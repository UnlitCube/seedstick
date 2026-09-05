// 日本語が原文。ここに追加したキーは en.ts にも必ず追加する（型で強制される）。
export const ja = {
  // --- 共通 ---
  'app.name': 'Autoinstall USB Creator',
  'app.tagline': 'Ubuntu Server の自動インストール USB を作る',
  'common.next': '次へ',
  'common.back': '戻る',
  'common.cancel': 'キャンセル',
  'common.close': '閉じる',
  'common.save': '保存',
  'common.ok': 'OK',
  'common.optional': '任意',
  'common.required': '必須',
  'common.add': '追加',
  'common.delete': '削除',
  'common.advanced': '上級者向け',
  'common.recommended': '推奨',
  'common.warning': '注意',
  'common.error': 'エラー',
  'common.yes': 'はい',
  'common.no': 'いいえ',
  'common.loading': '読み込み中…',
  'common.refresh': '再読み込み',
  'common.copy': 'コピー',
  'common.copied': 'コピーしました',
  'common.show': '表示',
  'common.hide': '隠す',
  'common.edit': '編集',

  // --- 書式 ---
  'format.etaMinutesSeconds': '約 {minutes} 分 {seconds} 秒',
  'format.etaSeconds': '約 {seconds} 秒',

  // --- ステップ ---
  'step.iso': 'ISO を選ぶ',
  'step.basics': '基本設定',
  'step.user': 'ユーザー',
  'step.network': 'ネットワーク',
  'step.storage': 'ディスク',
  'step.runtime': '実行時に決める',
  'step.software': 'ソフトウェア',
  'step.postinstall': 'インストール後',
  'step.review': '確認',
  'step.write': '書き込み',

  // --- ISO ---
  'iso.title': 'Ubuntu Server の ISO ファイルを選んでください',
  'iso.description':
    'Ubuntu 公式サイトからダウンロードした live-server の ISO ファイルを指定します。このツールは ISO を配布しません。',
  'iso.choose': 'ISO ファイルを選ぶ',
  'iso.dropHint': 'ここに ISO ファイルをドラッグしても選べます',
  'iso.download': '公式サイトからダウンロード',
  'iso.detected': '認識しました',
  'iso.version': 'バージョン',
  'iso.arch': 'アーキテクチャ',
  'iso.size': 'ファイルサイズ',
  'iso.checksum': 'チェックサム (SHA-256)',
  'iso.checksumVerify': '公式のチェックサムと照合する',
  'iso.checksumOk': '公式のチェックサムと一致しました',
  'iso.checksumMismatch': 'チェックサムが一致しません。ダウンロードが壊れている可能性があります。',
  'iso.checksumOffline': 'チェックサムを取得できませんでした（オフラインの可能性があります）',
  'iso.unsupported': 'この ISO には対応していません',
  'iso.notServer':
    'Ubuntu Server の live-server 版ではないようです（ボリューム名: {volumeId}）。Desktop 版や他のフレーバーには対応していません。',
  'iso.unknownSeries': '対応していないバージョンです（{version}）。',
  'iso.rejectNotAFile': 'ファイルではありません。',
  'iso.rejectNotUbuntu': 'Ubuntu の ISO ではないようです（ボリューム名: {volumeId}）。',
  'iso.rejectNotFound': 'ファイルが見つかりません。',
  'iso.rejectPermission': 'ファイルを読む権限がありません。',
  // ISO の構造を理由に拒否したときの本文。`IsoValidationError` の reason ごとに 1 つ。
  // 総称のタイトル（iso.unsupported）と同じ文字列にならないようにするため、必ず具体的に書く。
  'iso.rejectNotIso9660':
    'ISO9660 として読めませんでした。ファイルが途中で切れているか壊れているか、そもそも ISO イメージではない可能性があります。',
  'iso.rejectNoCasper':
    'この ISO には casper ディレクトリがありません。Ubuntu の live-server ISO ではない可能性があります。',
  'iso.rejectNoGrubCfg':
    'この ISO には /boot/grub/grub.cfg がありません。起動メニューを書き換えられないため、対応していない形式です。',
  'iso.rejectNoKernelLine':
    'grub.cfg に /casper のカーネル行が見つかりません。autoinstall のカーネル引数を追加できないため、ISO の構造が想定と異なります。',
  'iso.rejectGrubTooLarge':
    '改変後の grub.cfg が 1 セクタに収まりません。カーネル引数を減らしてください。実際のバイト数は下の詳細に出ています。',
  'iso.eol': 'このバージョンはサポートが終了しています',
  'iso.eolBody':
    'セキュリティ更新が提供されないため、インターネットに接続するサーバーには使わないでください。LTS 版の利用を強く推奨します。',
  'iso.eolSoon': 'このバージョンはまもなくサポートが終了します',
  'iso.supportUntil': 'サポート期限',
  'iso.approxSize': '約 {size}',
  'iso.build': 'ビルド',
  'iso.checksumComputing': 'チェックサムを計算しています… {done} / {total}',
  'iso.checksumMismatchAdvice':
    'この ISO は使わないでください。もう一度ダウンロードし直すことを強く推奨します。',
  'iso.checksumRun': '確認する',
  'iso.checksumUnknownAdvice':
    '公式の一覧を取得できませんでした。ハッシュ値は Ubuntu 公式サイトの SHA256SUMS と手動で見比べてください。',
  'iso.checksumVerifyHint':
    'ダウンロードが壊れていないか、公式のチェックサムと照合します（数分かかります）',
  'iso.chooseAgain': '選び直す',
  'iso.codename': 'コードネーム',
  'iso.eolBadge': 'サポート終了',
  'iso.eolDetail': 'Ubuntu {series} ({codename}) の標準サポートは {eol} に終了しました。',
  'iso.eolSoonDetail':
    'Ubuntu {series} の標準サポートは {eol} に終了します（残り約 {months} か月）。',
  'iso.grubExplain':
    'ISO の中の {path} だけを書き換え、カーネル引数に {arg} を追加します。これが無いと「Continue with autoinstall? (yes|no)」で止まってしまうため必須です。ISO ファイル自体は変更しません。',
  'iso.grubHide': '起動メニューの変更内容を隠す',
  'iso.grubShow': '起動メニューにどんな変更を加えるか見る',
  'iso.minimumDevice': '必要な USB 容量',
  'iso.minimumDeviceValue': '{size} 以上',
  'iso.noIsoDescription':
    'このツールは ISO を同梱しません。Ubuntu の公式サイトからダウンロードしてください。',
  'iso.noIsoTitle': 'ISO を持っていない場合',
  'iso.supportedEditionsOnly':
    '対応しているのは Ubuntu Server の {edition} 版 ISO です。Desktop 版や他のフレーバー、他のディストリビューションには対応していません。',

  // --- 基本設定 ---
  'basics.title': '言語とキーボードを設定します',
  'basics.locale': 'システムの言語',
  'basics.keyboard': 'キーボード配列',
  'basics.timezone': 'タイムゾーン',
  'basics.hostname': 'ホスト名',
  'basics.hostnameHint': 'ネットワーク上でこのサーバーを識別する名前です（例: web-01）',
  'basics.hostnameInvalid': '英数字とハイフンのみ、先頭と末尾は英数字にしてください',

  // --- ユーザー ---
  'user.title': '最初のユーザーを作ります',
  'user.description': 'このユーザーが管理者 (sudo が使える) になります。',
  'user.realname': '氏名',
  'user.username': 'ユーザー名',
  'user.usernameHint': '小文字の英字で始め、英数字とハイフンが使えます',
  'user.password': 'パスワード',
  'user.passwordConfirm': 'パスワード（確認）',
  'user.passwordMismatch': 'パスワードが一致しません',
  'user.passwordStored': 'パスワードはハッシュ化して保存され、平文は残りません',
  'user.passwordStrength': 'パスワードの強度',
  'user.strengthWeak': '弱い',
  'user.strengthFair': 'ふつう',
  'user.strengthStrong': '強い',
  'user.sudoNoPassword': 'sudo をパスワード無しで使えるようにする',
  'user.generate': 'ランダムなパスワードを生成',
  'user.groupsModeAppend': '既定に加えて追加する',
  'user.groupsModeDefault': 'インストーラの既定のまま (sudo, adm など)',
  'user.groupsModeOverride': '指定したグループだけにする',
  'user.groupsOverrideWarning':
    'sudo を外すと管理者権限が無くなり、インストール後に設定を変えられなくなります。',
  'user.identityGroupsHint':
    'docker や libvirt など、追加で入れたいグループをスペース区切りで書きます。',
  'user.sudoNoPasswordHint':
    '自動化には便利ですが、このユーザーのログインを奪われると即座に root 権限を取られます。',
  'user.usernameInvalid': '使えない文字が含まれています',

  // --- SSH ---
  'ssh.title': 'SSH の設定',
  'ssh.installServer': 'SSH サーバーをインストールする',
  'ssh.installServerHint': 'ネットワーク越しにこのサーバーへログインできるようになります',
  'ssh.allowPassword': 'パスワードでの SSH ログインを許可する',
  'ssh.authorizedKeys': 'SSH 公開鍵',
  'ssh.authorizedKeysHint': '1 行に 1 つ貼り付けてください（ssh-ed25519 AAAA... の形式）',
  'ssh.keyInvalid': '公開鍵の形式が正しくありません',
  'ssh.importFile': 'ファイルから読み込む',
  'ssh.allowPasswordHint':
    'オフにすると公開鍵でしかログインできません。必ず先に公開鍵を登録してください。',
  'ssh.keyCount': '{n} 個の鍵',
  'ssh.keysInvalid': '形式が正しくない鍵があります',
  'ssh.lockedOutBody':
    'SSH のパスワードログインを禁止しているのに公開鍵が登録されていません。公開鍵を追加するか、パスワードログインを許可してください。',
  'ssh.lockedOutTitle': 'このままではログインできなくなります',

  // --- ネットワーク ---
  'network.title': 'ネットワークの設定',
  'network.modeDefault': '自動 (DHCP) にまかせる',
  'network.modeDefaultHint':
    'インストーラが有線 LAN を自動で設定します。ほとんどの場合はこれで問題ありません。',
  'network.modeDhcp': 'DHCP を明示的に指定する',
  'network.modeStatic': '固定 IP アドレスを使う',
  'network.modeRaw': 'netplan の YAML を直接書く',
  'network.interface': '対象のネットワークカード',
  'network.interfaceAny': 'すべての有線 LAN',
  'network.interfaceByName': '名前で指定',
  'network.interfaceByMac': 'MAC アドレスで指定',
  'network.address': 'IP アドレス / サブネット',
  'network.addressHint': '例: 192.168.1.10/24',
  'network.gateway': 'デフォルトゲートウェイ',
  'network.nameservers': 'DNS サーバー',
  'network.searchDomains': '検索ドメイン',
  'network.optional': 'このネットワークカードが未接続でも起動を待たない',
  'network.optionalHint': '未接続だと起動が 2 分ほど待たされるのを防ぎます',
  'network.installerDefaultBody':
    'インストーラが {ethGlob} と {enGlob} に一致するすべての有線 NIC で DHCPv4 を試し、アドレスを取得できなかった NIC は自動的に無効化します。手で設定を書くより確実です。',
  'network.interfaceName': 'ネットワークカードの名前',
  'network.interfaceNameHint': '例: enp0s3, eno1, ens18。事前に確認しておく必要があります。',
  'network.macAddress': 'MAC アドレス',
  'network.macAddressHint': '例: 52:54:00:12:34:56。機器を入れ替えても確実に一致します。',
  'network.modeDhcpHint': '特定のネットワークカードだけを DHCP にしたい場合に選びます。',
  'network.modeRawHint': 'bond / VLAN / 複数 NIC など、複雑な構成を自分で書く場合に選びます。',
  'network.modeStaticHint': 'サーバー用途で IP アドレスを固定したい場合に選びます。',
  'network.nameserversHint': 'カンマ区切りで複数指定できます',
  'network.netplanReference': 'netplan のリファレンス',
  'network.rawDescription':
    'autoinstall の network キーにそのまま入ります。netplan v2 の形式です。',
  'network.rawExample': '例: bond、VLAN、複数 NIC の静的設定など。{link}',
  'network.rawTitle': 'netplan の設定を直接書く',
  'network.searchDomainsHint': '社内ドメインなど（任意）',
  'network.staticCloudInitNote':
    '固定 IP を設定した物理サーバーでは、「インストール後は cloud-init にネットワークを触らせない」（インストール後の設定）も合わせて有効にすることをおすすめします。再起動のたびに設定が書き戻されるのを防げます。',
  'network.staticTitle': '固定 IP の設定',

  // --- ストレージ ---
  'storage.title': 'ディスクの使い方',
  'storage.warning': '選んだディスクの中身はすべて消去されます。',
  'storage.layoutLvm': 'LVM（推奨・あとから容量を変えやすい）',
  'storage.layoutDirect': 'シンプル（LVM なし）',
  'storage.layoutZfs': 'ZFS',
  'storage.layoutRaw': 'curtin の設定を直接書く',
  'storage.match': 'どのディスクにインストールするか',
  'storage.matchLargest': 'いちばん大きいディスク',
  'storage.matchSmallest': 'いちばん小さいディスク',
  'storage.matchSsd': 'SSD',
  'storage.matchAny': '任意の 1 台（ディスクが 1 台だけの場合）',
  'storage.matchPath': 'デバイスのパスで指定',
  'storage.matchSerial': 'シリアル番号で指定',
  'storage.matchModel': 'モデル名で指定',
  'storage.matchHint':
    'ディスクが複数ある機器では、シリアル番号やパスで指定する方が安全です。',
  'storage.wholeDisk': 'ディスク全体をルートに割り当てる',
  'storage.wholeDiskHint':
    '既定ではスナップショット用に空きを残します。全部使いたい場合はオンにしてください。',
  'storage.encrypt': 'ディスク全体を暗号化する (LUKS)',
  'storage.encryptPassphrase': '暗号化のパスフレーズ',
  'storage.encryptWarning':
    'パスフレーズは設定ファイルに平文で書かれます。USB の取り扱いに注意してください。起動のたびに入力が必要です。',
  'storage.disableSwap': 'swap を作らない',
  'storage.partitionTable': 'パーティション形式',
  'storage.ptableDefault': '自動 (GPT)',
  'storage.ptableMsdos': 'MBR（古い BIOS 機向け）',
  'storage.detailsTitle': '詳細',
  'storage.encryptHint':
    '盗難時にデータを守れますが、起動のたびにパスフレーズの入力が必要になります。',
  'storage.layoutDirectHint': 'パーティションを直接切ります。構成が単純で分かりやすくなります。',
  'storage.layoutLvmHint':
    'あとから容量を増やしたりスナップショットを取ったりできます。Ubuntu の既定もこれです。',
  'storage.layoutRawHint': 'RAID や複雑なパーティション構成を自分で書く場合に選びます。',
  'storage.layoutZfsHint':
    'ZFS ルートを使います。スナップショットやデータ整合性チェックが強力です。',
  'storage.modelHint': '例: Samsung SSD*。ワイルドカードが使えます。',
  'storage.modelLabel': 'モデル名',
  'storage.pathHint': '例: /dev/nvme0n1、/dev/sda。ワイルドカード (*) が使えます。',
  'storage.pathLabel': 'デバイスのパス',
  'storage.ptableGpt': 'GPT（明示）',
  'storage.rawHint':
    'autoinstall の storage キーにそのまま入ります。誤るとインストールが途中で失敗します。',
  'storage.rawTemplateComment': 'curtin の storage config をそのまま書きます (UEFI + LVM の例)',
  'storage.rawTitle': 'curtin の storage config',
  'storage.serialHint':
    '例: CT500MX* のようにワイルドカードが使えます。複数ディスク機で最も確実な指定方法です。',
  'storage.serialLabel': 'シリアル番号',
  'storage.usbExcluded':
    'インストール USB 自身がこの条件で選ばれることはありません（インストーラが除外します）。',
  'storage.warningBody':
    'インストール先として選ばれたディスクは、既存のパーティションごと完全に消去されます。本番機で使う前に、必ず仮想マシンで一度試してください。',

  // --- ソフトウェア ---
  'software.title': 'インストールするソフトウェア',
  'software.source': 'インストールの範囲',
  'software.sourceFull': '標準 (ubuntu-server)',
  'software.sourceMinimal': '最小構成 (ubuntu-server-minimal)',
  'software.packages': '追加パッケージ',
  'software.packagesHint': 'インターネット接続が必要です',
  'software.customPackages': 'その他のパッケージ（スペース区切り）',
  'software.snaps': 'snap パッケージ',
  'software.updates': 'インストール時の更新',
  'software.updatesSecurity': 'セキュリティ更新のみ',
  'software.updatesAll': 'すべての更新',
  'software.drivers': 'サードパーティのドライバを自動で入れる',
  'software.kernelCrashDumps': 'カーネルクラッシュダンプ (kdump)',
  'software.ubuntuPro': 'Ubuntu Pro のトークン',
  'software.aptMirror': 'パッケージの取得元',
  'software.aptMirrorDefault': '既定',
  'software.aptMirrorCountry': '国別の最寄りミラーを自動選択',
  'software.aptMirrorCustom': 'URL を指定',
  'software.aptProxy': 'APT プロキシ',
  'software.aptDebLineKeyNote':
    'deb 行を直接書いた場合、署名鍵は自分で用意する必要があります（`signed-by=` を指定するか、上級者向けタブの生 YAML で {sources} に鍵を書きます）。',
  'software.aptMirrorCountryHint':
    'インストーラが接続元の国から最寄りのミラーを選びます。ダウンロードが速くなります。',
  'software.aptMirrorCustomHint': '社内ミラーなどを指定します。',
  'software.aptMirrorDefaultHint': 'archive.ubuntu.com を使います。',
  'software.aptMirrorUrl': 'ミラーの URL',
  'software.aptProxyHint': '社内プロキシ経由でパッケージを取得する場合（任意）',
  'software.crashDumpsDefault': 'インストーラの既定にまかせる',
  'software.crashDumpsOff': '無効にする',
  'software.crashDumpsOn': '有効にする',
  'software.customPackagesHint': 'apt でインストールできるパッケージ名をスペース区切りで書きます',
  'software.driversHint':
    'NVIDIA など、サードパーティのドライバを自動で検出してインストールします。',
  'software.snapsLabel': 'snap 名（1 行に 1 つ。channel を指定する場合は `名前 channel`）',
  'software.sourceFullHint': '通常のサーバー構成。よく使うツールが最初から入っています。',
  'software.sourceMinimalHint':
    'パッケージ数を最小限にします。コンテナホストなど用途が決まっている場合に。',
  'software.ubuntuProKeyNote':
    'Ubuntu {series} では {advantage} キーとして出力されます（{pro} は 24.04 以降）。',
  'software.ubuntuProTokenHint':
    'C で始まる 24〜30 文字。設定すると ESM などのサービスが有効になります（任意）。',
  'software.ubuntuProTokenLabel': 'トークン',
  'software.updatesDriversTitle': '更新とドライバ',

  // --- インストール後 ---
  'postinstall.title': 'インストール後にすること',
  'postinstall.presets': 'よく使う設定',
  'postinstall.lateCommands': '追加のコマンド（インストール直後に実行）',
  'postinstall.lateCommandsHint':
    '新しいシステムの中で実行するには先頭に curtin in-target -- を付けてください',
  'postinstall.firstBoot': '初回起動時に実行するコマンド',
  'postinstall.files': 'USB に同梱してコピーするファイル',
  'postinstall.addFile': 'ファイルを追加',
  'postinstall.fileName': 'ファイル名',
  'postinstall.fileTarget': 'コピー先の絶対パス',
  'postinstall.fileMode': 'パーミッション',
  'postinstall.fileOwner': '所有者',
  'postinstall.fileContent': '内容',
  'postinstall.adKeyMissing':
    'Ubuntu {series} の autoinstall には {key} キーがありません。出力からは省かれます。',
  'postinstall.edit': '編集',
  'postinstall.editFile': 'ファイルを編集',
  'postinstall.extraKernelArgs': '追加のカーネル引数',
  'postinstall.extraKernelArgsHint':
    'GRUB のカーネル行に追加されます。autoinstall は自動で付くので不要です。; & | は使えません。',
  'postinstall.fileChars': '{n} 文字',
  'postinstall.fileModeHint': '例 0644',
  'postinstall.fileNameHint': 'USB 上での名前',
  'postinstall.fileOwnerHint': '例 root',
  'postinstall.fileTargetHint': 'インストール先での絶対パス',
  'postinstall.filesEmpty': 'まだファイルはありません。',
  'postinstall.filesHint':
    '小さな設定ファイルをここに直接書けます。大きなファイルやアーカイブは「アプリの展開」を使ってください。',
  'postinstall.firstBootDesc':
    'インストール後の初回起動時に cloud-init が実行します。ネットワークが上がった後に走るので、外部との通信が必要な処理に向いています。',
  'postinstall.fullUpgradeExplain':
    '「ソフトウェア」の「インストール時の更新」がセキュリティ更新のみ適用するのに対し、こちらはインストール完了後に {command} を実行してすべてのパッケージを最新にします。カーネルが更新されることもあります。',
  'postinstall.installerEnv': 'インストーラ環境',
  'postinstall.lateCommandsDesc':
    'インストール完了後、再起動する直前に実行されます。1 行に 1 コマンド。',
  'postinstall.lateCommandsWhere': '実行される場所に注意',
  'postinstall.lateCommandsWhereBody':
    'コマンドは{installerEnv}で実行され、新しいシステムは {target} にマウントされています。新しいシステムの中で実行したい場合は {inTarget} を先頭に付けてください。',
  'postinstall.needsNetwork': 'ネット必須',
  'postinstall.presetsHint': 'よくある設定をチェックするだけで追加できます。',
  'postinstall.rawYaml': '生の YAML で上書きする',
  'postinstall.rawYamlHint':
    'ここに書いた内容が、生成された autoinstall にマージされます（同じキーは上書き、配列は置き換え）。',
  'postinstall.refreshChannelHint': '空なら subiquity の既定チャンネルを使います。',
  'postinstall.reportingIgnored': '対話セクションがあると subiquity は reporting を無視します。',
  'postinstall.systemUpdate': 'システムの更新',

  // --- 確認 ---
  'review.title': '設定の確認',
  'review.yaml': '生成される設定ファイル',
  'review.yamlUserData': 'user-data (cloud-init)',
  'review.yamlAutoinstall': 'autoinstall.yaml',
  'review.issues': 'チェック結果',
  'review.noIssues': '問題は見つかりませんでした',
  'review.errorsFound': 'エラーがあります。修正してください。',
  'review.warningsFound': '注意事項があります',
  'review.export': '設定を書き出す',
  'review.exportProfile': 'プロファイル (JSON) を保存',
  'review.exportYaml': 'YAML を保存',
  'review.exportBundle': '設定一式を ZIP で保存',
  'review.importProfile': 'プロファイルを読み込む',
  'review.unattended': 'このまま書き込めば、電源を入れるだけでインストールが完了します',
  'review.interactive': '一部の項目はインストール中に画面で質問されます',
  'review.aptUpgradeOff': 'しない',
  'review.aptUpgradeOn': '実行する',
  'review.deploymentCount': '{n} 件',
  'review.deploymentCountWithSize': '{n} 件（{size}）',
  'review.diskRaw': 'カスタム (curtin)',
  'review.exportDescription': 'USB を作らずに設定だけ持ち出すこともできます。',
  'review.exportFolder': '設定一式をフォルダに書き出す',
  'review.exportNote':
    'プロファイル JSON にはパスワードのハッシュだけが入り、平文は含まれません。同じ設定で何台も作るときに使えます。',
  'review.fixErrorsFirst': '先に進む前に、下のエラーを修正してください。',
  'review.gpuNoDriver': 'ドライバなし',
  'review.hintAutoinstall':
    'cloud-config でラップしない形式です。人が読む用の控えとして USB にも同梱されます。',
  'review.hintGrub':
    'ISO 内の /boot/grub/grub.cfg をこの内容に書き換えます。autoinstall が無いと確認プロンプトで止まります。',
  'review.hintUserData':
    'この内容が USB の設定用パーティション (CIDATA) に user-data として書き込まれます。先頭の #cloud-config は cloud-init が必須とする目印です。',
  'review.isoNotSelected': '未選択',
  'review.networkAuto': '自動 (DHCP)',
  'review.networkDhcp': 'DHCP (明示)',
  'review.networkRaw': 'カスタム YAML',
  'review.networkStatic': '固定 {address}',
  'review.none': 'なし',
  'review.partlyInteractive': '一部対話あり',
  'review.runtimeAllFixed': 'なし（すべて固定）',
  'review.runtimeInteractive': '手入力',
  'review.runtimeKernelArg': '起動メニュー',
  'review.runtimeMenuCount': 'メニュー {n} 件',
  'review.shutdownPowerOff': '電源オフ',
  'review.shutdownReboot': '再起動',
  'review.sshDisabled': '無効',
  'review.sshEnabled': '有効（鍵 {keys} 個 / パスワード {password}）',
  'review.sshPasswordAllowed': '許可',
  'review.sshPasswordDenied': '禁止',
  'review.summary': 'サマリー',
  'review.summaryAdditionalUsers': '追加ユーザー',
  'review.summaryLocaleKeyboard': 'ロケール / キーボード',
  'review.summaryPostAction': 'インストール後の動作',
  'review.summaryServices': 'サービス',
  'review.summaryUnattended': '完全無人',

  // --- 書き込み ---
  'write.title': 'USB メモリに書き込む',
  'write.selectDevice': '書き込み先を選んでください',
  'write.noDevices': '対象になる USB メモリが見つかりません',
  'write.noDevicesHint': 'USB メモリを挿してから「再読み込み」を押してください',
  'write.refreshDevices': 'デバイスを再読み込み',
  'write.deviceBlocked': 'このデバイスには書き込めません',
  'write.systemDiskHidden': 'システムディスクは安全のため表示していません',
  'write.confirmTitle': '本当に書き込みますか？',
  'write.confirmBody': '次のデバイスの中身はすべて消去され、元に戻せません。',
  'write.confirmTypeHint': '続けるには「消去」と入力してください',
  'write.extraCaution': 'このデバイスは外付けドライブの可能性があります',
  'write.extraCautionBody':
    '容量が大きい、または USB 以外の接続です。中身のデータを確認してから進めてください。',
  'write.confirmWord': '消去',
  'write.start': '書き込みを開始',
  'write.writing': '書き込み中',
  'write.flushing': '書き込みを確定しています',
  'write.verifying': '内容を確認しています',
  'write.done': '完了しました',
  'write.doneBody': 'USB メモリを取り外して、インストールしたいサーバーで起動してください。',
  'write.failed': '書き込みに失敗しました',
  'write.cancelled': '書き込みを中止しました',
  'write.cancelledBody': 'USB メモリの内容は壊れています。もう一度作り直してください。',
  'write.elevationNeeded': '管理者権限が必要です',
  'write.remaining': '残り',
  'write.speed': '速度',
  'write.verifyOption': '書き込み後に内容を確認する（時間が約 2 倍になります）',
  'write.auditRecord': '作成記録を USB に残す',
  'write.another': 'もう一本作る',
  'write.auditRecordHint':
    '作成日時・ISO 名・設定のハッシュを autoinstall-usb.json として残します。パスワードは含みません。',
  'write.badgeCaution': '要確認',
  'write.badgeElapsed': '{minutes} 分 {seconds} 秒',
  'write.badgeNotVerified': '読み戻し確認なし',
  'write.badgeTooSmall': '容量不足',
  'write.badgeVerified': '読み戻し確認 OK',
  'write.badgeWritten': '{size} 書き込み',
  'write.configInvalid': '設定にエラーがあります',
  'write.configInvalidBody': '「確認」のステップでエラーを修正してから書き込んでください。',
  'write.currentlyMounted': '現在マウントされています: {mountpoints}',
  'write.doNotRemove': '書き込み中に USB メモリを抜かないでください。',
  'write.elevationAllow': '権限の確認ダイアログが出たら許可してください。',
  'write.isoMissing': 'ISO が選ばれていません',
  'write.isoMissingBody': '最初のステップに戻って ISO ファイルを選んでください。',
  'write.minimumSize': 'この ISO には {size} 以上の USB メモリが必要です。',
  'write.next1': 'USB メモリを安全に取り外し、インストールしたいサーバーに挿します。',
  'write.next2':
    'サーバーの電源を入れ、起動デバイスとして USB を選びます（多くの機種で F12 / F11 / Esc）。',
  'write.next3': 'GRUB のメニューで {entry} を選びます（30 秒で自動的に始まります）。',
  'write.next4Interactive': '一部の項目で入力を求められます。',
  'write.next4Reboot': '完了すると自動的に再起動します。',
  'write.next4Shutdown': '完了すると自動的に電源が切れます。',
  'write.next4Unattended': 'あとは何も操作せずに待つだけです。',
  'write.next5Login': '再起動後、{user} でログインできます。',
  'write.next5Ssh': 'SSH は {command} です。',
  'write.nextTitle': '次にすること',
  'write.optionsTitle': '書き込みオプション',
  'write.showBlocked': '書き込めないデバイス ({n} 台) を表示',
  'write.tooSmallBody': 'このデバイスは {size} ですが、{required} 以上が必要です。',
  'write.troubleApplied': '実際に適用された設定は {path} で確認できます（root のみ読めます）。',
  'write.troubleLogs': 'インストール先の {path} にログが残ります。',
  'write.troubleTitle': 'うまくいかないときは',
  'write.verifyOptionHint':
    '書き込んだ内容を読み戻してハッシュを照合します。安価な USB メモリの不良を検出できます。',

  // 書き込みの進行状況・失敗（main / media から LocalizedText で運ばれてくる）
  'write.deviceGone': 'デバイスが見つかりません。挿し直して再読み込みしてください。',
  'write.deviceNotWritable':
    'このデバイスには書き込めません。デバイス一覧を再読み込みしてください。',
  'write.deviceStalled':
    'USB メモリへの書き込みが進まなくなりました。取り外された可能性があります。挿し直してから、もう一度作り直してください。',
  'write.errorAlreadyRunning': '既に書き込み中です。',
  'write.errorCancelFailed':
    '管理者権限で動いている書き込み処理を停止できませんでした。USB メモリはまだ書き込まれている可能性があります。取り外さずに、タスクマネージャーで該当のプロセスを終了するか、完了を待ってください。',
  'write.errorElevationDeclined':
    '管理者権限が許可されませんでした。USB メモリへの書き込みには管理者権限が必要です。もう一度「書き込みを開始」を押し、権限の確認ダイアログで「はい」を選んでください。',
  'write.errorSpawnFailed': '書き込みプロセスを起動できませんでした。',
  'write.errorWorkerExited': '書き込みプロセスが異常終了しました (終了コード {code})。',
  'write.errorWorkerExitedNoOutput':
    '書き込みプロセスが異常終了しました (終了コード {code})。管理者権限の要求がキャンセルされた可能性があります。もう一度試してください。',
  'write.isoNotSelected': 'この ISO は選択されていません。選び直してください。',
  'write.isoPrepareFailed': 'ISO の準備に失敗しました。ISO ファイルが壊れている可能性があります。',
  'write.isoRecognized': 'ISO を認識しました: {volumeId}',
  'write.payloadMissing': '展開するファイルが見つかりません: {files}',
  'write.payloadNotSelected':
    '展開するファイル「{name}」が選択されていません。選び直してください。',
  'write.quitAbort': '中止して終了する',
  'write.quitContinue': '書き込みを続ける',
  'write.quitDetail':
    '今終了すると、書き込み途中の USB メモリが残ります（起動できません）。\n「中止して終了する」を選んだ場合も、USB メモリは作り直しが必要です。',
  'write.quitMessage': 'USB メモリへの書き込みが終わっていません。',
  'write.quitTitle': '書き込み中です',
  'write.statusCheckingPrivileges': '権限を確認しています',
  'write.statusPreparing': '書き込みを準備しています',
  'write.statusStarted': '書き込みを開始しました',
  'write.statusWaitingElevation': '管理者権限の許可を待っています',
  'write.unmounting': 'デバイスのマウントを解除しています',
  'write.verifyMismatch':
    '書き込んだ内容が読み戻した内容と一致しません（オフセット {offset}）。USB メモリが故障しているか、書き込み中に抜かれた可能性があります。別の USB メモリで作り直してください。',

  // --- デバイス（列挙と、ワーカー側の再照合） ---
  'device.blockedSystemDisk': 'OS が入っているシステムディスクです',
  'device.blockedReadOnly': '書き込み禁止になっています',
  'device.blockedUnknownSize': '容量を取得できませんでした',
  'device.blockedVirtual': '仮想ディスクのため対象外です',
  'device.blockedNotRemovable': '取り外し可能なデバイスとして認識できませんでした',
  'device.blockedTooSmall': '容量が小さすぎます（{min} 以上が必要）',
  'device.blockedTooLarge': '{max} を超えるデバイスは対象外です（外付けドライブの誤選択防止）',
  'device.rejectedNotFound':
    '書き込み先 {path} が見つかりません。取り外されたか、書き込み対象として認められないデバイスです。',
  'device.rejectedNotWritable': '{path} には書き込めません: {reason}',
  'device.rejectedNotWritableUnknown': '{path} には書き込めません（対象外のデバイスです）。',
  'device.rejectedSizeMismatch':
    '{path} の容量が指示書と違います（指示 {expected} / 実際 {actual}）。もう一度選び直してください。',
  'device.rejectedSerialMismatch':
    '{path} は選んだデバイスと違います（シリアル 指示 {expected} / 実際 {actual}）。取り外して挿し直したか、別のデバイスに入れ替わっています。もう一度選び直してください。',
  'device.rejectedSerialMissing':
    '{path} は選んだデバイスと違います（シリアル 指示 {expected} / 実際は読み取れません）。取り外して挿し直したか、別のデバイスに入れ替わっています。もう一度選び直してください。',
  'device.rejectedDescriptionMismatch':
    '{path} は選んだデバイスと違います（指示「{expected}」/ 実際「{actual}」）。もう一度選び直してください。',

  // --- USB のレイアウト計画（書き込み前に落ちる） ---
  'layout.notProtectiveMbr':
    'この ISO には protective MBR がありません。Ubuntu の live-server ISO ではない可能性があります。',
  'layout.noGpt': 'この ISO には GPT がありません。対応していない形式です。',
  'layout.isoTruncated':
    'この ISO は途中で切れています。パーティション "{partition}" は {needed} の位置まで続いていますが、ファイルは {fileSize} しかありません。ダウンロードが完了しているか、SHA256 が公式のものと一致するかを確認してください。',
  'layout.diskTooSmall':
    'USB の容量が足りません。ISO ({isoSize}) と設定用パーティション ({cidataSize}) を書くには少なくとも {required} 必要ですが、このデバイスは {deviceSize} です。',
  'layout.cidataTooSmall': '設定用パーティションは 1 MiB 以上にしてください。',

  // --- 書き込みの各工程（進捗バーの下に出るラベル） ---
  'writeOp.clearTable': 'パーティションテーブルの無効化',
  'writeOp.isoBody': 'ISO イメージ本体',
  'writeOp.clearStaleGpt': 'ISO 末尾の古いバックアップ GPT を消去',
  'writeOp.clearGap': '境界までの隙間を消去',
  'writeOp.cidata': '設定用パーティション (CIDATA)',
  'writeOp.backupGptEntries': 'バックアップ GPT エントリ',
  'writeOp.backupGptHeader': 'バックアップ GPT ヘッダ',
  'writeOp.gptEntries': 'GPT パーティションエントリ',
  'writeOp.gptHeader': 'GPT ヘッダ',
  'writeOp.protectiveMbr': 'protective MBR (GRUB ブートコード込み)',
  'writeOp.verifying': '書き込んだ内容を読み戻して確認しています',
  'writeOp.flushing': 'デバイスへの書き込みを完了させています',

  // --- 設定用パーティション (CIDATA) の組み立て ---
  'seed.reservedNameFile':
    '追加ファイルの名前「{name}」は設定用パーティションの予約名です。別の名前にしてください。',
  'seed.reservedNameDeployment':
    'アプリの展開の名前「{name}」は設定用パーティションの予約名です。別の名前にしてください。',
  'seed.duplicateNameFile':
    '追加ファイルの名前「{name}」が重複しています。設定用パーティションには同じ名前を 2 つ置けません。',
  'seed.duplicateNameDeployment':
    'アプリの展開の名前「{name}」が重複しています。設定用パーティションには同じ名前を 2 つ置けません。',
  'seed.payloadTooLarge':
    '{name} は {size} あり、USB の設定用パーティションに載せられません（上限 {limit}）。URL からのダウンロードに切り替えてください。',

  // --- YAML の生成が止まったとき ---
  // `generate.ts` の例外が運ぶ。**日本語の診断 (`Error.message`) を英文に連結しない**
  // ために、総括はここから引く（生の診断は `ValidationIssue.detail` に別の行として出す）。
  // `{detail}` に入るのは YAML パーサの原文で、もともと英語なので両方の言語に載せてよい。
  'generate.overlaySyntax': '上書き YAML の構文エラー: {detail}',
  'generate.overlayNotMapping': '上書き YAML はキーと値のマッピングにしてください。',
  'generate.failed': 'YAML を生成できませんでした。設定を見直してください。',

  // --- OS ネイティブのダイアログ（renderer を通らないので main が訳す） ---
  'dialog.chooseIso': 'Ubuntu Server の ISO ファイルを選ぶ',
  'dialog.filterIso': 'ISO イメージ',
  'dialog.saveProfile': 'プロファイルをファイルに書き出す',
  'dialog.openProfile': 'プロファイルをファイルから読み込む',
  'dialog.importProfile': 'プロファイルを取り込む',
  'dialog.filterProfile': 'プロファイル',
  'dialog.exportBundleDir': '設定一式の保存先フォルダを選ぶ',
  'dialog.pickPayload': 'インストール先に展開するファイルを選ぶ',
  'dialog.filterArchive': 'アーカイブ',
  'dialog.readTextFile': 'ファイルを選ぶ',
  'dialog.filterPublicKey': '公開鍵',
  'dialog.filterText': 'テキスト',
  'dialog.filterAllFiles': 'すべてのファイル',

  // --- 書き出す成果物（画面ではなくファイル） ---
  'bundle.readme': `Ubuntu Server 自動インストール設定

使い方（このツール以外で USB を作る場合）:
1. Ubuntu の live-server ISO を Rufus / balenaEtcher などで USB に書き込む（DD モード）。
2. 別の USB メモリを FAT32 でフォーマットし、ボリュームラベルを CIDATA にする。
3. そこに user-data と meta-data をコピーする。
4. 両方の USB を挿してサーバーを起動する。
5. GRUB のメニューで e を押し、linux の行の末尾（--- の前）に autoinstall を追加して Ctrl+X で起動する。
   ※ この手順を省くと "Continue with autoinstall? (yes|no)" で止まります。

このツールで USB を作れば、上記 2〜5 はすべて自動で行われます。

注意: アプリの展開を設定している場合、そのファイルはここには書き出されません。
      late-commands が CIDATA パーティションをマウントして参照します。

生成: {tool}
日時: {date}`,

  // --- プロファイル ---
  'profile.library': 'プロファイル',
  'profile.unsaved': '未保存の設定',
  'profile.dirty': '未保存の変更があります',
  'profile.save': '保存',
  'profile.saveAs': '名前を付けて保存',
  'profile.name': 'プロファイル名',
  'profile.namePlaceholder': '例: GPU サーバー標準構成',
  'profile.saveHint': 'あとから開いて修正できます。パスワードはハッシュのみ保存されます。',
  'profile.new': '新規作成',
  'profile.import': 'ファイルから取り込む',
  'profile.openFile': 'ファイルを開く',
  'profile.exportFile': 'ファイルに書き出す',
  'profile.revealFolder': '保存フォルダを開く',
  'profile.empty': '保存されたプロファイルはまだありません。設定を作って「保存」を押すとここに並びます。',
  'profile.rename': '名前を変更',
  'profile.duplicate': '複製',
  'profile.delete': '削除する',
  'profile.deleteTitle': 'プロファイルを削除しますか？',
  'profile.deleteBody': '次のプロファイルを削除します。元に戻せません。',
  'profile.badgeUsers': '追加ユーザー',
  'profile.badgeDeployments': '展開',
  'profile.badgeServices': 'サービス',
  'profile.badgeStaticIp': '固定 IP',
  'profile.migrated': 'プロファイルを読み込みました',
  'profile.badgeDeploymentsCount': '展開 {n}',
  'profile.badgeServicesCount': 'サービス {n}',
  'profile.badgeUsersCount': '追加ユーザー {n}',
  'profile.copyName': '{name} のコピー',
  'profile.discardConfirm': '保存していない変更があります。破棄して続けますか？',

  // --- 追加ユーザー ---
  'users.title': '追加のユーザー',
  'users.description':
    '管理者のほかに作るユーザーです。アプリを動かすための専用アカウントなどに使います。',
  'users.add': 'ユーザーを追加',
  'users.empty': '追加のユーザーはありません。',
  'users.username': 'ユーザー名',
  'users.realname': '説明 / 氏名',
  'users.password': 'パスワード',
  'users.passwordHint': '空にするとパスワードログインできません（SSH 鍵のみ、またはサービス専用）',
  'users.sudo': 'sudo の権限',
  'users.sudoNone': 'なし',
  'users.sudoPassword': 'あり（パスワードを聞く）',
  'users.sudoNopasswd': 'あり（パスワード不要）',
  'users.groups': '追加のグループ',
  'users.groupsHint': 'カンマ区切り。例: docker, adm',
  'users.shell': 'ログインシェル',
  'users.createHome': 'ホームディレクトリを作る',
  'users.systemAccount': 'システムアカウントにする',
  'users.systemAccountHint': 'UID が 1000 未満になり、ログイン一覧に出ません。サービス専用向け。',
  'users.sshKeys': 'SSH 公開鍵',
  'users.badgeNoLogin': 'ログイン不可',
  'users.clearPassword': '消す',
  'users.nopasswdWarning':
    'このユーザーはパスワード無しで root 権限を取得できます。サービス専用アカウントには通常「なし」を選んでください。',
  'users.passwordAlreadySet': 'パスワードは設定済みです。変更する場合だけ入力してください。',
  'users.sshKeyCount': 'SSH 鍵 {n}',

  // --- アプリの展開 ---
  'deploy.title': 'アプリ / ファイルの展開',
  'deploy.description':
    'USB に同梱するか、初回起動時に URL から取得して、インストール先の指定ディレクトリに展開します。',
  'deploy.add': '展開を追加',
  'deploy.empty': '展開するものはありません。',
  'deploy.kind': '種類',
  'deploy.kindFile': '単一ファイルを配置',
  'deploy.kindArchive': 'アーカイブを展開',
  'deploy.sourceKind': '取得元',
  'deploy.sourceHostFile': 'この PC のファイルを USB に同梱',
  'deploy.sourceInline': 'ここに直接書く',
  'deploy.sourceUrl': '初回起動時に URL から取得',
  'deploy.pickFile': 'ファイルを選ぶ',
  'deploy.selectedFile': '選択中',
  'deploy.missingFile': '元のファイルが見つかりません。選び直してください。',
  'deploy.url': 'ダウンロード元 URL',
  'deploy.sha256': 'SHA-256（改ざん検出）',
  'deploy.sha256Hint': '64 桁の 16 進数。空欄でも動きますが検証されません。',
  'deploy.archiveFormat': 'アーカイブ形式',
  'deploy.targetDir': '展開先ディレクトリ',
  'deploy.targetFile': '配置先のパス',
  'deploy.owner': '所有者',
  'deploy.group': 'グループ',
  'deploy.chownRecursive': '展開先を丸ごとこの所有者にする',
  'deploy.postCommand': '展開後に実行するコマンド',
  'deploy.postCommandHint': '展開先ディレクトリで実行されます。例: npm ci --omit=dev',
  'deploy.content': '内容',
  'deploy.sizeWarning': 'USB に同梱するファイルの合計',
  'deploy.bundleSizeWarning':
    '{size} を USB に同梱します。書き込み時間が延び、USB の容量も必要になります。大きなファイルは「初回起動時に URL から取得」の方が向いています。',
  'deploy.fileNameOnUsb': 'USB 上のファイル名',
  'deploy.summaryHostFile': 'USB 同梱 · {size}',
  'deploy.summaryInline': '直接入力 · {size}',
  'deploy.summaryUrl': '初回起動時に {url} から取得',
  'deploy.unnamed': '(名前なし)',
  'deploy.urlDownloadNote':
    '初回起動時にダウンロードします。インターネットに接続できる環境が必要です。{curl} が自動で追加されます。',

  // --- サービス ---
  'service.title': 'systemd サービスの登録',
  'service.description': 'インストール先で自動起動するサービスを登録します。',
  'service.add': 'サービスを追加',
  'service.empty': '登録するサービスはありません。',
  'service.name': 'サービス名',
  'service.nameHint': '.service は付けません。例: myapp',
  'service.descriptionField': '説明',
  'service.execStart': '起動コマンド (ExecStart)',
  'service.execStartHint': '絶対パスで書いてください。systemd は PATH を解決しません。',
  'service.execStartPre': '起動前に実行するコマンド (ExecStartPre)',
  'service.workingDirectory': '作業ディレクトリ',
  'service.user': '実行ユーザー',
  'service.group': '実行グループ',
  'service.environment': '環境変数',
  'service.environmentHint': '1 行に 1 つ、KEY=VALUE の形式',
  'service.environmentFile': '環境変数ファイル',
  'service.type': 'サービスの種類 (Type)',
  'service.restart': '異常終了時の再起動',
  'service.restartNo': '再起動しない',
  'service.restartOnFailure': '失敗したときだけ',
  'service.restartAlways': '常に',
  'service.restartSec': '再起動までの秒数',
  'service.after': '起動順序 (After)',
  'service.afterHint': 'カンマ区切り。例: network-online.target, docker.service',
  'service.wantedBy': '有効化する対象 (WantedBy)',
  'service.enabled': 'インストール時に自動起動を有効にする',
  'service.preview': 'ユニットファイルの内容',
  'service.badgeEnabled': '自動起動',
  'service.badgeManual': '手動',
  'service.nameInvalid': '使えない文字が含まれています',
  'service.noCommand': '(コマンド未設定)',
  'service.typeForking': 'forking（自分で daemon 化する）',
  'service.typeOneshot': 'oneshot（1 回だけ）',
  'service.typeSimple': 'simple（常駐）',
  'service.unnamed': '(名前なし)',
  'service.userRootDefault': 'root（既定）',

  // --- GPU / CUDA ---
  'gpu.title': 'NVIDIA GPU / CUDA',
  'gpu.description':
    'NVIDIA の公式リポジトリからドライバと CUDA を導入します。初回起動時に実行され、数 GB のダウンロードが発生します。',
  'gpu.enable': 'NVIDIA ドライバ / CUDA を導入する',
  'gpu.driver': 'ドライバ',
  'gpu.driverNone': '入れない（ツールキットのみ）',
  'gpu.driverOpen': 'オープンカーネルモジュール (nvidia-open)',
  'gpu.driverOpenHint': 'Turing (RTX 20 系) 以降で推奨されます。',
  'gpu.driverProprietary': '従来のドライバ (cuda-drivers)',
  'gpu.driverProprietaryHint': 'Maxwell〜Volta などの古い GPU 向け。',
  'gpu.toolkit': 'CUDA ツールキット',
  'gpu.setupPath': 'PATH と LD_LIBRARY_PATH を設定する',
  'gpu.setupPathHint': '/etc/profile.d/cuda.sh を作り、ログイン時に nvcc が使えるようにします。',
  'gpu.containerToolkit': 'Docker から GPU を使えるようにする',
  'gpu.containerToolkitHint': 'nvidia-container-toolkit を入れて Docker に登録します。',
  'gpu.rebootNote': 'ドライバを入れた場合、初回起動時の導入完了後に自動で再起動します。',
  'gpu.unsupported': 'このバージョンには CUDA リポジトリがありません',
  'gpu.archUnsupportedBody':
    'この ISO は {arch} 版です。CUDA の導入は amd64 (x86_64) の ISO でのみ行えます。',
  'gpu.dockerMissing':
    'コンテナから GPU を使う設定ですが、Docker がインストールされません。「インストール後」の「よく使う設定」で Docker を有効にしてください。',
  'gpu.installNote': '初回起動時に {keyring} を導入してから apt でインストールします。',
  'gpu.noRepoBody':
    'NVIDIA は Ubuntu {series} 向けの CUDA リポジトリを公開していません。LTS 版（22.04 / 24.04 / 26.04）の ISO を使ってください。',
  'gpu.nothingSelected': '（ドライバもツールキットも選ばれていません）',
  'gpu.officialGuide': 'NVIDIA の公式手順',
  'gpu.repoInUse': 'NVIDIA の {repo} リポジトリを使います。',
  'gpu.unsupportedSeries': 'Ubuntu {series} には CUDA リポジトリがありません',
  'gpu.willInstall': 'インストールされるもの',

  // --- その他 ---
  'postinstall.aptFullUpgrade': '全パッケージを最新にする (apt full-upgrade)',
  'postinstall.aptFullUpgradeHint':
    'インストール直後に実行します。時間がかかりますが、初回起動時点で最新の状態になります。',
  'postinstall.tabPresets': 'よく使う設定',
  'postinstall.tabDeploy': 'アプリの展開',
  'postinstall.tabServices': 'サービス',
  'postinstall.tabFiles': 'ファイルとコマンド',
  'postinstall.tabAdvanced': '上級者向け',

  // --- 実行時に決める値（ホストごとに違う項目） ---
  'runtime.title': '実行時に決める値',
  'runtime.intro':
    'IP アドレスやホスト名のように「同じ USB を挿しても機械ごとに変えたい」項目は、ここで決め方を選べます。',
  'runtime.fieldHostname': 'ホスト名',
  'runtime.fieldNetwork': 'ネットワーク (IP / ゲートウェイ / DNS)',
  'runtime.fieldDisk': 'インストール先ディスク',
  'runtime.modeFixed': 'この設定の値を使う',
  'runtime.modeFixedHint': 'いつも同じ値になります。1 台だけ作るならこれで十分です。',
  'runtime.modeKernelArg': '起動メニューから選ぶ',
  'runtime.modeKernelArgHint':
    'USB の起動画面に「web01」「web02」のような項目を並べ、選んだ内容を設定に流し込みます。手を止めるのは最初の一瞬だけです。',
  'runtime.modeInteractive': 'インストーラの画面で入力する',
  'runtime.modeInteractiveHint':
    'いつもの Ubuntu インストーラの画面が出て、この設定の値が初期値として入ります。その場で書き換えられます。',
  'runtime.presetsTitle': '起動メニューに並べるホスト',
  'runtime.presetsIntro':
    '1 行が起動メニューの 1 項目になります。「起動メニューから選ぶ」にした項目だけが使われます。',
  'runtime.presetLabel': 'メニュー名',
  'runtime.presetHostname': 'ホスト名',
  'runtime.presetIpv4': 'IPv4 (CIDR)',
  'runtime.presetGateway': 'ゲートウェイ',
  'runtime.presetDns': 'DNS (カンマ区切り)',
  'runtime.presetDisk': 'ディスク',
  'runtime.addPreset': 'ホストを追加',
  'runtime.removePreset': 'この行を削除',
  'runtime.noPresets': 'まだ 1 件もありません。「ホストを追加」から登録してください。',
  'runtime.offerInteractiveEntry': '「その場で入力する」項目も起動メニューに出す',
  'runtime.offerInteractiveEntryHint':
    '一覧に無いホストを作るときのための逃げ道です。選ぶとインストーラの画面が出ます。',
  'runtime.grubFree': '起動メニューの残り容量',
  'runtime.grubFreeHint':
    '起動メニューは 2048 バイトに収める必要があります（ISO を作り直さずに書き換えているため）。',
  'runtime.grubTooLarge':
    'ホストが多すぎて起動メニューが 2048 バイトに収まりません。件数を減らすか、メニュー名を短くしてください。',
  'runtime.howItWorks': '仕組み',
  'runtime.howItWorksBody':
    '起動メニューから選ぶ場合は ai.hostname= のようなカーネル引数が渡され、インストール開始直前に autoinstall.yaml の該当箇所だけを書き換えます。引数が無ければこの設定の値がそのまま使われるので、失敗しても止まりません。',
  'runtime.previewTitle': '起動メニューのプレビュー',
  'runtime.needIso': 'ISO を選ぶと、実際の起動メニューを確認できます。',
  'runtime.grubFreeBytes': '{bytes} バイト',
  'runtime.prereqDisk':
    'ディスクを起動メニューから選ぶには、「ディスク」で「シリアル番号で指定」にしておく必要があります。',
  'runtime.prereqNetwork':
    'ネットワークを起動メニューから選ぶには、「ネットワーク」で「固定 IP」にしておく必要があります（今は「{mode}」）。',
  'runtime.prereqTitle': 'この設定にはもう少し必要です',

  // --- 上級者向け（公式仕様のうち普段は隠す項目） ---
  'adv.kernelTitle': 'カーネル',
  'adv.kernelDefault': '既定 (linux-generic)',
  'adv.kernelHwe': '新しいハードウェア向け (HWE)',
  'adv.kernelHweHint': '新しい CPU / NIC / GPU を積んだ機械で認識しない場合に選びます。',
  'adv.kernelCustom': 'パッケージ名を指定',
  'adv.kernelFlavor': 'カーネルのパッケージ名',
  'adv.searchDrivers': 'サードパーティのドライバを探す',
  'adv.searchDriversHint': 'NVIDIA などの追加ドライバをインストーラに探させます（ネットワークが必要）。',
  'adv.searchDriversDefault': 'インストーラの既定にまかせる',
  'adv.searchDriversOn': '探す',
  'adv.searchDriversOff': '探さない',
  'adv.codecs': '制限付きコーデックを入れる',
  'adv.codecsHint': 'MP3 / H.264 などのライセンス上分離されているパッケージを入れます。',
  'adv.oem': 'OEM モードで入れる',
  'adv.oemHint': '出荷前設定用。初回起動時にユーザー作成をやり直させたい場合に使います。',
  'adv.aptTitle': 'APT の追加設定',
  'adv.aptSources': '追加リポジトリ',
  'adv.aptSourcesHint':
    'ppa:user/name か、deb 行をそのまま 1 行ずつ書きます。インストール中に有効になります。',
  'adv.aptPreserve': '既存の sources.list をそのまま使う',
  'adv.aptPreserveHint': 'ミラーの自動設定を止め、書いた内容だけを使います。',
  'adv.aptFallback': 'ミラーに繋がらないときの動作',
  'adv.aptFallbackAbort': '中止する',
  'adv.aptFallbackOffline': 'オフラインで続ける (offline-install)',
  'adv.aptFallbackContinue': '無視して続ける (continue-anyway)',
  'adv.swapTitle': 'スワップ',
  'adv.swapAuto': 'インストーラに任せる',
  'adv.swapNone': '作らない',
  'adv.swapSize': 'サイズを指定',
  'adv.swapSizeValue': 'スワップのサイズ',
  'adv.swapSizeHint': '4G / 2048M のように単位付きで書きます。',
  'adv.resetPartition': '復旧用パーティションを作る',
  'adv.resetPartitionHint': 'Ubuntu 24.04 以降。工場出荷状態に戻すための領域を確保します。',
  'adv.resetPartitionSize': '復旧用パーティションのサイズ',
  'adv.errorCommands': '失敗したときに実行するコマンド',
  'adv.errorCommandsHint': 'インストールが失敗した場合だけ実行されます。1 行に 1 コマンド。',
  'adv.collectLogs': '失敗時にログを集める',
  'adv.collectLogsHint':
    '/var/log/installer をまとめて、原因を後から追えるようにします（error-commands を使います）。',
  'adv.debconf': 'debconf の事前回答',
  'adv.debconfHint':
    'パッケージが出す質問に先回りで答えます。`パッケージ 質問 型 値` を 1 行ずつ書きます。',
  'adv.reporting': 'インストール状況の通知先',
  'adv.reportingConsole': 'コンソールに表示する（既定）',
  'adv.reportingNone': '通知しない',
  'adv.reportingWebhook': 'Webhook (URL に POST)',
  'adv.reportingRsyslog': 'rsyslog サーバー',
  'adv.reportingUrl': '送信先',
  'adv.reportingUrlHint': '進行状況が逐次送られます。多数の機械を一括で見るときに使います。',
  'adv.adTitle': 'Active Directory に参加する',
  'adv.adHint': 'ドメイン参加のパスワードはインストール中に画面で聞かれます（設定には保存されません）。',
  'adv.adDomain': 'ドメイン名',
  'adv.adAdmin': '参加に使う管理者名',
  'adv.adWarning': 'AD 参加を有効にすると、パスワード入力のため完全な無人インストールにはなりません。',
  'adv.refreshInstaller': 'インストーラを最新に更新する',
  'adv.refreshInstallerHint': '起動後に subiquity 自身を snap から更新します（ネットワークが必要）。',
  'adv.interactiveAll': 'すべての項目をインストーラの画面で確認する',
  'adv.interactiveAllHint':
    '設定は初期値として入りますが、全画面を手で進めることになります。動作確認のときに使います。',
  'adv.identityGroups': '管理ユーザーを追加のグループに入れる',
  'adv.identityGroupsUnsupported': 'このバージョンでは指定できません (26.04 以降)',

  // --- エラー境界 ---
  'boundary.body':
    '設定の内容が想定と違うため、画面の描画に失敗しました。手で編集したプロファイルや、別のバージョンで保存されたプロファイルを開くと起こることがあります。',
  'boundary.reload': 'アプリを読み込み直す',
  'boundary.retry': 'もう一度表示する',
  'boundary.title': 'この画面を表示できませんでした',

  // --- ストア ---
  'store.seriesAligned':
    'このプロファイルは Ubuntu {savedSeries} 用に保存されていましたが、選択中の ISO ({isoSeries}) に合わせました。バージョンによって使える設定が違うので、確認画面で内容を見てください。',
  'store.writeStartFailed': '書き込みを開始できませんでした。',

  // --- 保存済みプロファイルの読み込み（落とし穴 49 / 50 の安全通知） ---
  // ここは `migrateProfile` が LocalizedText で積む。訳すのは描画するときだけ。
  'migrate.notAProfile': 'ファイルの中身がプロファイルではありませんでした。',
  'migrate.unsupportedSeries':
    '対応していない Ubuntu バージョン ({series}) だったため既定に戻しました。',
  'migrate.enumReset':
    '{field} の値 ({value}) を認識できなかったため既定 ({fallback}) に戻しました。',
  'migrate.itemsDropped': '{category}の {count} 件は形式が正しくないため読み飛ばしました。',
  'migrate.storageModeReset':
    'ディスクの構成方法 ({mode}) を認識できなかったため既定に戻しました。対象ディスクの指定は残してあります。書き込む前に確認してください。',
  'migrate.fromV1':
    '古い形式のプロファイルを読み込みました。追加ユーザー・アプリ展開・サービス・GPU は未設定です。',
  'migrate.fromV2':
    '古い形式のプロファイルを読み込みました。「実行時に決める値」は未設定です。',
  'migrate.fromV3':
    '古い形式のプロファイルを読み込みました。カーネル選択・追加リポジトリ・失敗時のログ収集などは未設定です。',
  'migrate.fromNewer':
    '新しいバージョンのツールで保存されたプロファイルです。認識できない設定は無視しました。',
  // 項目名・分類名は、文の中に入れ子で差し込む（語順の違う言語でも成立させる）。
  'migrate.field.softwareUpdates': '更新の範囲 (software.updates)',
  'migrate.field.aptFallback': 'ミラーが使えないときの動作 (apt.fallback)',
  'migrate.field.behaviorShutdown': 'インストール後の動作 (behavior.shutdown)',
  'migrate.field.storagePartitionTable':
    'パーティションテーブル (storage.partitionTable)',
  'migrate.category.snap': 'Snap',
  'migrate.category.file': '追加ファイル',
  'migrate.category.user': '追加ユーザー',
  'migrate.category.service': 'サービス',
  'migrate.category.deployment': 'アプリ展開',

  // --- エラー ---
  'error.isoTooBig': 'USB メモリの容量が足りません',
  'error.deviceRemoved': 'USB メモリが取り外されました',
  'error.permissionDenied': '権限がありません',
  'error.unknown': '予期しないエラーが発生しました',
} as const

export type MsgKey = keyof typeof ja
