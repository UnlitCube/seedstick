# 引き継ぎ記録 (2026-09-05)

直近 3 セッションで行った作業と、次のセッションが引き継ぐべきことをまとめる
（**新しいほうは 2.6**）。
落とし穴そのものは `CLAUDE.md` の「落とし穴」節に入れてあるので、
ここには**状態**と**残っていること**だけを書く。
（項目数は変わるので断定しない。数えるなら `grep -cE '^[0-9]+\. \*\*' CLAUDE.md`。
2026-09-07 時点で **107**。RAID / bond の巡で 94〜103、
VM で RAID を組んだ巡で 104〜107 が増えた。）

> ## ⚠ この資料に書かれている**コミット SHA は、もう存在しない**
>
> 2026-09-10 と 2026-09-11 の 2 回、`git filter-branch` で
> author / committer のメールを書き換えた（最終形は `unlit.cube@gmail.com`）。
> **全コミットの SHA が変わっている**ので、下に出てくる `git rev-parse HEAD = …` の
> 値で GitHub を開いても 404 になる。
>
> **中身は 1 バイトも変わっていない。** tree ハッシュは全件一致を確認済みなので、
> 「その SHA の時点のツリー」は現在の履歴の中に必ず同じものがある。
> この資料が実際に引用している 6 件の対応:
>
> | 資料中の SHA | 現在の SHA | コミット |
> |---|---|---|
> | `ee7c558` | `e175832` | fix: UEFI の grub_device は ESP のパーティションに付ける |
> | `4710485` | `c0292ac` | fix: 要約が「リリースによる出し分け」を見ておらず… |
> | `38a588c` | `61c6ed6` | feat: RAID/bond の構成と .img 書き出しを UI から… |
> | `565ca23` | `46f49ac` | feat: 画面文言を i18n に載せ、English で日本語が残らないように |
> | `e1843bb` | `1434a04` | fix: テストが %TEMP% に 526 GB を積み上げていたのを止め… |
> | `0d2c3c6` | `9f6283e` | test: .e2e をロケール非依存にし、英語表示でも GUI を通す |
>
> 対応づけは **tree ハッシュ**で導いた（23 件すべて相異なるので 1 対 1 に決まる）。
> 書き換え前の姿そのものは
> `C:\dev\_backup\autoinstall-ui-before-email-rewrite-2026-09-11.bundle`
> （検証済み。`git clone --mirror <bundle> <dir>` で丸ごと戻る）と、
> ローカルの `refs/original/refs/heads/*` に残っている。
>
> **今後 SHA を資料に書くときは、件名も一緒に書くこと**（落とし穴 145）。

---

## 1. 現在の状態

### 検証結果

**この表の全行が、この作業ツリーに対して測った数字である**
（`git rev-parse HEAD` = `ee7c558`、`git status --porcelain` = 31 件、うち `samples/` は 2 ファイル）。
実 USB の 3 行（`e2e:usb` / `e2e:verify-usb` / `e2e:usb-worker`）も今回実行した。

> **`e2e:usb-worker` が使ったビルド成果物について（落とし穴 72）。**
> ワーカーの実体は `apps/desktop/out/main/worker.js`（ビルド成果物）で、
> 実行時のものは **15:56 のビルド**、実行後に再ビルドすると**ハッシュが変わった**。
> 差の原因は特定済み: `worker.js` は i18n 辞書を含むチャンクを
> **内容ハッシュ入りのファイル名**で `require` しており、
> この巡で検証メッセージを 2 つ足したのでチャンク名が変わっただけである。
> **書き込み経路そのものは 1 バイトも変えていない**
> （`git status --porcelain packages/media apps/desktop` = 0 件。ビルドは決定的で、
> 同じソースから 2 回ビルドして同じハッシュになることも確認した）。
> 足した文字列はワーカーが書き込みに使わない検証用の訳文である。


| 検証 | コマンド | 結果 | いつ測ったか |
|---|---|---|---|
| 型検査 | `npm run typecheck` | **5 / 5 通過** ✅ | 今回（作業ツリー） |
| ユニットテスト | `npm run test:unit` | **1263 / 1264**（63 ファイル、skip 1） ✅ | 今回（作業ツリー） |
| スモーク（実 ISO → `.img`） | `npm run smoke` | **98 / 98** ✅ | 今回（作業ツリー） |
| E2E マトリクス（実 ISO × 設定 10 パターン） | `npm run e2e` | **422 / 422** ✅ | 今回（作業ツリー。USB を挿した状態） |
| **RAID + bond の生成検証** | `npm run e2e:raid-bond` | **77 / 77** ✅ | 今回（作業ツリー） |
| **ESP ミラーの late-command を `sh` で実行** | `npm run e2e:esp-mirror` | **12 / 12** ✅ | **今回（新規）。Git Bash / PowerShell 両方で確認** |
| **イメージ保存の経路（実 ISO 2 種 → `.img`）** | `npm run e2e:image` | **84 / 84** ✅ | 今回（作業ツリー） |
| **VM で無人インストール完走（RAID + LVM）** | `npm run e2e:vm:raid` | **30 / 30** ✅ | **今回（2026-09-10・24.04.3）。監査の修正後に再実行** |
| **VM で ESP 2 台 + bond**（`--mirror`） | `npm run e2e:vm:mirror` | **33 / 33** ✅ | **今回（2026-09-10・24.04.3）** |
| VM で無人インストール完走（単一ディスク・LVM） | `npm run e2e:vm` | **14 / 14** ✅ | **今回（2026-09-10）。監査の修正後に再実行** |
| **VM で「起動メニューで選んだ IP が反映される」**（`--ip`） | `npm run e2e:vm:ip` | **25 / 25** ✅ | **今回（2026-09-10・24.04.3）。配布サンプル `samples/ip-only.json` そのもの** |
| **実 USB への書き込み** | `npm run e2e:usb`（管理者権限） | **19 / 19** ✅ | **今回（2026-09-10）。KIOXIA TransMemory 30.97 GB に 3.37 GB を 254.9 秒で書いて読み戻した** |
| **書き終わった USB の読み戻し** | `npm run e2e:verify-usb` | **11 / 11** ✅ | **今回（2026-09-10）。ここで古い検査 1 件の取り残しが見つかった（落とし穴 126）** |
| **昇格ワーカー経路（実 USB）** | `npm run e2e:usb-worker`（管理者権限） | **18 / 18** ✅ | **今回（2026-09-10）。hello / progress / done の疎通と読み戻しまで実機で確認** |

- **前の巡で RED だった `image-write.test.ts` は閉じた。** 型 4 件は
  74 行目の `Parameters<WriteSupervisor['startImageWrite']>[0]` を
  `InstanceType<typeof WriteSupervisor>` に直して消え（`WriteSupervisor` は
  `await import()` 由来の**値**なので型位置に書けない。TS2749）、
  落ちていたテスト 6 件は**実装側の 3 つの実バグ**が原因だった
  （→ 2.8）。**現在は typecheck / unit とも全緑**。
- **書き込み経路 3 本は 1 バイトも変えていない。**
  `git diff e1843bb -- packages/media/src/writer/execute.ts
  packages/media/src/layout/plan.ts packages/media/src/grub/patch.ts` が空。
  ただし **`apps/desktop/src/main/write-supervisor.ts` は +261 / -0** で、
  `.img` 書き出し (`startImageWrite`) が**追加**されている（別セッションの作業）。
  **削除・変更が 0 行**なので既存の USB 書き込み経路は素通しのままだが、
  「4 本とも無改変」ではなくなっている。
- **型検査は 4 つから 5 つに増えた。** `scripts/tsconfig.json` を足したため
  （`scripts/` は長らく対象外で、`ValidationIssue` から消えた `messageJa` を
  4 本が読み続けていた）。`CLAUDE.md` の開発コマンド表も直してある。
- ユニットは **HEAD の 32 ファイルから +17 ファイル**（`find` で実測）。
  53 ファイル / 990 件。増えた分は画面の階層化（`Disclosure` / `summarizeStep` /
  `STEP_GROUPS` / `ReadyToReview`）と、`validate.ts` の i18n の番人。
  **件数の前後比較には注意**: 前の引き継ぎに載っている 687 は前セッションの記録で、
  **HEAD で走らせ直してはいない**（HEAD のテストファイル数 32 とは一致する）。
  このセッションの途中で記録された「804 / 41 ファイル」も途中経過であって、
  HEAD の値ではない。
- **スモークと E2E の件数は変わっていない**
  （書き込みのバイト列・順序・条件に触っていないので、増えないのが正しい）。
  `npm run e2e:image` の 84 件は**新設**（下の 2.8）。
- **`npm run test:unit` は Git Bash から実行する。** PowerShell だと `sh` が
  PATH に無く 19 件が ENOENT で落ちる（テストの失敗ではない）。
- 作業ツリーは**全部が未コミット**（`git rev-parse HEAD` = `e1843bb`、
  `git status --porcelain` が **46 件**＝変更 25 / 新規 21）。
  上の 6 行はその未コミットの木に対する結果。

---

## 2. セッションの記録

**2.1〜2.4 は前々セッション、2.5 が前セッション、2.6〜2.8 が今回。**
新しい順に読みたければ 2.8 から。

### 2.1 昇格ワーカー経路の実機確認（完了・前々セッション）

実行にあたって、ハーネス側のバグが 3 件見つかった（いずれも修正済み）。
**4 回試して 4 回とも通らなかった前セッションの原因はこれ。**

1. `.e2e/run-elevated.ps1` の既定デバイスが `'\.\PhysicalDrive1'`
   （バックスラッシュ 1 個）で、`devices.find(d => d.id === explicit)` に
   一致せず必ず `exit 2` になっていた。既定を「自動選択」に変えた
2. 同ファイルのログが二重変換で壊れていた。PS 5.1 が npx の UTF-8 出力を
   OEM コードページ (932) で読むため、`Out-File -Encoding utf8` に届く前に化ける
3. `scripts/e2e-worker-usb.mts` の受信ソケットに `error` ハンドラが無く、
   ワーカー終了時の RST で**未処理例外でプロセスごと落ちて**いた。
   `[done]` の直後に死ぬので、読み戻し検証に一度も到達できなかった。
   GUI 本体 (`write-supervisor.ts`) には元からハンドラがあり無事だった
   ——「GUI と同じ経路を通す」はずのテストが GUI より脆かった

### 2.2 4 巡目の敵対的監査（完了）

13 領域 × 3 レンズ反証。**136 件指摘 → 63 件が反証を生き延びた**
（critical 3 / high 25 / medium 26 / low 9）。
セッション上限で 178 エージェントが失敗し、うち **58 件は 3 レンズ全滅で
未検証のまま消えていた**（critical 5 を含む）。journal から回収して別途精査した。

3 巡目までと同じく、**今回も「前の巡の修正が別の退行を生んでいた」**。
critical 3 件はすべてその型だった。

**生き延びた 63 件を対応した**（修正 or 仕様として固定）。
未検証のまま消えた 58 件も精査し、再現できたものは修正した。
内容は `CHANGELOG.md` の「🐛 修正」に 14 の見出しで整理してある。

ただし、この引き継ぎ資料自体を敵対的に検証したところ
（`wf_a8b00896-b01`）、**「すべて対応済み」は言いすぎだった**。
取りこぼしが 5 件見つかり、うち 4 件はその場で直した（下記 2.4）。

主なもの:

- **root で任意コマンドが動く経路 5 件**（shell / パスワードハッシュ /
  展開先パス / ヒアドキュメント終端子 / CUDA パッケージ名）
- **設定がすり替わる 3 件**（展開の取得元が別の展開のものになる /
  ディスク指定が「最大のディスク」に落ちる / snaps の異物）
- **キャンセルが嘘をつく**（Windows でラッパーを殺して「止めた」と表示）
- **制御チャネルの乗っ取り**（ローカルの一般プロセスが cancel の送り先を奪える）
- **入力できない欄 5 か所**（区切り文字を打った瞬間に消える）
- **白画面**（Error Boundary が 1 つも無かった）
- **起動しない USB**（切り詰めた ISO で CIDATA が ISO9660 に重なる）
- **空振りしていた検証 8 件**（廃止済みプレースホルダ要求、`|| true`、
  失敗が exit 0、ISO 0 本で緑 など）

**入れた回帰テストは、すべて修正を変異させると落ちることを確認済み。**

### 2.3 引き継ぎ資料の検証で見つかった取りこぼし

引き継ぎを書いたあと、**この資料自体が実装と食い違っていないか**を
別のワークフローで検証した（32 件指摘 → 28 件が反証を生き延びた）。
このリポジトリは「ドキュメントが実装より広いことを謳う」不具合を
実際に何度も出しているので、引き継ぎ資料も同じ疑いで確かめた。

見つかった実バグ（すべて修正済み・回帰テストあり）:

- **知らない列挙値が素通りして YAML に出ていた。** `apt.fallback` に
  `NOT-A-REAL-VALUE` を書くとそのまま出力され、migrate も validate も
  何も言わない。気づくのは**実機でインストールを始めてから**になる
- **レコードの中の文字列配列が壊れていると、検証も生成も例外で落ちた。**
  `services[].environment: [42]` で `e.trim is not a function`。
  落とし穴 23（GUI が空の確認画面になる）の再発
- **入力欄の修正が 5 か所で止まっていた。** 同じ壊れ方の欄が 8 か所残っており、
  CHANGELOG が「直した」と書いていた**追加ユーザーの SSH 公開鍵欄も未修正**だった。
  フックを汎用化して全 13 か所に適用した

ドキュメント側の誤りも直した:

- 落とし穴 22 が存在しない関数 `isOtherVariant` を指していた
  （しかもその手法は落とし穴 29 が否定している）
- 「平文パスワードを永続化しない」が成立していなかった
  （ディスク暗号化パスフレーズはプロファイル JSON に平文で入る）
- 「実機で通した」が現行コードに対する検証ではなかった（下記 3.2）
- e2e マトリクスは既定では 10 件中 4 件しか `.img` に書いていない

### 2.4 監査結果の置き場

```
run ID    : wf_f344b0ea-275
スクリプト: audit-round4-wf_f344b0ea-275.js
```

5 巡目:

