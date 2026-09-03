# R7: 競合・類似ツール調査 / 初心者向け・商用 UX 要件 / Electron 配布要件

調査日: 2026-09-03。担当範囲: 競合ツールの機能とUX、安全UI、検証、商用ライセンス・法務、Electron 配布。
対象 Ubuntu Server: 22.04 LTS / 24.04 LTS / 25.10 / 26.04 LTS。
ISO の物理構造は `docs/research/ISO-FACTS.md`（実測済み）を前提とする。

---

## 0. エグゼクティブサマリ

1. **手本にすべきは Raspberry Pi Imager 2.0 の「6ステップ・ウィザード」**（Device → OS → Storage → Customisation → Writing → Done）。OS カスタマイズを「隠し設定」から「一級市民のウィザード段」へ昇格させたのが 2.0 の核心的改善。本ツールも同型を採る。
2. **Rufus / Ventoy / Cubic は GPL-3.0、Fedora Media Writer は GPL-2.0**。商用クローズドソースの Electron アプリにこれらのコードを取り込む/リンクすることはできない。**balenaEtcher（Apache-2.0）系の `drivelist` / `etcher-sdk`、および Raspberry Pi Imager 本体コード（Apache-2.0）は取り込み可能**。
3. **Ubuntu ISO を改変して再配布してはならない**。Canonical の IP ポリシーは「You can redistribute Ubuntu, but only where there has been no modification to it.」と明記。本ツールは「ユーザー端末上でユーザー自身が入手した ISO をローカル改変する」設計にとどめ、改変済み ISO を出荷・配布しない。
4. **製品名に "Ubuntu" を含めてはならない**。「You cannot use the Trademarks in software titles.」。ただし「for use with or on Ubuntu」の文脈で参照することは許される（推奨表現は後述）。
5. **2026-09-03 時点で Ubuntu 25.10 は既に EOL（2026-07-09）**。バージョン選択 UI にサポート期限とEOL警告を出すことが必須。
6. **Electron 44（2026-08-25）で Windows x86(ia32) と Linux armv7l のビルドが廃止、macOS 13 以上が必須**。配布ターゲットを x64/arm64 に限定する必要がある。
7. **SmartScreen: EV 証明書による警告バイパスは既に廃止されている**（Microsoft Learn 明記）。「EV を買えば警告が出ない」という前提で見積もると失敗する。
8. **raw ディスク書き込みには昇格が必須だが、`win.requestedExecutionLevel` は portable ターゲットで機能しない既知不具合がある**。アプリ本体は asInvoker のままにし、書き込み時だけ昇格ヘルパープロセスを起動する設計が唯一堅い。

---

## 1. 競合・類似ツール一覧（機能・ライセンス比較）

| ツール | 種別 | ライセンス | 実装 | ISO改変 | 自動応答設定 | 書き戻し検証 | GUI |
|---|---|---|---|---|---|---|---|
| Rufus | USB 書き込み | **GPL-3.0** | C / Win32 | ISO Image モード時にファイル展開 | 無し（persistence のみ） | 不良ブロック検査（任意） | Win のみ |
| balenaEtcher | USB 書き込み | **Apache-2.0** | Electron / TS | 無し（raw dd） | 無し | あり（Validated Flashing） | Win/mac/Linux |
| Ventoy | マルチブート USB | **GPL-3.0** | C | 無し（ISO をファイルとして置く） | **あり（Auto Install プラグイン）** | 無し | Win/Linux |
| Cubic | ISO リマスタ | **GPL-3.0** | Python/GTK | あり（chroot で全面改変） | 間接的（squashfs に埋込） | 無し | Linux のみ |
| Fedora Media Writer | USB 書き込み | **GPL-2.0** | C++/Qt | 無し | 無し | **あり（全読み戻し）** | Win/mac/Linux |
| **Raspberry Pi Imager** | USB/SD 書き込み + 設定注入 | **Apache-2.0**（本体コード） | C++/Qt | 無し（FAT boot 領域にファイル追記） | **あり（cloud-init / firstrun.sh / rpi-preseed）** | **あり（書込時ブロック検証を強制）** | Win/mac/Linux |
| ubuntu-autoinstall-generator | ISO 生成スクリプト | MIT | Bash + xorriso | あり（再ビルド） | あり（user-data 埋込） | 無し | CLI のみ |
| Canonical MAAS | ベアメタル・プロビジョニング | AGPL-3.0 系 | Python | 無し（PXE） | あり | N/A | Web |
| Canonical Landscape | 運用管理 | 商用 | — | 無し | N/A | N/A | Web |

出典:
- https://api.github.com/repos/pbatard/rufus （license.spdx_id = `GPL-3.0`）
- https://github.com/balena-io/etcher/blob/master/LICENSE （Apache-2.0）
- https://api.github.com/repos/ventoy/Ventoy （`GPL-3.0`）
- https://launchpad.net/cubic （GNU GPL v3）
- https://api.github.com/repos/FedoraQt/MediaWriter （`GPL-2.0`）
- https://api.github.com/repos/raspberrypi/rpi-imager/license （`license.txt`: 本体 Apache-2.0 + 第三者コンポーネント一覧）
- https://api.github.com/repos/covertsh/ubuntu-autoinstall-generator （MIT、最終 push 2024-03-19）

### 1.1 Rufus（Windows 専用、C、GPL-3.0）

- **安全UI の要**: USB HDD は既定で一覧に出さない。`List USB Hard Drives` は「Advanced drive properties」内のオプトイン設定で、公式 FAQ が **"an unsupported mode ... it can be a potentially risky operation when Rufus is used by non-technical users"** と位置付けている。→ **「初心者が誤って外付け HDD/内蔵ディスクを焼く」ことを、機能を隠すことで防ぐ**という設計思想。本ツールも同じ二段構え（既定=USB リムーバブルのみ / 明示オプトインで拡張）を採るべき。
- **ISOHybrid ダイアログ**: ハイブリッド ISO を選ぶと「ISO Image mode（ファイルコピー）」と「DD Image mode（バイト単位）」の選択ダイアログを出し、**ISO Image mode を推奨**する。理由は「書き込み後もドライブにフルアクセスできるから」。→ Ubuntu live-server ISO も同じジレンマがある（DD だと Windows から中身をいじれない）。本ツールは DD 前提だが、**「書き込み後に Windows で『フォーマットしますか？』と聞かれるのは正常です」というアフターケア文言が必須**（Rufus が長年ユーザー混乱の一次窓口になっている領域）。
- **検証**: ISO の MD5/SHA-1/SHA-256/SHA-512 を計算する機能あり。ダウンロード物の SHA-256 検証もある。
- **多言語**: 単一実行ファイルに約 40 言語を内蔵（追加ダウンロード不要）。公式 Wiki は「最も普及した 35 前後の言語」を基準に選定したと説明。
- **商用上の帰結**: GPL-3.0 のため**コード流用は不可**。参考にできるのは UX の設計判断のみ。

出典: https://github.com/pbatard/rufus/wiki/FAQ , https://github.com/pbatard/rufus/wiki/Localization , https://github.com/pbatard/rufus

### 1.2 balenaEtcher（Electron、Apache-2.0）

- **同じ技術スタック（Electron）で商用配布されている先行事例**。ライセンスが Apache-2.0 なので、**部品の再利用が法的に安全**な唯一の主要ツール。
  - `drivelist`（balena-io-modules、Apache-2.0）: クロスプラットフォームのドライブ列挙。`isSystem` / `isRemovable` などのフラグを返す。**Raspberry Pi Imager もこの drivelist を採用している**（rpi-imager の `license.txt` 第三者一覧に "Balena.io Drivelist — Apache License" と記載、かつ `src/drivelist/` ディレクトリが存在）。
  - `etcher-sdk`（Apache-2.0）: ブロックデバイスへのイメージ書き込みコア。
- **安全UI**: システムドライブは既定で非表示（内蔵ディスクを一覧から除外）。
- **検証**: 書き込み後に読み戻して元イメージと突合する "Validated Flashing"。
- **反面教師（重要）**: macOS で **OS 純正に見せかけた自前のパスワード入力ダイアログを出して平文パスワードを自前で受け取っていた**ことが強く批判された（balena-io/etcher issue #3321、#4052）。指摘の中で「Raspberry Pi Imager は OS 標準の権限昇格機構を使っている」と対比されている。→ **本ツールは絶対に自前のパスワード UI を作らない**。Windows は UAC、macOS は Authorization Services、Linux は polkit/pkexec に委譲する。

出典: https://github.com/balena-io/etcher/blob/master/LICENSE , https://www.npmjs.com/package/drivelist , https://www.npmjs.com/package/etcher-sdk , https://github.com/balena-io/etcher/issues/3321 , https://github.com/balena-io/etcher/issues/4052

### 1.3 Ventoy（GPL-3.0）

- **設計思想が根本的に違う**: USB を Ventoy 形式にフォーマットし、以後は **ISO ファイルをコピーするだけ**。書き込みのたびに全体を焼き直さない。
- **Auto Install プラグイン**が本ツールと直接競合する。`ventoy/ventoy.json` に以下の形式で自動応答テンプレートを紐付ける:

```json
{
    "auto_install": [
        {
            "image": "/abc/centos.iso",
            "template": "/ventoy/script/centos_kickstart.cfg"
        },
        {
            "parent": "/ISO/SUSE",
            "template": "/ventoy/script/suse_autoyast.xml"
        }
    ]
}
```

  - キー: `image`（ISO パス、あいまい一致可）/ `parent`（ディレクトリ単位で適用）/ `template`（文字列または配列で複数テンプレート）/ `autosel`（既定選択の整数、0=テンプレート無しで起動）/ `timeout`（メニュータイムアウト秒）。
  - 起動時にテンプレート選択メニューが出る。**複数テンプレートを切り替えられる**のが強み。
  - 公式の対応表は "Ubuntu Server (< 20.x)" = preseed、"Ubuntu Server (20.x+)" = cloud-init と記載。subiquity の `autoinstall` スキーマは明示されていない。
