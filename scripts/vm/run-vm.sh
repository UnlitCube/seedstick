#!/usr/bin/env bash
# QEMU で「作った USB イメージから起動して無人インストールを完走させる」ための土台。
#
# **Windows からは直接 QEMU を動かせない**（この環境に QEMU が無く、Windows 11 Home は
# Hyper-V も無い）。WSL2 の Ubuntu には /dev/kvm があるので、そちらで動かす。
# 呼び出し側（`scripts/e2e-vm.mts`）が wsl.exe 経由でこれを叩く。
#
# 使い方:
#   run-vm.sh install <img> <lab-dir> <disk-spec...>   USB から起動してインストール
#   run-vm.sh boot    <lab-dir> <disk-spec...>         インストール済みディスクから起動
#
# disk-spec は「名前:サイズ」（例 sda:450G）。qcow2 で疎に作るので実容量は使った分だけ。
set -u

MODE="${1:?mode}"
shift

LAB=""
IMG=""
if [ "$MODE" = "install" ]; then IMG="${1:?img}"; shift; fi
LAB="${1:?lab dir}"; shift

mkdir -p "$LAB"
cd "$LAB"

OVMF_CODE=/usr/share/OVMF/OVMF_CODE_4M.fd
[ -f OVMF_VARS.fd ] || cp /usr/share/OVMF/OVMF_VARS_4M.fd OVMF_VARS.fd

# --- ディスクを用意する（既にあれば作り直さない＝インストール後の再起動で中身を保つ）
DISK_ARGS=()
IDX=0
for spec in "$@"; do
  name="${spec%%:*}"
  size="${spec##*:}"
  [ -f "$name.qcow2" ] || qemu-img create -q -f qcow2 "$name.qcow2" "$size"
  # NVMe と SATA を作り分ける（利用者の構成に nvme が出てくる）。
  # 名前が nvme で始まるものは NVMe として見せる。
  if [ "${name#nvme}" != "$name" ]; then
    DISK_ARGS+=(-drive "file=$name.qcow2,if=none,id=d$IDX,format=qcow2"
                -device "nvme,drive=d$IDX,serial=$name")
  else
    DISK_ARGS+=(-drive "file=$name.qcow2,if=none,id=d$IDX,format=qcow2"
                -device "virtio-blk-pci,drive=d$IDX,serial=$name")
  fi
  IDX=$((IDX + 1))
done

BOOT_ARGS=()
if [ "$MODE" = "install" ]; then
  # 作った USB イメージを **USB メモリとして**挿す（実機と同じ経路で起動させる）。
  BOOT_ARGS+=(-drive "file=$IMG,if=none,id=usbstick,format=raw"
              -device qemu-xhci,id=xhci
              -device "usb-storage,bus=xhci.0,drive=usbstick,bootindex=0")
fi

# シリアルをログに落とす。GUI は出さない（WSL に X が無い）。
: "${VM_MEM:=4096}"
: "${VM_CPUS:=4}"
: "${VM_TIMEOUT:=3600}"

echo "=== QEMU 起動 ($MODE) mem=${VM_MEM}M cpus=${VM_CPUS} timeout=${VM_TIMEOUT}s ==="
timeout "$VM_TIMEOUT" qemu-system-x86_64 \
  -accel kvm -cpu host -smp "$VM_CPUS" -m "$VM_MEM" \
  -machine q35 \
  -drive "if=pflash,format=raw,unit=0,readonly=on,file=$OVMF_CODE" \
  -drive "if=pflash,format=raw,unit=1,file=OVMF_VARS.fd" \
  -netdev user,id=net0 -device virtio-net-pci,netdev=net0 \
  "${DISK_ARGS[@]}" "${BOOT_ARGS[@]}" \
  -display none -serial mon:stdio -no-reboot
RC=$?
echo "=== QEMU 終了 rc=$RC ==="
exit $RC