```
run ID    : wf_9dc57c25-409
スクリプト: guard-and-audit-round5-wf_9dc57c25-409.js
修正側    : fix-round5-findings-wf_821c84cc-258.js（run ID `wf_821c84cc-258`）
```

（結果・journal・スクリプトは作者の手元の Claude Code の作業ディレクトリ（`.claude` 配下）にあり、
リポジトリには含まれない。公開にあたってローカルのパスは消した。）

一時ディレクトリなので消える可能性がある。**残す価値があるものは
CHANGELOG と CLAUDE.md に書き写してある。**

| 巡 | run ID | 指摘 | 生存 |
|---|---|---|---|
| 1 | `wf_9cac9e26-778` | 59 | 46 |
| 2 | `wf_f0e104d3-f87` | 30 | 18 |
| 3 | `wf_46e449ca-cef` | 33 | 21 |
| 4 | `wf_f344b0ea-275` | 136 | 63 |
| 5 | `wf_9dc57c25-409` | 36 | 19 |
| 6 | `wf_d24aabeb-1ac` | 29 | 14 |
| 7 | `wf_65b716c6-c27` | 35 | 20 |

（5 巡目は 6 レンズ × 3 視点反証。対象は「文言の i18n」そのもの。→ 2.5）

6 巡目（今回）:

```
run ID    : wf_d24aabeb-1ac
スクリプト: audit-round6-wf_d24aabeb-1ac.js
修正側    : fix-round6-wf_6aa98323-d61.js（run ID `wf_6aa98323-d61`）
階層化側  : hierarchy-and-remaining-work-wf_c472cec9-a4f.js
```

（6 巡目も 6 レンズ × 3 視点反証。対象は「今回入れた階層化と i18n の統一」
そのもの。→ 2.6。記録は作者の手元の `.claude` 配下にあり、リポジトリには含まれない。）
**「29 件」は journal の `severity` の実測**（high 2 / medium 13 / low 14）。
**「14 件生存」はワークフローの申し送りの数字で、journal から数え直してはいない。**

### 2.5 前のセッション：画面文言の i18n と 5 巡目の敵対的監査

**やったこと（3 つ）:**

1. **renderer の日本語ハードコードを `t()` / `useTx()` へ移した。**
   辞書は **410 → 742 キー**（ja / en それぞれ。実測。前の引き継ぎに載っていた
   「272 行」の grep はこの作業のためのもので、**その作業は終わっている**）
2. **main と `@autoinstall/media` が返す画面文言を `LocalizedText`
   （キー + 差し込み値）にした。** 訳すのは renderer が描画するときだけ。
   これらのパッケージは利用者の言語を知らない
   （昇格ワーカーは別プロセスで locale を持たない）
3. **5 巡目の敵対的監査**（`wf_9dc57c25-409`、6 レンズ × 3 視点反証。
   36 件指摘 → **19 件が反証を生き延びた**）。その 19 件を対応した

**方針として固定したこと:**

- **開発者向けの診断は日本語のまま残す。** `Error.message`・
  `WriteStatus.detail`・`ValidationIssue.detail` がそれ。
  画面には「訳した総括 + 生の詳細」の 2 本立てで出す。
  **総括に連結しない**（English の画面に半分日本語の行が出る）
- `LocalizedText` は IPC と NDJSON を通る**純粋なデータ**。
  関数・Symbol・`undefined` を持たせない
- `MsgParams` の値に `LocalizedText` の**入れ子を許した**。
  「〈デバイス〉には書き込めません: 〈理由〉」のように、外側と内側が
  別々の場所で作られる文が実際にある

**型が変わったもの（互換性）** は `CHANGELOG.md` の
「🌐 English に切り替えても日本語が残らないようにした」に表で整理してある。
`RemovableDevice.blockedReason` / `WriteOp.label` / `WriteStatus` /
`WorkerMessage`（`log.message` は `text` に改名）/ `IsoOpenResult.detail` の意味 /
`migrateProfile` の `notes` / `MsgParams`（入れ子を許した）の 7 系統。
**保存済みプロファイルの JSON 形式は変わっていない。**

**この巡で踏んだ、いちばん大きいもの:**

> **契約を広げたのに、受け取り側の検査が古いままだった。**
> `MsgParams` に入れ子を許したあとも、ワーカー境界に置いた「形の判定の写し」が
> `params` を `string | number` に限っていた。そのため理由つきの拒否
> （`device.rejectedNotWritable` が `device.blockedSystemDisk` を入れ子で持つ）が
> 境界で捨てられ、画面には「予期しないエラーが発生しました」だけが出ていた。
> **判定は `isLocalizedText()` 1 つに集約**し、プロセス境界を越える値は
> `deep` で中身まで見るようにした。

**入れた検査**（詳細は CHANGELOG の「入れた検査」）:
辞書のキー一致・全角約物・差し込み名の集合、入れ子の展開と深さ打ち切り、
main / media のソース走査（`message:` / `label:` / `blockedReason:` に
日本語リテラルを残していないこと、辞書に死にキーが無いこと）、
ワーカー境界を越えても文言が残ること、`assertDeviceIsWritable` の拒否 7 + 許可 2。

変異検査については、**この引き継ぎを書く時点で再確認したのは 1 件だけ**:
`isLocalizedTextDeepAt()` を「入れ子を許さない」古い形に戻すと
`worker-boundary.test.ts` の該当ケースが `{ key: 'error.unknown' }` で落ちる
（実行して確認し、すぐ戻した）。**残りは作成時の確認に依拠している。**
次に触る人が疑うなら、そこから疑うのが正しい。

### 2.6 今回のセッション：設定の階層化・辞書の一本化・6 巡目の敵対的監査

**やったこと（3 つ）:**

1. **設定を 4 グループ + `<Disclosure>` の階層構造にした**（`wf_c472cec9-a4f`）
2. **`ValidationIssue` と選択肢ラベルを辞書に一本化した**
   （`add()` の 121 か所 / `{value, labelJa, labelEn}` → `{value, label: MsgKey}`）
3. **6 巡目の敵対的監査**（`wf_d24aabeb-1ac`、6 レンズ × 3 視点反証。
   29 件指摘 → 14 件生存）。その 14 件を対応した（`wf_6aa98323-d61`）

#### 一次資料のどこに沿ったか

設計の出どころは `docs/research/R7-tools-landscape-ux.md`
「Step 4: インストール設定」の**サブステップ 4a〜4i の表と設計原則**。
次の人が「なぜこの並びなのか」を追えるように、対応を書いておく。

| 一次資料 | 資料の「かんたんモード」欄 | このリポジトリでの実装 |
|---|---|---|
| 4a. 場所と言語 | 表示 | `basics`（グループ「必ず設定する」） |
| 4b. コンピュータ名 | 表示 | `basics` の同じ画面 |
| 4c. 管理ユーザー | 表示 | `user`（同上） |
| 4d. リモートアクセス | 表示 | `user` の同じ画面（SSH） |
| 4e. ネットワーク | 折りたたみ（既定 DHCP） | `network`（グループ「必要なら変える」）。生の netplan だけ `<Disclosure>` |
| 4f. ディスク | 折りたたみ（既定 direct・全ディスク） | `storage`（同上）。swap / 暗号化 / リセットパーティション / 生の curtin が `<Disclosure>` |
| 4g. ソフトウェア | 折りたたみ | `software`（同上）。apt の fallback と追加リポジトリ・カーネル flavor・Ubuntu Pro が `<Disclosure>` |
| 4h. インストール後 | 折りたたみ | `postinstall`（グループ「このツールが足すこと」）。error-commands / debconf / reporting / AD / 生の YAML が `<Disclosure>` |
| 4i. 手動で決めたい項目 | **非表示（上級者のみ）** | `runtime`。この位置づけに合わせて **`software` / `postinstall` より後ろへ移した**（以前は 6 番目） |

資料と**違えた点**も残しておく（黙って変えない）:

- 資料は 4a〜4d を「1 つのステップの中のサブステップ」として並べているが、
  実装は**ステップのまま**にして、サイドバーを 4 グループに分けた。
  ステップを畳むと ISO 選択と書き込みの順序（3.2 節の安全 UI 規則）が
  1 画面に混ざるため。
- 資料の「かんたんモード」というモード切替は入れていない。
  代わりに**グループの見出しそのもの**（「必ず設定する」「必要なら変える」）で
  同じことを伝える。モードを 2 つ持つと、保存済みプロファイルを開いたときに
  「どちらのモードで開くか」という新しい事故が増える。
- 資料の「既定値を一行で要約表示する」は、折りたたみの中ではなく
  **サイドバーの各ステップの下**に出した（`summarizeStep`）。
  折りたたみを開かなくても、その画面へ行かなくても分かる。

`STEP_ORDER` は `STEP_GROUPS` から `flatMap` で導く（2 つ並べると必ず食い違う。
`store-steps.test.ts` が落ちも重複も無いことを固定している）。

#### この巡で踏んだ、いちばん大きいもの

> **折りたたみを入れた仕掛けが、折りたたみの中身を見ていなかった。**
> `summarizePostInstall()` は折りたたみの外だけを数えていたので、
> 「上級者向け」に 3 件の変更があってもサイドバーは
> 「既定のまま（何もしない）」と出ていた。
> その中には **`interactiveAll`（全画面で入力を待つ＝無人インストールでなくなる）**
> が含まれる。**隠したものを要約が見ないなら、隠さないほうがまだましだった。**
> 同じ形が 4 つ出た（要約が中身を見ない / 無効化しても値が残る 2 件 /
> 開き直しても折りたたみが開かない）。詳細は `CHANGELOG.md` の
> 「🧭 設定を階層構造に整理した」の「6 巡目の監査で…」。

#### 作業の進め方で踏んだもの

- **`git checkout <file>` で 121 か所の移行を一撃で消した**（落とし穴 79）。
  このリポジトリは 1 セッションぶんをまとめて 1 コミットにするので、
  作業中はほぼ常に全ファイルが未コミット。`git checkout` は使えない。
  別のエージェントが scratchpad に残していたバックアップから復元できたのは運。
- **再現せずに直しにかかった**（落とし穴 80）。
  「生の curtin を選ぶと暗号化パスフレーズの平文告知が消える」は、
  `StorageConfig` が判別可能ユニオンで `{mode:'raw'}` に
  `encryptionPassphrase` が存在しないため、指摘そのものが誤りだった。
- **番人の例外表に逃げかけた**（落とし穴 81）。検証の指摘を 1 つ足したら
  `validate-i18n.test.ts` の「踏めないキーは理由が書かれているものだけ」が落ちた。
  例外表に書けば緑になるが、それは**新しい検証を誰も試さないまま通す**こと。
  正しいのは battery にその組み合わせを足すほう。

#### 変異検査をどこまで確かめたか（正直に）

**この引き継ぎを書く時点で自分で変異させて確かめたのは 3 件**（落とし穴 72）:

| 変異 | 落ちたテスト |
|---|---|
| `summarizeStorage` の `mode === 'lvm' &&` を外す | `storage-whole-disk.test.tsx`「LVM 以外で値が残っていても『暗号化あり』と言わない」 |
| Active Directory の無効化で値を消すのをやめる | `postinstall-ad-disable.test.tsx`「無効なのにドメイン名が残っている」 |
| `changeMode` で `useWholeDisk` を残す | `storage-whole-disk.test.tsx` 3 件 |

どれも戻すと緑に戻ることまで確認した。**退避は `cp`**（落とし穴 79）。
`.e2e` 側は別の担当が 5 件（実在しない placeholder に戻す /
`.catch(() => {})` を戻す / 番人の走査パスをずらす など）を確認している。
**それ以外は作成時の確認に依拠している。**
次に触る人が疑うなら、そこから疑うのが正しい。

### 2.7 今回のセッション：RAID + LVM と bond（利用者の要望）

利用者の要望は「NIC が複数ある際の bond の設定、RAID の設定、
ストレージを boot デバイスに 2 個設定し、RAID1 で /boot、RAID10 で LVM を組んで
root パーティションを切る、を UI から可能に」。
**一次資料は `docs/research/R8-raid-and-bond.md`**（curtin のアクション仕様、
RAID の最小台数表、netplan の bonds）。

合意した設計判断（変えていない）:

1. **台数を決め打ちしない。** ディスクを何台でも並べ、配列ごとにレベルと
   使うディスクを選ぶ汎用 UI。台数不足は検証で止める。
2. **各ディスクに ESP を作り、late-commands で 2 台目以降にも `grub-install`。**
   `grub_device` は 1 つにしか設定できないので、
   「どちらが壊れても起動する」はこのアプリが補う。
   （**付ける場所は 2.9 で直した**: UEFI では disk ではなく **ESP の partition**。）
3. **ディスクの構成方法の 4 つ目として追加。既存の 3 つは一切変えない。**

#### 実際に生成して確かめた（`npm run e2e:raid-bond`）

`scripts/e2e-raid-bond.mts` を足した。**利用者の言葉どおりの構成**
（boot 2 台 = ESP + RAID1 `/boot`、data 4 台 = RAID10 → LVM → root、
NIC 2 枚を 802.3ad で束ねて固定 IP）を組み立て、
`generateUserData()` の出力を**実際に YAML へ往復させて**から見る。**70 / 70 成功**。

見ているのは、形の目視ではなく**機械で追える性質**:

- `storage.config` を出し **`layout` は出さない**（排他）
- **id の参照が全部解決し、前方参照が無い**（＝依存の順に並んでいる）。
  さらに**参照先の種類**まで見る:
  `mount.device` → `format` / `lvm_volgroup.devices` → `raid` /
  `raid.devices` → `partition` / `lvm_partition.volgroup` → `lvm_volgroup`
- ESP が boot ディスク 2 台にあり、**マウントは 1 つだけ**、`grub_device` は 1 つだけ
  （**2.9 で「disk ではなく ESP の partition に付ける」に直した**。当時は disk に付けていた）
- late-commands に 2 台目への `grub-install` が入り、
  **ヒアドキュメントを使わず、利用者の入力を 1 文字も埋め込まず、必ず `exit 0`**