- **Secure Boot**: Ventoy 1.0.76 以降、Ventoy2Disk に Secure Boot オプションがある。ただし **MokManager で `ENROLL_THIS_KEY_IN_MOKMANAGER.cer` を手動登録する必要がある**。Ventoy の既定ポリシーは「secure boot を完全にバイパスする」ため、企業環境では受け入れられないことがある。
  - → **本ツールの強み**: Ubuntu 公式 ISO をそのまま DD する方式なら、**Canonical 署名済み shim/grub がそのまま使われるため Secure Boot を有効のまま何もせず起動できる**。これは Ventoy に対する明確な優位点であり、UI 上で明示すべき差別化ポイント。
- GPL-3.0 のためコード流用不可。

出典: https://www.ventoy.net/en/plugin_autoinstall.html , https://github.com/ventoy/Ventoy/blob/master/SecureBoot.md , https://ventoy.net/en/doc_secure.html

### 1.4 Cubic（GPL-3.0、Linux 専用）

- ISO を展開 → squashfs を chroot して**中身を丸ごと改変** → 再ビルドする「リマスタ」ツール。GUI ウィザードで前後に自由に行き来できる。
- **本ツールが取るべきでないアプローチ**の代表。理由:
  1. Linux 上でしか動かない（chroot が必要）。Win/mac 対応が不可能。
  2. 改変後の ISO は Canonical の商標条件（1.5 節・8 節）に抵触しうる。
  3. 数十 GB の一時領域と長時間の再ビルドを要し、初心者向け UX と相容れない。
- ただし「前後に自由に移動できるウィザード」「重要パラメータに賢いデフォルトを自動投入」という UX 方針は取り入れる価値がある。

出典: https://launchpad.net/cubic , https://github.com/PJ-Singh-001/Cubic

### 1.5 Fedora Media Writer（GPL-2.0、Qt）

- **検証設計が最も厳格**で、参考価値が高い:
  1. リリースメタデータ（HTTPS 経由）に含まれる SHA256 と、ダウンロード中に計算したハッシュを突合（「偽物か否か」の判定）。
  2. ISO 内蔵の MD5（implanted md5）をダウンロード直後に検証。
  3. **書き込み後、全体を読み戻して検証**。
- **容量ヒューリスティック**: 選択されたドライブが **160 GB を超える場合に追加警告**を出す。「外付けディスクを誤選択した可能性を示す」ためであり、公式ドキュメントは「これはあくまで追加の安全確認であり、小さいドライブにも取り返しのつかないデータが入りうる」と釘を刺している。
  - → 本ツールでは USB メモリ用途を想定し、**閾値を 64 GB 程度に下げた警告**が妥当（後述チェックリスト）。

出典: https://github.com/FedoraQt/MediaWriter/blob/main/CRYPTOGRAPHY.md , https://github.com/FedoraQt/MediaWriter

### 1.6 ubuntu-autoinstall-generator 系（MIT、Bash）

- `xorriso` で ISO を展開・再ビルドし、`user-data` / `meta-data` を焼き込む（`-a, --all-in-one`）。
- **GPG 検証を内蔵**: `SHA256SUMS-<date>` と `SHA256SUMS-<date>.gpg` で ISO の真正性を検証。Ubuntu 署名鍵をスクリプトディレクトリ内の新規キーリングにダウンロードする。`-k, --no-verify` で無効化可。
- **最終更新 2024-03-19 で事実上メンテ停止**。25.10 / 26.04 は未検証であり、24.04 以降の autoinstall スキーマ厳格化（未知キーの拒否）にも追随していない。多数のフォーク（`ubuntu-24.04-autoinstall-generator` 等）が乱立しているのはこのため。
- **ライセンス上は MIT なのでロジックの参照・移植が可能**だが、**`xorriso` 自体は GPL-3.0** である点に注意（8 節）。本ツールは ISO-FACTS のインプレース改変方式を採ることで xorriso 依存を回避できる。

出典: https://github.com/covertsh/ubuntu-autoinstall-generator , https://github.com/covertsh/ubuntu-autoinstall-generator/blob/main/README.md , https://api.github.com/repos/covertsh/ubuntu-autoinstall-generator

### 1.7 Canonical MAAS / Landscape

- **MAAS**: マシンのライフサイクル（Enlistment → Commissioning → Deploy）を管理する PXE ベースのベアメタル・プロビジョニング。Commissioning では一時的な Ubuntu イメージで起動して CPU/RAM/ストレージ/NIC をプローブする。**ネットワークブート前提**なので、「ネットワークが無い/PXE が使えない現場で USB 1 本から入れたい」というニーズは埋められない。
- **Landscape**: 導入後の運用（パッチ、監査、アクセス管理、コンプライアンス）。MAAS と組み合わせる想定。
- **競合ではなく上流/下流**。本ツールのポジションは「MAAS を立てるほどではない 1〜数十台規模、あるいは MAAS 自体をブートストラップする最初の 1 台」。UI 上で「大規模なら MAAS へ」と誘導する導線を持つと、商用製品としての誠実さが増す。

出典: https://canonical.com/maas/docs/about-the-machine-life-cycle , https://canonical.com/maas/docs/about-commissioning-machines , https://canonical.com/maas

---

## 2. Raspberry Pi Imager の "OS customisation" UX 徹底分解（本ツールの手本）

### 2.1 ウィザード構成（Imager 2.0）

Imager 2.0 は単一ウィンドウ + モーダルだった 1.x を捨て、**左側にステップ一覧を持つ 6 段ウィザード**に再設計された。

> 「Setup steps on the left are **Device, OS, Storage, Customisation, Writing and Done**」

各ステップは**ウィンドウ全体を使い**、説明文・バリデーションのフィードバック・関連ドキュメントへのリンクを置く専用スペースを持つ。OS カスタマイズを「隠れた副ウィンドウ」から「メインワークフローの一級市民」へ昇格させたのが最大の変更点。

その他 2.0 の設計判断:
- **書き込み時のブロック検証を強制**。開発者コメント: *"force the operating system to confirm blocks are written as we perform the write"*。速度より信頼性を優先し、不良なカードリーダー組み合わせを露見させる方針。
- **スクリーンリーダー向けのアクセシビリティラベル**を付与し、**完全なキーボード操作**に対応。コミュニティ翻訳者は UI 文字列に加えて **"accessibility strings" も翻訳**している。
- 配色は視認性を上げる方向に刷新（Raspberry Red 基調）、余白を大きく取る。

出典: https://www.raspberrypi.com/news/a-new-raspberry-pi-imager/ , https://www.raspberrypi.com/documentation/computers/getting-started.html

### 2.2 収集する項目と、どこに置くか

Imager 2.x のカスタマイズは以下のステップに分割されている（`deepwiki` によるコード構造の要約と、公式ドキュメントの記述が一致）:

| ステップ | 収集項目 |
|---|---|
| Hostname | ホスト名（英数字とハイフンのみ、というバリデーション文言を明示） |
| User Account | ユーザー名、パスワード、passwordless sudo |
| WiFi Configuration | SSID（**OS から現在の SSID を自動取得** `ImageWriterSingleton.getSSID()`）、PSK、hidden、国コード |
| Locale Configuration | **「首都（capital city）を選ぶ」だけ**でタイムゾーン・キーボードレイアウト・国コードを一括で推定 |
| Remote Access | SSH パスワード認証 / SSH 公開鍵（`SshKeyManager.qml`、`ssh-keygen` を叩く生成ボタン付き） |
| Pi Connect | 組織 API キーによる事前登録 |
| Interfaces & Features | I2C / SPI / 1-Wire / シリアルコンソール / USB ガジェット |

**最も学ぶべき UX 判断は「Locale = 首都を1つ選ばせる」**。初心者に `Asia/Tokyo`・`jp`・`JP`・`ja_JP.UTF-8` の 4 つを別々に答えさせない。本ツールでも **「国／都市を1つ選ぶ → timezone / keyboard.layout / locale を自動導出、上級者だけ個別に上書き可能」**とすべき。

出典: https://www.raspberrypi.com/documentation/computers/getting-started.html , https://deepwiki.com/raspberrypi/rpi-imager/3.2-os-customization , https://github.com/raspberrypi/rpi-imager/blob/main/src/customization_generator.h

### 2.3 出力フォーマットの抽象化（`init_format`）— 設計上の最重要教訓

Imager はオンライン OS マニフェスト（`https://downloads.raspberrypi.com/os_list_imagingutility_v4.json`）の **`init_format` メタデータ**を見て、同じ UI 入力を異なるフォーマットに落とす:

- `"init_format": "none"` — カスタマイズ非対応（**`init_format` を省略した場合の既定値**）
- `"init_format": "systemd"` — `firstrun.sh` を書き、`cmdline.txt` を書き換えて実行させる
- `"init_format": "cloudinit"` — 標準的な cloud-init（**"often used by Ubuntu Server OS images"**）
- `"init_format": "cloudinit-rpi"` — `rpi:` モジュール付きの拡張 cloud-init
- `"init_format": "rpi-preseed"` — `/boot/firmware/rpi-preseed.toml` を 1 ファイル書く。**`cmdline.txt` を触らない**（units がファイルの存在で発火するため）

**痛烈な失敗事例（本ツールが必ず回避すべきもの）**:

> "there's a bug in Imager 1.x whereby if it sees an `init_format` that it doesn't know about (or if the `init_format` is missing) it _assumes_ that the image allows `systemd` customisation."
>
> 結果、Imager 1.x で Trixie をカスタマイズすると **「カスタマイズしたように見えるのに、起動すると何も適用されていない」** という最悪のサイレント失敗が起きた。

さらに、**ローカルの `.img` を読み込んだ場合、Imager 2.x は `"init_format": "none"` と正しく仮定して「カスタマイズできない」と扱う**。ローカルイメージにカスタマイズを許すには、`create_local_json.py` でローカル OS マニフェストを作る必要がある。

