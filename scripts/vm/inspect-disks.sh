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
NAMES=()
for f in *.qcow2; do
  [ -e "$f" ] || continue
  raw="_probe-$I.raw"
  qemu-img convert -O raw "$f" "$raw" || continue
  RAWS+=("$raw")
  if lo=$(losetup -P -f --show -r "$raw" 2>/dev/null); then
    LOOPS+=("$lo")
    # **どの loop がどのディスクか**を覚える。「ESP は sda だけ」を言うのに要る。
    NAMES+=("${f%.qcow2}")
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

# --- 機械で読む形（`e2e-vm.mts` の RAID 用の判定がこれを読む）-----------------
# 名前 (`md0`) はホスト名つきで記録されるうえ、別のホストで組み立て直すと
# `/dev/md127` のように番号が変わる。**番号や名前だけに頼らない**ように、
# 「レベル・台数・その md の上に何があるか」も一緒に出す。
#   MD=<metadata の名前>|<レベル>|<台数>|<md 上の FSTYPE>|<デバイス名>
# md の上が
#   ext4        → /boot   (role: boot)
#   LVM2_member → LVM PV  (role: lvm-pv)
#   （空）       → **何も載っていない** (role: data。作るだけ)
for md in /dev/md[0-9]*; do
  [ -b "$md" ] || continue
  # `--export` は KEY=VALUE を並べるだけ。**eval しない**（値が何であれ壊れない）。
  det=$(mdadm --detail --export "$md" 2>/dev/null || true)
  nm=$(echo "$det" | sed -n 's/^MD_NAME=//p' | head -1)
  lv=$(echo "$det" | sed -n 's/^MD_LEVEL=//p' | head -1)
  nd=$(echo "$det" | sed -n 's/^MD_DEVICES=//p' | head -1)
  fs=$(lsblk -ndo FSTYPE "$md" 2>/dev/null | head -1)
  # **メンバーがディスク丸ごとか、パーティションか。**
  # 丸ごとメンバー (`usage: 'whole'`) が意図どおり出たかは、ここでしか機械で言えない
  # （`/dev/loop4p3` のように末尾に `pN` が付いていればパーティション）。
  mem=$(mdadm --detail "$md" 2>/dev/null | awk '/\/dev\/loop/ {printf "%s,", $NF}')
  echo "MD=${nm}|${lv}|${nd}|${fs}|$(basename "$md")|${mem%,}"
done

echo
echo "=== LVM ==="
# **必ず自分で有効化する。** udev の自動有効化に頼ると環境で結果が変わる。
vgchange -ay >/dev/null 2>&1 || true
pvs --noheadings -o pv_name,vg_name,pv_size 2>/dev/null || true
lvs --noheadings -o lv_name,vg_name,lv_size 2>/dev/null || true
pvs --noheadings -o pv_name,vg_name 2>/dev/null |
  while read -r pv vg; do echo "LVM_PV=${pv}|${vg}"; done
lvs --noheadings -o lv_name,vg_name 2>/dev/null |
  while read -r lv vg; do echo "LVM_LV=${lv}|${vg}"; done

# --- ESP はどのディスクに、いくつあるか ------------------------------------
# 「ESP は sda1 だけ」が守られたかを見る。**RAID に置けないので台数がそのまま
# 「1 台落ちたら起動しない」の台数**になる（落とし穴 97）。
ESP_TOTAL=0
ESP_DISKS=""
i=0
for lo in "${LOOPS[@]:-}"; do
  [ -n "$lo" ] || continue
  n=$(lsblk -lno FSTYPE "$lo" 2>/dev/null | grep -c '^vfat$' || true)
  if [ "$n" -gt 0 ]; then ESP_DISKS="$ESP_DISKS ${NAMES[$i]:-?}"; fi
  ESP_TOTAL=$((ESP_TOTAL + n))
  i=$((i + 1))
done
echo "ESP_PARTS=$ESP_TOTAL"
echo "ESP_DISKS=${ESP_DISKS# }"

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
# マウントポイントだけを 1 行に並べる。「md2 はどこにもマウントされていない」を
# 機械で言うため（**無いことの確認**は目視では抜けやすい）。
# **`/` で始まる列だけ**を取る。swap の行は 2 列目が `none` なので落とす
# （`/swap.img none swap sw 0 0`。これを数えると「余分なマウントがある」に見える）。
echo "FSTAB_MOUNTS=$(awk '!/^[[:space:]]*#/ && NF>=2 && $2 ~ /^\// {printf "%s ", $2}' "$MNT/etc/fstab" 2>/dev/null)"
if [ -f "$MNT/etc/mdadm/mdadm.conf" ]; then
  echo "--- /etc/mdadm/mdadm.conf ---"
  grep -E '^ARRAY' "$MNT/etc/mdadm/mdadm.conf" 2>/dev/null || echo "(ARRAY 行なし)"
  echo "MDADM_CONF_ARRAYS=$(grep -cE '^ARRAY' "$MNT/etc/mdadm/mdadm.conf" 2>/dev/null || echo 0)"
  # **`raid.name` がそのまま残るのはここ**（mdadm.conf の ARRAY 行のデバイス名）。
  # md のメタデータの `Name:` は `<homehost>:0` のように**数字になる**
  # （mdadm は `/dev/mdN` から名前を N と決める）ので、
  # 「md0 と名付けたものが md0 になったか」はこちらで見る。
  echo "MDADM_CONF_DEVS=$(awk '/^ARRAY/ {printf "%s ", $2}' "$MNT/etc/mdadm/mdadm.conf" 2>/dev/null)"
else
  echo "MDADM_CONF_ARRAYS=0"
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
