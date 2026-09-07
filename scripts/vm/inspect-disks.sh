#!/usr/bin/env bash
# インストールが終わったディスクを **VM を起動せずに** 開いて、
# 実際にできた RAID / LVM / ファイルシステムと、
# **私たちの user-data が効いたか**（ホスト名・ユーザー・SSH）を報告する。
#
# 起動して中で `lsblk` を打つ方法もあるが、それだと
# 「起動できた場合しか検査できない」。**起動しなかったときこそ中を見たい**。
#
# 使い方: inspect-disks.sh <lab-dir>
#
# ---------------------------------------------------------------------------
# **この環境で踏んだ罠（同じ道を通らないために残す）**
#
# 1. **`qemu-nbd --connect` は WSL では使えない。**
#    接続自体は rc=0 で返り、`blockdev --getsize64` も正しい値を返すのに、
#    **デーモンが直後に死ぬ**ので読むと 0 バイト（`Buffer I/O error`）。
#    「繋がっているのに読めない」ので原因が分かりにくい。
#    → `qemu-img convert -O raw` して **loop デバイス**で開く。
#      raw は疎ファイルなので 20 GB の見かけでも実使用は 5〜6 GB。
#
# 2. **`blkid` は WSL では空を返す**（udev が動いていない）。`lsblk` を使う。
#
# 3. **`/dev/mapper/xxx` のリンク経由でマウントしない。**
#    `readlink -f` で `/dev/dm-N` の実体にする。リンクのままだと
#    `already mounted or mount point busy` になる（実際は空いている）。
#
# 4. **ext4 のジャーナルが未再生**だと読み取り専用で開けない。`-o ro,noload`。
#
# 5. **全体を対象にする操作を使わない（重要）。**
#    WSL2 のカーネルは **Docker Desktop と共有**している。
#    `losetup -D`（全 loop を外す）や `dmsetup remove_all` は
#    **Docker の loop / dm まで巻き込む**（実際 loop0 / loop1 は
#    docker-desktop.iso のものだった）。自分が作ったものだけを名前で外す。
# ---------------------------------------------------------------------------
set -u
LAB="${1:?lab dir}"
cd "$LAB"

MNT=/mnt/vm-root
RAWS=()
LOOPS=()

cleanup() {
  umount "$MNT" 2>/dev/null || true
  vgchange -an >/dev/null 2>&1 || true
  mdadm --stop --scan >/dev/null 2>&1 || true
  # **自分が作った loop だけ**外す（`losetup -D` は Docker のものまで外す）
  for lo in "${LOOPS[@]:-}"; do [ -n "$lo" ] && losetup -d "$lo" 2>/dev/null || true; done
  for r in "${RAWS[@]:-}"; do [ -n "$r" ] && rm -f "$r" || true; done
}
trap cleanup EXIT

# 前回の残骸のうち、**このスクリプトが作るものだけ**を片付ける。
umount "$MNT" 2>/dev/null || true
vgchange -an >/dev/null 2>&1 || true
for name in $(dmsetup ls 2>/dev/null | awk '{print $1}' | grep -E '^(ubuntu--vg|vg0)' || true); do
  dmsetup remove --force "$name" 2>/dev/null || true
done
for old in _probe-*.raw; do [ -e "$old" ] && rm -f "$old"; done

# --- qcow2 を raw に変換して loop で開く
I=0
for f in *.qcow2; do
  [ -e "$f" ] || continue
  raw="_probe-$I.raw"
  qemu-img convert -O raw "$f" "$raw" || continue
  RAWS+=("$raw")
  if lo=$(losetup -P -f --show -r "$raw" 2>/dev/null); then
    LOOPS+=("$lo")
    echo "接続: $f → $lo"
  fi
  I=$((I + 1))