→ **本ツールへの適用（critical）**:
1. ISO のバージョン検出に失敗したら、**推測でフォーマットを決めず、カスタマイズを無効化して明示的にエラーを出す**。ISO-FACTS の Volume ID 正規表現 `^Ubuntu-Server (\d+\.\d+(?:\.\d+)?)(?: LTS)? (amd64|arm64)$` で確実に判定できる場合のみ有効化する。
2. 「未知バージョンなら最も新しいスキーマを仮定する」は禁止。24.04 以降 autoinstall は未知キーを厳格に拒否するため、サイレント失敗ではなくインストーラのクラッシュになる。
3. 対応バージョン表（22.04 / 24.04 / 25.10 / 26.04）を**アプリ内に持ち、かつオンライン更新可能**にする（Imager のオンラインマニフェストに相当）。

出典: https://github.com/raspberrypi/rpi-imager/blob/main/doc/os_customisation_formats.md

### 2.4 生成される cloud-init の実際のキー（Ubuntu autoinstall との差異）

`src/customization_generator.cpp` が実際に書き出すキー（`generateCloudInitUserData` / `generateCloudInitNetworkConfig`）:

user-data（`#cloud-config`）側:
`manage_resolv_conf: false` / `hostname` / `manage_etc_hosts: true` / `packages` / `apt` / `timezone` / `keyboard` / **`user`（単数）** / `ssh_pwauth` / `rpi` / `runcmd`
user ブロック: `name` / `shell: /bin/bash` / `lock_passwd` / `passwd`（クオート付きハッシュ） / `ssh_authorized_keys` / `sudo`
rpi ブロック: `enable_usb_gadget` / `interfaces:` 配下に `i2c` / `spi` / `onewire` / `serial`
runcmd はリスト形式: `- [ systemctl, enable, --now, ssh ]`

network-config（v2）側:
```
network:
  version: 2
  ethernets:
    eth0:
      dhcp4: true
      dhcp6: true
      optional: true
  wifis:
    wlan0:
      dhcp4: true
      regulatory-domain: "<country>"
      access-points:
        "<escaped-ssid>":
          password: "<psk>"
```

**重要な注意**: Imager が使うのは **素の cloud-config** であり、Ubuntu Server の **`autoinstall` スキーマとは別物**。本ツールで流用できるのは「UI 項目 → 構造化データ → 出力」の設計であって、キー名ではない。対応表は 2.6 節。

出典: https://github.com/raspberrypi/rpi-imager/blob/main/src/customization_generator.cpp

### 2.5 パスワードと WiFi PSK の扱い（そのまま真似すべき）

`customization_generator.h` の公開 API から確定できる事実:

```cpp
static QString cryptPassword(const QByteArray& password, const QString& osReleaseDate);
static QString pbkdf2(const QByteArray& password, const QByteArray& ssid);
static bool osUsesYescrypt(const QString& osReleaseDate);
static bool isYescryptHash(const QString& cryptHash);
static QString stripLineTerminators(const QString& secret);
```

- **パスワードは平文でイメージに書かない**。crypt ハッシュに変換してから `passwd:` に入れる。しかも **OS のリリース日付を見て yescrypt / sha512crypt を切り替える**（新しい OS は yescrypt）。
- **WiFi PSK も平文で書かず、PBKDF2(passphrase, ssid) で導出したキーにする**。
- `stripLineTerminators()` — 秘密情報をコピペしたときに混入する改行を除去する専用関数がある。**「ユーザーは必ず改行付きでペーストする」という現実に対する実装上の防御**。SSH 公開鍵欄でも同様の処理が必要。
- SSID はバイト列（`ssidOctetsFromSettings`）で扱い、YAML エスケープ専用関数（`yamlEscapeSsidOctets`）を持つ。**非 ASCII SSID / 記号入り SSID で YAML が壊れる問題への対策**。

→ 本ツールの必須要件:
1. Ubuntu autoinstall の `identity.password` は**暗号化済みハッシュが必須**。公式リファレンス: 「The password for the new user, **encrypted**. This is required for use with `sudo`, even if SSH access is configured.」「The encrypted password string must conform to what the `passwd` command requires... Several tools can generate the encrypted password, such as `mkpasswd` from the `whois` package, or `openssl passwd`.」「**Quote the password hash** to ensure correct treatment of any special characters.」
2. Windows には `mkpasswd` も `openssl passwd` も無い。**アプリ内にハッシュ生成を実装する必要がある**（sha512crypt `$6$` はドキュメントが `openssl passwd` を挙げている以上、22.04〜26.04 の全対象で受理される）。
3. **ハッシュは必ずシングルクオートで囲んで YAML に出力する**（`$6$` の `$` が原因の事故を防ぐ）。
4. 秘密情報の入力欄はすべて `stripLineTerminators` 相当の正規化を通す。

出典: https://github.com/raspberrypi/rpi-imager/blob/main/src/customization_generator.h , https://canonical-subiquity.readthedocs-hosted.com/en/latest/reference/autoinstall-reference.html

### 2.6 Imager の UI 項目 → Ubuntu Server `autoinstall` キー 読み替え表

| Imager の UI 項目 | Imager の出力（cloud-config） | 本ツールの出力（`autoinstall`） | バージョン差 |
|---|---|---|---|
| Hostname | `hostname` | `identity.hostname` | 共通 |
| Username | `user.name` | `identity.username` | 共通 |
| Password | `user.passwd`（crypt） | `identity.password`（crypt、**要クオート**） | 共通 |
| passwordless sudo | `user.sudo` | 該当キー無し → `late-commands` で sudoers.d を書く | 共通 |
| Enable SSH | `runcmd: - [ systemctl, enable, --now, ssh ]` | `ssh.install-server: true` | 共通 |
| SSH パスワード認証 | `ssh_pwauth` | `ssh.allow-pw`（`authorized-keys` が空なら既定 true、非空なら false） | 共通 |
| SSH 公開鍵 | `user.ssh_authorized_keys` | `ssh.authorized-keys`（リスト） | 共通 |
| Locale（首都選択） | `timezone` / `keyboard` | `timezone` / `keyboard.layout` `keyboard.variant` / `locale` | 共通 |
| WiFi / 有線 | `network-config` v2 | `network:`（netplan v2 をそのまま。`version: 2` を含む） | 共通 |
| — | — | `storage.layout.name`（`lvm` / `direct` / `zfs`）、`storage.layout.match.serial`、`storage.layout.password`（LUKS） | 共通 |
| 追加パッケージ | `packages` | `packages`（リスト） | 共通 |
| Snap | — | `snaps: [{name, channel, classic}]` | 共通 |
| 更新方針 | — | `updates: security`(既定) / `all` | 共通 |
| 終了動作 | — | `shutdown: reboot`(既定) / `poweroff` | 共通 |
| **部分自動化** | — | **`interactive-sections`**（「A list of configuration keys to still show in the user interface (UI).」。`*` を指定すると全質問を出しつつ既定値だけ変える） | 共通 |
| HWE カーネル選択 | — | grub.cfg のメニュー分岐（ISO-FACTS）。**22.04.5 / 24.04.4 には HWE エントリがあるが、25.10 / 26.04.1 には無い** | **要分岐** |
| 未知キーの扱い | — | **24.04 (Noble) で未知キーの厳格検証が導入**。それ以前の ISO はインストーラ更新をしないと同じ挙動にならない | **要分岐** |

出典: https://canonical-subiquity.readthedocs-hosted.com/en/latest/reference/autoinstall-reference.html , `docs/research/ISO-FACTS.md`

### 2.7 設定の永続化と CLI

- 設定は `ImageWriterSingleton.setPersistedCustomisationSetting()` で保存され、次回起動時に再利用される（ただし 2.0 では毎回入力を求められるという利用者からの指摘もある）。
- `src/cli.cpp` があり、`rpi-imager --cli` でスクリプト化できる。
- **本ツールの要件**: 「プロファイル」を**明示的なファイル（JSON、スキーマバージョン付き）としてエクスポート／インポート**し、CLI から `--profile <file>` で実行できるようにする。暗黙の隠しストアだけに頼らない（監査・再現性の観点、8 節）。

出典: https://deepwiki.com/raspberrypi/rpi-imager/3.2-os-customization , https://github.com/raspberrypi/rpi-imager （`src/cli.cpp`）

---

## 3. デバイス選択の安全 UI（各ツールの実装と推奨仕様）

### 3.1 先行実装の比較

| 対策 | Rufus | Etcher | Fedora MW | 推奨 |
|---|---|---|---|---|
| システム/内蔵ディスクを隠す | 既定で USB HDD も隠す | 既定でシステムドライブ非表示 | — | **MUST** |
| 危険ドライブの表示はオプトイン | `List USB Hard Drives`（Advanced 内） | — | — | **MUST** |
| 大容量ドライブ警告 | — | — | **>160 GB で警告** | **MUST（閾値 64 GB）** |
| 書き戻し検証 | 不良ブロック検査（任意） | Validated Flashing | 全読み戻し | **MUST** |

### 3.2 本ツールの推奨仕様

デバイス列挙に必要なメタデータ（`drivelist` 相当、または OS 標準コマンドから取得）:

- `device` / `raw` パス、`description`（モデル名）、`size`（バイト）、`busType`（USB / NVMe / SATA / SD）
- `isSystem`（OS/ブートボリュームを含むか）、`isRemovable`、`isReadOnly`、`isVirtual`
- `mountpoints[]`（パスとラベル）、可能ならシリアル番号（監査ログ用）

OS 標準コマンドで代替する場合（ネイティブモジュールのビルド地獄を避けたいとき）:
- Windows: PowerShell `Get-Disk` / `Get-Partition` / `Get-Volume` を `ConvertTo-Json` で取得
- macOS: `diskutil list -plist` + `diskutil info -plist <disk>`
- Linux: `lsblk -J -O`

