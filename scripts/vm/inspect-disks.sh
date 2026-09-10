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
# WSL には udev が無いので (`落とし穴 90`)、`/dev/mapper/` のノードが
# 出そろうまでの間がある。**待たずに mount のループへ行くと、
# インストールは成功しているのに「ルートが見つからない」と報告する**
# （実際に 1 回出した。落とし穴 92: 道具が不安定だと偽 FAIL になる）。
sleep 2
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

# **マウントの失敗理由を捨てない。**
# 以前は `mount ... 2>/dev/null` で握り潰していたので、インストールは成功しているのに
# 「ルートが見つからない」とだけ出て、**実装のバグに見える偽 FAIL** になった
# （落とし穴 92 / 117）。理由を出したうえで、1 度だけ落ち着かせて再試行する。
find_root() {
  # `/dev/dm-*` も候補に入れる。udev が無い環境では `/dev/mapper/` の
  # シンボリックリンクが揃わないことがあるが、`dm-N` の実体は必ずある。
  #
  # **`"${LOOPS[@]}"p*` と書いてはいけない。**
  # 配列の展開に接尾辞を付けると **最後の要素にしか付かない**
  # （`/dev/loop0` `/dev/loop1` `/dev/loop2p*` になる。実測）。
  # 前のディスクのパーティションが候補から抜け、代わりに
  # **ディスク丸ごと**が候補に入る。LVM / md が先に見つかるので
  # これまで表面化していなかっただけ。
  parts=()
  for lo in "${LOOPS[@]:-}"; do
    [ -n "$lo" ] || continue
    for pp in "$lo"p*; do [ -b "$pp" ] && parts+=("$pp"); done
  done
  for cand in /dev/mapper/* /dev/dm-* /dev/md* "${parts[@]:-}"; do
    [ -b "$cand" ] || continue
    fstype=$(lsblk -no FSTYPE "$cand" 2>/dev/null | head -1)
    case "$fstype" in ext2 | ext3 | ext4) ;; *) continue ;; esac
    real=$(readlink -f "$cand")
    if err=$(mount -t ext4 -o ro,noload "$real" "$MNT" 2>&1); then
      if [ -f "$MNT/etc/hostname" ] && [ -d "$MNT/etc/apt" ]; then
        ROOT_DEV="$cand"
        return 0
      fi
      echo "  ($cand は ext4 だが /etc/hostname が無い — /boot などの別の区画)"
      umount "$MNT" 2>/dev/null || true
    else
      echo "  ($cand をマウントできない: $err)"
    fi
  done
  return 1
}

if ! find_root; then
  # LVM / md がまだ落ち着いていないだけのことがある。**1 度だけ**やり直す。
  echo "  1 回目で見つからなかった。LVM と md をやり直して再試行する。"
  umount "$MNT" 2>/dev/null || true
  mdadm --assemble --scan --readonly >/dev/null 2>&1 || true
  vgchange -ay >/dev/null 2>&1 || true
  sleep 5
  find_root || true
fi

if [ -z "$ROOT_DEV" ]; then
  echo "!! ルートファイルシステムが見つからない（インストールが終わっていない可能性）"
  echo "INSPECT_RESULT=no-root"
  # 何が見えていたのかを残す。次に同じことが起きたときに原因を絞れる。
  echo "--- 見えていたブロックデバイス ---"
  lsblk -o NAME,SIZE,FSTYPE,TYPE "${LOOPS[@]}" 2>/dev/null || true
  echo "--- dm ---"
  dmsetup ls 2>/dev/null || true
  exit 2
fi
echo "INSPECT_RESULT=ok"

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
# --- bond（netplan）--------------------------------------------------------
# **ここには層が 3 つある**（落とし穴 93 / 112）:
#   1. subiquity が `/etc/cloud/cloud.cfg.d/90-installer-network.cfg` に書く
#      ……インストール直後に**もうある**
#   2. cloud-init が初回起動で `/etc/netplan/50-cloud-init.yaml` を書き出す
#      ……**インストール直後にはまだ無い**
#   3. 実際にリンクが上がる ……起動後のシステムの中でしか分からない
#
# インストール直後の検査で 2 を見て「bonds が無い」と報告したことがある
# ——**正しく組めているのに 4 件の偽 FAIL** を出した（管理ユーザーの件と同じ形）。
# だから**両方読み、どちらを読んだかを出す**。
# 3 は `e2e-vm.mts` が起動時のシリアル出力から拾う。
NP=""
NETPLAN_SOURCE=none
if [ -d "$MNT/etc/netplan" ]; then
  # インストーラが置く netplan は 1 本とは限らない。全部まとめて見る。
  NP=$(cat "$MNT"/etc/netplan/*.yaml 2>/dev/null)
  [ -n "$NP" ] && NETPLAN_SOURCE=netplan
fi
if [ -z "$NP" ] && [ -f "$MNT/etc/cloud/cloud.cfg.d/90-installer-network.cfg" ]; then
  NP=$(cat "$MNT/etc/cloud/cloud.cfg.d/90-installer-network.cfg" 2>/dev/null)
  [ -n "$NP" ] && NETPLAN_SOURCE=installer-cfg
fi
echo "NETPLAN_SOURCE=$NETPLAN_SOURCE"
if [ -n "$NP" ]; then
  echo "NETPLAN_HAS_BONDS=$(echo "$NP" | grep -qE '^[[:space:]]*bonds:' && echo yes || echo no)"
  # bond のデバイス名（`bonds:` の直下のキー）
  echo "BOND_NAMES=$(echo "$NP" | awk '/^[[:space:]]*bonds:/{f=1;next} f&&/^[[:space:]]{4}[a-zA-Z0-9_-]+:/{gsub(/[[:space:]:]/,"");printf "%s ",$0;next} f&&/^[[:space:]]{0,2}[a-zA-Z]/{f=0}')"
  # メンバー（`interfaces:` の配列）。**2 枚あるはず**。
  #
  # **ブロック形式とフロー形式の両方を読む。**
  #   ブロック: `interfaces:` の次行から `- nic-a` / `- nic-b`
  #   フロー  : `interfaces: [nic-a, nic-b]`
  # 実測した 24.04.3 + cloud-init はブロック形式で書き出すが、
  # **どちらで書き出すかは cloud-init の実装都合**で、こちらが決められない。
  # 片方しか読めない検査は「正しく組めているのに FAIL」を出す
  # （落とし穴 106 / 113 と同じ「静かに嘘の FAIL」）。
  echo "BOND_MEMBERS=$(echo "$NP" | awk '
    /^[[:space:]]*interfaces:[[:space:]]*\[/ {
      line = $0
      sub(/^[^[]*\[/, "", line); sub(/\].*$/, "", line)
      n = split(line, a, ",")
      for (i = 1; i <= n; i++) { gsub(/[[:space:]"'"'"']/, "", a[i]); if (a[i] != "") printf "%s ", a[i] }
      next
    }
    /^[[:space:]]*interfaces:[[:space:]]*$/ { f = 1; next }
    f && /^[[:space:]]*-[[:space:]]*[a-zA-Z0-9_.-]+[[:space:]]*$/ {
      # **先頭の "- " だけを落とす。** 以前は `gsub(/[-]/,"")` で
      # 名前の中のハイフンまで消していたので、ブロック形式とフロー形式で
      # 同じ bond のメンバー名が違って見えた（`nic525400123456` と `nic-525400123456`）。
      v = $0
      sub(/^[[:space:]]*-[[:space:]]*/, "", v)
      gsub(/[[:space:]"'"'"']/, "", v)
      printf "%s ", v
      next
    }
    f { f = 0 }
  ')"
  # **cloud-init が書き出す netplan は値をクォートする**（`mode: "active-backup"`）。
  # subiquity 側は素で書く。フロー形式 (`parameters: {mode: active-backup, ...}`) もありうる。
  # どれでも読めるように、`mode:` の後ろを次の区切り (`,` `}` 行末) まで取ってから
  # クォートと空白を落とす。
  echo "BOND_MODE=$(echo "$NP" | sed -n 's/.*[^a-z-]mode:[[:space:]]*\([^,}]*\).*/\1/p; s/^mode:[[:space:]]*\([^,}]*\).*/\1/p' | head -1 | tr -d '"'"'"' \r')"
  # メンバー側にアドレスが付いていないこと（落とし穴 100）。
  # `ethernets:` 節の中に `addresses:` が出たら誤り。
  echo "ETHERNETS_HAS_ADDRESSES=$(echo "$NP" | awk '/^[[:space:]]*ethernets:/{f=1;next} f&&/^[[:space:]]*bonds:/{f=0} f&&/addresses:/{print "yes";exit}')"
  # **実際に入っている IPv4 アドレス。**
  # 起動メニューで選んだ値が反映されたかを見るのに要る。
  # ブロック形式（`addresses:` の次行から `- 10.0.2.101/24`）と
  # フロー形式（`addresses: [10.0.2.101/24]`）の両方を読む
  # ——どちらで書き出すかは cloud-init の実装都合で、こちらが決められない（落とし穴 113）。
  # **CIDR（`/` を含むもの）だけを取る。**
  # `nameservers:` の下にも `addresses:` があり、そちらは DNS サーバの
  # 素の IP（`10.0.2.3`）なので `/` が無い。これで自然に分かれる
  # ——インデントを数えて `nameservers` 節を避ける実装より短く、崩れにくい。
  # クォートの有無も問わない（cloud-init は値をクォートして書き出す。落とし穴 113）。
  echo "NETPLAN_ADDRESSES=$(echo "$NP" | awk '
    /^[[:space:]]*addresses:[[:space:]]*\[/ {
      line = $0
      sub(/^[^[]*\[/, "", line); sub(/\].*$/, "", line)
      n = split(line, a, ",")
      for (i = 1; i <= n; i++) {
        gsub(/[[:space:]"'"'"']/, "", a[i])
        if (a[i] ~ /\//) printf "%s ", a[i]
      }
      next
    }
    /^[[:space:]]*addresses:[[:space:]]*$/ { f = 1; next }
    f && /^[[:space:]]*-[[:space:]]*["'"'"']?[0-9]/ {
      v = $0
      sub(/^[[:space:]]*-[[:space:]]*/, "", v)
      gsub(/[[:space:]"'"'"']/, "", v)
      if (v ~ /\//) printf "%s ", v
      next
    }
    f { f = 0 }
  ')"
fi

# --- 起動メニューで選んだ値が反映されたか（early-commands の記録）------------
# **「netplan にその値が入っている」と「early-commands が反映した」は別の層。**
# 前者だけを見ると、プロファイルの既定値がたまたま同じでも通ってしまう。
# 置換スクリプトは反映した引数を 1 行にまとめて標準出力へ書き、
# それがインストーラのログに残る（成功時は `/var/log/installer/` ごと
# インストール先へ複製される）。
# **スクリプトの「ソース」と「出力」を取り違えない。**
# インストーラのログには early-commands の**本文**もそのまま記録される。
# 本文には `sys.stdout.write("… 反映しました: %s\n" % …)` という行があるので、
# 素直に grep すると **`%s` を答えとして拾う**（実際に拾って偽 FAIL を出した）。
# 出力側は必ず `ai.` で始まる引数名が並ぶので、そこで見分ける。
APPLIED=""
for f in "$MNT"/var/log/installer/installer-journal.txt \
         "$MNT"/var/log/installer/*.log* \
         "$MNT"/var/log/syslog; do
  [ -f "$f" ] || continue
  hit=$(grep -a -o '起動時の指定を反映しました: ai\.[a-z0-9., ]*' "$f" 2>/dev/null |
    grep -v '%s' | tail -1)
  if [ -n "$hit" ]; then APPLIED="$hit"; break; fi
done
if [ -n "$APPLIED" ]; then
  echo "RUNTIME_APPLIED_LINE=$APPLIED"
  # 反映された引数の名前だけを並べる（`ai.ipv4 ai.gw ai.dns` のような形）。
  echo "RUNTIME_APPLIED=$(echo "$APPLIED" | sed 's/.*反映しました:[[:space:]]*//' | tr -d '\r' | tr ',' ' ' | tr -s ' ')"
else
  echo "RUNTIME_APPLIED="
fi

# --- ESP のミラー（2 台目にも GRUB が入ったか）------------------------------
# `grub_device` は 1 台目の ESP にしか付かないので（落とし穴 98）、
# 2 台目は **late-commands が複製する**。その結果をここで見る。
# ログは `raidEspMirrorCommand()` が必ず 1 行 `RESULT:` を書く。
if [ -f "$MNT/var/log/autoinstall-raid-esp.log" ]; then
  echo "ESP_MIRROR_RESULT=$(grep -oE '^RESULT: [a-z]+' "$MNT/var/log/autoinstall-raid-esp.log" | tail -1 | awk '{print $2}')"
  echo "--- /var/log/autoinstall-raid-esp.log ---"
  tail -20 "$MNT/var/log/autoinstall-raid-esp.log"
else
  echo "ESP_MIRROR_RESULT=none"
fi
# 2 台目の ESP を実際に開いて、起動に使えるものが入っているかを見る。
# **ログが ok と書いていても、中身が空なら起動しない。**
ESP_WITH_LOADER=0
for lo in "${LOOPS[@]:-}"; do
  [ -n "$lo" ] || continue
  for part in "$lo"p*; do
    [ -b "$part" ] || continue
    [ "$(lsblk -no FSTYPE "$part" 2>/dev/null)" = "vfat" ] || continue
    mkdir -p /mnt/vm-esp
    if mount -o ro "$part" /mnt/vm-esp 2>/dev/null; then
      # 署名版 shim / GRUB か、フォールバックの BOOTX64.EFI があれば起動できる形。
      if [ -f /mnt/vm-esp/EFI/BOOT/BOOTX64.EFI ] || [ -d /mnt/vm-esp/EFI/ubuntu ]; then
        ESP_WITH_LOADER=$((ESP_WITH_LOADER + 1))
      fi
      umount /mnt/vm-esp 2>/dev/null || true
    fi
  done
done
echo "ESP_WITH_LOADER=$ESP_WITH_LOADER"

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

# --- bond の第 3 の層: **実際にリンクが上がったか** -------------------------
# 「netplan に書かれたか」（層 1・2）と「リンクが上がったか」は別（落とし穴 112）。
# 起動後のシステムのログにしか残らないので、**起動後の検査でだけ**値が出る。
#
# 見るのは systemd-networkd の記録。Ubuntu Server は rsyslog を入れるので
# `/var/log/syslog` に出るが、入っていない構成もあるので
# **journal のバイナリを `strings` で読む**経路も用意する（どちらも読めなければ空）。
# 空＝「まだ起動していない」であって「リンクが上がらなかった」ではない。
BOND_LOG=""
if [ -f "$MNT/var/log/syslog" ]; then
  BOND_LOG=$(grep -a -E 'bond0' "$MNT/var/log/syslog" 2>/dev/null | tail -40)
fi
if [ -z "$BOND_LOG" ] && [ -d "$MNT/var/log/journal" ]; then
  BOND_LOG=$(find "$MNT/var/log/journal" -name '*.journal' -exec strings {} + 2>/dev/null |
    grep -a -E 'bond0' | tail -40)
fi
if [ -n "$BOND_LOG" ]; then
  echo "--- bond0 のログ（末尾）---"
  echo "$BOND_LOG" | tail -12
  echo "BOND_LOG_SEEN=yes"
  # `Gained carrier` = リンクが上がった。`DHCPv4 address` = アドレスが付いた。
  echo "BOND_CARRIER=$(echo "$BOND_LOG" | grep -qiE 'bond0.*(gained carrier|link.*up)' && echo yes || echo no)"
  echo "BOND_ADDRESS=$(echo "$BOND_LOG" | grep -aoiE 'bond0: DHCPv4 address [0-9./]+' | tail -1 | awk '{print $NF}')"
  # **カーネルが何枚 enslave したか。** netplan に 2 枚と書いてあることと、
  # カーネルが実際に 2 枚束ねたことは別（落とし穴 100:
  # 「2 枚あるつもりの冗長化が 1 枚」は実機で片方を抜くまで気づけない）。
  # active-backup なら 1 枚が active、残りが backup になる。
  echo "BOND_SLAVES=$(echo "$BOND_LOG" | grep -acE 'bond0: \(slave [a-z0-9]+\): Enslaving as')"
  echo "BOND_ACTIVE_SLAVES=$(echo "$BOND_LOG" | grep -acE 'Enslaving as an active interface')"
  echo "BOND_BACKUP_SLAVES=$(echo "$BOND_LOG" | grep -acE 'Enslaving as a backup interface')"
else
  echo "BOND_LOG_SEEN=no"
fi