done
if [ ${#LOOPS[@]} -eq 0 ]; then
  echo "!! qcow2 が 1 つも無い（インストールが始まっていない）"
  exit 1
fi
sleep 2

echo
echo "=== パーティション ==="
lsblk -o NAME,SIZE,FSTYPE,LABEL "${LOOPS[@]}" 2>/dev/null

echo
echo "=== RAID ==="
mdadm --assemble --scan --readonly >/dev/null 2>&1 || true
grep -E '^(md|Personalities)' /proc/mdstat 2>/dev/null || echo "(md は無い)"
for md in /dev/md*; do
  [ -b "$md" ] || continue
  echo "--- $md ---"
  mdadm --detail "$md" 2>/dev/null |
    grep -E 'Raid Level|Array Size|Raid Devices|Active Devices|State :|Name :' || true
  mdadm --detail "$md" 2>/dev/null | grep -E '/dev/(loop|md)' || true
done

echo
echo "=== LVM ==="
# **必ず自分で有効化する。** udev の自動有効化に頼ると環境で結果が変わる。
vgchange -ay >/dev/null 2>&1 || true
pvs --noheadings -o pv_name,vg_name,pv_size 2>/dev/null || true
lvs --noheadings -o lv_name,vg_name,lv_size 2>/dev/null || true

# --- ここからが本題: **私たちの設定が効いたか** ------------------------------
echo
echo "=== インストールされたシステムの中身 ==="
mkdir -p "$MNT"
ROOT_DEV=""
for cand in /dev/mapper/* /dev/md* "${LOOPS[@]}"p*; do
  [ -b "$cand" ] || continue
  lsblk -no FSTYPE "$cand" 2>/dev/null | grep -qE '^ext[234]$' || continue
  real=$(readlink -f "$cand")
  if mount -t ext4 -o ro,noload "$real" "$MNT" 2>/dev/null; then
    if [ -f "$MNT/etc/hostname" ] && [ -d "$MNT/etc/apt" ]; then
      ROOT_DEV="$cand"
      break
    fi
    umount "$MNT" 2>/dev/null || true
  fi
done

if [ -z "$ROOT_DEV" ]; then
  echo "!! ルートファイルシステムが見つからない（インストールが終わっていない可能性）"
  exit 2
fi

echo "ルート: $ROOT_DEV"
echo "HOSTNAME=$(cat "$MNT/etc/hostname" 2>/dev/null | tr -d '\r\n')"
# 1000 番以上の一般ユーザー（初回起動で cloud-init が作る）
echo "USERS=$(awk -F: '$3>=1000 && $3<65534 {printf "%s ", $1}' "$MNT/etc/passwd" 2>/dev/null)"
echo "SUDO=$(grep -E '^sudo:' "$MNT/etc/group" 2>/dev/null | cut -d: -f4)"
echo "SSHD=$([ -f "$MNT/etc/ssh/sshd_config" ] && echo yes || echo no)"
echo "AUTHORIZED_KEYS=$(find "$MNT/home" -name authorized_keys 2>/dev/null | wc -l)"
echo "--- /etc/fstab ---"
grep -vE '^\s*#|^\s*$' "$MNT/etc/fstab" 2>/dev/null || true
if [ -f "$MNT/etc/mdadm/mdadm.conf" ]; then
  echo "--- /etc/mdadm/mdadm.conf ---"
  grep -E '^ARRAY' "$MNT/etc/mdadm/mdadm.conf" 2>/dev/null || echo "(ARRAY 行なし)"
fi
# **ユーザーはインストール時点では存在しない。**
# subiquity は cloud-init の設定に書くだけで、実際に作るのは初回起動時。
# 「設定が渡ったか」と「実際に作られたか」は**別の層**なので、両方出す。
CI=$MNT/etc/cloud/cloud.cfg.d/99-installer.cfg
if [ -f "$CI" ]; then
  # 99-installer.cfg は user-data を 1 本の YAML 文字列に畳んで持つ。
  # 改行がエスケープされて 1 行に並ぶので、`grep -oE 'name: ...'` の
  # **最初**を取ると `datasource` 側の値を拾ってしまう（`true` が出た）。
  # ユーザー定義は末尾側にあるので `tail -1` を取る。
  echo "CLOUDINIT_USER=$(grep -oE 'name: [A-Za-z0-9_-]+' "$CI" | tail -1 | awk '{print $NF}')"
  grep -q 'sudo' "$CI" && echo "CLOUDINIT_SUDO=yes" || echo "CLOUDINIT_SUDO=no"
fi
if [ -f "$MNT/var/log/installer/autoinstall-user-data" ]; then
  echo "AUTOINSTALL_USER_DATA=yes"
fi