**UI 規則（MUST）**:
1. 既定リストは `isRemovable && busType === 'USB' && !isSystem` のみ。
2. それ以外を出すには「上級者向け：内蔵・大容量ディスクも表示する」トグルを明示的に ON にさせ、ON にした瞬間に赤い恒久バナーを出す。
3. `isSystem` のデバイスは**トグルを ON にしても選択不可（表示のみ、グレーアウト + 理由表示）**。Rufus/Etcher より一段厳しくする。商用ツールで OS を消す事故を起こしたら終わりであるため。
4. 各行に **モデル名 / 容量 / 現在のボリュームラベルとマウント先**を出す。「E: (USB DISK 3.0) — 28.9 GB — ラベル: BACKUP」のように、**ユーザーが「あ、これバックアップ用だ」と気づける情報**を必ず含める。
5. 最終確認ダイアログは **OK ボタンだけでは通さない**。デバイス名（例: `USB DISK 3.0`）またはボリュームラベルを**タイプさせる**か、少なくとも「このドライブの全データが消えます」チェックボックスを要求する。
6. 容量が 64 GB を超える場合、または `busType` が USB でない場合は、確認ダイアログの文言を強い警告版に差し替える。
7. 書き込み中にデバイスが抜かれた場合は**即座に中断し、「USB が取り外されました。データは中途半端な状態です。もう一度書き込んでください」**と明示（部分書き込みのまま「完了」と表示しない）。

---

## 4. 検証（Verification）

### 4.1 ISO の真正性検証（ダウンロード時）

Ubuntu 公式の検証手順（一次資料）:

```bash
curl -o ubuntu.gpg "https://archive.ubuntu.com/ubuntu/project/ubuntu-archive-keyring.gpg"
export RELEASE=noble
curl -O "http://releases.ubuntu.com/$RELEASE/SHA256SUMS"
curl -O "http://releases.ubuntu.com/$RELEASE/SHA256SUMS.gpg"
gpgv --keyring ./ubuntu.gpg ./SHA256SUMS.gpg ./SHA256SUMS
sha256sum -c --ignore-missing ./SHA256SUMS
```

有効な Ubuntu Image Signing Key は 3 本:

| 鍵 | フィンガープリント |
|---|---|
| Ubuntu CD Image Automatic Signing Key (2012) | `843938DF228D22F7B3742BC0D94AA3F0EFE21092` |
| Ubuntu Archive Automatic Signing Key (2012) | `790BC7277767219C42C86F933B4FE6ACC0B21F32` |
| Ubuntu Archive Automatic Signing Key (2018) | `F6ECB3762474EDA9D21B7022871920D1991BC93C` |

**本ツールの要件**:
- 鍵はアプリにバンドルする（キーサーバへの取得を実行時に必須にしない＝オフライン動作・改ざん耐性のため）。ubuntu-autoinstall-generator のように「実行時に鍵をダウンロードする」設計は、初回オフライン時に破綻する。
- **GPG 検証を既定 ON**、無効化は上級者トグル + 監査ログ記録。
- ユーザーがローカル ISO を持ち込んだ場合も、SHA256 を計算して**アプリ内蔵の既知ハッシュ表**と突合し、一致しなければ「公式リリースと一致しません」と警告（ブロックはしない。日次ビルドやミラーの点リリース差を考慮）。

出典: https://documentation.ubuntu.com/security/software-integrity/image-verification/ , https://ubuntu.com/tutorials/how-to-verify-ubuntu

### 4.2 書き込み後の検証

- **Fedora Media Writer**: 全体を読み戻して突合。
- **Raspberry Pi Imager 2.0**: 書き込み中に OS へブロックの確定を強制し、加えて検証を行う。
- **本ツールの要件**:
  1. 書き込み後に**全体を読み戻して SHA256 を比較**（既定 ON）。ただし本ツールは ISO をそのまま書くのではなく **grub.cfg セクタ・md5sum.txt・追加パーティション・GPT を改変する**ため、「書き込んだバイト列」のハッシュを書き込み側で計算しておき、読み戻しと比較する方式にする（ISO のハッシュとは一致しない点に注意）。
  2. 加えて **`md5sum.txt` の整合性を自前で再検証**する。ISO-FACTS の通り、改変後は `./boot/grub/grub.cfg` の MD5 行を更新する必要があり、ここが崩れると起動時の integrity check で失敗する。書き込み前に「改変後イメージの自己検証パス」を必ず走らせる。
  3. 検証をスキップする選択肢は出してよいが、**既定は ON**、スキップ時は完了画面に「検証をスキップしました」と残す。

---

## 5. 進捗表示・エラー案内

### 5.1 進捗

- フェーズを分けて表示する: `ISO 検証` → `設定の生成` → `パーティション準備` → `書き込み` → `検証` → `取り外し可能`。単一のバーで 0→100% を 2 回往復させない（Etcher の「Flashing → Validating」で 2 回 100% になる UX は毎回問い合わせを生んでいる）。
- 残り時間・MB/s・書き込み済みバイト数を出す。
- **書き込み中はスリープを抑止する**（rpi-imager は `suspend_inhibitor.cpp` を持つ。Electron では `powerSaveBlocker.start('prevent-app-suspension')`）。

### 5.2 エラー案内（初心者向けに最も差がつく箇所）

エラーは**必ず「何が起きたか」「なぜ起きたか」「次に何をすべきか」の 3 点セット**にする。想定される主要エラーと推奨文言の骨子:

| 事象 | 表示すべき原因 | 次にすべきこと |
|---|---|---|
| 昇格が拒否された | 管理者権限が必要 | 「もう一度実行し、UAC / パスワード入力で許可してください」 |
| デバイスがロックできない | 他のアプリ（エクスプローラ、ウイルス対策、Windows の「メディア準備」）が使用中 | 「該当ドライブを開いているウィンドウを閉じて再試行」 |
| 書き込み中にデバイス消失 | USB が抜けた / ハブの電力不足 | 「PC 本体の USB ポートに直挿しして再試行」 |
| 書き戻し検証の不一致 | USB メモリの不良、または偽装容量品 | 「別の USB メモリで試してください」（**「もう一度書けば直る」と誘導しない**） |
| ISO の GPG 検証失敗 | ダウンロード破損 or 改ざん | 「再ダウンロード。繰り返す場合はネットワーク経路を疑う」 |
| 書き込み後 Windows が「フォーマットしますか？」 | 正常。Linux 用パーティションを Windows が読めないだけ | **「絶対にフォーマットしないでください」** |
| 起動しない | Secure Boot ではなく起動順 / USB 3.0 ポート / Fast Boot が原因のことが多い | BIOS 起動順の変え方をリンク |

**「書き込み後に Windows がフォーマットを促す」問題は、Rufus が DD モードの注意点として長年扱ってきた既知の混乱源**であり、完了画面に事前に書いておくだけでサポート問い合わせが大きく減る。

出典: https://github.com/pbatard/rufus/wiki/FAQ , https://github.com/pbatard/rufus/issues/843

---

## 6. 設定の可視化・プロファイル・多言語

### 6.1 設定の可視化（商用差別化ポイント）

競合はいずれも**「生成された自動応答ファイルをユーザーに見せない」**。Ventoy はユーザーが自分でテンプレートを書く前提、Imager は生成物を見せない。

本ツールは以下を持つべき（SHOULD 以上）:
1. **最終確認画面で `autoinstall` YAML 全文をシンタックスハイライト付きでプレビュー**（パスワードハッシュは `$6$••••` にマスク、トグルで表示）。
2. **「この YAML をそのままコピー / エクスポート」**ボタン。他のツール（MAAS、PXE、Ventoy）でも使える資産になる。
3. **YAML の直接編集モード（上級者）**。編集した場合は、書き込み前にスキーマ検証を行う（24.04 以降は未知キーが厳格に拒否されるため、事前検証の価値が高い）。
4. **差分表示**: 「あなたが変えた項目」だけをハイライトする。既定値との差分が見えることが、レビューと監査の前提になる。

### 6.2 プロファイル保存

- スキーマバージョン付き JSON（例 `{"schemaVersion": 1, "target": "24.04", ...}`）でエクスポート／インポート。
- **秘密情報の扱いを 2 モードに分ける**:
  - `プロファイル（秘密を含まない）`: パスワード・PSK・API キーを除外。チーム共有・Git 管理向け。**既定はこちら**。
  - `プロファイル（秘密を含む）`: 明示的に選択したときのみ。**OS のキーチェーン（Windows DPAPI / macOS Keychain / Linux Secret Service）に保管し、ファイルには入れない**、あるいはファイルに入れる場合はパスフレーズ暗号化を必須にする。
- CLI で `--profile <file>` を受け取り、CI から再実行できるようにする。

### 6.3 多言語対応

- Rufus は約 40 言語を単一バイナリに内蔵。rpi-imager は `src/i18n/` を持ち、**アクセシビリティ文字列まで翻訳**している。
- 本ツールの現実解: **日本語 + 英語を一次サポート**、i18next 等でリソース分離し、`ja` / `en` を確実に完成させる。中途半端な機械翻訳の多言語より、2 言語の完成度を優先する。
- **必ずやること**:
  - すべての文字列を外部化（エラーメッセージ・確認ダイアログを含む）。
  - **アクセシビリティラベル（`aria-label`）も翻訳対象に含める**。
  - 数値・日付・容量表記のロケール対応（`Intl.NumberFormat`）。
  - フォントフォールバック（日本語環境で CJK が豆腐にならないこと）。
  - 長い訳文でレイアウトが壊れないこと（ドイツ語想定でボタン幅を検証）。

---

## 7. 商用観点：ライセンス・法務

### 7.1 ライセンス混入回避（critical）