- netplan の `bonds` にメンバーが並び、`ethernets` にも宣言があり、
  **メンバーにアドレスが付いていない**。`802.3ad` が YAML 往復で文字列のまま残る
- **subiquity 公式スキーマを 4 リリースとも通る**。あわせて
  `schema.properties.storage` が 4 リリースとも `{type: object}` であることも見る
  （＝**リリース差が無い**ことの確認。落とし穴 64）
- **RAID10 を 2 台で組もうとすると検証が止め、4 台なら通る**（境界の両側）
- 既存 3 モードが `layout` を出し `config` を出さないまま

#### 変異検査（落とし穴 57）

**このスクリプト自体が何も見ていない可能性**を潰すため、12 個の変異を入れた。
`cp` で退避 → 変異 → 実行 → 復元し、4 ファイルとも `diff` 一致を確認済み
（`git checkout` は使っていない。落とし穴 79）。

| 変異 | 落ちた件数 |
|---|---|
| mount のソートを外す | 1 |
| `RAID_MIN_DEVICES.raid10` を 4 → 2 | 2 |
| bond のメンバーにもアドレスを付ける | 1 |
| `grub_device` の「1 台だけ」の歯止めを外す | 1 |
| ESP を全 boot ディスクでマウントする | 1 |
| `mount.device` を partition の id にする | 3 |
| 2 台目への `grub-install` を丸ごと出さない | 5 |
| 802.3ad なのに `lacp-rate` を出さない | 1 |
| メンバーを `ethernets` に宣言しない | 3 |
| RAID なのに `layout` も一緒に出す | 1 |
| mount を先頭に置く（依存の順を壊す） | 2 |
| 読めない `match` を `{}` に落とす | **0 →** 下記 |

**最後の 1 つは落ちなかった。** このスクリプトの構成は
`match` がすべて読める（シリアル指定）ので、**その経路を踏んでいない**。
スクリプトの穴であって実装の穴ではない
（`raid.test.ts` が同じ変異で落ちることは StorageCore 側で確認済み）。
**「変異を入れたが落ちなかった」ことをここに残す**のは、
次に見る人が「12 件すべて落ちた」と誤読しないため（落とし穴 72）。

また、最初に書いた変異のうち **3 つは実装に当たっていなかった**
（置換文字列が実際のコードと違い、no-op だった）。
`assert old in s` を入れて当たったことを確かめてから測り直している。
**「変異を入れた」ことと「変異が効いた」ことは別。**

---

### 2.8 今回のセッション：イメージファイル (.img) として保存

**USB を挿さず、管理者権限も要らずに、USB と同じ内容の `.img` を作れるようにした。**
出来上がったファイルは Rufus / balenaEtcher / `dd` で焼ける。

引き継いだ作業ツリーには**実装より先にテストだけがあった**
（`image-write.test.ts` 324 行が、まだ無い `startImageWrite` を import していて
typecheck が RED）。テストが求めている契約をそのまま実装する形で閉じた。

#### 直した実バグ 3 件（`apps/desktop/src/main/write-supervisor.ts`）

1. `startImageWrite()` が `write.statusCheckingPrivileges`（「権限を確認しています」）を
   出していた。**昇格しないのに権限の話をするのは嘘。** `image.statusPreparing` に。
2. `settleImageFailure()` が `const removed = true` を置いていて、
   **`removeImageFile()` を一度も呼んでいなかった**。書きかけ／中止した `.img` が
   そのまま残り、しかも「中止しました」と成功扱いになる（落とし穴 50 そのもの）。
   → `fileCreated ? await removeImageFile(imagePath) : true`。
   `fileCreated === false` のときは**同名の既存 `.img` に触らない**（前回作った
   イメージを消したら事故）。
3. `toWritingStatus()` が `bytesDone` と `bytesTotal` を**入れ替えて**写していた。
   進捗バーが逆進する。

テスト側も 1 行直した。`image-write.test.ts:74` の
`Parameters<WriteSupervisor['startImageWrite']>[0]` は、`WriteSupervisor` が
`await import()` で受けた**値**なので型位置に書けない（TS2749）。
同ファイル 92 行目が既に使っている `InstanceType<typeof WriteSupervisor>` に揃えた。
**仕様の書き換えではなく TS の書き間違いの修正**（落とし穴 56 に照らして、
「テストを実装に合わせて緩める」ことはしていない）。

#### 実際に `.img` を作って確かめた（`npm run e2e:image`）

`scripts/e2e-image-file.mts` を新設。**`npm run smoke` とは通る経路が違う** ——
smoke は media パッケージを素で並べるが、こちらは **GUI が通る main の経路**
（`checkImageDestination` → `buildGrubPlan` + `buildIsoPatches` →
`buildSeedBundle` → `checkFreeSpace` → `WriteSupervisor.startImageWrite`）を
そのまま呼び、`WriteStatus` を購読して終端まで待つ。
ipcMain の配線と保存ダイアログだけが無い。

実 ISO 2 種（22.04.5 / 24.04.3）で **84 / 84 成功**。

| 確かめたこと | 22.04.5 | 24.04.3 |
|---|---|---|
| 出来上がりのサイズ | 2.2 GB | 3.4 GB |
| `minimumDiskSize()` と**バイト単位で一致** | ✅ | ✅ |
| 書き出し時間（読み戻し検証こみ） | 7.0 秒 | 11.5 秒 |
| 読み戻し検証 (`verified`) | ✅ | ✅ |
| protective MBR / GRUB ブートコード / 0xEE がディスク全体を覆う | ✅ | ✅ |
| GPT（ヘッダ CRC / エントリ CRC / CIDATA / 末尾のバックアップ） | ✅ | ✅ |
| ISO9660 の Volume ID が保たれる | ✅ | ✅ |
| **すべての casper エントリに `autoinstall`**（落とし穴 1） | ✅ | ✅ |
| Joliet 側の Data Length も更新（落とし穴 3） | ✅ | ✅ |
| `md5sum.txt` の grub.cfg 行（落とし穴 4） | ✅ | ✅ |
| CIDATA の全ファイルがバイト単位で一致 | ✅ | ✅ |
| **昇格の文言が 1 度も出ない** | ✅ | ✅ |
| **作った `.img` を削除した**（数 GB。落とし穴 86） | ✅ | ✅ |

- **31 GB の USB に書いた場合との差は 28.8 GB / 27.6 GB。**
  デバイス容量に水増ししていないことが実測で出ている。
- 許可リスト（落とし穴 55）は**断ることも**確かめている：ダイアログを通っていない
  パスは `image.pathNotChosen`、開いた実績のある ISO への上書きは `image.sameAsIso`。
  空き容量の判定も `checkFreeSpace(required, 1024)` が `image.noSpace` を返すことまで見た。
- **監査記録は入れていない** (`auditRecord: false`)。`buildAuditRecord()` が
  `app.getName()` を呼ぶので Electron の外（tsx）では動かせない。
  記録そのものは `seed-builder` の単体テストが見ている。

#### 変異検査（落とし穴 57）

`write-supervisor.ts` を `cp` で退避してから 2 か所を壊し、スクリプトが落ちることを
確認した（`git checkout` は使っていない。落とし穴 79。復元後 `diff` で一致を確認）。

| 変異 | 落ちた検査 |
|---|---|
| `image.statusPreparing` → `write.statusCheckingPrivileges` | 「最初の状態は image 専用」「権限まわりの文言が 1 度も出ない」 |
| `minimumDiskSize(...)` に `+ 4_000_000_000` | 「minimumDiskSize と一致」「水増ししていない」 |

4 件が落ち、42 件中 38 件成功で `exit 1`。**このスクリプトは空回りしていない。**

---

### 2.9 今回のセッション：参考構成（SATA×2 + NVMe×2）を VM で組んで完走させた

**やったこと**: `scripts/e2e-vm.mts` に RAID 構成のモード (`--raid`) を足し、
参考構成（SATA×2 + NVMe×2）そのもの（容量だけ縮めたもの）を QEMU で組んで
**無人インストールを完走させ、そのシステムを起動させた**。

```
npm run e2e:vm         既定（単一ディスク・LVM）— 一切変えていない
npm run e2e:vm:raid    参考構成（SATA×2 + NVMe×2）
```

VM のディスク（`VM_DISKS` の既定）:

| VM | 実機 | 使い方 |
|---|---|---|
| `sda:60G` | SATA SSD 447.1GB | パーティション。**ESP 1G（この 1 台だけ）** + `/boot` 2G + 残り |
| `sdb:60G` | SATA SSD 447.1GB | パーティション。`/boot` 2G + 残り（ESP は作らない） |
| `nvme0n1:20G` | NVMe 3.5TB | **丸ごと** md2 のメンバー |
| `nvme1n1:20G` | NVMe 3.5TB | **丸ごと** md2 のメンバー |

**容量だけ縮めてある。構成（何が何台で、どの配列に入るか）は同じ。**
3.5TB を実際に作ると `qemu-img convert` の時間が現実的でなくなる。
**3.5TB そのものは試していない**（→ 3.2）。

#### 最終結果（`npm run e2e:vm:raid`）

**30 / 30 成功**（2026-09-07、Ubuntu Server **24.04.3**、`git rev-parse HEAD` = `38a588c` + 未コミット 18 件）。
確かめている 30 件の内訳:

| 段階 | 見ていること |
|---|---|
| 設定 | 検証を通る（error 0 件）/ イメージを書いて読み戻せる / WSL に運べた |
| インストール | インストーラが起動した |
| **できたもの** | md が 3 つ / `/boot` の md が RAID1 2 台で ext4 / LVM PV の md が RAID1 2 台 / **md2 は何も載っていない** / **md2 のメンバーはディスク丸ごと** / `/boot` と PV の md はパーティションがメンバー / mdadm.conf の ARRAY が `/dev/md0 /dev/md1 /dev/md2` / メタデータ名が 0・1・2 / vg0 の PV が md / vg0/lv-0 がある / ルートが `vg0-lv--0` |
| **ESP** | 1 つだけ / あるのは sda だけ |
| **fstab** | `/` `/boot` `/boot/efi` がある / **余分なマウントが無い**（md2 はマウントされない） |
| user-data が効いたか | ホスト名 / cloud-init に管理ユーザーが渡っている / sudo 指定つき / autoinstall の user-data が読まれた |
| **起動** | カーネルが起動した / **`vm-raid login:` が出た** |
| 初回起動後 | 管理ユーザーが作られた (`USERS=vmadmin`) / sudo に入っている |

**ここまで到達するのに VM を 4 回走らせている**（22.04 で無音 → 24.04 で
`grub_device` の error → 直して 27 件中 24 件（残る 3 件は**検査側のバグ**）→
検査を直して 30/30）。

#### この巡で見つけた実バグ（VM でしか見つからなかったもの）

**`grub_device` を「ディスク」に付けていた。UEFI では ESP の「パーティション」に付ける。**

- 症状: `apply_autoinstall_config` が
  `autoinstall config did not create needed bootloader partition` を投げ、
  **ディスクに 1 バイトも書かないまま**インストールが止まる。
- 原因: subiquity の `models/filesystem.py` の `needs_bootloader_partition()` は、
  UEFI のとき `self._all(type="partition", grub_device=True)` **だけ**を見る。
  `type="disk"` を見るのは **BIOS 起動のときだけ**。
- なぜ気づけなかったか: **一次資料 (R8) が `disk` の任意キーとしてしか書いていない**。
  curtin のドキュメントを写した表に `partition` の `grub_device` が無かった。
  `e2e-raid-bond.mts` の 70 件も `raid.test.ts` も、
  **「disk に 1 つだけ付く」ことを正として固定していた**（落とし穴 56 そのもの）。
- 皮肉なことに、**`StorageStep.tsx` の「curtin 直書き」の記入例は最初から正しかった**
  （`disk … grub_device: false` / `partition … flag: boot, grub_device: true`）。
  生成側と画面の例が食い違っていたのに、誰も突き合わせていなかった。
- 直した先: `generate-raid.ts`（disk からは出さない / **`/boot/efi` にマウントする
  1 台目の ESP にだけ付ける**）、`raid.test.ts`、`scripts/e2e-raid-bond.mts`（70 → 73 件）、
  `docs/research/R8-raid-and-bond.md` の §4.1（**一次資料を足した**）、
  `CLAUDE.md` の落とし穴 98。

#### ハーネス側で直したもの（バグではないが、これが無いと原因に到達できない）

1. **`findIso()` が「見つけた順」に選んでいた。**
   `~/images` を上から見るので `ubuntu-22.04.5-live-server` が先に当たり、
   プロファイルは `createDefaultProfile('24.04')` 固定だった。
   **ISO と設定のリリースが食い違ったまま**走っていた。
   新しいリリースを優先し、**選んだ ISO の `series` をそのまま設定に使う**ようにした。
2. **カーネルがシリアルに何も出していなかった。**
   Ubuntu の ISO の grub.cfg は `console=` を付けないので、
   GRUB のエラー 2 行のあとは無音になる。
   **「失敗している」と「時間がかかっている」が区別できない**まま 15 分待った。
   VM のときだけ `console=tty0 console=ttyS0,115200n8` を足す
   （**実機の USB に焼くときは付けない**。`e2e-vm.mts` だけが足す）。
3. **`inspect-disks.sh` に機械可読な行を足した**（既存の出力は 1 行も消していない）。
   `MD=<名前>|<レベル>|<台数>|<md 上の FSTYPE>|<デバイス名>|<メンバー>` /
   `LVM_PV=` / `LVM_LV=` / `ESP_PARTS=` / `ESP_DISKS=` /
   `FSTAB_MOUNTS=` / `MDADM_CONF_ARRAYS=` / `MDADM_CONF_DEVS=`。
   md の**番号と名前は当てにならない**（別ホストで組み立て直すと `/dev/md127`）ので、
   **「レベル・台数・その md の上に何が載っているか」で見分ける**:
   `ext4` = `/boot`、`LVM2_member` = LVM PV、**空 = 何も載っていない**（`role: 'data'`）。
   **メンバーが `/dev/loopN`（末尾に `pN` が無い）なら丸ごとメンバー**
   ——`usage: 'whole'` が意図どおり出たかは、ここでしか機械で言えない。


#### 実際にできたもの（VM の中・最終実行の出力そのまま）

