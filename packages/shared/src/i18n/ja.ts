// 日本語が原文。ここに追加したキーは en.ts にも必ず追加する（型で強制される）。
export const ja = {
  // --- 共通 ---
  'app.name': 'Seedstick',
  'app.tagline': 'Ubuntu Server の自動インストール USB を作る',
  'common.next': '次へ',
  'common.language': '表示言語',
  'common.back': '戻る',
  'common.cancel': 'キャンセル',
  'common.close': '閉じる',
  'common.save': '保存',
  'common.add': '追加',
  'common.delete': '削除',
  'common.advanced': '上級者向け',
  'common.recommended': '推奨',
  'common.yes': 'はい',
  'common.loading': '読み込み中…',
  'common.copy': 'コピー',
  'common.copied': 'コピーしました',
  'common.show': '表示',
  'common.hide': '隠す',
  'common.edit': '編集',
  'common.moveUp': '上へ移動',
  'common.moveDown': '下へ移動',

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

  // 選択肢のラベル（`presets.ts` の LOCALE_CHOICES / KEYBOARDS / TIMEZONES）。
  // 以前は配列の要素が labelJa / labelEn を直接持っていた。i18n の機構が 2 つあると
  // 片方だけ更新されるので、表示名は必ずここを通す。`value`（autoinstall に出る値）は
  // 変えていない。
  'basics.localeEnUs': '英語 (アメリカ)',
  'basics.localeJaJp': '日本語',
  'basics.localeEnGb': '英語 (イギリス)',
  'basics.localeDeDe': 'ドイツ語',
  'basics.localeFrFr': 'フランス語',
  'basics.localeEsEs': 'スペイン語',
  'basics.localePtBr': 'ポルトガル語 (ブラジル)',
  'basics.localeZhCn': '中国語 (簡体)',
  'basics.localeKoKr': '韓国語',
  'basics.localeC': 'ロケールなし (C.UTF-8)',
  'basics.keyboardUs': '英語 (US)',
  'basics.keyboardJp': '日本語 (JIS)',
  'basics.keyboardUsDvorak': '英語 (Dvorak)',
  'basics.keyboardGb': '英語 (UK)',
  'basics.keyboardDe': 'ドイツ語',
  'basics.keyboardFr': 'フランス語',
  'basics.keyboardEs': 'スペイン語',
  'basics.keyboardKr104': '韓国語 (104キー)',
  'basics.keyboardCn': '中国語',
  'basics.timezoneTokyo': '東京 (JST)',
  'basics.timezoneUtc': 'UTC (協定世界時)',
  'basics.timezoneGeoip': 'IP アドレスから自動判定',
  'basics.timezoneLosAngeles': 'ロサンゼルス',
  'basics.timezoneNewYork': 'ニューヨーク',
  'basics.timezoneLondon': 'ロンドン',
  'basics.timezoneBerlin': 'ベルリン',
  'basics.timezoneSingapore': 'シンガポール',
  'basics.timezoneSeoul': 'ソウル',
  'basics.timezoneSydney': 'シドニー',

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
  'user.detailsTitle': '詳しい設定',
  'user.detailsDescription': 'インストーラは聞きません。既定のままで問題ありません。',

  // --- SSH ---
  'ssh.title': 'SSH の設定',
  'ssh.installServer': 'SSH サーバーをインストールする',
  'ssh.installServerHint': 'ネットワーク越しにこのサーバーへログインできるようになります',
  'ssh.allowPassword': 'パスワードでの SSH ログインを許可する',
  'ssh.authorizedKeys': 'SSH 公開鍵',
  'ssh.authorizedKeysHint': '1 行に 1 つ貼り付けてください（ssh-ed25519 AAAA... の形式）',
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
  'network.detailsTitle': '詳しい設定',
  'network.detailsDescription': 'インストーラは聞きません。既定のままで問題ありません。',
  'network.detailsInactive':
    '上で「netplan の YAML を直接書く」を選ぶと、ここに編集欄が出ます。',

  // --- ネットワーク: bond（NIC の束ね） ---
  'network.modeBond': '複数のネットワークカードを束ねる (bond)',
  'network.modeBondHint':
    '2 枚以上の NIC を 1 本の回線として扱います。冗長化（片方が切れても通信が続く）や帯域の合算に使います。',
  'network.bondTitle': 'bond の設定',
  'network.bondName': 'bond の名前',
  'network.bondNameHint': '例: bond0。netplan のデバイス名になります。',
  'network.bondMembers': '束ねるネットワークカード',
  'network.bondMembersHint': '2 枚以上を指定します。ここに挙げた NIC には IP を付けません。',
  'network.bondMember': 'ネットワークカード {n}',
  'network.bondAddMember': 'ネットワークカードを追加',
  'network.bondRemoveMember': 'この行を削除',
  'network.bondParameters': '束ね方',
  'network.bondMode': 'モード',
  'network.bondModeHint': 'スイッチ側の設定が要るかどうかが変わります。',
  'network.bondModeActiveBackup': 'active-backup（片方を待機。スイッチの設定不要）',
  'network.bondMode8023ad': '802.3ad（LACP。スイッチ側の設定が必要）',
  'network.bondModeBalanceRr': 'balance-rr（順番に振り分け）',
  'network.bondModeBalanceXor': 'balance-xor（宛先で振り分け）',
  'network.bondModeBalanceTlb': 'balance-tlb（送信だけ負荷分散）',
  'network.bondModeBalanceAlb': 'balance-alb（送受信とも負荷分散）',
  'network.bondModeBroadcast': 'broadcast（全 NIC に同じものを送る）',
  'network.bondLacpRate': 'LACP の送信間隔 (lacp-rate)',
  'network.bondLacpRateHint': '802.3ad のときだけ効きます。空欄なら netplan の既定に従います。',
  'network.bondLacpRateDefault': '指定しない（netplan の既定）',
  'network.bondLacpRateFast': 'fast（1 秒ごと）',
  'network.bondLacpRateSlow': 'slow（30 秒ごと）',
  'network.bondMiiMonitor': 'リンク監視の間隔 (mii-monitor-interval)',
  'network.bondMiiMonitorHint':
    'ミリ秒。0 にすると監視しません（ケーブルが抜けても切り替わりません）。実運用では 100 程度にします。',
  'network.bondHashPolicy': '振り分けの方法 (transmit-hash-policy)',
  'network.bondHashPolicyHint':
    'balance-xor と 802.3ad のときだけ効きます。例: layer2, layer3+4。空欄なら netplan の既定に従います。',
  'network.bondAddressing': 'bond の IP アドレス',
  'network.bondAddressingHint': 'アドレスは束ねた bond 側に付きます。個々の NIC には付けません。',
  'network.bondAddressingDhcp': 'DHCP で取得する',
  'network.bondAddressingStatic': '固定 IP を使う',
  'network.bondOptional': 'bond が上がらなくても起動を待たない',
  'network.bondTargetInactive':
    'この構成では「対象のネットワークカード」は使いません（束ねる NIC を下で指定します）。',

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
  'storage.partitionTable': 'パーティション形式',
  'storage.ptableDefault': '自動 (GPT)',
  'storage.ptableMsdos': 'MBR（古い BIOS 機向け）',
  'storage.detailsTitle': '詳しい設定',
  'storage.detailsDescription': 'インストーラは聞きません。既定のままで問題ありません。',
  'storage.detailsRawActive':
    'curtin の設定を直接書いている間は、スワップ・暗号化・復旧用パーティションの設定は使われません。下の YAML がそのまま autoinstall の storage になります。',
  'storage.detailsRawInactive':
    '上で「curtin の設定を直接書く」を選ぶと、ここに編集欄が出ます。',
  'storage.encryptHint':
    '盗難時にデータを守れますが、起動のたびにパスフレーズの入力が必要になります。',
  'storage.layoutDirectHint': 'パーティションを直接切ります。構成が単純で分かりやすくなります。',
  'storage.layoutLvmHint':
    'あとから容量を増やしたりスナップショットを取ったりできます。Ubuntu の既定もこれです。',
  'storage.layoutRawHint': 'RAID や複雑なパーティション構成を自分で書く場合に選びます。',
  // --- RAID + LVM ---
  'storage.raidLevelRaid0': 'RAID0（ストライプ・冗長性なし・2 台から）',
  'storage.raidLevelRaid1': 'RAID1（ミラー・2 台から）',
  'storage.raidLevelRaid5': 'RAID5（パリティ 1 本・3 台から）',
  'storage.raidLevelRaid6': 'RAID6（パリティ 2 本・4 台から）',
  'storage.raidLevelRaid10': 'RAID10（ミラー + ストライプ・4 台から）',
  'storage.raidRoleBoot': '/boot にする',
  'storage.raidRoleLvmPv': 'LVM の物理ボリュームにする（この上に root を切る）',
  'storage.raidRoleData': '作るだけ（フォーマットもマウントもしない）',
  'storage.raidFstypeExt4': 'ext4',
  'storage.raidFstypeXfs': 'XFS',
  'storage.layoutRaid': 'RAID + LVM（複数のディスクをまとめる）',
  'storage.layoutRaidHint':
    '複数のディスクで RAID を組み、その上に LVM を作って root を切ります。/boot を RAID1、LVM を RAID10 のように、用途ごとに配列を分けられます。ここに並べたディスクは中身がすべて消去されます。',
  'storage.warningRaid': '選んだ {count} 台のディスクが、まるごと消去されます。',
  'storage.raidDisksTitle': 'RAID に使うディスク',
  'storage.raidDisksHint':
    '1 行が 1 台です。どのディスクが消えるかを取り違えないよう、シリアル番号かデバイスのパスで 1 台ずつ指定してください。並び順は「1 台目の起動ディスク」を決めます。',
  'storage.raidDisksEmpty': 'まだ 1 台も登録されていません。',
  'storage.raidAddDisk': 'ディスクを追加',
  'storage.raidDiskHeading': 'ディスク #{n}',
  'storage.raidDiskBoot': 'このディスクから起動できるようにする',
  'storage.raidDiskBootHint':
    'EFI システムパーティション (ESP) を作ります。ESP は RAID に置けないので、起動に使うディスクごとに 1 つずつ作られます。',
  'storage.raidDiskBootBadge': '起動用',
  'storage.raidDiskUsage': 'このディスクの使い方',
  'storage.raidDiskUsagePartitions': 'パーティションを切って使う',
  'storage.raidDiskUsageWhole': 'ディスク丸ごとを 1 つのメンバーにする',
  'storage.raidDiskUsageHint':
    '丸ごとを選ぶと、パーティションを 1 つも作らずにディスクそのものを RAID のメンバーにします。パーティションテーブルを作らないので、このディスクには EFI システムパーティションも /boot も置けません。',
  'storage.raidDiskWholeBadge': '丸ごと',
  'storage.raidDiskEspOnWhole':
    'このディスクは丸ごと 1 つのメンバーにするので、EFI システムパーティションを置く場所がありません。操作は残してあります（有効のまま保存されたプロファイルを解除できなくしないため）が、有効にすると矛盾として指摘されます。',
  'storage.raidEspCount':
    'EFI システムパーティションを作るディスク: {count} 台。ここが 0 台だと、インストールできても起動できません。',
  'storage.raidRoleDataNote':
    'この配列は組み立てるだけで、フォーマットもマウントもされません。インストール後に自分でファイルシステムを作って使ってください。',
  'storage.raidDiskIncomplete': 'ディスク未指定',
  'storage.raidRowUnreadable':
    'この行は読み取れませんでした（プロファイルを手で編集した可能性があります）。削除してから入れ直してください。',
  'storage.raidArraysTitle': 'RAID の配列',
  'storage.raidArraysHint':
    '配列ごとにレベルと使うディスクを選びます。/boot 用の配列と、LVM の物理ボリュームにする配列（root はこの上に作られます）を分けられます。',
  'storage.raidArraysEmpty': 'まだ 1 つも定義されていません。',
  'storage.raidAddArray': '配列を追加',
  'storage.raidArrayHeading': '配列 #{n}',
  'storage.raidArrayName': '配列の名前 (md デバイス)',
  'storage.raidArrayNameHint': '例: md0。/dev/md/md0 として作られます。',
  'storage.raidArrayLevel': 'RAID レベル',
  'storage.raidArrayRole': 'この配列の使い道',
  'storage.raidArrayMembers': '使うディスク',
  'storage.raidArrayMembersHint':
    'チェックした順に mdadm へ渡されます。スペアは故障時に自動で入れ替わる予備で、最小台数には数えません。',
  'storage.raidLevelMin': '{need} 台から。いま {have} 台選ばれています。',
  'storage.raidMemberSpare': 'スペアにする',
  'storage.raidLvmTitle': 'LVM と root',
  'storage.raidLvmHint':
    '「LVM の物理ボリュームにする」配列の上にボリュームグループを作り、その中に root の論理ボリュームを切ります。',
  'storage.raidVolumeGroup': 'ボリュームグループ名',
  'storage.raidRootName': 'root の論理ボリューム名',
  'storage.raidRootSize': 'root の大きさ',
  'storage.raidRootSizeRest': '残り全部',
  'storage.raidRootSizeFixed': '大きさを指定する',
  'storage.raidRootSizeValue': 'root に割り当てる大きさ',
  'storage.raidRootSizeHint': '例: 100G。残した領域は、あとから lvextend で足せます。',
  'storage.raidRootFstype': 'root のファイルシステム',
  'storage.raidBootTitle': '起動まわり',
  'storage.raidBootHint': 'ESP と /boot の大きさ、2 台目以降の起動ディスクの扱いを決めます。',
  'storage.raidEspSize': 'EFI システムパーティションの大きさ',
  'storage.raidEspSizeHint': '起動に使うディスクごとに 1 つずつ作られます。例: 512M。',
  'storage.raidBootSize': '/boot の大きさ',
  'storage.raidBootSizeHint': '/boot にする配列があるときだけ使われます。例: 2G。',
  'storage.raidMirrorBootloader': '2 台目以降の起動ディスクにもブートローダを入れる',
  'storage.raidMirrorBootloaderHint':
    'curtin は 1 台にしかブートローダを入れません。1 台目が壊れても起動できるよう、インストールの最後に複製します（この手順はまだ実機で検証していません）。',
  'storage.raidPtableIgnored':
    'RAID + LVM ではこの設定は使われません。パーティション形式は GPT に固定されます。',
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

  // 「詳しい設定」の折りたたみ（インストーラが決して聞かない項目）。
  'software.advancedTitle': '詳しい設定',
  'software.advancedHint':
    'インストーラが聞かない項目です。カーネルの種類・追加リポジトリ・Ubuntu Pro のトークン。',

  // 選択肢のラベル（`presets.ts` の APT_MIRROR_PRESETS / COMMON_PACKAGES）
  'software.aptMirrorPresetJp': '日本 (jp.archive.ubuntu.com)',
  'software.aptMirrorPresetDefault': '既定 (archive.ubuntu.com)',
  'software.aptMirrorPresetJaist': '日本 JAIST',
  'software.aptMirrorPresetRiken': '日本 理研',
  'software.aptMirrorPresetUs': 'アメリカ',
  'software.aptMirrorPresetDe': 'ドイツ',
  'software.packageOpensshServer': 'SSH サーバー',
  'software.packageVim': 'vim エディタ',
  'software.packageCurl': 'curl',
  'software.packageGit': 'git',
  'software.packageHtop': 'htop (プロセス監視)',
  'software.packageTmux': 'tmux',
  'software.packageNetTools': 'net-tools (ifconfig 等)',
  'software.packageBuildEssential': 'build-essential (コンパイラ一式)',
  'software.packageNfsCommon': 'NFS クライアント',
  'software.packageLmSensors': 'lm-sensors (温度監視)',

  // --- インストール後 ---
  'postinstall.presets': 'よく使う設定',
  'postinstall.lateCommands': '追加のコマンド（インストール直後に実行）',
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

  // インストール後処理プリセットの見出しと説明（`presets.ts` の POST_INSTALL_PRESETS）。
  // キーの末尾は `PostInstallPresetId` に対応する（`sudo-nopasswd` → `SudoNopasswd`）。
  'postinstall.presetSudoNopasswdTitle': 'sudo をパスワード無しにする',
  'postinstall.presetSudoNopasswdDesc':
    '作成したユーザーが sudo をパスワード入力なしで使えるようにします。自動化には便利ですが、そのユーザーのログインを奪われると即座に root 権限を取られます。',
  'postinstall.presetSshHardenTitle': 'SSH のパスワード認証を無効にする',
  'postinstall.presetSshHardenDesc':
    '公開鍵認証のみ許可し、root の SSH ログインも禁止します。事前に SSH 公開鍵を登録していないとログインできなくなるので注意してください。',
  'postinstall.presetUnattendedUpgradesTitle': 'セキュリティ更新を自動適用する',
  'postinstall.presetUnattendedUpgradesDesc':
    'unattended-upgrades を有効にして、セキュリティ更新を自動で適用します。再起動が必要な更新でも自動再起動はしません。',
  'postinstall.presetQemuGuestAgentTitle': '仮想マシン用ゲストエージェントを入れる',
  'postinstall.presetQemuGuestAgentDesc':
    'KVM / Proxmox / QEMU の仮想マシンにインストールする場合に選びます。ホスト側からシャットダウンや IP 取得ができるようになります。',
  'postinstall.presetDockerCeTitle': 'Docker を入れる (Ubuntu 標準リポジトリ版)',
  'postinstall.presetDockerCeDesc':
    'docker.io と docker-compose-v2 をインストールし、作成したユーザーを docker グループに入れます。docker グループは実質 root 権限と同等です。',
  'postinstall.presetChronyNtpTitle': '時刻同期 (chrony) を入れる',
  'postinstall.presetChronyNtpDesc':
    'chrony をインストールして時刻を自動同期します。ログの時刻ずれや証明書エラーを防ぎます。',
  'postinstall.presetUfwAllowSshTitle': 'ファイアウォールを有効にして SSH だけ許可する',
  'postinstall.presetUfwAllowSshDesc':
    'ufw を有効にし、22/tcp のみ許可します。他のポートで待ち受けるサービスを後から入れる場合は自分で開放が必要です。',
  'postinstall.presetDisableCloudInitNetTitle': 'インストール後は cloud-init にネットワークを触らせない',
  'postinstall.presetDisableCloudInitNetDesc':
    '固定 IP を設定した物理サーバー向け。再起動のたびに cloud-init がネットワーク設定を書き戻すのを防ぎます。',
  'postinstall.presetJaLocaleTitle': '日本語ロケールと日本語マニュアルを入れる',
  'postinstall.presetJaLocaleDesc':
    'language-pack-ja と manpages-ja をインストールします。サーバーの表示は英語のままです。',

  // --- 確認 ---
  'review.yaml': '生成される設定ファイル',
  'review.issues': 'チェック結果',
  'review.noIssues': '問題は見つかりませんでした',
  'review.errorsFound': 'エラーがあります。修正してください。',
  'review.warningsFound': '注意事項があります',
  'review.export': '設定を書き出す',
  'review.exportProfile': 'プロファイル (JSON) を保存',
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
  'write.selectDevice': '書き込み先を選んでください',
  'write.noDevices': '対象になる USB メモリが見つかりません',
  'write.noDevicesHint': 'USB メモリを挿してから「再読み込み」を押してください',
  'write.refreshDevices': 'デバイスを再読み込み',
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

  // イメージファイル (.img) への書き出し。
  // デバイスへの書き込みと違い昇格しないので、権限の話は出さない。
  'image.statusPreparing': 'イメージファイルを準備しています',
  'image.pathNotChosen':
    'この保存先は選ばれていません。「保存先を選ぶ」からもう一度選んでください。',
  'image.sameAsIso':
    '選んだ ISO ファイルそのものには書き出せません（元のファイルが壊れます）。別の名前を選んでください。',
  'image.overwritesPayload':
    '展開するファイルとして使っている {path} には書き出せません（元のファイルが壊れます）。別の名前を選んでください。',
  'image.noSpace':
    '保存先の空き容量が足りません。{required} 必要ですが、空きは {free} です。別のドライブを選ぶか、空き容量を作ってから、もう一度実行してください。',
  'image.createFailed':
    'イメージファイルを作成できませんでした。保存先のフォルダに書き込めるか確認してください。',
  'image.cancelledLeftover':
    '書き出しを中止しましたが、書きかけのイメージファイルを削除できませんでした。{path} を手で削除してください（このファイルは起動しません）。',
  'image.errorLeftover':
    '{reason} さらに、書きかけのイメージファイルを削除できませんでした。{path} を手で削除してください（このファイルは起動しません）。',
  'image.doneSaved': '{path} に書き出しました。',

  // 書き込み画面に出す「イメージファイルとして保存」の導線。
  // 主導線（USB メモリへの書き込み）を弱めないよう、文面でも副次的な出口だと分かるようにする。
  'image.cardTitle': 'イメージファイル (.img) として保存',
  'image.cardHint':
    'USB メモリを挿さずに .img ファイルを作れます。あとから Rufus・balenaEtcher・dd で USB メモリに焼くと、このアプリで直接書いたものと同じになります。',
  'image.noElevation': '管理者権限は不要',
  'image.saveButton': 'イメージファイルとして保存…',
  'image.approxSize': 'できるファイルの大きさ: 約 {size}',
  'image.destination': '保存先: {path}',
  'image.needIso': 'ISO を選ぶと、イメージファイルも作れるようになります。',
  'image.needConfig': '「確認」のステップでエラーを直すと、イメージファイルを作れるようになります。',
  'image.doneTitle': 'イメージファイルができました',
  'image.doneBody':
    'このファイルを Rufus・balenaEtcher・dd で USB メモリに焼いてから、インストールしたいサーバーで起動してください。',
  'image.next1':
    'イメージファイルを Rufus・balenaEtcher・dd で USB メモリに焼き、インストールしたいサーバーに挿します。',
  'image.cancelledBody':
    '書きかけのイメージファイルは削除しました。もう一度やり直してください。',
  'write.noDevicesImage':
    'USB メモリが手元に無いときは、下の「イメージファイル (.img) として保存」で作れます。',

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
  'dialog.saveImage': 'イメージファイルの保存先を選ぶ',
  'dialog.filterImage': 'ディスクイメージ',
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

  // 選択肢のラベル（`provisioning.ts` の SHELL_CHOICES）
  'users.shellBash': 'bash（標準）',
  'users.shellSh': 'sh',
  'users.shellNologin': 'ログイン不可（サービス用）',

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
  'deploy.chownRecursiveHint':
    'オフでも、展開先ディレクトリそのものは上の所有者になります（中身はアーカイブが持っている所有者のまま）。オンにすると展開されたファイルもすべて変更します。',
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
  'service.workingDirectory': '作業ディレクトリ',
  'service.user': '実行ユーザー',
  'service.environment': '環境変数',
  'service.environmentHint': '1 行に 1 つ、KEY=VALUE の形式',
  'service.type': 'サービスの種類 (Type)',
  'service.restart': '異常終了時の再起動',
  'service.restartNo': '再起動しない',
  'service.restartOnFailure': '失敗したときだけ',
  'service.restartAlways': '常に',
  'service.restartSec': '再起動までの秒数',
  'service.after': '起動順序 (After)',
  'service.afterHint': 'カンマ区切り。例: network-online.target, docker.service',
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

  // 選択肢のラベル（`provisioning.ts` の CUDA_TOOLKIT_CHOICES）。
  // バージョン番号は製品名なので両言語で同じ。
  'gpu.toolkitLatest': '最新版 (cuda-toolkit)',
  'gpu.toolkitCuda133': 'CUDA 13.3',
  'gpu.toolkitCuda132': 'CUDA 13.2',
  'gpu.toolkitCuda131': 'CUDA 13.1',
  'gpu.toolkitCuda130': 'CUDA 13.0',
  'gpu.toolkitCuda129': 'CUDA 12.9',
  'gpu.toolkitCuda128': 'CUDA 12.8',
  'gpu.toolkitCuda126': 'CUDA 12.6',
  'gpu.toolkitNone': 'ツールキットを入れない（ドライバのみ）',

  // --- その他 ---
  'postinstall.aptFullUpgrade': '全パッケージを最新にする (apt full-upgrade)',
  'postinstall.aptFullUpgradeHint':
    'インストール直後に実行します。時間がかかりますが、初回起動時点で最新の状態になります。',
  'postinstall.tabPresets': 'よく使う設定',
  'postinstall.tabDeploy': 'アプリの展開',
  'postinstall.tabServices': 'サービス',
  'postinstall.tabFiles': 'ファイルとコマンド',
  'postinstall.tabAdvanced': '上級者向け',
  'postinstall.advancedHint':
    'インストーラが聞かない設定です。ふつうは開かなくてかまいません。',

  // --- 実行時に決める値（ホストごとに違う項目） ---
  //
  // このステップだけは「インストーラを一度でも通したことがある人」に前提が無い。
  // 起動メニューで値を差し替える仕組みは Ubuntu のインストーラには存在しないので、
  // 用語（kernel-arg / autoinstall.yaml）ではなく**目的**から書き起こす。
  'runtime.purposeTitle': 'このステップは何のためにあるか',
  'runtime.purposeBody':
    'USB を 1 本だけ作って何台にもインストールすると、ホスト名も IP アドレスも全台で同じになります。このステップは、その「機械ごとに違う値」だけを、USB を作り直さずに機械ごとに決められるようにするものです。台数ぶんの USB も、台数ぶんの設定ファイルも要りません。',
  'runtime.purposeSkip':
    '1 台だけインストールするなら、ここは既定（すべてこの設定の値を使う）のままで構いません。',
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

  // 選択肢のラベル（`advanced.ts` の KERNEL_FLAVORS / APT_FALLBACK_CHOICES）。
  // `adv.kernelFlavor` / `adv.aptFallback` は入力欄の見出しで、こちらは選択肢の名前。
  'adv.kernelFlavorGeneric': '標準 (generic)',
  'adv.kernelFlavorHwe': 'HWE（新しいハードウェア向け）',
  'adv.kernelFlavorGenericHwe': 'generic-hwe',
  'adv.kernelFlavorLowlatency': '低レイテンシ (lowlatency)',
  'adv.aptFallbackChoiceAbort': 'インストールを中止する（既定）',
  'adv.aptFallbackChoiceOffline': 'ネットワーク無しで続行する',
  'adv.aptFallbackChoiceContinue': '壊れたミラー設定のまま続行する',

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
  'migrate.category.raidDisk': 'RAID に使うディスク',
  'migrate.category.raidArray': 'RAID の配列',
  'migrate.field.raidLevel': 'RAID レベル (storage.raid.arrays[].level)',
  'migrate.field.raidRole': '配列の用途 (storage.raid.arrays[].role)',
  'migrate.field.raidDiskUsage': 'ディスクの使い方 (storage.raid.disks[].usage)',
  'migrate.field.raidRootFstype': 'root のファイルシステム (storage.raid.rootFstype)',
  'migrate.raidDiskRefDropped':
    'RAID の配列が指していたディスク {count} 件が見つからなかったため、その参照を外しました。台数が足りなくなっていないか確認してください。',
  'migrate.category.bondMember': 'bond に束ねるネットワークカード',
  'migrate.field.bondMode': 'bond のモード (network.parameters.mode)',
  'migrate.field.bondLacpRate': 'LACP の送信間隔 (network.parameters.lacpRate)',
  'migrate.field.bondAddressing': 'bond の IP アドレスの決め方 (network.addressing)',


  // --- 設定の検証（`validate.ts` の指摘） ---
  // ここは `ValidationIssue.text` が運ぶ。訳すのは renderer が描画するときだけ。
  // 文の中に差し込む「項目名」は入れ子の LocalizedText にする
  // （語順の違う言語でも成立させるため。ja と en で差し込み名の集合が揃う）。
  'validate.fieldOwner': '所有者',
  'validate.fieldGroup': 'グループ',
  'validate.hostFieldHostname': 'ホスト名',
  'validate.hostFieldIpv4': 'IP アドレス',
  'validate.hostFieldGateway': 'ゲートウェイ',
  'validate.hostFieldNameservers': 'DNS',
  'validate.hostFieldDisk': 'ディスク',

  'validate.unknownPreset': '知らない設定 "{id}" が含まれています。新しい版で作られたプロファイルかもしれません。',
  'validate.hostnameEmpty': 'ホスト名を入力してください。',
  'validate.hostnameInvalid': 'ホスト名は英数字とハイフンのみ、先頭と末尾は英数字、63 文字以内です。',
  'validate.localeEmpty': 'ロケールを選んでください。',
  'validate.keyboardEmpty': 'キーボード配列を選んでください。',
  'validate.usernameEmpty': 'ユーザー名を入力してください。',
  'validate.usernameInvalid': 'ユーザー名は小文字英字かアンダースコアで始まり、小文字英数字・ハイフン・アンダースコアのみ、32 文字以内です。',
  'validate.usernameReserved': '"{username}" はシステムが予約している名前です。別の名前にしてください。',
  'validate.usernameSameAsHostname': 'ユーザー名とホスト名が同じです。インストーラが拒否する場合があります。',
  'validate.passwordMissing': 'パスワードを設定してください（ハッシュ化して保存されます）。',
  'validate.passwordPlainText': 'パスワードが平文のままです。crypt(3) ハッシュ（$6$ で始まる文字列）が必要です。',
  'validate.passwordHashNotSha512': 'パスワードハッシュが SHA-512 crypt の標準形式ではありません。ログインできるか確認してください。',
  'validate.passwordHashMalformed': 'パスワードハッシュの形が崩れています（本体の長さか、使える文字が crypt(3) の形式と合いません）。Ubuntu 26.10 ではインストールの最後で失敗し、それより前のリリースではどのパスワードでもログインできません。パスワードを入力し直してください。',
  'validate.sshKeyMalformed': '{n} 番目の SSH 公開鍵の形式が正しくありません（"ssh-ed25519 AAAA..." のような 1 行）。',
  'validate.sshKeysWithoutServer': 'SSH 公開鍵を登録していますが SSH サーバーをインストールしない設定です。リモートログインできません。',
  'validate.sshHardenWithoutKeys': 'SSH のパスワード認証を無効にする設定ですが、公開鍵が 1 つも登録されていません。SSH でログインできなくなります。',
  'validate.sshNoPasswordNoKey': 'SSH のパスワードログインを許可せず、公開鍵も登録されていません。SSH でログインできなくなります。',
  'validate.networkAddressInvalid': 'IP アドレスは "192.168.1.10/24" のように、サブネットマスクの長さを付けて入力してください。',
  'validate.networkGatewayInvalid': 'ゲートウェイの IP アドレスが不正です。',
  'validate.networkGatewayMissing': 'デフォルトゲートウェイが未設定です。外部ネットワークに接続できません。',
  'validate.networkNameserverInvalid': 'DNS サーバー #{n} の IP アドレスが不正です。',
  'validate.networkNameserversMissing': 'DNS サーバーが未設定です。名前解決ができず apt が失敗します。',
  'validate.networkYamlSyntax': 'ネットワーク YAML の構文エラー: {detail}',
  // MAC は YAML 1.1 の 60 進数として読まれる。クォートしないと数になる（落とし穴 108）。
  'validate.networkYamlUnquotedMac':
    '{path} の MAC アドレスが数値として読まれます。YAML では 52:54:00:12:34:56 のような値は 60 進数と解釈されるため、"52:54:00:12:34:56" のように引用符で囲んでください（囲まないと netplan が失敗し、インストールが 1 バイトも書かずに止まります）。',
  // curtin は serial / wwn / path / model を udev の文字列と比べる。数だと一致しない（落とし穴 82 / 83）。
  'validate.storageYamlNumericSelector':
    '{path} が数値として読まれます。curtin はディスクの serial / wwn / path / model を文字列として比較するため、この指定はどのディスクにも一致しません（0x… は桁が落ち、0 で始まる値は八進数になります）。"…" のように引用符で囲んでください。',
  'validate.storageYamlSyntax': 'ストレージ YAML の構文エラー: {detail}',
  'validate.zfsEncryptionUnverified': 'ZFS レイアウトでの暗号化はインストーラのバージョンによって挙動が異なります。実機で確認してください。',
  'validate.encryptionPassphraseTooShort': 'ディスク暗号化のパスフレーズが短すぎます（8 文字以上）。',
  'validate.encryptionPassphrasePlainInYaml': 'ディスク暗号化のパスフレーズは、autoinstall の YAML と、保存・書き出したプロファイルに平文で入ります。USB とプロファイルのファイルの扱いに注意してください。',
  'validate.encryptionRequiresLvm': 'ディスク暗号化は LVM レイアウトでのみ使えます（{mode} では無視されます）。',
  'validate.wholeDiskRequiresLvm': 'ディスク全体を使う指定は LVM レイアウトでのみ使えます（{mode} では無視されます）。設定は残っていますが、この構成方法では画面に出ません。',
  'validate.diskMatchEmpty': 'ディスクの指定方法を選んだので、その値も入れてください（空だと一致するディスクがありません）。',
  'validate.diskMatchAny':
    'インストール先を「どのディスクでもよい」にしています。複数のディスクがある機器では、どれが消えるか分かりません。シリアル番号やパスで指定してください。',
  'validate.diskMatchSizeBased': '複数のディスクがある機器では、シリアル番号やパスで指定する方が安全です。',
  'validate.archiveFormatUnsupported': '展開 "{name}" のアーカイブ形式 "{format}" は対応していません。',
  'validate.fileOwnerNotCreated':
    'ファイル "{name}" の所有者 "{owner}" はこの設定では作成されません（既存のユーザーでなければ、インストールが最後の段階で失敗します）。',
  'validate.deploymentOwnerNotCreated':
    '展開 "{name}" の所有者 "{owner}" はこの設定では作成されません（既存のユーザーでなければ、インストールが最後の段階で失敗します）。',
  'validate.resetPartitionUnsupported': 'Ubuntu {series} にはリセットパーティションがありません（設定は無視されます）。',
  'validate.aptSourceNameInvalid': '追加リポジトリの名前 "{name}" が不正です（英数字と . _ - で書いてください）。',
  'validate.aptSourceNameDuplicated': '追加リポジトリの名前 "{name}" が重複しています（後のものが前のものを消します）。',
  'validate.aptFallbackUnsupported': 'Ubuntu {series} では「ミラーが使えないときの動作」を指定できません（無視されます）。',
  'validate.cudaToolkitNameInvalid': 'CUDA ツールキット名 "{toolkit}" が apt のパッケージ名として不正です。',
  'validate.fileOwnerInvalid': 'ファイル "{name}" の所有者 "{owner}" が不正です（ユーザー名、または user:group で書いてください）。',
  'validate.deploymentOwnerFieldInvalid': '展開 "{name}" の{field} "{value}" が不正です。',
  'validate.interfaceNameEmpty': 'ネットワークカードの名前が空です（netplan のキーになるので必須です）。',
  'validate.interfaceNameInvalid': 'ネットワークカードの名前 "{name}" が不正です（英字で始まり、英数字と . _ - のみ）。',
  'validate.macAddressInvalid': 'MAC アドレスは "aa:bb:cc:dd:ee:ff" の形式で入力してください。',
  'validate.aptMirrorUriEmpty': 'ミラーの URL を入力してください（空だと既定のミラーが使われます）。',
  'validate.overlayOverridesDangerousKeys':
    '上書き YAML が {keys} を書き換えています。画面のディスク・ユーザー設定は無効になり、ここに書いた内容が使われます。',
  'validate.packagesWithoutGateway': '追加パッケージ/snap を指定していますが、ゲートウェイが無いためインターネットに到達できません。',
  'validate.ubuntuProTokenInvalid': 'Ubuntu Pro のトークン形式が正しくありません（C で始まる 24〜30 文字）。',
  'validate.sourceKeyUnsupported':
    'Ubuntu {series} の autoinstall には source キーがありません。最小構成の指定は無視されます。',
  'validate.kernelCrashDumpsUnsupported': 'kernel-crash-dumps は Ubuntu {series} では未対応です。無視されます。',
  'validate.searchDriversUnsupported':
    'Ubuntu {series} の autoinstall には source キーがありません。ドライバの検索 (search_drivers) の指定は無視されます。',
  'validate.codecsUnsupported': 'codecs は Ubuntu {series} では使えません。無視されます。',
  'validate.oemUnsupported': 'oem は Ubuntu {series} では使えません。無視されます。',
  'validate.fileTargetPathNotAbsolute': '追加ファイル #{n} の配置先は絶対パスにしてください。',
  'validate.fileModeInvalid': '追加ファイル #{n} のパーミッションは 0644 のような 8 進数で指定してください。',
  'validate.fileNameInvalid': '追加ファイル #{n} のファイル名に使えない文字があります。',
  'validate.sudoNopasswdWarning': 'パスワード無し sudo を有効にしています。そのユーザーを奪われると即座に root 権限を取られます。',
  'validate.additionalUserNameEmpty': '追加ユーザー #{n} の名前が空です。',
  'validate.additionalUserNameInvalid': '追加ユーザー "{username}" の名前に使えない文字があります。',
  'validate.additionalUserNameReserved': '"{username}" はシステムが予約している名前です。',
  'validate.additionalUserNameDuplicated': 'ユーザー名 "{username}" が重複しています。',
  'validate.additionalUserPasswordPlainText': '追加ユーザー "{username}" のパスワードが平文のままです。',
  'validate.additionalUserPasswordHashMalformed': '追加ユーザー "{username}" のパスワードハッシュの形が崩れています。Ubuntu 26.10 ではインストールの最後で失敗し、それより前のリリースではどのパスワードでもログインできません。',
  'validate.additionalUserNoLogin': '"{username}" はパスワードも SSH 鍵も無いためログインできません（アカウントはロックされます）。',
  'validate.additionalUserSshKeyMalformed': '"{username}" の {n} 番目の SSH 公開鍵の形式が正しくありません。',
  'validate.additionalUserSudoNopasswd': '"{username}" はパスワード無しで sudo を使えます。',
  'validate.deploymentTargetPathNotAbsolute': '展開 #{n} の配置先は絶対パスにしてください。',
  'validate.deploymentNameInvalid': '展開 #{n} のファイル名に使えない文字があります。',
  'validate.deploymentModeInvalid': '展開 #{n} のパーミッションは 0644 のような 8 進数で指定してください。',
  'validate.deploymentUrlInvalid': '展開 #{n} の URL が正しくありません。',
  'validate.deploymentSha256Missing': '展開 #{n} は URL から取得しますが SHA-256 が未設定です。改ざんを検出できません。',
  'validate.deploymentSha256Invalid': '展開 #{n} の SHA-256 は 64 桁の 16 進数です。',
  'validate.deploymentSourceFileMissing': '展開 #{n} の元ファイルが選ばれていません。',
  'validate.serviceNameInvalid': 'サービス #{n} の名前が不正です（英数字と . _ - @ のみ、末尾に .service は付けません）。',
  'validate.serviceNameDuplicated': 'サービス名 "{name}" が重複しています。',
  'validate.serviceExecStartEmpty': 'サービス "{name}" の実行コマンドが空です。',
  'validate.serviceExecStartNotAbsolute':
    'サービス "{name}" の実行コマンドは絶対パスにしてください（systemd は PATH を解決しません）。',
  'validate.serviceUserNotCreated': 'サービス "{name}" が使うユーザー "{user}" はこの設定では作成されません。',
  'validate.serviceGroupNotCreated':
    'サービス "{name}" のグループ "{group}" はこの設定では作成されません（既存のグループなら問題ありません）。',
  'validate.serviceEnvironmentInvalid': 'サービス "{name}" の環境変数は KEY=VALUE の形式で書いてください。',
  'validate.cudaRepoMissingForSeries':
    'NVIDIA は Ubuntu {series} 向けの CUDA リポジトリを提供していません。LTS 版（22.04 / 24.04 / 26.04）を使ってください。',
  'validate.gpuNothingSelected': 'GPU 設定が有効ですが、ドライバもツールキットも選ばれていません。',
  'validate.containerToolkitWithoutDocker':
    'コンテナから GPU を使う設定ですが、Docker がインストールされません。「インストール後」で Docker を有効にしてください。',
  'validate.cudaDownloadsOnFirstBoot': 'CUDA は初回起動時にインターネットから数 GB をダウンロードします。完了後に自動で再起動します。',
  'validate.interactiveAllUnverified':
    'Ubuntu {series} では interactive-sections: ["*"] の展開が確認できていないため、この指定は出力しません。個別の項目を「インストーラの画面で入力する」に設定してください。',
  'validate.refreshChannelIgnored':
    'インストーラの更新が無効なので、チャンネルの指定は効きません（YAML には残ります）。更新を有効にしないと、この欄は画面に出ません。',
  'validate.rsyslogNotImplemented':
    'rsyslog への送信は subiquity にまだ実装がありません（公式リファレンスに明記）。進捗は届かない可能性があります。',
  'validate.interactiveSectionsUnsupported':
    'Ubuntu {series} には interactive-sections がありません。値が渡されなかったときに手入力へ切り替えることができず、既定値が使われます。',
  'validate.hostsWithoutKernelArgs':
    'ホストを {n} 件登録していますが、どの項目も「固定値」なので起動メニューは作られません。この一覧は使われません。',
  'validate.kernelArgsWithoutHosts':
    'カーネル引数で値を渡す設定ですが、ホストが 1 つも登録されていません。起動時に GRUB で e キーを押して自分で入力することになります。',
  'validate.hostLabelInvalid': 'ホスト #{n} の表示名に使えない文字があります（" $ 改行は使えません、40 文字まで）。',
  'validate.hostLabelDuplicated': 'ホスト名 "{label}" が重複しています。',
  'validate.hostHostnameInvalid': 'ホスト "{label}" のホスト名は英数字とハイフンで書いてください。',
  'validate.hostGatewayInvalid': 'ホスト "{label}" のゲートウェイは "192.168.1.1" のように書いてください。',
  'validate.hostNameserverInvalid': 'ホスト "{label}" の DNS "{ns}" は IP アドレスの形式ではありません。',
  'validate.hostDiskNotSerial': 'ホスト "{label}" のディスクにはシリアル番号を書いてください（"/dev/sda" のようなパスは一致しません）。',
  'validate.hostFieldEmpty': 'ホスト "{label}" の{field}が空です。',
  'validate.hostFieldInvalidChars': 'ホスト "{label}" の{field}に使えない文字が含まれています（英数字と . _ : / , - のみ）。',
  'validate.hostIpv4Invalid': 'ホスト "{label}" の IP アドレスは "192.168.1.10/24" のように書いてください。',
  'validate.grubMenuHostSelection':
    '起動時に GRUB のメニューからホストを選ぶと、その値が使われます。一覧に無いホストは e キーで引数を編集してください。',
  'validate.diskKernelArgWithRawStorage': 'ディスクをカーネル引数で渡す設定は、curtin の生 YAML と併用できません。',
  'validate.diskKernelArgWithRaidStorage':
    'ディスクをカーネル引数で渡す設定は、RAID + LVM の構成と併用できません。RAID は storage.config を出力するので、置換スクリプトが書き換える storage.layout がありません（反映できないためインストールは開始直後に中止されます）。',

  // --- RAID + LVM（落とし穴 65: 危険な設定ほど強い助言を出す） ---
  // 文の中に差し込む項目名は入れ子の LocalizedText にする（語順の違う言語でも成立させる）。
  'validate.raidFieldEsp': 'EFI システムパーティション (ESP)',
  'validate.raidFieldBoot': '/boot',
  'validate.raidFieldRoot': 'root',

  'validate.raidNoDisks': 'RAID に使うディスクが 1 台も登録されていません。',
  'validate.raidNeedsTwoDisks': 'RAID を組むにはディスクが 2 台以上必要です（いまは 1 台だけです）。',
  'validate.raidDiskIdInvalid':
    'ディスク #{n} の内部 ID が空か、他の行と重複しています。配列がどのディスクを指しているか決まりません。',
  'validate.raidDiskMatchEmpty':
    'ディスク #{n} のディスク指定が空か、読み取れませんでした。このままでは一致するディスクが 1 台もなく、インストールはディスクの段階で止まります。',
  'validate.raidMemberMatchNotSpecific':
    'ディスク #{n} の指定 ({kind}) では、どのディスクが選ばれるか決まりません。RAID では選んだディスクの中身がすべて消えるので、シリアル番号かデバイスのパスで 1 台ずつ指定してください。',
  'validate.raidNoBootDisk':
    '起動に使うディスクが 1 台もありません。EFI システムパーティションが作られないので、インストールしても起動できません。',
  'validate.raidSingleBootDisk':
    '起動に使うディスクが 1 台だけです。そのディスクが壊れると、RAID が生きていても起動できません。',
  'validate.raidNoArrays': 'RAID の配列が 1 つも定義されていません。',
  'validate.raidNoLvmArray':
    'LVM の物理ボリュームにする配列がありません。root を作る場所がないのでインストールできません。',
  'validate.raidMultipleBootArrays':
    '/boot にする配列が 2 つ以上あります。/boot は 1 か所にしかマウントできません。',
  'validate.raidNoDedicatedBootArray':
    '/boot 専用の配列がないので、/boot は LVM の中（root と同じ場所）に置かれます。GRUB は mdraid1x と lvm のモジュールでこれを読めることが多いのですが、この組み合わせは一次資料に記載がありません。確実にしたい場合は /boot 用の RAID1 を別に作ってください。',
  'validate.raidArrayNameEmpty': '配列 #{n} の名前が空です（md0 のように付けてください）。',
  'validate.raidArrayNameInvalid':
    '配列名 "{name}" が不正です（英数字で始まり、英数字と . _ - のみ、32 文字以内）。',
  'validate.raidArrayNameDuplicated': '配列名 "{name}" が重複しています。',
  'validate.raidUnknownDiskRef':
    '配列 "{name}" が、この設定には無いディスクを {count} 件指しています。台数が足りているか確認してください。',
  'validate.raidDiskDuplicatedInArray':
    '配列 "{name}" に同じディスクが 2 回入っています（本体とスペアの両方に入れた場合も含みます）。',
  'validate.raidDiskInTwoArraysOfSameRole':
    '配列 "{name}" のディスクが、同じ用途の別の配列にも入っています。そのディスクにどちらのパーティションを作るか決まりません。',
  'validate.raidTooFewDevices':
    '配列 "{name}" は {level} なのにディスクが {have} 台しかありません（{need} 台以上必要です）。',
  'validate.raidLevel0NoRedundancy':
    '配列 "{name}" は RAID0 です。1 台でも壊れると配列全体のデータが失われます。',
  'validate.raidSparesIgnoredForLevel0':
    '配列 "{name}" は RAID0 なのでスペアは使われません（無視されます）。',
  'validate.raidBootArrayWithoutEspDisk':
    '配列 "{name}" のメンバーに、EFI システムパーティションを作るディスクが 1 台もありません。起動はブートローダのあるディスクから始まり、そこから /boot を読みます。/boot をまったく別のディスク群に置くと、その配列が 1 台落ちただけで起動できなくなることがあります。',
  'validate.raidWholeDiskEsp':
    'ディスク #{n} は「丸ごとを 1 つのメンバーにする」設定なのに、EFI システムパーティションを作ることになっています。パーティションテーブルを作らないので置き場所がありません。ESP を外すか、使い方を「パーティションを切って使う」に戻してください。',
  'validate.raidWholeDiskInBootArray':
    '配列 "{name}"（/boot 用）に、「丸ごとを 1 つのメンバーにする」ディスクが {count} 台入っています。そのディスクにはパーティションを切らないので、/boot 用の領域を作れません。使い方を「パーティションを切って使う」に戻すか、この配列から外してください。',
  'validate.raidArrayNotMounted':
    '配列 "{name}" は組み立てるだけで、フォーマットもマウントもされません。インストール後に自分でファイルシステムを作って /etc/fstab に足してください（意図した設定ならこのままで問題ありません）。',
  'validate.raidDiskUnused':
    'ディスク #{n} はどの配列でも使われず、起動にも使いません。何にも使わないディスクを消さないよう、このディスクには一切書き込みません。',
  'validate.raidWipesAllMemberDisks':
    'RAID に使う {count} 台のディスクは、中身がすべて消去されます。台数が多いぶん取り返しがつきません。シリアル番号を 1 台ずつ確認してください。',
  'validate.raidSizeInvalid':
    '{field} のサイズ "{value}" が不正です（4G や 512M のように指定してください）。',
  'validate.raidVolumeGroupNameInvalid':
    'ボリュームグループ名 "{name}" が不正です（英数字と + _ . - のみ、先頭に - は使えません）。',
  'validate.raidRootNameInvalid':
    'root の論理ボリューム名 "{name}" が不正です（英数字と + _ . - のみ、先頭に - は使えません）。',
  'validate.raidGrubMirrorUnverified':
    '2 台目以降の起動ディスクへのブートローダの複製は、インストール後に /var/log/autoinstall-raid-esp.log に結果が残ります。この手順はまだ実機で検証していないので、1 台目を抜いた状態で起動できるか必ず確かめてください。',
  // ESP を作るディスクが「マウントされる FS」を 1 つも支えていないと、
  // late-command の絞り込み（落とし穴 114）から外れて複製が届かない。
  'validate.raidGrubMirrorUnreachableDisk':
    'EFI システムパーティションを作るディスクのうち {count} 台が、/ や /boot のどの配列にも入っていません。ブートローダの複製はインストール先が実際に使うディスクにしか行われないため、この {count} 台には複製されません（1 台目が壊れたとき起動できません）。そのディスクを / か /boot の RAID に入れるか、EFI システムパーティションを作らない設定にしてください。',
  'validate.raidGrubOnlyOnFirstDisk':
    'ブートローダを入れるのは 1 台目の起動ディスクだけです。そのディスクが壊れると、RAID が生きていても起動できません。',
  'validate.raidMatchIgnored':
    'RAID + LVM では「どのディスクにインストールするか」の指定は使われません（無視されます）。使われるのは RAID の設定にあるディスクの一覧です。',
  'validate.raidResetPartitionIgnored':
    'リセットパーティションは RAID + LVM では作られません（無視されます）。',

  // --- bond ---
  'validate.bondNameEmpty': 'bond の名前を入力してください（例: bond0）。',
  'validate.bondNameInvalid':
    'bond の名前 "{name}" が不正です（英字で始まり、英数字と _ . - のみ、15 文字以内）。',
  'validate.bondNeedsTwoMembers':
    'bond には 2 枚以上のネットワークカードが必要です（いまは {count} 枚）。1 枚では冗長化にも帯域の合算にもなりません。',
  'validate.bondMemberNameEmpty':
    'ネットワークカード {n} の名前が空です。束ねる NIC を指定してください。',
  'validate.bondMemberNameInvalid':
    'ネットワークカード {n} の名前 "{name}" が不正です（英字で始まり、英数字と _ . - のみ）。',
  'validate.bondMemberMacInvalid':
    'ネットワークカード {n} の MAC アドレスが不正です（例: 52:54:00:12:34:56）。',
  'validate.bondMemberUnreadable':
    'ネットワークカード {n} の指定を読み取れませんでした。指定し直してください。このままでは、どの NIC にも一致しない設定が出力されます。',
  'validate.bondMemberDuplicated':
    'ネットワークカード {n} は同じ NIC を 2 回指しています。netplan は 1 枚として扱うので、2 枚あるつもりの冗長化が 1 枚になります。',
  'validate.bondMemberAny':
    'ネットワークカード {n} が「すべての有線 LAN」になっています。どの NIC が束ねられるかは実機まで分からず、管理用に残したい NIC まで巻き込みます。名前か MAC で指定してください。',
  'validate.bondMemberKeyIsBondName':
    '束ねるネットワークカードの名前が bond の名前 "{name}" と同じです。netplan のデバイス名は重複できません。',
  'validate.bondModeInvalid': 'bond のモード "{value}" は使えません。',
  'validate.bondAddressingInvalid':
    'bond の IP アドレスの決め方 "{value}" は使えません。このままでは DHCP として扱われます。',
  'validate.bondModeNeedsSwitchConfig':
    '{mode} はスイッチ側でも LACP を設定しておく必要があります。設定されていないとリンクが上がらず、インストール後に通信できません。',
  'validate.bondLacpRateIgnored':
    'LACP の送信間隔は 802.3ad のときだけ効きます。いまのモード ({mode}) では出力されません。',
  'validate.bondHashPolicyIgnored':
    '振り分けの方法 (transmit-hash-policy) は balance-xor と 802.3ad のときだけ効きます。いまのモード ({mode}) では出力されません。',
  'validate.bondHashPolicyInvalid':
    '振り分けの方法 "{value}" が不正です（小文字の英数字を + や - でつないだ形。例: layer2, layer3+4）。',
  'validate.bondMiiMonitorInvalid':
    'リンク監視の間隔 "{value}" が不正です。0 以上の整数（ミリ秒）を入力してください。',
  'validate.bondMiiMonitorDisabled':
    'リンク監視の間隔が 0（監視しない）です。ケーブルが抜けても bond は気づかず、待機側に切り替わりません。実運用では 100 程度にしてください。',
  'validate.bondTargetIgnored':
    'bond では「対象のネットワークカード」の指定は使われません（無視されます）。束ねる NIC は bond の設定で指定します。',
  'validate.networkKernelArgWithRawNetplan': 'IP をカーネル引数で渡す設定は、netplan の生 YAML と併用できません。',
  'validate.networkKernelArgNeedsStatic':
    'IP を起動メニューで決める場合は、ネットワークの設定を「固定 IP」にして既定値も入れてください。引数なしで起動されたときに使われます。',
  'validate.defaultGatewayMissingForKernelArg':
    'ゲートウェイが空です。引数なしで起動した機械は外部と通信できません（閉じたネットワークなら問題ありません）。',
  'validate.defaultNameserversMissingForKernelArg':
    'DNS が空です。引数なしで起動した機械は名前解決ができません（閉じたネットワークなら問題ありません）。',
  'validate.diskKernelArgNeedsSerialMatch':
    'ディスクを起動メニューで決める場合は、ディスクの指定方法を「シリアル番号」にして既定値も入れてください。引数なしで起動されたときに使われます。',
  'validate.interactiveAllOverridesKernelArgs': 'すべての画面を出す設定なので、カーネル引数で渡した値は「既定値」として表示されるだけになります。',
  'validate.kernelFlavorEmpty': 'カーネルの flavor を入力してください。',
  'validate.kernelPackageEmpty': 'カーネルのパッケージ名を入力してください。',
  'validate.oemConflictsWithKernel': 'OEM メタパッケージはカーネルを入れ替えることがあり、カーネル指定と競合してインストールが失敗する場合があります。',
  'validate.aptSourceEmpty': '追加リポジトリ #{n} が空です。',
  'validate.aptSourceFormatInvalid':
    '追加リポジトリ #{n} は "ppa:user/name" か "deb https://... " の形式で書いてください。',
  'validate.aptSourceKeyMissing': '追加リポジトリ #{n} に GPG 公開鍵が設定されていません。署名検証ができず apt が失敗する可能性があります。',
  'validate.preserveSourcesListIgnoresMirror': 'sources.list を書き換えない設定なので、指定したミラーは反映されません。',
  'validate.swapSizeInvalid': 'swap のサイズは 4G のように書いてください。',
  'validate.resetPartitionSizeInvalid': 'リセットパーティションのサイズは 12G のように書いてください。',
  'validate.identityGroupsUnsupported':
    'identity.groups は Ubuntu 26.04 で追加された項目です。{series} では無視されます。',
  'validate.groupOverrideWithoutSudo': 'グループを上書きする設定で sudo が含まれていません。管理者ユーザーが sudo を使えなくなります。',
  'validate.activeDirectoryUnsupported': 'active-directory は Ubuntu {series} では使えません。無視されます。',
  'validate.adDomainNameEmpty': 'ドメイン名を入力してください。',
  'validate.adAdminNameEmpty': 'ドメイン参加に使う管理者名を入力してください。',
  'validate.adPasswordPrompt': 'AD 参加のパスワードは設定ファイルに書けず、インストール中に入力を求められます。完全無人にはなりません。',
  'validate.webhookUrlInvalid': 'Webhook の URL が正しくありません。',
  'validate.rsyslogDestinationEmpty': 'rsyslog の送信先を入力してください（例: @192.168.0.1）。',
  'validate.reportingIgnoredWhenInteractive': '対話セクションがある場合、インストーラは reporting の設定を無視します。',
  'validate.kernelArgsSpecialChars': 'カーネル引数に grub.cfg で特別な意味を持つ文字 (" # $ \' { } \\ < > `) は使えません。',
  'validate.kernelArgsCommandChars': 'カーネル引数に ; & | は使えません（GRUB の設定行が壊れます）。',
  'validate.interactiveSectionsPause': '対話セクションが指定されているため、インストールは途中で入力待ちになります。',

  'validate.grubMenuTooLarge':
    '起動メニューが 1 セクタ (2048 バイト) に収まりません（あと {bytes} バイト超過）。ホストの件数を減らすか、メニュー名を短くしてください。',

  // --- ナビゲーション（サイドバーのグループ分けと 1 行の要約） ---
  //
  // 要約はサイドバーに出す「いまの設定」。**既定のままであることが一目で分かる**
  // ことが目的なので、既定のときは必ず `nav.summaryDefault` で包む
  // （中身は入れ子の `LocalizedText` として差し込む）。
  // 折りたたんだものが何に設定されているか分からないのは、折りたたまないより悪い。
  'nav.groupRequired': '必ず設定する',
  'nav.groupRequiredHint': 'インストーラが必ず聞くことです。',
  'nav.groupOptional': '必要なら変える',
  'nav.groupOptionalHint': '既定のままでも動きます。',
  'nav.groupExtra': 'このツールが足すこと',
  'nav.groupExtraHint': 'インストーラには無い機能です。既定では何もしません。',
  'nav.groupFinish': '仕上げ',
  'nav.groupFinishHint': '設定を確かめて USB に書きます。',

  'nav.changedCount': '{n} 件変更',
  'nav.summaryDefault': '既定のまま（{detail}）',
  'nav.summaryUnknown': '読み取れない設定（{value}）',
  'nav.summaryJoin2': '{a}・{b}',
  'nav.summaryJoin3': '{a}・{b}・{c}',
  'nav.summaryJoin4': '{a}・{b}・{c}・{d}',
  'nav.summaryMore': 'ほか {n} 件',
  'nav.summaryOther': 'その他 {n} 件',
  // このリリースの subiquity が知らないキーは `generate.ts` が出力しない。
  // 断片を黙って消すと「設定したのに効かない」に気づけないので、件数だけ必ず言う。
  'nav.summaryIneffective': 'このリリースでは効かない設定が {n} 件',

  // 管理ユーザー（`user` ステップ）。**平文パスワードもハッシュも出さない。**
  // 出すのは「誰でログインするか」「どうやって入るか」だけ。
  'nav.summaryUserName': 'ユーザー {name}',
  'nav.summaryUserNameMissing': 'ユーザー名 未設定',
  'nav.summarySshOn': 'SSH 有効',
  'nav.summarySshOff': 'SSH 無効',
  'nav.summarySshKeyOnly': '公開鍵のみ',
  'nav.summarySshKeys': '公開鍵 {n} 件',
  'nav.summaryGroupsAppend': 'グループを追加',
  'nav.summaryGroupsOverride': 'グループを置き換え',
  'nav.summarySudoNoPassword': 'sudo にパスワード不要',

  'nav.summaryNetworkInstallerDefault': 'DHCP（自動）',
  // 以前は「DHCP（NIC を指定）」と**断定**していたが、要約は `network.target` を
  // 読んでいなかった。既定の `{kind:'any'}`（すべての NIC）でも「指定」と出る嘘になる。
  // 対象は入れ子で差し込む。読み取れない指定もそこに入れる（黙って既定に見せない）。
  'nav.summaryNetworkDhcp': 'DHCP（{target}）',
  'nav.summaryTargetAny': 'すべての NIC',
  'nav.summaryTargetName': 'NIC {name}',
  'nav.summaryTargetMac': 'MAC {mac}',
  'nav.summaryNetworkStatic': '静的 IP {address}',
  'nav.summaryNetworkRaw': 'netplan を直接指定',

  'nav.summaryStorageRaw': 'curtin を直接指定',
  'nav.summaryDiskLargest': '最大のディスク',
  'nav.summaryDiskSmallest': '最小のディスク',
  'nav.summaryDiskSsd': 'SSD を優先',
  'nav.summaryDiskAny': '任意のディスク',
  'nav.summaryDiskPath': 'パス {path}',
  'nav.summaryDiskSerial': 'シリアル {serial}',
  'nav.summaryDiskModel': 'モデル {model}',
  'nav.summaryLayoutLvm': 'LVM',
  'nav.summaryLayoutDirect': 'そのまま',
  'nav.summaryLayoutZfs': 'ZFS',
  'nav.summaryEncryptionOn': '暗号化あり',
  'nav.summaryEncryptionOff': '暗号化なし',
  'nav.summaryWholeDisk': 'ディスク全体を使用',
  'nav.summarySwapCustom': 'swap を指定',
  'nav.summaryPartitionTable': 'パーティション表 {table}',
  'nav.summaryResetPartition': 'リセット領域あり',

  'nav.summarySoftwareNone': '追加なし',
  'nav.summaryPackages': 'パッケージ {n} 件',
  'nav.summarySnaps': 'snap {n} 件',
  'nav.summarySourceMinimal': '最小構成',
  'nav.summaryUpdatesAll': 'すべての更新',
  'nav.summaryDrivers': 'ドライバ自動導入',
  'nav.summaryGpuOn': 'GPU 有効',
  'nav.summaryKernelCustom': 'カーネル指定',
  'nav.summaryUbuntuPro': 'Ubuntu Pro',
  'nav.summaryMirrorCustom': 'ミラー指定',
  'nav.summaryAptSources': '追加リポジトリ {n} 件',

  'nav.summaryPostInstallNone': '何もしない',
  'nav.summaryPresets': 'よくある設定 {n} 件',
  'nav.summaryFiles': 'ファイル {n} 件',
  'nav.summaryUsers': '追加ユーザー {n} 件',
  'nav.summaryDeployments': '展開 {n} 件',
  'nav.summaryServices': 'サービス {n} 件',
  'nav.summaryCommands': 'コマンド {n} 件',
  'nav.summaryFullUpgrade': '全体を更新',
  'nav.summaryDebconf': 'debconf 指定',
  'nav.summaryActiveDirectory': 'AD 参加',
  'nav.summaryReporting': '進捗の送信先を指定',
  'nav.summaryRefreshInstaller': 'インストーラを更新',
  'nav.summaryRefreshChannel': 'インストーラを更新（チャンネル指定）',
  'nav.summaryInteractiveAll': '全画面で入力を待つ',
  'nav.summaryRawOverlay': 'YAML で上書き',
  'nav.summaryExtraKernelArgs': 'カーネル引数を追加',
  'nav.summaryNoLogCollect': '失敗ログを集めない',

  'nav.summaryRuntimeFixed': 'すべて固定値',
  'nav.summaryRuntimeKernelArg': '{field}を起動メニューで選ぶ',
  'nav.summaryRuntimeInteractive': '{field}をインストーラで入力',
  'nav.summaryRuntimeFieldHostname': 'ホスト名',
  'nav.summaryRuntimeFieldNetwork': 'ネットワーク',
  'nav.summaryRuntimeFieldDisk': 'ディスク',
  'nav.summaryRuntimeHosts': 'ホスト {n} 件',

  'nav.readyTitle': 'ここまでで足ります',
  'nav.readyBody':
    'あとは既定のままでよければ、そのまま確認へ進めます。ネットワークやディスクは、あとから戻って変えられます。',
  'nav.readyButton': '確認へ進む',

  // --- エラー ---
  'error.isoTooBig': 'USB メモリの容量が足りません',
  'error.unknown': '予期しないエラーが発生しました',
  // --- 生成する YAML のコメント（画面ではなく生成物に入る） ---
  'yaml.header.title': 'Ubuntu Server 自動インストール設定 (autoinstall)',
  'yaml.header.generated': '生成: {tool} / プロファイル: {profile}',
  'yaml.header.target': '対象: Ubuntu Server {series}',
  'yaml.header.magic': '先頭の #cloud-config 行は cloud-init が必須とする目印です。消さないでください。',
  'yaml.comment.version': 'autoinstall 設定の形式バージョン。現在は 1 のみ。',
  'yaml.comment.interactive': 'ここに書いたセクションはインストーラが画面で質問します（空なら完全自動）。',
  'yaml.comment.locale': 'インストール後のシステムロケール。',
  'yaml.comment.keyboard': 'キーボード配列。layout は必須、variant は配列の派生（無ければ空）。',
  'yaml.comment.timezone': 'タイムゾーン。geoip にすると IP アドレスから自動判定します。',
  'yaml.comment.refreshInstaller': 'インストーラ本体を snap store から最新版に更新するか。ネットワークが必要です。',
  'yaml.comment.source': 'インストールする範囲。ubuntu-server=標準、ubuntu-server-minimal=最小構成。',
  'yaml.comment.network': 'ネットワーク設定（netplan v2 形式）。インストール中と再起動後の両方に使われます。',
  'yaml.comment.proxy': 'APT が使う HTTP プロキシ。',
  'yaml.comment.apt': 'パッケージの取得元。ミラーが遅い/届かないとインストールが長時間止まります。',
  'yaml.comment.storage': 'ディスクの使い方。ここで指定したディスクの中身は完全に消去されます。',
  'yaml.comment.identity': '最初に作る管理ユーザー。password は crypt(3) ハッシュ（平文は使えません）。',
  'yaml.comment.ssh': 'SSH の設定。install-server を true にすると openssh-server が入ります。',
  'yaml.comment.packages': '追加でインストールする deb パッケージ。ネットワークが必要です。',
  'yaml.comment.snaps': '追加でインストールする snap。ネットワークが必要です。',
  'yaml.comment.updates': 'インストール時に適用する更新。security=セキュリティのみ、all=全部。',
  'yaml.comment.drivers': 'サードパーティのドライバ（NVIDIA 等）を自動で入れるか。',
  'yaml.comment.kernelCrashDumps': 'カーネルクラッシュダンプ (kdump) を有効にするか。',
  'yaml.comment.ubuntuPro': 'Ubuntu Pro のトークン。付けると ESM などが有効になります。',
  'yaml.comment.lateCommands': 'インストール完了後・再起動前に実行するコマンド。curtin in-target で新システム内で動きます。',
  'yaml.comment.errorCommands': 'インストールが失敗したときに実行するコマンド（ログ収集などに使います）。',
  'yaml.comment.userData': 'インストール後の初回起動時に cloud-init が実行する設定。',
  'yaml.comment.shutdown': 'インストール後の動作。reboot=再起動、poweroff=電源を切る。',
  'yaml.comment.reporting': 'インストール進捗の出力先。',
  'yaml.comment.kernel': 'インストール先に入れるカーネル。hwe は新しいハードウェア向け。',
  'yaml.comment.debconf': 'debconf の質問に先回りして答える設定。',
  'yaml.comment.activeDirectory': 'Active Directory ドメインへの参加。パスワードはインストール中に聞かれます。',
  'yaml.comment.codecs': 'multiverse の制限付きパッケージ (ubuntu-restricted-addons) を入れるか。',
  'yaml.comment.oem': 'OEM メタパッケージを入れるか。カーネルが変わることがあります。',
  'yaml.comment.earlyCommands': 'インストーラ起動直後に実行するコマンド。ここで設定自体を書き換えられます。',
  // --- このアプリについて / メニュー ---
  'about.open': 'このアプリについて',
  'about.title': '{app} について',
  'about.version': 'バージョン {version}',
  'about.license': 'MIT ライセンスのオープンソースソフトウェアです。Copyright (c) 2026 UnlitCube',
  'about.noWarranty': '無保証で提供されます。このツールは書き込み先の USB メモリを消去します。作った USB で起動した機械は、操作しなければインストール先のディスクを確認なしで消去します。',
  'about.disclaimer': 'Seedstick は独立したオープンソースソフトウェアで、Canonical Ltd. とは提携・承認・後援の関係にありません。Ubuntu および Canonical は Canonical Ltd. の登録商標です。',
  'about.noImages': 'Ubuntu のイメージは同梱していません。公式サイトから入手した ISO を、この PC の上で使います。',
  'about.trademarks': 'Windows は Microsoft グループの商標です。Apple と macOS は Apple Inc. の商標です。NVIDIA と CUDA は NVIDIA Corporation の商標です。その他の名称は各社の商標です。',
  'about.website': 'Web サイト',
  'about.source': 'ソースコード',
  'about.issues': '不具合の報告',
  'about.licenseText': 'ライセンス全文',
  'about.notices': '第三者のライセンス',
  'about.openFailed': 'ファイルを開けませんでした。',
  'menu.about': '{app} について',
  'menu.hide': '{app} を隠す',
  'menu.hideOthers': 'ほかを隠す',
  'menu.showAll': 'すべてを表示',
  'menu.quit': '{app} を終了',
  'menu.edit': '編集',
  'menu.undo': '取り消す',
  'menu.redo': 'やり直す',
  'menu.cut': 'カット',
  'menu.copy': 'コピー',
  'menu.paste': 'ペースト',
  'menu.selectAll': 'すべてを選択',
  'menu.window': 'ウインドウ',
  'menu.minimize': 'しまう',
  'menu.zoom': '拡大／縮小',
  'menu.close': '閉じる',
  'review.commentLanguage': 'YAML のコメント:',
  'review.commentLanguageUi': '表示言語に合わせる',
  'review.commentLanguageNone': '付けない',
  'image.redistributionNotice': 'このイメージは Ubuntu の公式 ISO に設定を書き加えたものです。自分や所属組織の中で使うのは問題ありませんが、第三者への配布・公開はしないでください（Canonical の知的財産ポリシーは、改変した Ubuntu を同社の商標とともに再配布することを認めていません）。',
} as const

export type MsgKey = keyof typeof ja