| 依存候補 | ライセンス | 商用クローズドソースでの可否 |
|---|---|---|
| Electron | MIT | 可 |
| React / Vite / electron-vite / electron-builder | MIT | 可 |
| `drivelist` (balena) | **Apache-2.0** | **可**（NOTICE ファイルの同梱義務あり） |
| `etcher-sdk` (balena) | **Apache-2.0** | **可**（同上） |
| Rufus / Ventoy / Cubic のコード | **GPL-3.0** | **不可** |
| Fedora Media Writer のコード | **GPL-2.0** | **不可** |
| **`xorriso`** | **GPL-3.0** | **バンドル不可**（別プロセス実行でも同梱配布すれば GPL 頒布義務が生じる） |
| `mkpasswd`（whois パッケージ） | GPL | バンドル不可 → **自前実装 or 許諾的ライセンスの JS 実装を使う** |
| yescrypt リファレンス実装 | BSD-2-Clause | 可 |
| sha256crypt / sha512crypt リファレンス | Public Domain | 可 |
| Qt | LGPL-3.0 | 本ツールでは不要 |

**設計上の帰結（critical）**: ISO-FACTS が確立した**インプレース改変方式（grub.cfg セクタ書き換え + ディレクトリレコードの Data Length 更新 + md5sum.txt の MD5 差し替え + GPT 追記）は、xorriso を一切必要としない**。これは技術的な優位性であると同時に、**GPL-3.0 バイナリを同梱しないで済むというライセンス上の決定的な利点**である。ubuntu-autoinstall-generator 系のアプローチ（xorriso で ISO を再生成）を採用すると、この利点を失う。

さらに:
- Apache-2.0 の依存を使う場合、**`NOTICE` ファイルの内容を配布物に含める義務**がある。Electron アプリでは「ライセンス情報」画面を用意し、`license-checker` 等で自動生成した第三者ライセンス一覧を同梱する（rpi-imager の `license.txt` が良い手本）。
- **依存ライセンスの CI ゲート**を入れる（`GPL-*` / `AGPL-*` / `SSPL` を検出したらビルド失敗）。

出典: 各リポジトリの API 応答（1 節）、https://api.github.com/repos/raspberrypi/rpi-imager/license

### 7.2 Ubuntu ISO を再配布しない設計（critical）

Canonical の Intellectual property rights policy（一次資料）:

> **"You can redistribute Ubuntu, but only where there has been no modification to it."**
>
> **"Any redistribution of modified versions of Ubuntu must be approved, certified or provided by Canonical if you are going to associate it with the Trademarks."** — そうでなければ **"you must remove and replace the Trademarks and will need to recompile the source code to create your own binaries."**

→ **本ツールの必須設計**:
1. **改変済み ISO を成果物として配布・出荷しない**。改変は必ず**ユーザーの端末上で、ユーザーが入手した ISO に対して**行う。
2. ISO はアプリに同梱せず、**`releases.ubuntu.com` / 公式ミラーからユーザーの操作でダウンロード**する（または既にローカルにあるものを使う）。
3. 「改変済み ISO を保存する」機能を付ける場合は、**保存先はユーザーのローカルのみ**とし、UI に「このイメージを第三者に再配布しないでください」という注意を出す。**社内配布サーバへのアップロード機能を付けるなら、その注意はさらに強く**（社内配布も「redistribution」に該当しうる）。
4. アプリのブランディングに Ubuntu のロゴ・オレンジの円形マーク（Circle of Friends）を使わない。

出典: https://canonical.com/legal/intellectual-property-policy

### 7.3 Ubuntu 商標と製品名（critical）

一次資料の文言:

> **"You cannot use the Trademarks in software titles. However, if you are producing software for use with or on Ubuntu you may reference Ubuntu, but must avoid: (i) any implication of endorsement, or (ii) any attempt to unfairly or confusingly capitalise on the goodwill of Canonical or Ubuntu."**
>
> 対象マーク: **UBUNTU, KUBUNTU, EDUBUNTU, XUBUNTU, JUJU, LANDSCAPE**
> **"You can use the Trademarks, in accordance with Canonical's brand guidelines, with Canonical's permission in writing."**
> ドメイン名 / URL での使用、`UBUNTU` または `BUNTU` で終わる紛らわしい名称、マーチャンダイズには書面同意が必要。

→ **具体的な指針**:
- ✗ 製品名「Ubuntu Autoinstall USB Creator」「UbuntuBuntu」「ubuntu-installer.com」
- ○ 製品名は独立した造語 + 説明文で参照。例: 「**AutoInstall Studio** — *a USB creator for Ubuntu Server unattended installs*」
- ○ 機能説明・UI 内での「Ubuntu Server 24.04 LTS」というバージョン表記（事実の記述）
- ✗ 「Canonical 公式」「Ubuntu 認定」等、承認を示唆する表現
- ✗ ロゴの流用、Ubuntu のブランドカラー・書体を模したアイコン
- Web サイトのフッター等に「Ubuntu is a registered trademark of Canonical Ltd.」の帰属表記を入れる。

出典: https://canonical.com/legal/intellectual-property-policy , https://canonical.com/legal/trademarks

### 7.4 監査ログ

商用（特に法人納品）で必須になる項目:

| 記録項目 | 備考 |
|---|---|
| 実行日時（ISO 8601、TZ 付き）、ツールのバージョンとビルド ID | |
| 実行 OS・ホスト名・実行ユーザー（アカウント名） | 個人情報の扱いに注意、設定で無効化可能に |
| 使用した ISO のファイル名・サイズ・**SHA256**・Volume ID・`.disk/info` | ISO-FACTS の判別ロジックで取得可能 |
| GPG 検証の結果（成功 / スキップ / 失敗）と使用鍵のフィンガープリント | スキップは必ず記録 |
| 書き込み先デバイスの**モデル名・シリアル番号・容量・デバイスパス** | 「どの USB に何を焼いたか」の追跡 |
| 生成した `autoinstall` YAML の **SHA256**（**本文はマスク版のみ**） | 再現性の証跡 |
| 使用したプロファイル名・スキーマバージョン | |
| 各フェーズの所要時間、検証結果（一致 / 不一致） | |
| 失敗時のエラーコードと分類 | |

**絶対にログに書いてはならないもの**: 平文パスワード、パスワードハッシュ（オフライン解析可能なため）、WiFi PSK、SSH 秘密鍵、Ubuntu Pro トークン、LUKS パスフレーズ、API キー。
ログは JSONL 追記型 + ローテーション、既定でユーザーデータディレクトリ配下、エクスポート機能付き。

### 7.5 設定の再現性

- プロファイル JSON に **`schemaVersion` と `targetUbuntuVersion` を必ず含める**。バージョンをまたいだ流用は、24.04 以降の未知キー厳格検証で事故る。
- **同じプロファイル + 同じ ISO ハッシュ → 同じ YAML** を保証する（生成にタイムスタンプや乱数を混ぜない。混ぜる必要があるもの＝ソルトは、プロファイルに保存して固定する）。
- パスワードハッシュのソルトは、プロファイルに秘密を含めない場合に問題になる。**「ハッシュだけをプロファイルに保存する」モード**を用意すると、平文を持たずに再現性を確保できる。

### 7.6 オフライン動作

- **ネットワークが一切無い状態でも、ローカル ISO を指定すれば全機能が動くこと**を要件にする（現場のキッティング作業はしばしばオフライン）。
- GPG 公開鍵・既知 SHA256 表・ロケール/キーボード/タイムゾーンのデータは**アプリに同梱**する。
- オンラインが必要な機能（ISO ダウンロード、バージョン一覧の更新）は明確に分離し、オフライン時は「ローカル ISO を選択」へ誘導する。
- テレメトリは既定 OFF、または初回起動時にオプトインを問う。

---

## 8. Electron 配布要件（2026-09-03 時点）

### 8.1 スタック前提と既知の注意点

| 依存 | バージョン | 確認済み事実・注意点 |
|---|---|---|
| Electron | **44**（2026-08-25 リリース） | Chromium 152.0.7977.54 / V8 15.2 / Node **v24.18.1**。**Electron 41.x は EOS**。 |
| electron-vite | **5.0**（2025-12-07） | `externalizeDepsPlugin` / `bytecodePlugin` が**非推奨**、`build.externalizeDeps`（既定で有効）/ `build.bytecode` へ移行。新規に `build.isolatedEntries`、`bytecode.protectedStrings`。 |
| electron-builder | **26**（26.15.3 が 2026-06-09 時点の最新系） | mac の署名オプション（`hardenedRuntime` / `entitlements` / `entitlementsInherit`）は **v26 では `mac.*` 直下**。**v27 で `mac.sign.*` 配下へ移動する破壊的変更**が予告されている。 |
| Vite | **7** | **Node.js 20.19+ または 22.12+ が必須**（Node 18 サポート打ち切り）。既定のブラウザターゲットが `'modules'` → **`'baseline-widely-available'`** に変更。 |
| React | 19 | レンダラ側は Electron 44 の Chromium 152 上で動くため互換性問題は想定されない。 |

**Electron 44 の破壊的変更で本ツールに効くもの（critical）**:
1. **macOS 12 (Monterey) 非対応。macOS 13 (Ventura) 以上が必須。** → `mac.minimumSystemVersion` を `13.0` にし、対応 OS 表に明記する。
2. **Windows x86 (ia32) と Linux armv7l のビルドが廃止。x64 と arm64 のみ。** → 32bit Windows 向けの提供を約束してはならない。
3. **`clipboard` モジュールが非同期化され、レンダラから直接使えなくなった。** レンダラでは `navigator.clipboard` を使うか、preload の `contextBridge` で必要最小限だけ公開する。「生成した YAML をコピー」ボタンの実装がこれに該当する。
4. **ANGLE がバイナリに静的リンクされ、独立した `.dll` / `.so` / `.dylib` が同梱されなくなった。** 配布物のファイル一覧を検査している署名スクリプト等があれば要修正。
5. `app.isUnityRunning()` 削除、macOS の `openAsHidden` / `wasOpenedAsHidden` / `restoreState` 削除。
6. 新機能で使えるもの: `windowStatePersistence`（ウィンドウ状態の永続化がクロスプラットフォームで標準化）、Linux での `setProgressBar()` / `setBadgeCount()` が libunity 無しで復活（**書き込み進捗をタスクバーに出せる**）。