```
=== パーティション ===
NAME            SIZE FSTYPE            LABEL
loop2            20G                                   ← nvme0n1（丸ごとメンバー・表を作っていない）
loop3            20G                                   ← nvme1n1（丸ごとメンバー・表を作っていない）
loop4            60G                                   ← sda
├─loop4p1         1G vfat                              ← ESP（この 1 台だけ）
├─loop4p2         2G linux_raid_member ubuntu-server:0
│ └─md127         2G ext4                              ← /boot
└─loop4p3        57G linux_raid_member ubuntu-server:1
  └─md126        57G LVM2_member
    └─vg0-lv--0  57G ext4                              ← /
loop5            60G                                   ← sdb
├─loop5p1         2G linux_raid_member ubuntu-server:0 ← ESP が無いので /boot が p1
│ └─md127         2G ext4
└─loop5p2        58G linux_raid_member ubuntu-server:1
  └─md126        57G LVM2_member
    └─vg0-lv--0  57G ext4

=== RAID ===
Personalities : [raid1]
md125 : active (read-only) raid1 loop2[0] loop3[1]        ← md2（NVMe 丸ごと・何も載っていない）
md126 : active (read-only) raid1 loop5p2[1] loop4p3[0]    ← md1（LVM PV）
md127 : active (read-only) raid1 loop5p1[1] loop4p2[0]    ← md0（/boot）

MD=ubuntu-server:2|raid1|2||md125|/dev/loop2,/dev/loop3
MD=ubuntu-server:1|raid1|2|LVM2_member|md126|/dev/loop4p3,/dev/loop5p2
MD=ubuntu-server:0|raid1|2|ext4|md127|/dev/loop4p2,/dev/loop5p1

=== LVM ===
  /dev/md126 vg0 56.96g
  lv-0 vg0 56.96g

ESP_PARTS=1
ESP_DISKS=sda
ルート: /dev/mapper/vg0-lv--0
HOSTNAME=vm-raid

--- /etc/fstab ---
/dev/disk/by-id/dm-uuid-LVM-kqV2czuhuS2Nos3SIUx2fbDrr4FIvYeyGctaNCtl4VAjTImYuWZ0ahujGwUiRpMc / ext4 defaults 0 1
/dev/disk/by-id/md-uuid-d920010d:36e9311f:045d126d:eaa7ef6c /boot ext4 defaults 0 1
/dev/disk/by-uuid/15F9-9D47 /boot/efi vfat defaults 0 1
/swap.img	none	swap	sw	0	0

--- /etc/mdadm/mdadm.conf ---
ARRAY /dev/md0 metadata=1.2 UUID=d920010d:36e9311f:045d126d:eaa7ef6c
ARRAY /dev/md1 metadata=1.2 UUID=b4d6990a:73671259:35c83ddf:2aeecc20
ARRAY /dev/md2 metadata=1.2 UUID=2257f2f6:89d01ec1:aa8bad90:1a98fe00
```

読み方:

- **`md2` は組み立てられているが、その上に何も無い**（`FSTYPE` が空、`fstab` にも無い）。
  `role: 'data'`（作るだけ）が意図どおりに出ている。
- **`md2` のメンバーは `/dev/loop2` `/dev/loop3`**（末尾に `pN` が無い＝**ディスク丸ごと**）。
  `md0` / `md1` のメンバーは `/dev/loop4p2` のようなパーティション。
  `usage: 'whole'` と `usage: 'partitions'` が両方とも意図どおり出ている。
- **ESP は sda の p1 だけ**。sdb には無いので、sdb の `/boot` は p1・データは p2 になる
  （実機の `lsblk` の sdb2 / sdb3 とは番号が 1 つずれるが、md のメタデータで対応が付く）。
- **`/dev/md127` `/dev/md126` `/dev/md125` は検査ホスト側での番号**
  （別ホストで組み立て直すと番号が変わる）。
  新システムの `/etc/mdadm/mdadm.conf` には `md0` / `md1` / `md2` が入っている。
- **起動した。** USB を挿さない状態（`run-vm.sh boot`）でカーネルが上がり、
  シリアルに `vm-raid login:` が出た。
  ＝ **RAID1 (metadata 1.2) の `/boot` を GRUB が読めている**（3.1 の宿題が 1 つ片付いた）。
- **初回起動で cloud-init が管理ユーザーを作った**（`USERS=vmadmin` / `SUDO=vmadmin`）。
  インストール直後は空なのが正しい（落とし穴 93）。
- `/swap.img` は subiquity の既定。**このアプリが出しているものではない**。

#### 検査側のバグも 3 件出た（実装は正しいのに FAIL を出していた）

**「実装が悪い」と「検査が悪い」を取り違えないこと**（落とし穴 93）。
`grub_device` を直したあとに残った FAIL は、どれも**検査の書き方**が悪かった。

1. **`raid.name` をメタデータの `Name:` で照合していた。**
   `name: md0` は `/dev/md0` になり、mdadm はそこから名前を **`0`** と決める
   （`Name : ubuntu-server:0`）。**正しく組めているのに FAIL**。
   照合先を `/etc/mdadm/mdadm.conf` の `ARRAY /dev/md0` に変えた（落とし穴 107）。
2. **`fstab` のマウントポイントに swap の行が混ざっていた。**
   `/swap.img none swap sw 0 0` の 2 列目は `none` なので、
   「余分なマウントがある」に見えていた。`/` で始まる列だけを数えるようにした。
3. **`` new RegExp(`${host}\s+login:`) `` が永久に一致しない。**
   テンプレートリテラルの中の `\s` は正規表現の `\s` にならない（`s` 1 文字になる）。
   **これは今回入れたコードではなく、元からあった**
   ——つまり「ログインプロンプトがホスト名つきで出た」は
   **単一ディスクの巡でも本当は測れていなかった**（落とし穴 106）。

#### 変異検査をどこまで確かめたか（正直に・落とし穴 57 / 72）

**生成側の修正（`grub_device` の位置）は 3 つの変異で確かめた。**
`cp` で退避 → 変異 → `raid.test.ts` と `e2e-raid-bond.mts` を実行 → 復元
（`git checkout` は使っていない。落とし穴 79。
スクリプトは scratchpad の `mut-grub.py`）:

| 変異 | raid.test.ts | e2e-raid-bond |
|---|---|---|
| 修正前の形に戻す（disk に付け、ESP から外す） | 4 件 FAIL | 4 件 FAIL |
| `grub_device` をどこにも出さない | 4 件 FAIL | 3 件 FAIL |
| 全部の ESP に付ける（マウントしない ESP にも） | 2 件 FAIL | 1 件 FAIL |

復元後に `e2e-raid-bond` が **73 / 73** に戻ることも確認した。

**VM 側の検査は、1 件だけ「変異させて落ちた」に相当する証拠がある。**
`grub_device` を直す前の実行（2 回目）が、まさにその変異の状態で
`autoinstall config did not create needed bootloader partition` で止まっている。
**それ以外の VM 検査（丸ごとメンバー / md2 が何も載っていないこと / ESP の台数 /
fstab の中身）は、個別に変異させて落ちることを確かめていない**
——1 件あたり VM を 1 本走らせる（30〜40 分）ので、今回は見送った。
ただしどの検査も**値を literal と比べる形**なので、
報告に該当行が無ければ必ず落ちる（空振りで緑にはならない）。
次に触る人が疑うなら、ここから疑うのが正しい。

#### `error-commands` が効いた

原因にたどり着けたのは、**失敗したときに `/var/log/installer/` を CIDATA に書き出す
`error-commands` が既に入っていた**から。
`subiquity-traceback.txt` を USB イメージ側から読むだけで原因が確定した。
（VM のディスクではなく **USB のイメージ**に残るので、
インストール先が 1 バイトも書かれていなくても読める。）

### 2.10 今回のセッション：YAML の方言（1.1 と 1.2）で MAC が数になっていた

**症状**: `npm run e2e:vm:mirror`（ESP を 2 台に置き、NIC 2 枚を bond で束ねる）で
インストールが**ディスクに 1 バイトも書かないまま**止まった。
画面に出たのは `An error occurred. Press enter to start a shell` の 1 行だけ。
`grub_device` の不具合（2.9）と**まったく同じ見え方**をする。

**原因にたどり着いた経路**（`error-commands` が 2 度目に効いた例）:

1. VM のディスクは空なので、インストール先からは何も分からない
2. USB イメージの `CIDATA` パーティションを loop で開く
   （**`ESP` も vfat なので、ラベルで選ぶこと**。パーティション番号順に
   最初の vfat をマウントすると ISO の ESP に当たる）
3. `installer-journal.log` に
   `subiquity/Network/apply_config: FAIL: Command '['netplan', 'apply']' returned non-zero exit status 1`
4. `installer-logs.tar.gz` の `subiquity-server-debug.log` に**理由**があった:

```
config for nic-525400123456 = {'match': {'macaddress': 41135085296}}
stderr: Invalid MAC address '41135085296', must be XX:XX:XX:XX:XX:XX
```

**`52:54:00:12:34:56` が 60 進数として読まれていた。**

```
52·60⁵ + 54·60⁴ + 0·60³ + 12·60² + 34·60 + 56 = 41135085296
```

`yaml` パッケージの既定は **YAML 1.2** で、1.2 には 60 進数が無い。
だから「クォート不要な文字列」と判断されて素のまま出る。
ところが読むのは **PyYAML（subiquity）と libyaml（netplan）＝ YAML 1.1** で、
1.1 には 60 進数がある。**出す側と読む側で方言が違っていた。**

**hex の英字が 1 つでも入れば 1.1 でも文字列**（`52:54:00:ab:34:56` は無事）。
つまり「たまたま動く MAC」と「壊れる MAC」が混在する。QEMU の既定 MAC は
全桁が 0〜59 の 10 進数なので、必ず壊れる側に当たる。

**直したもの**:

- `packages/shared/src/autoinstall/yaml.ts`（新規）に方言を**1 か所だけ**置いた。
  `parseAutoinstallYaml()` / `createAutoinstallDocument()` を通し、
  `yaml` から `parseDocument` / `Document` を直に import しない。
  生成も解析も**消費者と同じ 1.1**にしたので、
  「こちらが持っている値」と「subiquity が持つ値」が食い違わない。
  1.1 で出すと**誤読される値だけがクォートされる**（過剰クォートにならない）。
- 影響したのは **MAC を使う 2 経路の両方**——bond のメンバー選択と、
  単一 NIC の `target: {kind:'mac'}`。**bond だけの不具合ではなかった。**
- 生の netplan YAML と上書き YAML には、利用者が書いた文字列がそのまま
  この方言で読まれるので、**`macaddress` が数になっていたら error で伝える**
  （`numericMacPaths()`。`validate.networkYamlUnquotedMac`）。
  クォート済みと hex 入りには何も言わない（誤検出 0 を確認済み）。

**なぜ 73/73 が緑のまま通り抜けたのか**（ここがいちばん大事）:

`scripts/e2e-raid-bond.mts` は生成物を **`yaml` の `parse`（＝1.2）で読み直していた**。
1.2 で読めば MAC は文字列に見えるので、**クォート漏れは原理的に見えない**。
**検査の道具が消費者と違う規則で読んでいたら、その検査は何も見ていない。**
落とし穴 103（スキーマが緑でも組まれる証拠にならない）の別の顔。

**入れた番人**（値を列挙しない形にした）:

> 生成したテキストを **1.1 と 1.2 の両方で読み、結果が完全に一致すること**。

一致しない値があれば、それは「こちらが思っている型」と「subiquity が読む型」が
違う値なので、クォートが要る。MAC の 60 進数だけでなく、
`yes` / `no` / `on` / `off`（1.1 だけ真偽値）も先頭 0 の八進数も 1 本で捕まる。
**将来 UI に増える自由入力にも自動で効く。**

置いた場所は 3 つ:

| 場所 | 何を見るか |
|---|---|
| `packages/shared/src/autoinstall/yaml.test.ts` | 4 リリースの既定 + MAC 2 経路 + **地雷入りプロファイル**（`username: 'no'` / `hostname: 'off'` / `packages: ['yes','no','on','off','y','n']`） |
| `scripts/e2e-raid-bond.mts` | bond（名前指定・MAC 指定）と単一 NIC の MAC |
| `scripts/e2e-matrix.mts` | **設定 10 パターン × 実 ISO 2 種の全ケース** |

**変異させて落ちることを確かめた**（落とし穴 57）。
`AUTOINSTALL_YAML_VERSION` を `'1.2'` に戻すと:

| 検査 | 変異時 |
|---|---|
| `yaml.test.ts` | **12 件中 6 件 FAIL** |
| `e2e-raid-bond` | MAC の 2 経路が FAIL（`1.1 では number 41135085296 / 1.2 では string "52:54:00:12:34:56"`） |

**このとき番人自身の欠陥も 1 つ見つかった。** 最初は
「`yaml.ts` の方言 対 1.2」で比べていたので、方言を 1.2 に戻すと
**比較が 1.2 対 1.2 になって緑のまま**だった。
見たいのは「出力されたテキストが両方の方言で同じ意味か」であって
こちらの設定値ではないので、**両方の版をその場で固定して読む**形に直した。
あわせて「クォートを外した MAC を仕込んで検出させる」自己確認を検査の中に置いた
（落とし穴 110）。

### 2.11 今回のセッション：ESP のミラーが「関係の無いディスク」に書きに行っていた

`e2e:vm:mirror` を通したことで、**§3.1 で「怪しい」と書いていた項目がそのまま当たった**。

> `findmnt` は `/target/boot/efi` しか見ていないので、
> **インストーラ USB の ESP は除外されない**（§3.1 の 3 番目の疑い）

VM のログ（`/var/log/autoinstall-raid-esp.log`）:

