# 引き継ぎ記録 (2026-09-05)

直近 3 セッションで行った作業と、次のセッションが引き継ぐべきことをまとめる
（**新しいほうは 2.6**）。
落とし穴そのものは `CLAUDE.md` の「落とし穴」節に入れてあるので、
ここには**状態**と**残っていること**だけを書く。
（項目数は変わるので断定しない。数えるなら `grep -cE '^[0-9]+\. \*\*' CLAUDE.md`。
2026-09-05 時点で **81**。6 巡目で 79〜81 が増えた。）

---

## 1. 現在の状態

### 検証結果

上 4 行は**このセッションで実際に実行して数えた**。
下 2 行は**過去のログの数字で、現行コードに対するものではない**（→ 3.2）。

| 検証 | コマンド | 結果 | いつ測ったか |
|---|---|---|---|
| 型検査 | `npm run typecheck` | 通過（**5 つ**の tsconfig） | 今回（作業ツリー） |
| ユニットテスト | `npm run test:unit` | **873 / 873**（49 ファイル） | 今回（作業ツリー） |
| スモーク（実 ISO → `.img`） | `npm run smoke` | **98 / 98** | 今回（作業ツリー） |
| E2E マトリクス（実 ISO × 設定 10 パターン） | `npm run e2e` | **402 / 402** | 今回（作業ツリー） |
| 実 USB への書き込み | `npm run e2e:usb`（管理者権限） | 19/19 | **過去のログ。SHA 不明** |
| 昇格ワーカー経路（実 USB） | `npm run e2e:usb-worker`（管理者権限） | 18/18 | **過去のログ。SHA 不明** |

- **型検査は 4 つから 5 つに増えた。** `scripts/tsconfig.json` を足したため
  （`scripts/` は長らく対象外で、`ValidationIssue` から消えた `messageJa` を
  4 本が読み続けていた）。`CLAUDE.md` の開発コマンド表も直してある。
- ユニットは **HEAD の 32 ファイルから +17 ファイル**（`find` で実測）。
  49 ファイル / 873 件。増えた分は画面の階層化（`Disclosure` / `summarizeStep` /
  `STEP_GROUPS` / `ReadyToReview`）と、`validate.ts` の i18n の番人。
  **件数の前後比較には注意**: 前の引き継ぎに載っている 687 は前セッションの記録で、
  **HEAD で走らせ直してはいない**（HEAD のテストファイル数 32 とは一致する）。
  このセッションの途中で記録された「804 / 41 ファイル」も途中経過であって、
  HEAD の値ではない。
- **スモークと E2E の件数は変わっていない**
  （書き込みのバイト列・順序・条件に触っていないので、増えないのが正しい）。
  `git diff --stat HEAD -- packages/media/src/writer packages/media/src/layout
  packages/media/src/grub apps/desktop/src/main/write-supervisor.ts` が空であることも
  確認した。
- **`npm run test:unit` は Git Bash から実行する。** PowerShell だと `sh` が
  PATH に無く 19 件が ENOENT で落ちる（テストの失敗ではない）。
- 作業ツリーは**全部が未コミット**（`git rev-parse HEAD` = `565ca23`、
  `git status --porcelain` が **63 件**＝変更 43 / 新規 20）。
  上の 4 行はその未コミットの木に対する結果。

---

## 2. セッションの記録

**2.1〜2.4 は前々セッション、2.5 が前セッション、2.6 が今回。**
新しい順に読みたければ 2.6 から。

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
run ID  : wf_f344b0ea-275
結果 JSON: C:\Users\user\AppData\Local\Temp\claude\c--dev-autoinstall-ui\
           fc99da65-c423-4374-931f-e16fde7ad614\tasks\wm01o7nlq.output
journal : C:\Users\user\.claude\projects\c--dev-autoinstall-ui\
           265087e8-6f15-4284-9dc5-d04858b0c178\subagents\workflows\wf_f344b0ea-275\journal.jsonl
スクリプト: C:\Users\user\.claude\projects\C--dev-autoinstall-ui\
           265087e8-6f15-4284-9dc5-d04858b0c178\workflows\scripts\audit-round4-wf_f344b0ea-275.js
```

5 巡目:

```
run ID   : wf_9dc57c25-409
journal  : C:\Users\user\.claude\projects\c--dev-autoinstall-ui\
           8ef72743-47d2-4cdb-a320-0daf0fed1f11\subagents\workflows\wf_9dc57c25-409\journal.jsonl
スクリプト: C:\Users\user\.claude\projects\C--dev-autoinstall-ui\
           8ef72743-47d2-4cdb-a320-0daf0fed1f11\workflows\scripts\
           guard-and-audit-round5-wf_9dc57c25-409.js
修正側     : 同ディレクトリの fix-round5-findings-wf_821c84cc-258.js
           （run ID `wf_821c84cc-258`）
```

（2026-09-05 時点で上記はすべて実在を確認した。ただしどれも
`.claude` 配下なので、リポジトリを別のマシンへ移すと付いてこない。）

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

（5 巡目は 6 レンズ × 3 視点反証。対象は「文言の i18n」そのもの。→ 2.5）

6 巡目（今回）:

```
run ID   : wf_d24aabeb-1ac
journal  : C:\Users\user\.claude\projects\c--dev-autoinstall-ui\
           8ef72743-47d2-4cdb-a320-0daf0fed1f11\subagents\workflows\wf_d24aabeb-1ac\journal.jsonl