**Vite 7 の注意**: 既定ターゲットの `baseline-widely-available` は「30 か月以上広くサポートされた機能」基準であり、Electron 44 の Chromium 152 に対しては**過剰にトランスパイルする**。electron-vite はレンダラのターゲットを Electron の Chromium に合わせるが、`vite.config` で `build.target` を上書きしている場合は見直す。

出典: https://www.electronjs.org/blog/electron-44-0 , https://electron-vite.org/blog/ , https://vite.dev/blog/announcing-vite7 , https://www.electron.build/docs/features/code-signing/notarization/ , https://www.npmjs.com/package/electron-builder

### 8.2 Windows

**ターゲット**: `nsis`（インストーラ）+ `portable`（USB 持ち歩き / 権限が無い現場向け）。

**NSIS の既定値（electron-builder 26）**:

| キー | 既定 |
|---|---|
| `oneClick` | `true` |
| `perMachine` | `false` |
| `allowElevation` | `true`（assisted のみ） |
| `allowToChangeInstallationDirectory` | `false`（assisted のみ） |
| `createDesktopShortcut` | `true` |
| `createStartMenuShortcut` | `true` |
| `runAfterFinish` | `true` |
| `deleteAppDataOnUninstall` | `false`（one-click のみ） |
| `unicode` | `true` |
| `warningsAsErrors` | `true` |

→ **商用ツールでは `oneClick: false` + `allowToChangeInstallationDirectory: true` を推奨**（IT 部門がインストール先を制御したがるため）。`perMachine` は「全ユーザー向けに入れるか」を選ばせる。

**権限昇格（critical）**:
- `requestedExecutionLevel` は `"asInvoker"` / `"highestAvailable"` / `"requireAdministrator"` の 3 値で、**`win` 直下にしか書けない（ターゲットごとに指定できない）**。
- **portable ターゲットでは `requestedExecutionLevel` が効かない既知不具合がある**（electron-builder issue #7566）。`requireAdministrator` / `highestAvailable` を指定するとマニフェスト生成の不備でアプリが起動しなくなる報告もある（issue #2936、#3102）。
- → **推奨設計: アプリ本体は `asInvoker` のままにし、実際にディスクへ書き込む瞬間だけ「昇格ヘルパー」子プロセスを起動して UAC を出す。** これは
  - portable の不具合を回避でき、
  - 「ISO を選ぶだけ」「設定を書くだけ」の段階で管理者権限を要求しない（企業のセキュリティ審査で有利）、
  - Etcher の「起動時に必ず管理者権限」というクレームも回避できる、
  という三重の利点がある。
- 書き込み前に対象ボリュームの**ロックとアンマウント**（`FSCTL_LOCK_VOLUME` / `FSCTL_DISMOUNT_VOLUME` 相当）を行う。失敗時のエラー案内は 5.2 節の表に従う。

**コード署名なしの SmartScreen（critical）**:

Microsoft Learn の一次資料より:
- SmartScreen が見るのは 2 つのシグナル: **Publisher reputation**（署名されているか、既知の信頼できる発行者か）と **File hash reputation**（そのファイルが問題なくダウンロードされてきたか）。
- **無署名**: 「Windows protected your PC」の警告。ユーザーは "Run anyway" を選ばないと実行できない。**企業ポリシーで続行を完全に禁止できる**。自己署名証明書も無署名と同じ扱い。
- **無署名の致命的な性質**: *"When a file is not signed, SmartScreen reputation must build for each new version of your files, starting with zero reputation."* → **リリースのたびに毎回ゼロからやり直し**。継続的にアップデートを出す商用製品では実質的に永久に警告が出続ける。
- **EV 証明書はもう SmartScreen をバイパスしない**: *"EV certificates no longer bypass SmartScreen. ... this behavior no longer exists. ... Paying a premium for EV solely to avoid SmartScreen warnings is no longer justified."*
- 推奨されている選択肢: **Artifact Signing（旧 Trusted Signing）**、**月額 $9.99〜**、ハードウェアトークン不要で CI/CD（GitHub Actions、Azure DevOps）に直結でき、Microsoft が身元検証を行う。
- **Windows 11 の Smart App Control** は SmartScreen より強く、**無署名ファイルの実行を（正の評判が無い限り）ブロックする**。しかもインターネット由来かどうかに関わらず、すべての実行ファイルに署名チェックが及ぶ。

→ **商用配布では OV 以上のコード署名が事実上必須**。予算が無い場合でも「Artifact Signing（$9.99/月〜）」は現実的なライン。加えて、**署名しても最初の数週間は警告が出る**ことを前提に、リリースノート・ダウンロードページに「初回は SmartScreen 警告が出ます。発行者名が『〇〇』であることを確認して『詳細情報』→『実行』を押してください」というスクリーンショット付きの案内を必ず置く（Microsoft も *"Communicate with early adopters"* として推奨している）。

出典: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation , https://www.electron.build/docs/nsis/ , https://github.com/electron-userland/electron-builder/issues/7566 , https://github.com/electron-userland/electron-builder/issues/2936

### 8.3 macOS

**ターゲット**: `dmg`（+ 必要なら `zip` で自動更新用）。x64 / arm64 の universal または個別。

**署名・公証**:
- Gatekeeper は「識別された開発者による署名か」「Apple により公証され既知の悪意あるコンテンツが無いと確認されたか」「改変されていないか」を検査する。**"all software in macOS is checked for known malicious content the first time it's opened, regardless of how it arrived on the Mac."**
- **公証には Hardened Runtime が必須**。electron-builder 26 での設定:

```yaml
mac:
  notarize: true
  hardenedRuntime: true
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.inherit.plist
  minimumSystemVersion: "13.0"
```

  **※ v27 では `hardenedRuntime` / `entitlements` / `entitlementsInherit` が `mac.sign` 配下へ移動する**。v26 のまま使う場合は上記、v27 に上げる際は `mac.sign.*` へ移す。