```
primary ESP: /dev/vda1
--- /dev/sda2                      ← VM のディスクは vda / vdb。sda は **USB**
grub-install: error: ... `/boot/efi-mirror/EFI/ubuntu/grubx64.efi': No space left on device
FAILED: neither grub-install nor copying worked for /dev/sda2
--- /dev/vdb1
grub-install ok: /dev/vdb1         ← 本来の目的は成功している
RESULT: incomplete
```

**失敗したから気づけただけ**である。USB の ESP は 5 MiB しかないので溢れた。
本当に危ないのは「**別の OS が入った既存ディスクの ESP**」で、
そちらは容量があるぶん成功してしまい、**他の OS のブートローダを黙って上書きする**。

#### 1 回目の修正では足りなかった

「`findmnt -R /target` で `/target` 配下のマウントを全部拾い、
`lsblk -s` で物理ディスクまで辿った集合」に絞ったが、**2 回目の VM も incomplete** だった:

```
target disks: /dev/sda /dev/vda /dev/vdb      ← USB (/dev/sda) が混ざっている
mirrored: 2, failures: 1, skipped: 0
```

**curtin は ISO のパッケージプールを使うためにインストーラ USB を
`/target/cdrom` へ bind する。** だから「`/target` 配下」には USB が入る。

見るのを**起動チェーンの 3 か所だけ**にした——
`/target` `/target/boot` `/target/boot/efi` を `findmnt --target` で引く
（`--target` は「そのパスを含むいちばん近いマウント」を返すので、
`/boot` が独立していない構成でも root の SOURCE が返って正しく動く）。

#### VM を回さずに確かめられるようにした（`npm run e2e:esp-mirror`、数秒）

VM は「ESP を持つ関係の無いディスク」を用意できない
（インストーラ USB が偶然その役をしたから見つかった）。
偽の `findmnt` / `lsblk` / `mount` を PATH に置き、`/target` をサンドボックスに
置き換えて **生成した late-command をそのまま `sh` で走らせる**。
見せる機械は 4 つの ESP を持つ:

| デバイス | 何か | 期待 |
|---|---|---|
| `/dev/vda1` | 1 台目の ESP（`/boot/efi` にマウント済み） | 対象外（primary） |
| `/dev/vdb1` | 2 台目の ESP | **ミラーする** |
| `/dev/sda2` | インストーラ USB の ESP（`/target/cdrom` に bind されている） | **触らない** |
| `/dev/nvme9n1p1` | 別の OS が入った既存ディスクの ESP | **触らない** |

**10 / 10**。絞り込みを外す変異で 5 件、`-R /target` に戻す変異で 4 件が落ちる。
後者の変異は `target disks: /dev/sda /dev/vda /dev/vdb` を出す——
**VM の実測ログとまったく同じ行**（落とし穴 116）。

**`[ -b "$src" ]` は外した。** シェル組み込みなので PATH のスタブが効かず、
偽のデバイス名が全部落ちて「対象 0 台」になる。
この判定は `lsblk` が非ブロックデバイスで失敗することと重複していた。
**生成するシェルは、外から観測・差し替えできる形に寄せておく**と、
VM を 1 本（30〜40 分）回さずに確かめられる。

### 2.12 今回のセッション：bond の 4 件の FAIL は検査スクリプトの嘘だった

`e2e:vm:mirror` が「netplan に bonds がある」以下 4 件を FAIL にしたが、
**インストール済みシステムを直接開くと bond は正しく入っていた**:

```yaml
# /etc/netplan/50-cloud-init.yaml（**実物をそのまま貼る。畳んで書かない**）
  bonds:
    bond0:
      dhcp4: true
      interfaces:
      - nic-525400123456
      - nic-525400123457
      parameters:
        mode: "active-backup"
        mii-monitor-interval: "100"
```

> ここは最初、行数を詰めるために `interfaces: [a, b]` / `parameters: {mode: ...}` と
> **フロー形式に畳んで**書いていた。すると監査が
> 「検査スクリプトはフロー形式を読めないから、正しく組めていても FAIL する」という
> 指摘を出した——**引き継ぎ資料のほうが実物と違っていた**のが原因である。
> 実物はブロック形式で、検査は通っている。
> **資料に貼る出力は畳まない**（落とし穴 71: 資料そのものを実装と突き合わせる）。

**層が 3 つある**（落とし穴 112。管理ユーザーの落とし穴 93 とまったく同じ形で、
93 を引用したコメントのすぐ下で同じ間違いをした）:

| 層 | どこを見るか | いつ見えるか |
|---|---|---|
| 設定が渡った | `/etc/cloud/cloud.cfg.d/90-installer-network.cfg` | インストール直後 |
| 描画された | `/etc/netplan/50-cloud-init.yaml` | **初回起動後**（cloud-init が書く） |
| リンクが上がった | 起動したシステムの中 | 起動後（未検証） |

インストール直後の検査が 2 番目だけを見ていたので、**まだ存在しないファイル**を
「bonds が無い」と報告していた。両方を読み、`NETPLAN_SOURCE=` でどちらを読んだかを出す形にし、
**起動後にもう一度**（＝ 2 番目の層で）見る検査を足した。

**cloud-init は値をクォートして書き出す**（`mode: "active-backup"`）ので、
`grep -oE 'mode:\s*[a-z0-9.-]+'` は先頭の `"` に当たって一致しない。
クォートを落として読むようにした（落とし穴 113）。

### 2.13 今回のセッション：8 巡目の敵対的監査（43 エージェント）

**やり方**: 7 つのレンズで並列に欠陥を探し、出た指摘 1 件ごとに
**3 つの異なる観点**（再現するか / 既に対処済みでないか / 影響が主張どおりか）で
反証させた。2 票以上が反証したら落とす。

```
指摘 28 件（high 1 / medium 16 / low 11）
  → 重複を除いて 28 件、重い順に 12 件を検証
  → 7 件が反証を生き延び、5 件が反証された（16 件は未検証のまま記録）
```

#### 生き延びた 7 件と、その処理

| # | 指摘 | 結果 |
|---|---|---|
| 1 | **`yaml` の 1.1 は PyYAML の 1.1 と同じではない** | 直した（落とし穴 117） |
| 2 | 検証が例外を投げる（自己参照アンカー / エイリアス爆発） | 直した（落とし穴 118） |
| 3 | 生の storage YAML の `serial` / `wwn` に同じ軸が残っている | 直した（落とし穴 119） |
| 4 | shim を既定パスに置くのに `grubx64.efi` を置いていない | 直した（落とし穴 120） |
| 5 | `RESULT: nothing to do` の文言が事実と違う | 直した（落とし穴 121） |
| 6 | 起動チェーンに載らない ESP が黙って除外される | 検証で warning（落とし穴 122） |
| 7 | 起動後の bond 検査がフロー形式の netplan を読めない | **指摘の前提はこちらの資料の誤り**。ただし検査は両形式を読めるようにした |

7 番は、**引き継ぎ資料が実物と違っていた**のが原因だった。
§2.12 に貼った `50-cloud-init.yaml` を行数を詰めるために
`interfaces: [a, b]` とフロー形式に**畳んで**書いたので、
監査がそれを実物と思って「検査が読めない」と指摘した。
実物はブロック形式で検査は通っている。**資料に貼る出力は畳まない**（落とし穴 71）。
とはいえ **どちらの形式で書き出すかは cloud-init の実装都合**なので、
検査は両方読めるようにした（ついでにブロック形式だけメンバー名の
ハイフンまで落としていたのも直した）。

#### 反証された 5 件（直していない。理由を残す）

- 「`RESULT:` が `failed` だけで決まり、`skipped` や umount 失敗が届かない」
  → `skipped` は 5 番の修正で文言に入った。umount 失敗は `WARNING:` 行として残る
- 「生の storage YAML には複数の欠陥があり、`serial` が八進数になる」
  → 3 番として採用済み（重複）
- 「`BOND_CARRIER` が `Link UP` を受け入れるので、carrier が無くても通る」
  → `Gained carrier` と `Link UP` は systemd-networkd が**両方出す**。
    実測ログで両方あることを確認済み。加えて `BOND_ADDRESS` が
    DHCP のアドレスを要求するので、リンクが上がっていなければ通らない
- 「`inspect-disks.sh` が `/mnt/vm-esp` を `cleanup()` で外していない」
  → ESP を見るループの中で毎回 `umount` している（`losetup -d` も自分の名前で行う）

#### 直したが、今日の結果は 1 件も変わらなかったもの

「生成 YAML を読み直すユニットテスト 6 ファイルが `yaml` の既定 (1.2) のまま」
という指摘は正しかったので、21 か所を消費者と同じ方言に切り替えた
（`parseAutoinstallYamlToJs` を 1 つ export し、各ファイルは `parse` として import する）。
**ただし 494 件の結果は切り替えの前後で同じだった。**
6 ファイルはどれも方言差が出る値（MAC・`yes`/`no`・指数形式）を assert していないので、
今日の時点では何も捕まえていない。**将来そういう値を assert したときの死角を消すため**の変更である。
変異（出力を 1.2 に戻す）で落ちるのは `yaml.test.ts` の 5 件だけで、この 6 ファイルは落ちない。
**「直した」と「効いた」は別**なので、数字で書いておく（落とし穴 85）。

#### 監査そのものについて分かったこと

- **エージェントはリポジトリに一時ファイルを残す。** 10 個の `scripts/_audit*.mts` が
  作られ、`tsc -p scripts/tsconfig.json` を壊した（終了時には全部消えていた）。
  「作業中は typecheck が赤になりうる」と分かっていないと、
  自分の変更のせいだと誤認する。
- **エージェントが実装を変異させたまま戻さないことがある。**
  1 件が「`yaml.ts` の `AUTOINSTALL_YAML_VERSION` が `'1.2'` に書き換わっている」と
  報告してきた（別のエージェントの変異テスト）。**最後に必ず作業ツリーを確認する**。
- 監査には**禁止事項を明示的に渡す**必要がある。特に
  「`git checkout` を使うな」（未コミットの作業が消える。落とし穴 79）。

### 2.14 今回のセッション：IP だけ別のサンプルと、その VM 検証

**やったこと**: 「同じ構成だが IP だけが台ごとに違う」という構成を
**配布できるサンプル**として置き、**そのサンプルそのもの**を VM で確かめられるようにした。

```
samples/ip-only.json     GUI の「プロファイルを開く」から読める実物
samples/README.md        固定と可変の対応・使う前に変えるところ
npm run e2e:vm:ip        そのサンプルで VM を回して、選んだ IP が入ることを確かめる
```

#### 何を確かめたか（3 つの層）

引き継ぎ資料が長く「**subiquity 上では未実行**」と書いてきた連鎖を通した:

```
GRUB の menuentry の引数 (ai.ipv4=10.0.2.101/24)
  → early-commands の python が /proc/cmdline を読む
  → /autoinstall.yaml を PyYAML で書き換える
  → subiquity が適用する
  → cloud-init が /etc/netplan に書き出す
```

| 層 | 見たもの | 結果 |
|---|---|---|
| 反映したと記録したか | `起動時の指定を反映しました: ai.dns, ai.gw, ai.ipv4` | ✅ |
| 設定に入ったか | インストール直後の `10.0.2.101/24` | ✅ |
| 描画されたか | 初回起動後の `/etc/netplan/50-cloud-init.yaml` | ✅ |

あわせて **予備の値 (`10.0.2.90/24`) と、選ばなかった `10.0.2.100` / `10.0.2.102` が
入っていないこと**、**アドレスがちょうど 1 つ**であることも見ている。
「たまたま何か入っていた」「全部入っていた」を排除するため。

**わざと 2 番目のプリセットを選んでいる。** 1 番目だと
「添え字がずれて常に先頭を指す」壊れ方が見分けられない。

#### メニューの選び方（自分の誤りを 1 つ訂正した）

`patchGrubCfg` に `defaultEntry` を足し、**VM のときだけ** `set default=<n>` を入れる。
製品の書き込み経路では出ない（単体テストが `not.toContain('set default=')` で固定）。

最初、その理由を「**GRUB のメニューはシリアルに出ないので機械で選べない（実測）**」と
4 か所に書いた。**これは誤りだった。**
`terminal_output serial` が無いことを grep で確かめただけで結論まで飛んでいた。
実際には **OVMF が EFI のコンソールをシリアルに多重化する**ので
メニューは出るし、矢印キーを流し込めば選べる（監査エージェントがシリアルログで実証）。

正しい理由は「**キー入力はメニューが出るまでの待ち時間に依存する**——
負荷で描画が遅れると静かに別の項目を選ぶ。既定を書けば決定的になる」。
落とし穴 127 に記録した（落とし穴 72 の再発）。

#### サンプルを「配布物として」検査する

`samples.test.ts`（7 件）が **読める・通る・意図どおりの YAML になる**を固定する。
特に:

- **パスワードハッシュは入れない。** 入れると検証が指摘を 1 つも出さないので、
  「配ったサンプルの既定パスワードのまま焼いた」を捕まえる仕組みが無くなる。
  空なら error 1 件で止まり、`ipc.ts` が書き込み自体を拒む。
- **キー名の綴り違いは黙って通る。** `netowrk` と書くと note も出ず検証も通り、
  静的 IP が DHCP に化ける（落とし穴 22 / 49 / 50 の新しい入口。落とし穴 129）。
  だから「**書いた値が読み込んだあとも残っている**」ことを名指しで見る。
  変異（綴り違い / プリセットにホスト名を混ぜる）で落ちることを確認済み。

#### 検査が 1 度嘘をついた

`early-commands が「反映した」と記録している` が `%s` を答えとして FAIL した。
インストーラのログには **early-commands の本文がそのまま記録される**ので、
`sys.stdout.write("… 反映しました: %s\n" % …)` という**ソース行**を拾っていた。
正しく動いているのに偽 FAIL。
「出力にしか現れない形」（`反映しました: ai.` と引数名が続く）で探すよう直した（落とし穴 128）。

### 2.15 今回のセッション：Electron 製インストーラ（2026-09-11）

利用者の指示は 2 つ:
「Electron製インストーラーで作成してください。」
「モダンかつスタイリッシュな形としてコンセプトを反映してください。
（別の非公開アプリ）など参考になるものがあれば参考にしてください。」

別の非公開アプリの Electron 製インストーラを参照実装として読み、
**設計は借りて、判断は借りずに**移した。

#### できたもの

`npm run dist:installer` → `apps/desktop/release/Autoinstall USB Creator Setup-0.1.0.exe`
（**196.1 MB**、5〜6 分）。中身は payload.7z（99.4 MB）+ 7za.exe + アイコン +
インストーラ自身の Electron 一式。

