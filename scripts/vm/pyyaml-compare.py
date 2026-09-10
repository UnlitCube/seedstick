#!/usr/bin/env python3
"""**消費者そのもの（PyYAML）に読ませて、こちらの方言と突き合わせる。**

`packages/shared/src/autoinstall/yaml.ts` と `yaml.test.ts` が持っている
「PyYAML はこの値をこう読む」という表は、**この出力を写したもの**である。
表を書き換えるときは必ずこれを走らせて実測に合わせること
（`yaml` パッケージの 1.1 は PyYAML の 1.1 と同じではない。落とし穴 117）。

    wsl -d Ubuntu-24.04 -u root -- python3 /mnt/c/dev/autoinstall-ui/scripts/vm/pyyaml-compare.py

PyYAML は cloud-init が依存しているので、Ubuntu の live 環境にも WSL にも必ずある。
"""

import yaml

VALUES = [
    # 60 進数。**先頭グループが `[1-9]` 始まりのときだけ** PyYAML は数にする。
    "52:54:00:12:34:56",
    "10:20:30:40:50:59",
    "59:59:59:59:59:59",
    "1:30",
    "00:50:56:12:34:56",   # VMware の OUI
    "08:00:27:12:34:56",   # VirtualBox の OUI
    "01:02:03:04:05:06",
    "00:00:00:00:00:00",
    "0:1:2",
    "52:54:00:ab:34:56",   # hex の英字が入ると 60 進数になりえない
    # 真偽値。`y` / `n` は PyYAML では**文字列**。
    "yes", "no", "on", "off", "y", "n", "true", "false",
    # 数の書き方。
    "0123", "0x1f", "0b101", "20250101", "0x5002538e40a1b2c3",
    "1e5", "1E5", "1e+5", "1.5e3", "1.5e+3", ".5", "1.", "-0", "+1", "1_000",
    # 紛らわしいが文字列のままのもの。
    "802.3ad", "layer3+4", "S3Y1NB0K123456",
]


def main() -> None:
    print(f"PyYAML {yaml.__version__}")
    for v in VALUES:
        r = yaml.safe_load(f"k: {v}")["k"]
        print(f"{v:<24} -> {type(r).__name__:<5} {r!r}")


if __name__ == "__main__":
    main()