- 公証の認証情報（環境変数）:
  - Option A（Apple ID）: `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`
  - Option B（App Store Connect API キー、**CI 推奨**）: `APPLE_API_KEY` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER` / `APPLE_TEAM_ID`
  - Option C（Keychain プロファイル）: `APPLE_KEYCHAIN` / `APPLE_KEYCHAIN_PROFILE` / `APPLE_TEAM_ID`
  - **アプリ固有パスワードをスクリプトにハードコードしない**。API キーは期限切れが無く 2FA プロンプトも出ないため CI 向き。

**公証なしの場合（Gatekeeper）**:
- ユーザーは **システム設定 → プライバシーとセキュリティ → 「このまま開く」** を押し、再度出る警告で「開く」を押す必要がある。Apple のサポート文書はこの手順のみを案内しており、**Control クリック → 開く という旧来の回避策は案内されていない**。
- → 商用製品としては公証なしは受け入れがたい。Apple Developer Program（年額）+ Developer ID 証明書 + 公証を前提に見積もる。

**権限昇格**: raw デバイス（`/dev/rdiskN`）への書き込みには root が必要。**Etcher のように自前のパスワードダイアログを作ってはならない**（issue #3321）。OS 標準の Authorization Services / `SMJobBless`（あるいは最低限 `osascript ... with administrator privileges` のようなシステム提供の機構）を使い、**書き込みの瞬間のみ昇格**する。書き込み前に `diskutil unmountDisk` 相当でボリュームをアンマウントする。

出典: https://support.apple.com/guide/security/gatekeeper-and-runtime-protection-sec5599b66df/web , https://support.apple.com/en-us/102445 , https://www.electron.build/docs/features/code-signing/notarization/ , https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution

### 8.4 Linux

**ターゲット**: `deb` を主、`AppImage` を副に。**「AppImage 一本」は本ツールでは選ぶべきでない。**

**理由 1: Chromium サンドボックスと AppArmor（critical）**
- Ubuntu 23.10 で `kernel.apparmor_restrict_unprivileged_userns` が導入され、**24.04 で既定有効**になった。非特権プロセスは、AppArmor プロファイルに `userns,` ルールがあるか `CAP_SYS_ADMIN` を持つ場合にのみ user namespace を作れる。
- Electron はこれに直撃する（electron/electron issue #41066）。`chrome-sandbox` は **root 所有 + mode 4755（SUID）** である必要があるが、**AppImage は毎回異なる一時 FUSE マウント（`/tmp/.mount_xxxxxx/`）に展開され、所有者は実行ユーザーなので SUID を立てられない**。
- **electron-builder は v26.0.0 で FPM ターゲット（`.deb` / `.rpm`）への AppArmor プロファイル同梱をサポートした。AppImage はマウントパスが揮発的なため対象外。**
- → **`.deb` なら AppArmor プロファイルを同梱して素直に動く。AppImage は `--no-sandbox` 前提**になり、企業のセキュリティ審査で不利。
- 補足: electron-builder の生成する AppArmor プロファイルは、**アプリの productName に空白が含まれるとプロファイル構文が壊れる不具合**が報告されている（issue #9230）。productName にスペースを入れない、または生成物を検証する。

**理由 2: FUSE**
- AppImage は FUSE2 を要求する。**Ubuntu 24.04 / 26.04 では `libfuse2` が `libfuse2t64` に改名されており、既定では入っていない**。多くの AppImage は `libfuse.so.2` を期待するため、素の Ubuntu 24.04+ では起動しない。
- 回避策は `./App.AppImage --appimage-extract-and-run`（FUSE を完全に迂回）だが、初心者向けツールでこれを案内する時点で UX として失格。

**理由 3: polkit**
- raw デバイス書き込みには root が必要。Linux での正しい昇格は **polkit**（`pkexec` + `/usr/share/polkit-1/actions/*.policy`）だが、**policy ファイルはシステムディレクトリに置く必要があり、AppImage は何もインストールしないので配置できない**。`.deb` なら postinst で正規に配置でき、**「AutoInstall Studio が USB へ書き込むために認証が必要です」という自前の説明文付きの認証ダイアログ**を出せる。AppImage では汎用の `pkexec` プロンプトになり、ユーザーに何を許可しているのか伝わらない。

→ **推奨構成**:
- `.deb`（x64 / arm64）: 主配布物。AppArmor プロファイル + polkit policy + `.desktop` を同梱。apt リポジトリを立てて署名配布できるとなお良い。
- `AppImage`: 「deb が使えないディストリ向け」の副次配布物。ダウンロードページに **libfuse2t64 の導入方法**と **`--no-sandbox` が必要になる場合がある旨**を明記。
- `snap`: Ubuntu ネイティブだが、**strict confinement では raw ブロックデバイスへのアクセスが `raw-usb` / `removable-media` インターフェースの手動接続を要し、classic confinement はストア審査が必要**。初期リリースでは避ける（要検証、9 節）。

出典: https://ubuntu.com/blog/ubuntu-23-10-restricted-unprivileged-user-namespaces , https://discourse.ubuntu.com/t/spec-unprivileged-user-namespace-restrictions-via-apparmor-in-ubuntu-23-10/37626 , https://github.com/electron/electron/issues/41066 , https://github.com/electron-userland/electron-builder/issues/8635 , https://github.com/electron-userland/electron-builder/issues/9230 , https://docs.appimage.org/user-guide/troubleshooting/fuse.html

### 8.5 ネイティブモジュールとパッケージング

- `drivelist` / `etcher-sdk` はネイティブアドオンを含む。**electron-vite の `build.externalizeDeps`（v5 で既定有効）で外部化**し、electron-builder 側で `asarUnpack` に含める（asar 内のネイティブバイナリは `dlopen` できない）。
- ネイティブモジュールを避けたい場合は、8.1 の OS 標準コマンド（`Get-Disk` / `diskutil -plist` / `lsblk -J`）で代替できる。**クロスビルド（mac で Windows 向けを作る等）の難易度が劇的に下がる**ため、商用の CI 構成としてはこちらが安全側。

---

## 9. 本ツールが備えるべき機能チェックリスト

### 9.1 MUST（これが欠けたら商用品質ではない）

**安全性**
1. 既定で**リムーバブル USB のみ**を一覧表示。内蔵/システムディスクは非表示。
2. `isSystem` なデバイスは**上級者モードでも選択不可**（表示のみ、理由を明記）。
3. 書き込み前の最終確認で、**デバイス名またはラベルのタイプ入力、あるいは明示チェックボックス**を要求。
4. 選択デバイスの**モデル名・容量・現在のボリュームラベル/マウント先**を表示。
5. 64 GB 超、または非 USB バスのデバイスに対する**強調警告**。
6. 書き込み中のデバイス消失を検知して即中断し、**「完了」と表示しない**。

**正当性・検証**
7. ISO の **SHA256 + GPG 署名検証**（鍵をアプリ同梱、既定 ON）。
8. ISO のバージョン判定は Volume ID / `.disk/info` の**厳密パース**。判定不能なら**カスタマイズを無効化してエラー**（推測禁止 — Imager 1.x の教訓）。
9. 書き込み後の**全読み戻し検証**（既定 ON）。改変後イメージのハッシュと突合。
10. `md5sum.txt` の `./boot/grub/grub.cfg` 行を**必ず更新**し、書き込み前に自己検証パスを実行。

**設定**
11. `identity.password` を **crypt ハッシュ（`$6$` sha512crypt）に変換**して出力。平文を書かない。**シングルクオートで囲む**。
12. 秘密情報入力欄の**改行除去・前後空白除去**（`stripLineTerminators` 相当）。
13. 生成した `autoinstall` YAML の**全文プレビュー**（秘密はマスク）。
14. 対象バージョン（22.04 / 24.04 / 25.10 / 26.04）ごとの**スキーマ差分の反映**。24.04 以降の未知キー厳格検証を踏まえ、書き込み前にスキーマ検証。
15. **バージョン選択 UI にサポート期限を表示**し、**EOL 済み（25.10）には警告**。

**配布・法務**
16. 製品名・ドメイン・ロゴに **Ubuntu 商標を使わない**。帰属表記を入れる。
17. **改変済み ISO を配布しない**設計（ローカル生成のみ）。
18. 依存ライセンスの CI ゲート（GPL/AGPL/SSPL 検出でビルド失敗）+ **第三者ライセンス一覧画面**。
19. **xorriso を同梱しない**（ISO-FACTS のインプレース改変方式を採用）。
20. Windows: 署名（最低 OV / Artifact Signing）+ **SmartScreen 初回警告の案内ページ**。
21. macOS: Developer ID 署名 + **公証 + ステープル**、`hardenedRuntime: true`、`minimumSystemVersion: "13.0"`。
22. Linux: `.deb` を主配布物とし、**AppArmor プロファイルと polkit policy を同梱**。
23. **権限昇格は OS 標準機構のみ**。自前のパスワード入力 UI を作らない。アプリ本体は非昇格で起動し、**書き込み時のみ昇格ヘルパー**を使う。

**運用**
24. **オフラインで全機能が動く**（ローカル ISO 指定時）。
25. **監査ログ**（7.4 の項目）。平文パスワード・ハッシュ・PSK・秘密鍵は絶対に記録しない。
26. 日本語・英語の完全対応（**アクセシビリティラベルを含む**）。
27. 書き込み中の**スリープ抑止**。

### 9.2 SHOULD

28. プロファイルの**エクスポート／インポート**（`schemaVersion` 付き JSON、既定は秘密を含まない）。
29. **CLI モード**（`--profile <file>`）で CI から再実行可能。
30. `interactive-sections` を UI から設定可能に（「この項目だけインストール時に手動で決める」）。
31. **既定値との差分ハイライト**。
32. YAML の**直接編集モード**（上級者）+ 事前スキーマ検証。
33. **ドライラウン**（USB に書かずに、生成される改変後イメージと YAML だけを出力）。
34. 完了画面に**「次にすること」**（BIOS 起動順、Secure Boot は変更不要である旨、初回ログイン情報、Windows のフォーマット促しを無視する指示）。
35. Linux タスクバー / Windows タスクバーへの**進捗表示**（Electron 44 で Linux も libunity 不要）。
36. 秘密情報の **OS キーチェーン保管**（DPAPI / Keychain / Secret Service）。
37. **ISO のダウンロードとキャッシュ**（再ダウンロードを避ける。rpi-imager の `cachemanager` 相当）。
38. ネットワーク設定（静的 IP / プロキシ / DNS）を UI から（`network` + `proxy` キー）。
39. ストレージレイアウト選択（`direct` / `lvm` / `zfs`、および `storage.layout.password` による LUKS 暗号化）。
40. `late-commands` テンプレート集（passwordless sudo、Docker 導入、SSH ポート変更など）。

### 9.3 NICE

41. 複数 USB への**同時書き込み**（Etcher にある機能）。キッティング現場で効く。
42. **設定プリセット**（「最小サーバ」「Docker ホスト」「K8s ノード」）。
43. インストール完了後の**疎通確認ヘルパー**（`ssh user@hostname` のコマンドを生成、`.local` 名前解決の案内）。
44. **Ventoy 互換の書き出し**（`ventoy.json` + テンプレートを既存の Ventoy USB に追記）。マルチバージョン USB を作りたい上級者向け。
45. `autoinstall` YAML を **MAAS / PXE 向けにエクスポート**（「規模が大きくなったら MAAS へ」の導線）。
46. 生成 YAML の**バージョン間マイグレーション**（22.04 用プロファイルを 26.04 用に変換し、差分を提示）。
47. USB メモリの**書き込み速度ベンチ**と「この USB は遅い/不良の疑いがある」判定。
48. テーマ（ライト/ダーク）とハイコントラストモード。

---

## 10. 初心者向けウィザードの推奨ステップ構成

Raspberry Pi Imager 2.0 の 6 段（Device → OS → Storage → Customisation → Writing → Done）を、Ubuntu Server 向けに拡張した **7 段 + サブステップ**構成を推奨する。左サイドに常時ステップ一覧を表示し、各段はウィンドウ全体を使い、説明文・バリデーション・ドキュメントリンク用の領域を確保する。

### Step 0（起動直後）: モード選択
- 「**かんたん（おすすめ）**」= 必須項目だけ聞き、他はすべて安全な既定値。
- 「**くわしい**」= 全項目 + YAML 直接編集。
- 「**プロファイルを読み込む**」= 保存済み設定から即座に Step 5 の確認へ。
- ※ Imager にはこの段が無いが、商用では「初心者」と「毎日 50 台焼く人」の両方を satisfy する必要があるため追加する。

### Step 1: Ubuntu のバージョンを選ぶ
- カード形式で 26.04 LTS / 24.04 LTS / 22.04 LTS / 25.10 を提示。
- 各カードに**サポート期限**を表示: 22.04 は 2027-05（ESM 2032-05）、24.04 は 2029-05（ESM 2034-05）、26.04 は 2031-05（ESM 2036-05）。
- **25.10 は「サポート終了（2026-07-09）」バッジ + 選択時に警告**。既定では折りたたんでおく。
- 既定選択は **26.04 LTS**（最新 LTS）。
- 「LTS とは？」のインライン説明。

### Step 2: インストールイメージ（ISO）を用意する
サブステップ:
- 2a. 「ダウンロードする（推奨）」/「手元のファイルを使う」の二択。
- 2b. ダウンロード進捗（再開可能、キャッシュ利用）。
- 2c. **検証**: SHA256 一致と GPG 署名の検証結果を、緑のチェックで明示。失敗時は再ダウンロードへ誘導。
- 2d. 検出したバージョン・Volume ID を表示（「Ubuntu-Server 26.04.1 LTS amd64 を検出しました」）。**検出できなければここで止める**。

### Step 3: 書き込む USB メモリを選ぶ
- 3.2 節の安全 UI 規則をすべて適用。
- 空のリストのときは「USB メモリを挿してください」+ 自動再スキャン。
- 各行: モデル名 / 容量 / 現在のラベルとドライブレター（マウント先）。
- 「内蔵ディスクも表示する（上級者）」トグル + 恒久警告バナー。システムディスクは選択不可。

### Step 4: インストール設定（= OS customisation 相当、本ツールの中核）
サブステップに分割（Imager の分割に対応）:

| サブステップ | 内容 | かんたんモード |
|---|---|---|
| 4a. 場所と言語 | **国／都市を 1 つ選ぶ** → `timezone` / `keyboard.layout` / `locale` を自動導出。上級者は個別上書き。 | 表示（既定は OS から推定） |
| 4b. コンピュータ名 | `identity.hostname`。バリデーション文言を明示（英数字とハイフン） | 表示 |
| 4c. 管理ユーザー | `identity.realname` / `identity.username` / `identity.password`（強度メーター、確認入力、crypt ハッシュ化） | 表示 |
| 4d. リモートアクセス | `ssh.install-server` / `ssh.authorized-keys`（公開鍵の貼り付け + ファイル選択 + `~/.ssh/*.pub` の自動検出）/ `ssh.allow-pw` | 表示（既定: SSH 有効・鍵があればパスワード認証 OFF） |
| 4e. ネットワーク | DHCP（既定）/ 静的 IP / プロキシ。`network`（netplan v2）+ `proxy` | 折りたたみ（既定 DHCP） |
| 4f. ディスク | `storage.layout.name` = `direct`（既定・単純）/ `lvm` / `zfs`、`storage.layout.match`、LUKS 暗号化（`storage.layout.password`） | 折りたたみ（既定 direct、全ディスク使用） |
| 4g. ソフトウェア | `packages` / `snaps` / `updates`（`security` / `all`） | 折りたたみ |
| 4h. インストール後 | `shutdown`（`reboot` / `poweroff`）、`late-commands` テンプレート | 折りたたみ |
| 4i. 手動で決めたい項目 | `interactive-sections` のチェックリスト。「インストール中にこの画面だけ自分で操作する」 | 非表示（上級者のみ） |

**設計原則**:
- かんたんモードで**画面に出るのは 4a〜4d の 4 項目のみ**。残りは「詳細設定」の折りたたみに入れ、既定値を一行で要約表示する（例: 「ディスク: 検出した最初のディスク全体を使用（暗号化なし）」）。
- すべての入力欄に**インラインバリデーションと、なぜその制約があるかの一文**を添える。
- 秘密情報の入力欄は改行・前後空白を自動除去し、目のアイコンで表示切替。

### Step 5: 確認
- **左に設定サマリ、右に生成された `autoinstall` YAML 全文**（ハイライト、秘密はマスク、トグルで表示）。
- 「既定値から変更した項目」をハイライト。
- **書き込み先の再掲**（モデル名・容量・ラベル）と「このドライブの全データが消えます」の確認。
- 「**設定をプロファイルとして保存**」ボタン（秘密を含む/含まないの選択）。
- 「YAML をコピー / エクスポート」ボタン。

### Step 6: 書き込み
- フェーズ表示: `イメージを準備中` → `書き込み中` → `検証中`。**進捗バーを 2 回往復させない**（各フェーズに重み付けした単一の全体進捗 + フェーズ名）。
- 速度・残り時間・書き込み済み容量。タスクバー進捗。スリープ抑止。
- **昇格ダイアログはここで初めて出す**（Windows UAC / macOS 認証 / polkit）。事前に「次の画面で管理者権限の確認が出ます」と予告する。
- キャンセル時は「USB は中途半端な状態です。もう一度書き込むか、フォーマットしてください」と明示。

### Step 7: 完了 — 「次にすること」
Imager の "Done" を大幅に拡張する。ここが初心者向け商用ツールの最大の価値。
- ✅ 書き込みと検証が成功した旨。
- **接続情報カード**: ホスト名、ユーザー名、`ssh user@hostname` のコピーボタン。
- **起動手順**: 「① USB を対象マシンに挿す ② 電源投入直後に F2 / F12 / Del を押す ③ 起動順で USB を先頭にする」。主要メーカーのキー一覧へのリンク。
- **Secure Boot は変更不要です**（Canonical 署名の shim/grub をそのまま使うため）— Ventoy との差別化として明示。
- ⚠️ **「Windows で『フォーマットしますか？』と聞かれても、絶対にフォーマットしないでください」**。
- **インストールは全自動で進み、完了後に自動で再起動（または電源オフ）します**（`shutdown` の設定値を反映して文言を変える）。
- 「監査ログを保存」「プロファイルを保存」「もう 1 本作る（設定を保持したまま Step 3 へ）」。

---

## 11. 未解決事項 / 追加検証が必要な点

1. **25.10 の ISO 配置先**: 2026-09-03 時点では EOL 済みにもかかわらず `releases.ubuntu.com/25.10/` に残っている。いずれ `old-releases.ubuntu.com` へ移動するため、ダウンロード URL のフォールバック（releases → old-releases）と、移動時期の監視が必要。
2. **snap 版の可否**: strict confinement で raw ブロックデバイス書き込みが可能か（`raw-usb` / `removable-media` / `block-devices` インターフェースの自動接続可否とストア審査）は未検証。
3. **electron-builder v27 の正式リリース時期**と `mac.sign.*` への移行タイミング。v26 で作った設定がいつ壊れるか。
4. **Windows の昇格ヘルパー設計の詳細**: 別 exe を UAC 昇格で起動する際、その exe も署名対象になる。electron-builder の `win.signAndEditExecutable` / `extraResources` での取り扱いと、SmartScreen 評判が本体 exe と別に積まれるかどうか。
5. **Artifact Signing（旧 Trusted Signing）の日本法人からの利用可否**と、身元検証に要する期間・書類。
6. **`drivelist` の現在の保守状況**と Electron 44 / Node 24 ABI での prebuild 提供有無。OS 標準コマンド方式との比較検証が必要。
7. **yescrypt vs sha512crypt**: 22.04〜26.04 の `libcrypt`（libxcrypt）が `$6$` を確実に受理することは公式ドキュメントの `openssl passwd` 言及から推定できるが、26.04 で `$6$` が非推奨化されていないかの実機確認が望ましい。
8. **Ventoy 互換出力（NICE 44）を実装する場合の GPL 影響**: Ventoy のコードを使わず `ventoy.json` の書式に従うだけなら問題ないはずだが、書式自体が仕様として公開されている範囲の確認が必要。
9. **Canonical への商標照会**: 製品名・Web サイトでの「for Ubuntu Server」表記が「implication of endorsement」に当たらないかを、リリース前に書面で確認しておくのが商用として安全。

---

## 出典一覧（主要）

**Raspberry Pi Imager**
- https://github.com/raspberrypi/rpi-imager/blob/main/doc/os_customisation_formats.md
- https://github.com/raspberrypi/rpi-imager/blob/main/src/customization_generator.h
- https://github.com/raspberrypi/rpi-imager/blob/main/src/customization_generator.cpp
- https://api.github.com/repos/raspberrypi/rpi-imager/license
- https://www.raspberrypi.com/news/a-new-raspberry-pi-imager/
- https://www.raspberrypi.com/news/cloud-init-on-raspberry-pi-os/
- https://www.raspberrypi.com/documentation/computers/getting-started.html
- https://deepwiki.com/raspberrypi/rpi-imager/3.2-os-customization （二次資料）

**競合ツール**
- https://github.com/pbatard/rufus , https://github.com/pbatard/rufus/wiki/FAQ , https://github.com/pbatard/rufus/wiki/Localization
- https://github.com/balena-io/etcher/blob/master/LICENSE , https://github.com/balena-io/etcher/issues/3321 , https://github.com/balena-io/etcher/issues/4052
- https://www.ventoy.net/en/plugin_autoinstall.html , https://github.com/ventoy/Ventoy/blob/master/SecureBoot.md
- https://launchpad.net/cubic
- https://github.com/FedoraQt/MediaWriter/blob/main/CRYPTOGRAPHY.md
- https://github.com/covertsh/ubuntu-autoinstall-generator
- https://canonical.com/maas/docs/about-the-machine-life-cycle , https://canonical.com/maas/docs/about-commissioning-machines

**Ubuntu / Canonical**
- https://canonical-subiquity.readthedocs-hosted.com/en/latest/reference/autoinstall-reference.html
- https://canonical-subiquity.readthedocs-hosted.com/en/latest/intro-to-autoinstall.html
- https://canonical.com/legal/intellectual-property-policy , https://canonical.com/legal/trademarks
- https://documentation.ubuntu.com/security/software-integrity/image-verification/ , https://ubuntu.com/tutorials/how-to-verify-ubuntu
- https://ubuntu.com/about/release-cycle
- https://lists.ubuntu.com/archives/ubuntu-announce/2026-July/000325.html （25.10 EOL）
- https://ubuntu.com/blog/ubuntu-23-10-restricted-unprivileged-user-namespaces
- https://discourse.ubuntu.com/t/spec-unprivileged-user-namespace-restrictions-via-apparmor-in-ubuntu-23-10/37626
- https://releases.ubuntu.com/

**Electron / 配布**
- https://www.electronjs.org/blog/electron-44-0
- https://electron-vite.org/blog/
- https://vite.dev/blog/announcing-vite7
- https://www.electron.build/docs/nsis/ , https://www.electron.build/docs/features/code-signing/notarization/
- https://github.com/electron-userland/electron-builder/issues/7566 , /2936 , /8635 , /9230
- https://github.com/electron/electron/issues/41066
- https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation
- https://support.apple.com/guide/security/gatekeeper-and-runtime-protection-sec5599b66df/web , https://support.apple.com/en-us/102445
- https://docs.appimage.org/user-guide/troubleshooting/fuse.html