段は 4 つ: ようこそ → インストール設定 → インストール → 完了。
アンインストールは「プログラムと機能」（`uninstall.ps1` が黙って走る）と
「Setup.exe をもう一度動かす」（UI つき）の 2 経路。

#### 参照実装から**変えた**ところ（理由つき）

| | 参照実装（非公開） | ここ | 理由 |
|---|---|---|---|
| インストール先 | `Program Files`（全ユーザー） | `%LOCALAPPDATA%\Programs`（このユーザー） | このアプリは「本体は通常権限、USB へ書く子だけ昇格」が設計。インストーラだけ管理者を要求するのは筋が通らない。未署名で `requireAdministrator` は SmartScreen も強くなる |
| レジストリ | HKLM | **HKCU** | 上に合わせる。HKLM に書くと他のユーザーの「プログラムと機能」に、そのユーザーからは消せない項目が出る |
| アンインストーラ | Setup.exe を複製（196 MB） | **`uninstall.ps1`（1 KB）** | 落とし穴 138。複製だと合計 595 MB になる |
| 背景の演出 | conic の回転 + 粒子 + `backdrop-filter` | **静止したグラデーション + transform/opacity だけ** | CLAUDE.md の「大きな面に `backdrop-blur` を使わない」。ぼかしは確認ダイアログの覆いだけ |
| 使用許諾の段 | あり（`fetch('./license.txt')`） | **無し** | このリポジトリに LICENSE ファイルが無い。無いものの同意を求めない |
| 文言 | main にも日本語 | **辞書のキーで運ぶ** | 落とし穴 78 / 142。番人も置いた |
| QoS / Firewall | 登録する | **登録しない** | このアプリはネットワークを使わない |

#### 意匠

アイコン (`scripts/make-icon.py`) と**同じ図形・同じ色**を SVG で描き直した
（`Mark.tsx` の座標は `make-icon.py` の比率を 64 倍したもの）。
slate-900 → indigo-700 のグラデーション、白い USB メモリ、
書き込む向きの下向き矢印。矢印だけがゆっくり落ちる。
960→**980×700** の枠なし窓、左 240px の段、上端 48px の自前タイトルバー。

#### 検証（すべて実測）

- `npm run e2e:uninstall-script` … **13 / 13**（変異させて落ちることも確認）
- `.e2e/installer-shots.mjs` … payload 無しで 4 段を巡り、
  使えないパスで理由が出てボタンが押せないこと、`payload-missing` で止まることを見る
- `.e2e/installer-run.mjs` … **できあがった Setup.exe** で通しインストール。
  合計 398.1 MB が「必要な容量」の表示と一致、入れたアプリが起動する
- 「プログラムと機能」と同じ層で `UninstallString` を実行 → **exit 0、すべて消えた**

#### ついでに直したもの

- **`jsdom` が `package.json` のどこにも宣言されていなかった**（落とし穴 144）。
  別件の `npm i -D 7zip-bin` でツリーが整理され、jsdom の入れ子 `lru-cache@11` が落ちて
  root の `lru-cache@5` に解決されるようになり、
  **19 ファイルがワーカーごと起動できていなかった**
  （vitest の出力は `Test Files 1 failed | 46 passed (47)` + `Errors 19`。
  「失敗 1 件」に見える）。宣言を足して **66 ファイル / 1297 件**に戻した。
- 圧縮率のコメントに**測っていない数字**（18.4%）を書いていたのを実測値（25.0%）に直した。
  brotli との比較は**土俵が違う**（あちらは exe 1 ファイル）ことも明記した。

### 2.16 今回のセッション：リリース自動化と macOS 対応（2026-09-11）

利用者の指示:
「署名は一旦保留。出力物はインストーラーとポータブル版の2つ。
GitHubでリリースできるようにブランチを切って、自動でビルドできるようにしてください。
また、Macにも対応してください。」

ブランチ `feat/release-pipeline`。

#### 出力物を 2 つに絞った

NSIS インストーラを落とし、**Electron 製インストーラ + ポータブル**にした。
macOS は **dmg（インストーラ）+ zip（ポータブル）** を x64 / arm64 で。

**Windows と同じ Electron 製ウィザードを macOS に移植する案は採らなかった。**
署名を保留している以上、macOS では custom installer の .app 自体が
quarantine で止まり、`/Applications` への書き込みにも権限が要る。
Sequoia (15) で Control-クリック回避が廃止されたので、
利用者の手間は dmg より**増える**。dmg は「ドラッグするだけ」で、
未署名でも隔離属性を外せば動く。移植したいなら署名を先にすべき。

#### 調べて分かった実バグ（4 件。どれも自分で再現してから直した）

1. **electron-builder 26 は CI + タグ + `GITHUB_TOKEN` で勝手に publish する**
   → 両方の設定に `"publish": null`（落とし穴 151）
2. **GitHub は Release アセット名の空白をドットに置換する**
   → `artifactName` を `[0-9A-Za-z._-]` だけに（落とし穴 152）
3. **Windows ランナーの既定シェル (pwsh) に `sh` が無く、19 件落ちる**
   → `shell: bash`。うち 1 件は**誤った理由で緑になる**（落とし穴 153）
4. **版番号がソースの 5 か所に直書きされ、2 つは USB の中身に焼かれる**
   → `version-consistency.test.ts`（落とし穴 155）

#### ワークフローを 2 本に割った理由

Private なので Actions は課金枠を消費し、**macOS は 1 分 $0.062**（Linux の約 10 倍）。
毎回フルビルドすると枠を焼く。一方「タグを打って初めてパッケージの壊れに気づく」のも困る。

- `ci.yml`（push / PR）… Linux で typecheck + `e2e:raid-bond`、
  Windows でユニットテスト + `e2e:esp-mirror` + `e2e:uninstall-script` +
  **`--dir` までのカナリア**（圧縮を通さず、`files` / asar / `extraResources` の
  壊れだけを毎回見る。落とし穴 133 / 134）
- `release.yml`（タグのみ）… 版番号ゲート → Windows → macOS → Release。
  **手動実行はビルド確認だけで Release を作らない。**

#### 確かめたこと（ローカル実測）

- **CI が打つコマンドそのもの**をローカルで実行した。カナリアの中身検査
  （本体 exe / app.asar / `resources/samples/ip-only.json` /
  「asar にインストーラが入っていない」）は 4 つとも通る
- 新しい名前で 2 本とも出た:
  `AutoinstallUSBCreator-0.1.0-win-x64-Setup.exe` 196.1 MB /
  `…-portable.exe` 96.8 MB。空白なし、Setup は 1 本だけ
- **ポータブルを実際に起動した**（本文 949 文字・ボタン 20 個・
  `window.autoinstall` 生存・`listDevices()` が応答）
- `version-consistency.test.ts` は**変異させて落ちることまで確認**
  （version を 0.2.0 にすると赤くなる）

**説明できていないこと**: ポータブルが前回の 108.6 MB から 96.8 MB に縮んだ。
中身は上の 4 検査と実起動で確かめたので壊れてはいないが、
**縮んだ理由は特定していない**（nsis を外したことで `win-unpacked` の
作られ方が変わった可能性。前回の exe は消してしまい比較できない）。

---

## 3. 残っている作業

### 3.1 8 巡目の敵対的監査（判断が要る）

7 巡すべてで「前の巡の修正が別の退行を生んでいた」。
**7 巡目で分かったのは「軸を変えると同じ嘘が丸ごと残る」こと。**
6 巡目は `mode === 'lvm'` の軸を塞いだが、`series`（リリース）の軸は
手つかずで、22.04 で「全画面で入力を待つ」と出しながら実際は完全無人だった。
**今回入れた修正も同じ疑いを持って見るべき。** 特に:

- **`grub-install` のコマンドが正しいか（RAID の巡でいちばん怪しい）。**
  一次資料が保証しているのは「`grub_device` は 1 台」「ESP は RAID に置けない」までで、
  **複製の手順そのものはどの資料にも書かれていない**。こちらの組み立てである。
  疑うべき点:
  - `--no-nvram` を付けているので **NVRAM に起動項目が増えない**。
    1 台目が物理的に死んだとき、ファームウェアが 2 台目の ESP を自力で見つけられるかは
    機種依存。`EFI/BOOT/BOOTX64.EFI`（removable media path）を置いて補っているが、
    **これで足りるかは実機でしか分からない**
  - `curtin in-target -- grub-install` が失敗したときの
    **`cp -a` フォールバックは「1 台目の ESP の中身をそのまま複製する」だけ**。
    grub の埋め込み設定が 1 台目のディスクを指していたら、複製しても意味が無い可能性がある
  - ~~ESP を **`lsblk` のパーティションタイプ GUID で探し、`findmnt` で 1 台目を除外**している。
    USB インストールメディア自身の ESP を巻き込まないか~~
    **→ 巻き込んでいた（2026-09-10・VM）。この疑いはそのまま当たった**（→ 2.11）。
    起動チェーン（`/target` `/target/boot` `/target/boot/efi`）を backing するディスクに
    絞り、`npm run e2e:esp-mirror` で「USB」「別の OS が入ったディスク」を
    除外することを機械で見るようにした（**VM を回さずに数秒**）。
- **「ESP を 1 つだけマウントする」判断。**
  同じ `/boot/efi` に 2 つはマウントできないので 1 台目だけを `mount` しているが、
  その結果 **2 台目の ESP は `/etc/fstab` に載らない**。
  つまり以後の `grub-install` / カーネル更新は 1 台目にしか届かず、
  **時間が経つほど 2 台目が古くなる**。運用で埋めるのか、
  `/boot/efi2` として mount まで出すのかは**未決**。
- ~~**RAID1 の上の `/boot` を GRUB が読めるか。**~~
  **→ 読めた（2026-09-07・VM）。** `npm run e2e:vm:raid` で
  「ESP は 1 台目だけ・`/boot` は 2 台の RAID1（metadata 1.2）」の構成を作り、
  **インストールしたシステムを USB を抜いた状態で起動させた**
  （`run-vm.sh boot` は USB を挿さない）。カーネルが起動し、
  `vm-raid login:` まで出る。Ubuntu 24.04.3 の署名版 shim/grub は
  `mdraid1x` を読み込めている。
  **確かめたのは 1 台目の ESP から起動する経路だけ**で、
  「1 台目が死んだとき 2 台目から起動するか」は依然として未検証
  （この構成では ESP が 1 つしかないので late-commands も走っていない）。
- **`storage.config` を出すと、このアプリの他の機能が効かなくなっていないか。**
  `layout` 前提で書いた分岐（`reset-partition` / `partitionTable` / `match`）は
  検証で「効きません」と伝えるようにしたが、**数え上げてはいない**。
  `grep -n "storage\." packages/shared/src/autoinstall/generate.ts` で
  `mode === 'raid'` のとき通らない枝を全部拾い、
  **どれも検証が言及しているか**を突き合わせるのが次の巡の宿題（落とし穴 67 / 73）。

- **`seriesGate` の網羅。** 7 巡目で `SERIES_FEATURES` の 11 フラグを
  表にして塞いだが、**フラグが増えたときに追いつく保証は
  「網羅チェックが落ちる」ことだけ**（`validate-series.test.ts` /
  `summary-series.test.ts`）。第 3 の軸（たとえばアーキテクチャ差、
  `hweMenuEntry` のような grub 側の出し分け）が同じ形で残っていないか。
- ~~`user` ステップの要約が `null` なのは意図か漏れか~~
  **→ 漏れだった（7 巡目で決着）。** `summarizeUser()` を実装し、
  「追加ユーザー N 件」も**編集できる画面**（`user`）の要約へ移した
  （それまで `postinstall` に出ていた）。
- **`summarizeStep` の網羅は依然として型が守らない。** `switch` は
  `StepId` を網羅するのでステップを足せば気づくが、**中身**は気づかない。
  6 巡目・7 巡目の high はどちらもこれ。
- **`changedCount` の数え方。** 折りたたみの「N 件」と要約は
  別々に数えている（`countAdvancedChanges` / `countStorageDetailChanges` と
  `summarize*`）。同じことを 2 か所で数えているので、
  片方だけが設定の追加に追いつかない形（落とし穴 22 の親戚）。
  `deploymentOwnership()` のように**同じ関数から作る**のが正しい。
- **`Disclosure` の開閉と下書き。** 「閉じている間は中身を描画しない」
  ので、`useListDraft` の下書きは閉じると消える（確定した値は消えない）。
  これは実際に両方作って比べた結果の選択だが、**閉じた画面で編集を続ける
  利用者が居るかは確かめていない**。
- **世代カウンタ (`profileGeneration`)。** 増やすのは 3 か所だけ、という
  規約に頼っている。将来「プロファイルを丸ごと差し替える 4 か所目」が
  できたときに、誰も気づかない（型は守らない）。
  逆に `updateProfile` で増やすと 1 文字ごとに画面が作り直される。
- **`ReadyToReview` の導線。** `config?.ok !== true` で隠すので、
  **警告だけのときは出る**（error のときだけ隠れる）。
  「警告が出ているのに『これで十分』と言っている」と読めないか。
  出す場所がユーザーのステップの末尾 1 か所だけでよいのかも決めていない。
- 5 巡目から持ち越し: `isLocalizedText` の `deep` の使い分け /
  `formatMaybeLocalized` の `string` 退避路 /
  `interpolate` の `MAX_NEST_DEPTH = 4` / `useTx` の `Fragment` 分割
- 4 巡目から持ち越し: `useListDraft` の追従条件 /
  `planKill`・`taskkillMeansStopped`（実機で確かめたのは正常系だけ）/
  制御チャネルの認証（ワーカーが再接続する経路が将来できたら壊れる）/
  `classifyDevice` の反転（「USB なのに removable=false」の実機があると弾く）/
  `apt.fallback` の出し分け（22.04 で出さない判断は実機未確認）

**同じ領域割りで回すと同じものが出る。**
「今回の修正そのもの」を攻撃対象にした新しいスクリプトを書くほうがよい。

### 3.2 実機でしか確かめられないこと