スクリプト: C:\Users\user\.claude\projects\C--dev-autoinstall-ui\
           8ef72743-47d2-4cdb-a320-0daf0fed1f11\workflows\scripts\
           audit-round6-wf_d24aabeb-1ac.js
修正側     : 同ディレクトリの fix-round6-wf_6aa98323-d61.js（run ID `wf_6aa98323-d61`）
階層化側   : 同ディレクトリの hierarchy-and-remaining-work-wf_c472cec9-a4f.js
```

（6 巡目も 6 レンズ × 3 視点反証。対象は「今回入れた階層化と i18n の統一」
そのもの。→ 2.6。上の 3 つのパスも 2026-09-05 に実在を確認した。
`.claude` 配下なので、リポジトリを別のマシンへ移すと付いてこない。）
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

---

## 3. 残っている作業

### 3.1 7 巡目の敵対的監査（判断が要る）

6 巡すべてで「前の巡の修正が別の退行を生んでいた」。
**今回入れた修正も同じ疑いを持って見るべき。** 特に:

- **`summarizeStep` の網羅。** `switch` は `StepId` を網羅しているので
  ステップを足せば型で気づくが、**中身の網羅は型が守っていない**。
  6 巡目の high はまさにこれ（`postinstall` の折りたたみを見ていなかった）。
  設定を 1 つ足したときに要約が追いつかない形は残っている。
  **すでに 1 つ分かっている**: `user` ステップは `<Disclosure>`
  （管理ユーザーの追加グループ）を持つのに、`summarizeStep('user')` は
  `null` を返す。つまりそのステップだけ「折りたたんでも中身が分かる」
  仕掛けが効いていない。**意図的なのか漏れなのかを決めていない。**
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

- **書き込み経路の実機再検証（新しく増えた）。**
  実機ログ（`e2e:usb` = 19/19、`e2e:usb-worker` = 18/18）を取ったあとに、
  4 巡目の監査で `writer/execute.ts` / `layout/plan.ts` / `grub/patch.ts` /
  `write-supervisor.ts` を変更している。**現行コードでは実機を通していない。**
  **今回の i18n でこの 4 つはさらに変わった**（`WriteOp.label` と
  `LayoutError` に `LocalizedText` が乗り、`DeviceWriteStalledError` が増え、
  `write-supervisor` の `error` 分岐から `as WriteStatus` を外した）。
  書き込むバイト列・順序・条件は変えていないつもりだが、
  **それを実機で確かめてはいない。**
  `.e2e\run-elevated.ps1 worker` を一度流し直すのが望ましい。
  **以後の乖離は見えるようにした**（この乖離そのものは残っている）:
  `e2e:usb` と `e2e:usb-worker` の両方が、実行開始時に HEAD と作業ツリーの
  汚れをログの先頭へ出す（`scripts/lib/git-revision.mts` の
  `printRevisionBanner`）。汚れていれば `(uncommitted changes: N files)` と付き、
  git が使えなければ `unknown` と出して続行する。
  出すのはスクリプト側の 1 か所だけで、`run-elevated.ps1` はそれをログへ流すだけ。
  **既存の 2 つのログ（`.e2e\usb-write.log` / `.e2e\usb-worker.log`）は
  この仕組みより前に取ったものなので、SHA が入っていない。**
  どのコードに対する 19/19・18/18 なのかは、いま見ても分からない
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
- **GUI そのものを一度も動かしていない（今回さらに大きく変わった）。**
  サイドバーは 4 グループ + 1 行要約になり、5 つのステップ
  （ネットワーク / ディスク / ソフトウェア / ユーザー / インストール後）の中身が
  `<Disclosure>` の中に入り、`postinstall` の「上級者向け」は**タブから外れて**
  折りたたみになり、`runtime` の位置が後ろへ動いた。
  `.e2e/full-run.mjs` / `full-run2.mjs` は**折りたたみ対応に直した**
  （`d.openDisclosure()` を足し、実在しない placeholder も直した）が、
  **Electron を起動して CDP で通してはいない。**
  直したのは「探す文字列が renderer に実在するか」までで、
  番人 (`e2e-placeholder-drift.test.ts`) が見るのもそこまで。
  **その画面へ到達できるか・折りたたみが実際に開くかは、動かさないと分からない。**
  ユニットテスト側では `disclosure-e2e-marker.test.tsx` が
  `data-disclosure` から開けることを jsdom で固定してあるが、
  jsdom は本物のブラウザではない。
- 実機／VM からの起動と、完全無人インストールの完走
- 起動メニューから選んだホストの値が subiquity 上で反映されるか
- 追加ユーザー・アプリ展開・サービス登録・CUDA が実機で意図どおり動くか
- macOS / Linux でのデバイス列挙と権限昇格

### 3.3 意図して直していないもの

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

5 巡目の教訓は `CLAUDE.md` の落とし穴 **74〜78**
（契約を広げたときの検査の写し / 境界を通さないテスト /
壊れた値を実在キーで試す / 文言を総称に潰さない /
番人が見ていない範囲を明記する）。
6 巡目は **79〜81**（未コミットの木で `git checkout` を使わない /
報告された不具合は直す前に再現する /
番人が「踏んでいない」と言ったら例外表に足す前に踏ませる）。
**この節と落とし穴節は同じことを別の粒度で書いている。**
直すときは両方を見ること。