- **GUI からのイメージ保存は、動かして確かめていない。**
  通したのは `npm run e2e:image`（`scripts/e2e-image-file.mts`）だけで、
  これは **main の関数を tsx から直接呼んでいる**。
  **Electron を起動していないので、次の 3 つは未検証**:
  1. **保存ダイアログ** (`dialog.showSaveDialog`)。既定ファイル名の生成
     (`suggestImageFileName`) と `allowedImagePaths` への登録は単体テストが見ているが、
     **実際にダイアログが開いて `.img` フィルタが効くところは見ていない**。
     ここが唯一の許可の入口（落とし穴 55）なので、動かないと機能が丸ごと使えない。
  2. **ipcMain の配線**（`chooseImagePath` / `startImageWrite` の
     `preload` → `window.autoinstall` → `store.saveAsImage()`）。
     契約は型で繋がっていて `ipc.test.ts` も緑だが、**実際の IPC を往復していない**。
  3. **画面の見え方**。`write-image-target.test.tsx` (18 件) は jsdom で
     class 名と DOM 構造までしか見ていない。Tailwind の実描画・
     赤いボタンとの取り違えにくさ・進捗表示は**目視していない**。
  やるなら `npm run dev` で GUI を開き、ISO を選んで「イメージファイル (.img) として
  保存」→ 保存先を指定 → 完了画面にフルパスが出るところまで。
  **中止 (`cancelWrite`) で書きかけの `.img` が消えることも実際に見ておくとよい**
  （消す処理は今回直したばかりで、単体テストとスクリプト経由でしか通っていない）。
- **`.img` を実際に焼いて起動させていない。** `dd` / Rufus / balenaEtcher で
  USB に焼き、そこから無人インストールが完走するかは未確認。
  読み戻し検証が見るのは「書いたものが読めるか」だけ（落とし穴 62）。

- ~~**RAID / bond の構成は、実機でも VM でもインストールを完走させていない。**~~
  **→ RAID + LVM は VM で完走させた（2026-09-07・下の 2.9）。** bond は依然未検証。
  以前ここに書いてあったのは「YAML の形と、subiquity 公式スキーマを 4 リリースとも
  通ること」まで（当時 `npm run e2e:raid-bond` 70/70）で、
  **その 70 件が通っていた構成は実際にはインストールできなかった**
  （`grub_device` の位置が違った → 2.9）。
  **「スキーマを通る」は「そのとおりに組まれる」ではない。**
  `storage` のスキーマは 4 リリースとも `{type: object}` でしかないので、
  **アクション列の中身はスキーマ検証を一切通っていない**（中身の正しさを保証するのは
  curtin であって、autoinstall のスキーマではない）。実機で見るべき順:
  1. RAID10 が 4 台で組まれ、その上に LVM の PV が乗るか
  2. **RAID1 の上の `/boot` を GRUB が読めるか**（下の 3.1 参照）
  3. 1 台目から起動し、**2 台目からも起動するか**（＝ late-commands の複製が効いたか）。
     結果は新システムの `/var/log/autoinstall-raid-esp.log` に
     `RESULT: ok` / `incomplete` / `nothing to do` の 1 行で残る
  4. bond のリンクが上がるか。**`802.3ad` はスイッチ側にも LACP の設定が要る**ので、
     スイッチが未設定だとリンクが上がらない。切り分けの起点はここ
- **RAID の構成で「VM では確かめたが、実機では確かめていない」もの。**
  `npm run e2e:vm:raid` が確かめたのは**この 4 点を縮めた形**だけである。
  - **バスが違う。** VM の `sda` / `sdb` は **virtio-blk**（ゲストからは `/dev/vda` /
    `/dev/vdb`）で、実機の **SATA** ではない。NVMe は QEMU の `nvme` デバイスなので
    `/dev/nvme0n1` として見えるが、実機の データセンター向け NVMe ではない。
  - **容量が違う。** 60G x2 + 20G x2 で、実機は 447.1GB x2 + **3.5TB x2**。
    `size: -1`（残り全部）と LVM の伸びは容量に依存する。
    **3.5TB の md を作ったときの初期同期の時間**（実機では数時間になりうる）は
    まったく見ていない。
  - **シリアルの指定が違う。** VM では `serial: "*sda*"` のように
    **glob** で引いている（QEMU が付ける ID_SERIAL が NVMe だけ
    `<model>_<serial>` に組み立てられるため）。実機では
    `SSDSERIAL0001` のような完全一致を使う。**glob と完全一致で
    subiquity の照合が同じに動くか**は VM でしか見ていない。
  - **ESP が 1 台なので `late-commands` が 1 行も出ていない。**
    利用者の構成は ESP が sda だけなので `needsRaidEspMirror` が false になり、
    **2 台目への `grub-install` は今回も実行されていない**（→ 3.1 の最初の項目）。
    「どちらが壊れても起動する」は**依然として未検証**。
- **`npm run e2e:vm:raid` は 22.04 では試していない。**
  `findIso()` が新しいリリースを優先するので 24.04.3 が選ばれる。
  22.04 で最初に走らせたときは**ディスクに 1 バイトも書かれないまま無音**だったが、
  そのときはまだシリアルにカーネルの出力が出ていなかったので
  **原因は分かっていない**（`grub_device` の問題だった可能性が高いが、
  22.04 固有の問題が別にある可能性も消えていない）。
  22.04 で RAID を組むなら、まず `VM_DISKS` を指定して
  22.04 の ISO を明示的に渡して確かめること。
- **`size: -1` を `lvm_partition` に使えるかは実機未確認。**
  autoinstall リファレンスの節タイトル "Partition/logical volume extensions" から
  読み取っただけで、**例が載っているのはパーティション側だけ**。
- **BIOS 起動（`flag: bios_grub`）に対応していない。** GPT + UEFI のみ。
  `grub-install` も `--target=x86_64-efi` 決め打ちなので **arm64 でも効かない**。
- **root のサイズが VG の容量を超えるかは検査していない**（ディスク容量を知らないため）。
  形式検査だけなので、`rootSize` に大きすぎる値を書くと**インストール中に**落ちる。

- ~~**書き込み経路の実機再検証。**~~ **→ 通した（2026-09-06）。**
  `.e2e\run-elevated.ps1 worker`（＝`npm run e2e:usb-worker`。GUI が実際に使う
  昇格ワーカー + NDJSON 経路）を実機で流し、**18/18 成功**。
  KIOXIA TransMemory 31 GB に **3.37 GB を 256.9 秒**で書き、読み戻して
  protective MBR / GRUB ブートコード / GPT / grub.cfg（menuentry 2 件を含む）/
  CIDATA の `user-data` `meta-data` をバイト単位で照合した。
  - **ログの先頭に HEAD が入るようになった**ので、以後どのコードに対する結果か分かる。
    今回のログは `47104853…(uncommitted changes: 9 files)` ——
    **作業ツリーが汚れていたことも正直に出ている**（一時ファイルの後始末を直している最中だった）。
  - **`npm run e2e:usb`（ワーカーを介さず `executeWritePlan` を直接呼ぶ経路）は
    まだ通していない。** 2 回目の昇格が自動モードの分類器にブロックされたため。
    worker 経路のほうが広い（GUI と同じ経路 + NDJSON）ので優先度は低いが、
    やるなら管理者 PowerShell から `powershell -File .e2e\run-elevated.ps1 write`。
    `.e2e\usb-write.log` の 19/19 は**この仕組みより前のログで、SHA が入っていない**。
  - デバイス列挙も実機で確認した: システムディスク（Samsung 970 EVO Plus 2TB）が
    `selectable: false` で弾かれ、理由が `LocalizedText` 経由で
    「OS が入っているシステムディスクです」と出る。USB だけが候補になる。
- **ワーカー側のデバイス再検証が「差し替えられたジョブを拒否する」こと。**
  **単体では検証済み・実機では未検証。**
  `assertDeviceIsWritable` と `DeviceRejectedError` を `@autoinstall/media` から
  export し、拒否 7 パターン（列挙に無い / `selectable: false` / 理由が取れない /
  容量違い / シリアル違い / シリアルが読めない / シリアル無し環境で表示名違い）と
  許可 2 パターンのテストを入れた（`worker/run.test.ts`）。
  さらにワーカー境界を越えても拒否理由が残ることを
  `apps/desktop/src/main/worker-boundary.test.ts` で固定してある。
  **ただしこれはすべてフェイクの `PlatformOps` に対するもの。**
  実機ログの 18 項目は依然すべて正常系で、
  「本物の USB を途中で挿し替えると止まる」ことは確かめていない
- ~~**GUI そのものを一度も動かしていない。**~~ **→ 通した（2026-09-06）。**
  `npm run build` → `npx electron out/main/index.js --remote-debugging-port=9333` で
  起こし、リポジトリのルートから `node .e2e/full-run.mjs` と
  `node .e2e/full-run2.mjs` を実行した。**書き込み以外は昇格が要らない**ので、
  この 2 本は誰でも通せる（UAC が出るのは `start-write.mjs` から先だけ）。
  - **クリーン状態から full-run 完走・full-run2 は 20/20。**
    アプリの `settings.json` と `profiles/` を消してから通し、
    折りたたみが**閉じた状態**から始まることを確かめている
    （ディスク画面の入力欄が `openDisclosure()` の前は `["CT500MX*"]` で、
    swap の `4G` が無いこと＝閉じていることが出力に残る）。
  - **階層化が意図どおり動いていることを画面で確認した**（`.e2e/33-storage.png`
    ほか）。サイドバーは 4 グループの見出しつきで、
    「ソフトウェア: 既定のまま（追加なし）」「インストール後: 既定のまま（何もしない）」
    のように**既定かどうかが一目で分かる**。
    折りたたみは「上級者向け **2 件変更**」の Badge つきで開いた状態になり、
    サイドバーも「debconf 指定・進捗の送信先を…」と中身を出す
    （＝6 巡目の high「要約が折りたたみの中身を見ていない」の修正が実機で効いている）。
  - **通したことで 1 件見つけて直した**（ユニットテストでは見つからない類）:
    `full-run2.mjs` が `/起動メニューの残り容量: (\d+) bytes/` を探していたが、
    i18n で表示が `t('runtime.grubFreeBytes')` を通るようになり日本語では
    「610 バイト」になっていた。**画面には出ているのにテストだけが落ちる**。
    文言を書き写すのをやめ、`import { ja as DICT }` で辞書から引く形にした。
    （**この形は後で `d.t('キー')` に置き換えた。** `ja` を直に引くと
    英語表示で必ず空振りする。`.e2e/README.md` に「使わない」と書いてある。）
  - ~~**この壊れ方は機械では見張っていない。**~~ **→ 7 巡目で番人を入れた。**
    当時は「ラベル用のリテラル（`console.log` や `check()` の第 1 引数）と
    区別できず誤検出が 3〜7 件出る」として見送ったが、それは
    **全部のリテラルを見ようとしたから**だった。
    **画面の文言が来る位置**（`click()` の第 2 引数 / `fillByPlaceholder()` の
    第 1 引数 / `eval()`・`until()` の第 1 引数 / 正規表現リテラル）だけに絞ると、
    当時の残骸 **7 件を誤検出 0** で拾える（実測）。
    `apps/desktop/src/main/e2e-placeholder-drift.test.ts` に入れた。
    **見張れるのは日本語の書き写しだけ**で、英語の文言を直に書いた場合は素通りする。
  - **英語表示でも通した（同日）。** `.e2e` が画面の文言を書き写していたのを
    やめ、`drive.mjs` に `d.t('キー')` と `d.setLocale('en')` を足して
    **辞書から引く**ようにした。
    `node .e2e/set-locale.mjs en` のあと
    そのまま両方を通し、**日本語 20/20・英語 20/20**。
    画面（`.e2e/40-storage-en.png`）に日本語は 1 文字も残っていない
    ——グループ見出し（`Must configure` / `Change if needed` /
    `Added by this tool` / `Finish`）も 1 行要約
    （`Static IP 192.168.1.50/24` / `Defaults (No extras)` /
    `debconf selections / Custom pr…`）も英語で出る。
    **これが「English に切り替えても日本語が残らない」の実機での確認**にあたる。
  - **ただし直したのは 4 本中 2 本だった**（`full-run.mjs` / `full-run2.mjs`）。
    `start-write.mjs` と `watch.mjs` は日本語を直書きしたままで、
    上の記述だけが「`.e2e` は辞書から引く」と読める形になっていた。
    **7 巡目で残り 2 本も `d.t()` に直した**。`watch.mjs` は行の選別と終了条件が
    日本語の正規表現 (`/完了|失敗|エラー/`) だったので、英語表示では 1 行も拾えず
    **必ず TIMEOUT になっていた**。
    **この 2 本は実行していないので未検証**
    （`start-write.mjs` は実 USB を消し、`watch.mjs` はその後段）。
    ユニットの番人（上記）と `npm run typecheck` は通してある。
  - **まだ通していないもの**: `start-write.mjs` から先（UAC が出る）。
- 実機／VM からの起動と、完全無人インストールの完走
- 起動メニューから選んだホストの値が subiquity 上で反映されるか
- 追加ユーザー・アプリ展開・サービス登録・CUDA が実機で意図どおり動くか
- macOS / Linux でのデバイス列挙と権限昇格

#### Electron 製インストーラで**確かめていないこと**（2026-09-11）

通したのは **1 台の機械（Windows 11 Home 26200 / ja-JP / NTFS）だけ**である。
「通した」と書いてあるのはその範囲だけ、という意味に読むこと。

- **英語表示**。辞書は `satisfies` でキーが揃っていることと、
  `en` に日本語が混ざっていないことを機械で見ているが、
  **画面を英語で出して目で見てはいない**（`app.getLocale()` に従うだけで
  切り替え UI が無いので、確かめるには OS の言語を変えるしかない）
- **非 ASCII のユーザー名**（`C:\Users\山田\...`）。`uninstall.ps1` は BOM 付き UTF-8 で
  書いているので Windows PowerShell 5.1 でも読めるはずだが、**未実測**
- **アプリを起動したまま上書きインストール**。
  `detectRunningInstance()` が名前で検出して止める形は書いたが、
  実際にアプリを起動したまま走らせてはいない
- **中止（キャンセル）**。`AbortSignal` → `taskkill /T /F` → rollback の経路は
  書いてあるが、**展開の途中で押して確かめてはいない**
- **署名**。未署名なので SmartScreen の「WindowsによってPCが保護されました」は出る
  （§3.3 のとおり保留中）。portable の自己展開ぶんも未署名
- **32bit / ARM64**。`win.target` は x64 だけ
- **macOS / Linux**。`dist:installer` は Windows 専用で、他は従来どおり
  `dist:mac` / `dist:linux`（dmg / AppImage / deb）

#### リリース自動化と macOS で**確かめていないこと**（2026-09-11）

**CI は 1 度も走らせていない。** ワークフローは書いたが、
GitHub のランナー上での挙動はすべて未実測である。初回は必ずログを 1 行ずつ読むこと。

- **macOS のビルドそのもの**。手元に Mac が無いので `npm run dist:mac` を
  **1 度も実行していない**。dmg / zip ができるか、`afterPack` の ad-hoc 署名が
  通るか、`lipo -archs` が期待どおり出るかは、**初回の CI が最初の実測**になる。
- **macOS で .app が起動するか。** `release.yml` に起動検査を置いたが、
  ホスト型 macOS ランナーで GUI の Electron が上がるかが未知なので
  **`continue-on-error: true` にして判定に使っていない**。
  1 度でも起動を確認できたら、**そこを判定に格上げすること**
  （そうしないと「起動を見ているつもりで何も見ていない」検査が残る。落とし穴 123）。
- **Windows ランナーで GUI の Electron が起動するか**も未検証なので、
  CI では成果物の**起動検査を入れていない**（中身の構造検査だけ）。
  ローカルでは `.e2e/installer-run.mjs` が通っているので、
  ランナーで起動できると分かればそれを CI に載せられる。
- **費用の見積もりは推測**。1 リリースあたり実時間 31〜51 分・
  課金 136〜220 分・$0.81〜1.30 と見ているが、**根拠はローカルの実測と
  ランナー仕様からの外挿**である。初回の実行後に
  使用状況レポート CSV の `quantity` で置き換えること。
- **Private リポジトリの Release は第三者が匿名で落とせない。**
  「GitHub でリリースする」目的が誰に配るかによっては成立しない。
  配布専用の Public リポジトリを別に置く案があるが、
  **Public 化は本人の明示指示が要る**ので決めていない。

### 3.3 意図して直していないもの

#### 配布パッケージの署名（2026-09-10 に保留と決めた）

**未署名のまま配る。** 証明書を設定していないので、
`apps/desktop/release/` の 3 つの exe はすべて `NotSigned`
（`Get-AuthenticodeSignature` で確認済み）。

利用者に起きること:

- Windows の **SmartScreen が「発行元不明」の警告**を出す。
  「詳細情報」→「実行」で進めるが、初回は必ず 1 手間かかる。
- **このアプリは USB を丸ごと消す**ので、警告を見た人が
  「本物か」を判断する材料が無いのは弱点である。配る範囲が広がるなら先に直す。

やるときにすること（コードは触らない。electron-builder が拾う）:

```
set CSC_LINK=<.pfx のパス>
set CSC_KEY_PASSWORD=<パスワード>
npm run dist:win
```

> **`.pfx` とパスワードをリポジトリにも `.env` にも置かない。**
> このリポジトリは「ログインパスワードを平文で永続化しない」を規約にしている。
> 署名鍵はそれより強い扱いが要る（漏れると第三者が
> このアプリの名前で任意のものに署名できる）。

> EV 証明書でないと SmartScreen の評価は最初から高くならない。
> OV でも「未署名よりまし」だが、警告が完全に消えるわけではない。

アイコンは対処済み（落とし穴 135〜137）。**残っているのは署名だけ。**

**前の版にあった 3 つの「取り消し線つきの項目」（renderer の日本語ハードコード /
`ValidationIssue` の `messageJa` / `labelJa` のペア）は、どれも完了したので
この節から消した。** 何をやったかは `CHANGELOG.md` の
「🌐 English に切り替えても日本語が残らないようにした」
「🌐 検証の指摘も辞書を通るようにした」「🌐 選択肢のラベルも辞書に移した」にある。
番人だけ場所を残しておく:

- `packages/shared/src/i18n/i18n.test.ts` … 選択肢ラベル（公開値を歩く）と
  `*Ja` / `*En` で終わる識別子の禁止
- `packages/shared/src/autoinstall/validate-i18n.test.ts` … 検証の指摘。
  **この番人が踏めていないキーは 9 個**で、理由つきの表
  (`NOT_REACHED_BY_BATTERY`) が同じファイルにある
  （入れ子の項目名 7 / GUI 側でしか作れない 1 = `validate.grubMenuTooLarge` /
  現行 4 リリースでは成立しない 1 = `validate.interactiveSectionsUnsupported`。
  表と実測が食い違ったらテストが落ちる。**例外表に足す前に踏ませる**。
  落とし穴 81）
- `packages/media/src/localized-guard.test.ts` … ソースの日本語リテラル走査と
  `ALLOWLIST`（死んだ例外の検出つき）

**いま残っているのは次の 3 つ。**

- **`packages/media/src/isopatch/index.ts` の `Patch.label` は日本語のまま。**
  画面には出ない（ジョブ JSON と `assertPatchesDisjoint()` が投げる
  `Error.message` ＝**開発者向けの診断**にだけ現れる）。
  進捗バーの下に出るのは `WriteOp.label`（`layout/plan.ts`）のほうで、
  そちらは `LocalizedText` になっている。**別の型の、別の値。**
  `localized-guard.test.ts` の `ALLOWLIST` に 1 件だけ理由つきで載せてあり、
  **その許可リストは「使われていない例外」を落とす**ので、
  ここを「訳し忘れ」と見て直すと代わりに死んだ例外が残る。直すなら両方を直すこと。

- **辞書に誰も引かないキーが 33 個ある。**（実測。数え方は下記）
  **今回の作業で増えていない。** HEAD (`565ca23`) でも同じ 33 個で、
  **キーの集合まで一致する**（辞書は 742 → 1043 キーに増えたが、
  増えた 301 個はすべて使われている）。
  つまりこれは今回の負債ではなく、前から残っているもの。
  内訳は `common.ok` / `common.optional` / `common.required` / `common.warning` /
  `common.error` / `common.no` / `common.refresh` / `iso.checksum` /
  `ssh.keyInvalid` / `storage.disableSwap` / `software.title` /
  `postinstall.title` / `postinstall.lateCommandsHint` / `review.title` /
  `review.yamlUserData` / `review.yamlAutoinstall` / `review.exportYaml` /
  `review.exportBundle` / `write.title` / `write.deviceBlocked` /
  `profile.badgeUsers` / `profile.badgeDeployments` / `profile.badgeServices` /
  `service.execStartPre` / `service.group` / `service.environmentFile` /
  `service.wantedBy` / `adv.kernelHwe` / `adv.aptFallbackAbort` /
  `adv.aptFallbackOffline` / `adv.aptFallbackContinue` / `error.deviceRemoved` /
  `error.permissionDenied`。
  **消していない理由**: `adv.aptFallback*` / `adv.kernelHwe` のように
  「いま使われている生キーと意味が重なる」ものと、
  `review.export*` / `write.deviceBlocked` のように
  「機能そのものが未実装」のものが混ざっており、
  **どちらなのかを 1 件ずつ確かめないと消せない**。
  一括で消すと、実装されていない機能の訳文だけが先に消える。
  `localized-guard.test.ts` の死んだキー検出は `packages/media` と
  `apps/desktop/src/main` しか走査しないので、この 33 個は範囲外
  （renderer と `packages/shared` が持ち主）。
  **数え方**（走査対象が空でないことも一緒に見ること。落とし穴 57）:
  `ja.ts` のキーを取り、`packages` / `apps` / `scripts` / `.e2e` の
  `.ts/.tsx/.mts/.mjs/.js` から `ja.ts` / `en.ts` とテストを除いた本文に
  `'キー'` が現れるかを見る。**`git grep` の行数をそのまま使わないこと**
  （`write.title` はテストからだけ引かれているので、テストを含めると 32 になる）。

- **`packages/media/src/isopatch/index.ts` は `git` に「バイナリ」と見られている。**
  `git diff --stat` が `Bin 9005 -> 10144 bytes` と出し、
  **中身の差分が既定では表示されない**（`git diff --text` を付ければ読める）。
  原因は ISO9660 の `.` / `..` を弾く正規表現 `/^[\x00\x01]$/` に
  **生の NUL (0x00) と 0x01 がそのまま書かれている**こと（実測で各 1 バイト）。
  **HEAD にも同じ 1 バイトがあり、今回入れたものではない。**
  動作は正しい（落とし穴 3 のとおり `.` / `..` は 1 バイト）が、
  **このファイルの変更はレビューで見えない**という実害がある。
  落とし穴 44（U+2028 / U+2029 を直に書かない）と同じ理屈で
  `\x00` / `\x01` のエスケープに直せば解消するはずだが、
  **ここは ISO を書き換える経路のファイルなので、実機未検証のまま触らない**
  ことにした。触るときは 44 と一緒に読むこと。


---

## 4. 次のセッションへの申し送り

1. **修正を入れたら、その修正自体を敵対的に検証する。**
   6 巡すべてで自分の修正が退行を生んでいる
2. **折りたたんだら、要約は折りたたみの中身も見なければならない。**
   6 巡目の high はこれだった。`summarizePostInstall()` が
   折りたたみの外だけを数えていたので、「上級者向け」に
   `interactiveAll`（**全画面で入力を待つ＝無人インストールでなくなる**）が
   立っていても、サイドバーは「既定のまま（何もしない）」と出ていた。
   **隠したものを要約が見ないなら、隠さないほうがまだましだった。**
   UI を階層化するときは、隠す操作と「隠したものを見せる仕掛け」を
   同じ変更で入れ、**設定を 1 つ足すたびに両方を直す**。
   同じ形が 4 つ出ている（要約が中身を見ない / 無効化しても値が残る 2 件 /
   プロファイルを開き直しても折りたたみが開かない）ので、
   **「隠す」を足したら、その周りを 4 方向から疑うこと。**
3. **契約を広げたら、受け取り側の検査を grep で全部数えてから直す。**
   5 巡目の実害はこれだった。`MsgParams` に `LocalizedText` の入れ子を
   許したのに、**ワーカー境界に置いた判定の写しが古いまま**
   （`params` を `string | number` に限っていた）で、
   理由つきの拒否が境界で捨てられ、画面には
   「予期しないエラーが発生しました」だけが出ていた。
   契約を広げる変更は、必ず「その形を検査しているところ」を
   grep で列挙してから始める。判定は**写しを作らず 1 か所に集約する**
   （落とし穴 73 の、型ではなく**検査**に対する版）
4. **テストが通ることは正しさの証明ではない。**
   4 巡目では、脆弱な形を「正」として固定していたテストが 9 件、
   実質何も見ていない検証が 8 件見つかった。
   修正を入れたら、**変異させて落ちること**まで確かめる。
   走査系のテストは「走査対象が空でないこと」も一緒に検査する
   （5 巡目でも、実在しない語で変異を確かめたつもりになった検査が 1 件あった）
5. **数を書く前に数える。** この資料の「ユニットテスト 525」は
   実測すると 687 だった。「renderer の日本語ハードコードが残っている」は
   完了済みの作業だった。**書いたら実装と突き合わせる**（落とし穴 71 / 72）。
   6 巡目でも、この資料が載せていた「804 / 41 ファイル」は
   セッション途中の数字で、書き終えた時点の実測は **873 / 49 ファイル**だった。
   **セッションの途中で測った数は、そのセッションの結論にはならない。**
   数を書くときは、その数がどのコードに対するものかも一緒に書くこと
   （`git rev-parse HEAD` と `git status --porcelain | wc -l`）
6. **一次資料はリポジトリ内にある。** `docs/research/`。
   4 巡目は「4 リリースとも `set default=` が無い」「`fallback` の既定が
   リファレンス内で食い違っている」を一次資料で確かめてから直した
7. **`npm run test:unit` は Git Bash から実行する。**
   PowerShell だと `sh` が PATH に無く 19 件が ENOENT で落ちる
8. **`npm run e2e:usb-worker` は人の操作が要る。** UAC はプログラムから
   承認できない。`.e2e\run-elevated.ps1 worker` を実行してもらう
9. **「生成の検証が緑」は「インストールできる」ではない。**
   RAID の巡は `e2e-raid-bond` 70/70 と subiquity 公式スキーマ 4 リリースを
   通していたのに、**その構成は 1 台もインストールできなかった**
   （`grub_device` の位置。落とし穴 98 / 103）。
   **一次資料（curtin のドキュメント）に無いことは、実際に食う側
   （subiquity のソース）を読むか、VM で走らせるしかない。**
   `npm run e2e:vm` / `npm run e2e:vm:raid` は実 USB も昇格も要らないので、
   `storage.config` を触ったら必ず通すこと。
10. **検証の道具のバグを、実装のバグと取り違えない。**
   今回の最初の緑でない結果は、27 件中 3 件の FAIL が**すべて検査側**の誤りだった
   （md の名前の照合先 / swap の行 / テンプレートリテラルの `\s`）。
   しかも 3 件目は**元から測れていなかった**
   ——「ログインプロンプトがホスト名つきで出た」は前の巡でも一度も測れていない
   （`RegExp` に渡す文字列で `\\s` にしていなかった。落とし穴 106）。
   **緑だったものが本当に何かを測っていたかを、たまに疑うこと。**

5 巡目の教訓は `CLAUDE.md` の落とし穴 **74〜78**
（契約を広げたときの検査の写し / 境界を通さないテスト /
壊れた値を実在キーで試す / 文言を総称に潰さない /
番人が見ていない範囲を明記する）。
6 巡目は **79〜81**（未コミットの木で `git checkout` を使わない /
報告された不具合は直す前に再現する /
番人が「踏んでいない」と言ったら例外表に足す前に踏ませる）。
**この節と落とし穴節は同じことを別の粒度で書いている。**
直すときは両方を見ること。
