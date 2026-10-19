// 「ホストごとに違う値」をインストール時に決めるための仕組み。
//
// 実現手段は 2 つあり、項目ごとに選べる:
//
//   interactive … autoinstall の `interactive-sections` に該当セクションを入れる。
//                 インストーラが通常の画面を出し、プロファイルの値が既定値として入る。
//                 公式仕様なのでいちばん確実。粒度はセクション単位。
//
//   kernel-arg  … YAML にプレースホルダを埋め、`early-commands` が /proc/cmdline から
//                 値を拾って /autoinstall.yaml を書き換える。項目単位で指定でき、
//                 GRUB メニューから選ぶだけで済む。
//
// kernel-arg が成立する根拠（autoinstall リファレンス）:
//   "The autoinstall configuration is available at /autoinstall.yaml (irrespective of how
//    it was provided), and the file is re-read after the early-commands have run to allow
//    them to alter the configuration if necessary."
// subiquity の server.py も「早期コマンドが interactive-sections を変えることがある」と
// コメントしており、書き換えは想定された使い方。

/** 実行時に値を決めるかどうか。 */
export type RuntimeValueMode =
  /** プロファイルの値をそのまま使う */
  | 'fixed'
  /** GRUB のカーネル引数で渡す（メニューから選ぶ、またはその場で入力） */
  | 'kernel-arg'
  /** インストーラの画面で手入力する */
  | 'interactive'

/** 実行時に決められる項目。 */
export type RuntimeField = 'hostname' | 'network' | 'disk'

export const RUNTIME_FIELDS: readonly RuntimeField[] = ['hostname', 'network', 'disk']

/** その項目を interactive にしたときに `interactive-sections` へ入れるセクション名。 */
export const RUNTIME_FIELD_SECTION: Record<RuntimeField, string> = {
  hostname: 'identity',
  network: 'network',
  disk: 'storage',
}

/** GRUB メニューに並べる「ホスト」。選ぶだけでその値が使われる。 */
export interface HostPreset {
  readonly id: string
  /** メニューに出す名前（例 `web01`） */
  readonly label: string
  readonly hostname: string
  /** CIDR 表記（例 `192.168.1.11/24`） */
  readonly ipv4: string
  readonly gateway: string
  /** カンマ区切り */
  readonly nameservers: string
  /** ディスクのシリアルまたはパス */
  readonly disk: string
}

export interface RuntimeValuesConfig {
  readonly hostname: RuntimeValueMode
  readonly network: RuntimeValueMode
  readonly disk: RuntimeValueMode
  /** GRUB メニューに並べるホスト一覧 */
  readonly presets: readonly HostPreset[]
  /** 「インストーラで手入力する」メニュー項目も出す */
  readonly offerInteractiveEntry: boolean
}

export function createDefaultRuntimeValues(): RuntimeValuesConfig {
  return {
    hostname: 'fixed',
    network: 'fixed',
    disk: 'fixed',
    presets: [],
    offerInteractiveEntry: true,
  }
}

// ---------------------------------------------------------------------------
// プレースホルダ
// ---------------------------------------------------------------------------

/** カーネル引数の名前（`ai.` 接頭辞を付ける）。 */
export const KERNEL_ARG = {
  hostname: 'ai.hostname',
  ipv4: 'ai.ipv4',
  gateway: 'ai.gw',
  nameservers: 'ai.dns',
  disk: 'ai.disk',
  interactive: 'ai.interactive',
} as const

/**
 * カーネル引数に入れてよい文字。
 * GRUB の設定行とシェルの両方を通るので、区切り文字になりうるものは全部禁止する。
 * ホスト名・IP・CIDR・デバイスパス・シリアルはこの範囲で表せる。
 */
const SAFE_VALUE_RE = /^[A-Za-z0-9._:/,-]+$/

export function isSafeRuntimeValue(value: string): boolean {
  return SAFE_VALUE_RE.test(value)
}

/** GRUB メニューのラベルに使える文字か（" と改行を禁止）。 */
export function isSafePresetLabel(label: string): boolean {
  return label.length > 0 && label.length <= 40 && !/["\r\n$]/.test(label)
}

// ---------------------------------------------------------------------------
// 置換スクリプト（early-commands）
// ---------------------------------------------------------------------------

/**
 * `/autoinstall.yaml` を **YAML として読み書きして** カーネル引数の値を反映する。
 *
 * かつては sed でテキスト置換していたが、次の理由で成立しない:
 *   - subiquity は設定を PyYAML で書き直すので、こちらが出した引用形式は保たれない。
 *     `@@AI_X@@` は `@` が YAML の予約文字なので必ずクォートされ、中身だけ置換すると
 *     `interactive-sections: [""]` のような「空文字 1 要素」が残る。
 *     subiquity は `bool(["")` を真と見るので、無人インストールのはずが対話扱いになる。
 *   - DNS のように「複数値」を入れたい場所を 1 個のスカラーに押し込めてしまう。
 *   - 置換文字列に `"` や `&` が入ると sed とシェルの両方が壊れる（コマンド注入になる）。
 *
 * YAML を構造として扱えばどれも起きない。値は base64 の JSON で渡すので、
 * プロファイル由来の文字列がシェルにも Python ソースにも一切混ざらない。
 */
export interface SubstitutionDefaults {
  /** 引数が無いときのホスト名 */
  readonly hostname: string
  /** 書き換える `network.ethernets` のキー */
  readonly interfaceKey: string
  /** `ai.interactive=1` のときに対話にするセクション */
  readonly interactiveOnDemand: readonly string[]
  /** 実行時に決める項目。渡された引数のうちここが false のものは無視する。 */
  readonly fields: {
    readonly hostname: boolean
    readonly network: boolean
    readonly disk: boolean
  }
}

/** カーネル引数から来た値として許す文字（Python 側でも同じ判定をする）。 */
const SAFE_VALUE_PATTERN = '^[A-Za-z0-9._:/,-]+$'

/**
 * 「その項目は無し」を表す値。
 *
 * ゲートウェイや DNS を空欄にしたホストで引数自体を省くと、
 * プロファイルの既定値をそのまま引き継いでしまう（自分のサブネットに無い
 * ゲートウェイが既定経路になる）。空欄は「無し」だと明示して渡す。
 * IP アドレスとして解釈されえない語なので取り違えは起きない。
 */
export const NONE_VALUE = 'none'

/**
 * 実際に走らせる Python。読めば何をしているか分かる形にしておく
 * （生成された YAML はユーザーが確認画面で読むため）。
 *
 * 値は環境変数ではなく base64+JSON で渡す。`AI_DATA` の中身は
 * `[A-Za-z0-9+/=]` しか含まないので、シェルにも Python にも解釈されない。
 */
function pythonSource(): string {
  return [
    'import base64, json, os, re, sys',
    'try:',
    '    import yaml',
    'except ImportError:',
    '    sys.stderr.write("seedstick: PyYAML not found\\n")',
    '    sys.exit(1)',
    '',
    'D = json.loads(base64.b64decode(os.environ["AI_DATA"]).decode("utf-8"))',
    'conf = os.environ.get("AI_CONF", "/autoinstall.yaml")',
    'cmdline = os.environ.get("AI_CMDLINE", "/proc/cmdline")',
    '',
    '# /proc/cmdline is space separated. Pick up ai.* only, and only allowed characters.',
    `SAFE = re.compile("${SAFE_VALUE_PATTERN}")`,
    `NONE = "${NONE_VALUE}"`,
    'args = {}',
    '# A value with forbidden characters is not silently dropped but counted.',
    '# Otherwise a typo made with the GRUB e key would install every machine',
    '# with the profile defaults.',
    'rejected = []',
    'with open(cmdline, "r", encoding="utf-8", errors="replace") as fh:',
    '    for token in fh.read().split():',
    '        if "=" not in token:',
    '            continue',
    '        key, _, value = token.partition("=")',
    '        if not key.startswith("ai."):',
    '            continue',
    '        if SAFE.match(value):',
    '            args[key] = value',
    '        else:',
    '            rejected.append(key)',
    '',
    'if rejected:',
    '    sys.stderr.write(',
    '        "seedstick: boot parameters contain characters that are not allowed: %s\\n" % ", ".join(sorted(set(rejected)))',
    '    )',
    '    sys.stderr.write("seedstick: only letters, digits and . _ : / , - are allowed. Fix the GRUB entry.\\n")',
    '    sys.exit(1)',
    '',
    'if not args:',
    '    sys.exit(0)',
    '',
    '# Which parameters were actually applied. If one was given but has no place to go,',
    '# continuing silently would give every machine the same IP / disk. Stop instead.',
    'applied = set()',
    '',
    'with open(conf, "r", encoding="utf-8") as fh:',
    '    cfg = yaml.safe_load(fh)',
    'if not isinstance(cfg, dict):',
    '    sys.stderr.write("seedstick: cannot read the installer configuration\\n")',
    '    sys.exit(1)',
    '',
    'changed = False',
    '',
    '# --- hostname ---',
    'if D["fields"]["hostname"] and "ai.hostname" in args:',
    '    identity = cfg.setdefault("identity", {})',
    '    if isinstance(identity, dict):',
    '        identity["hostname"] = args["ai.hostname"]',
    '        applied.add("ai.hostname")',
    '        changed = True',
    '',
    '# --- network ---',
    '# The profile is generated as a static IP config (validation enforces it),',
    '# so rewrite the first ethernets entry.',
    'if D["fields"]["network"]:',
    '    net = cfg.get("network")',
    '    eths = net.get("ethernets") if isinstance(net, dict) else None',
    '    if not isinstance(eths, dict):',
    '        eths = {}',
    '    key = D["interfaceKey"] if D["interfaceKey"] in eths else (next(iter(eths), None))',
    '    iface = eths.get(key) if key is not None else None',
    '    if isinstance(iface, dict):',
    '        if "ai.ipv4" in args:',
    '            iface["addresses"] = [args["ai.ipv4"]]',
    '            iface["dhcp4"] = False',
    '            applied.add("ai.ipv4")',
    '            changed = True',
    '        if "ai.gw" in args:',
    '            # NONE means "no gateway". Keeps a host with an empty gateway from',
    '            # inheriting the profile default (a route into another subnet).',
    '            if args["ai.gw"] == NONE:',
    '                iface.pop("routes", None)',
    '            else:',
    '                iface["routes"] = [{"to": "default", "via": args["ai.gw"]}]',
    '            applied.add("ai.gw")',
    '            changed = True',
    '        if "ai.dns" in args:',
    '            if args["ai.dns"] == NONE:',
    '                # Remove only the DNS servers. Removing nameservers entirely',
    '                # would also drop the search domains from the profile.',
    '                ns = iface.get("nameservers")',
    '                if isinstance(ns, dict):',
    '                    ns.pop("addresses", None)',
    '                    if not ns:',
    '                        iface.pop("nameservers", None)',
    '                else:',
    '                    iface.pop("nameservers", None)',
    '            else:',
    '                # Turn the comma separated value into a real list.',
    '                servers = [x for x in args["ai.dns"].split(",") if x]',
    '                ns = iface.get("nameservers")',
    '                if not isinstance(ns, dict):',
    '                    ns = {}',
    '                    iface["nameservers"] = ns',
    '                ns["addresses"] = servers',
    '            applied.add("ai.dns")',
    '            changed = True',
    '',
    '# --- target disk ---',
    'if D["fields"]["disk"] and "ai.disk" in args:',
    '    storage = cfg.get("storage")',
    '    layout = storage.get("layout") if isinstance(storage, dict) else None',
    '    if isinstance(layout, dict):',
    '        layout["match"] = {"serial": args["ai.disk"]}',
    '        applied.add("ai.disk")',
    '        changed = True',
    '',
    '# --- "enter at the installer" was chosen ---',
    '# Must be a list of section names. A single string matches no controller',
    '# and the install turns interactive without showing any screen.',
    '# Keep existing entries (never take away a screen the user asked for).',
    'if args.get("ai.interactive") == "1":',
    '    current = cfg.get("interactive-sections") or []',
    '    if not isinstance(current, list):',
    '        current = []',
    '    if "*" in current:',
    '        # "*" already asks everything; nothing broader exists.',
    '        pass',
    '    else:',
    '        merged = list(current)',
    '        for name in D["interactiveOnDemand"]:',
    '            if name not in merged:',
    '                merged.append(name)',
    '        if merged != current:',
    '            cfg["interactive-sections"] = merged',
    '            changed = True',
    '    applied.add("ai.interactive")',
    'elif "ai.interactive" in args:',
    '    # `ai.interactive=0` means "no extra screens", which is already the default.',
    '    # Nothing changes, but count it as applied: treating it as ignored would',
    '    # abort the install on a machine where someone merely retyped the entry.',
    '    applied.add("ai.interactive")',
    '',
    '# Stop if a given parameter could not be applied. Continuing would produce a',
    '# machine without the value chosen at the boot menu, noticed only after reboot.',
    'ignored = sorted(set(args) - applied)',
    'if ignored:',
    '    sys.stderr.write(',
    '        "seedstick: could not apply boot parameters: %s\\n" % ", ".join(ignored)',
    '    )',
    '    sys.stderr.write("seedstick: the configuration has no field for them. Rebuild the USB.\\n")',
    '    sys.exit(1)',
    '',
    'if not changed:',
    '    sys.exit(0)',
    '',
    'with open(conf, "w", encoding="utf-8") as fh:',
    '    yaml.safe_dump(cfg, fh, default_flow_style=False, allow_unicode=True, sort_keys=False)',
    '',
    'sys.stdout.write("seedstick: applied boot parameters: %s\\n" % ", ".join(sorted(applied)))',
  ].join('\n')
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * UTF-8 の base64。`Buffer` も `btoa` も使わない。
 * このモジュールは renderer からも import されるので Node の API を持ち込めず、
 * `btoa` は Latin-1 しか受け付けないので日本語のホスト名で壊れる。
 */
export function utf8ToBase64(text: string): string {
  const bytes: number[] = []
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (cp < 0x80) bytes.push(cp)
    else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f))
    else if (cp < 0x10000) {
      bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f))
    } else {
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      )
    }
  }
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0
    const b1 = bytes[i + 1]
    const b2 = bytes[i + 2]
    out += BASE64_ALPHABET[b0 >> 2]
    out += BASE64_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)]
    out += b1 === undefined ? '=' : BASE64_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)]
    out += b2 === undefined ? '=' : BASE64_ALPHABET[b2 & 0x3f]
  }
  return out
}

export function buildSubstitutionScript(defaults: SubstitutionDefaults): string {
  const data = utf8ToBase64(JSON.stringify(defaults))
  // ヒアドキュメントは引用符付き (<<'AI_PY') なのでシェルは中身を一切展開しない。
  // AI_DATA は base64 なので、プロファイルの文字列がシェルに解釈されることはない。
  return [
    `AI_DATA=${data}`,
    'export AI_DATA',
    // 引数が渡されているのに反映できないまま進むと、全台が同じ IP になるなど
    // 気づきにくい事故になる。ツールが無ければここで止める。
    'if ! command -v python3 >/dev/null 2>&1; then',
    // ai.ipv4 のように数字を含む名前もあるので [a-z0-9.]+ で見る
    `  if grep -qE '(^| )ai\\.[a-z0-9.]+=' "\${AI_CMDLINE:-/proc/cmdline}"; then`,
    '    echo "seedstick: python3 not found; cannot apply boot parameters" >&2',
    '    exit 1',
    '  fi',
    '  exit 0',
    'fi',
    "python3 - <<'AI_PY'",
    pythonSource(),
    'AI_PY',
  ].join('\n')
}
// ---------------------------------------------------------------------------
// GRUB メニュー
// ---------------------------------------------------------------------------

export interface GrubMenuEntry {
  readonly title: string
  /** `linux` 行に追加する引数 */
  readonly args: readonly string[]
}

/** ホストプリセットと「手入力」から GRUB のメニュー項目を組み立てる。 */
export function buildHostMenuEntries(
  runtime: RuntimeValuesConfig,
  extraArgs: readonly string[] = [],
): GrubMenuEntry[] {
  const entries: GrubMenuEntry[] = []
  const useHostname = runtime.hostname === 'kernel-arg'
  const useNetwork = runtime.network === 'kernel-arg'
  const useDisk = runtime.disk === 'kernel-arg'
  if (!useHostname && !useNetwork && !useDisk) return entries

  for (const p of runtime.presets) {
    const args = [...extraArgs]
    if (useHostname && p.hostname) args.push(`${KERNEL_ARG.hostname}=${p.hostname}`)
    if (useNetwork) {
      if (p.ipv4) args.push(`${KERNEL_ARG.ipv4}=${p.ipv4}`)
      // 空欄は「無し」を明示して渡す。省くとプロファイルの既定値が残る。
      args.push(`${KERNEL_ARG.gateway}=${p.gateway || NONE_VALUE}`)
      // 手で編集された JSON では文字列とは限らない。触る前に型を確かめる
      // （ここで落ちると GUI が理由の分からない空の確認画面になる・落とし穴 23）。
      const dns = typeof p.nameservers === 'string' ? p.nameservers.replace(/\s+/g, '') : ''
      args.push(`${KERNEL_ARG.nameservers}=${dns || NONE_VALUE}`)
    }
    if (useDisk && p.disk) args.push(`${KERNEL_ARG.disk}=${p.disk}`)
    // 詳細をタイトルに出しておくと、選ぶ前に確認できる。
    // ラベルと同じ内容は繰り返さない（grub.cfg は 2048 バイトしか無い）。
    const detail = [useHostname ? p.hostname : '', useNetwork ? p.ipv4 : '']
      .filter((v) => v && v !== p.label)
      .join(' / ')
    entries.push({ title: detail ? `${p.label} - ${detail}` : p.label, args })
  }

  if (runtime.offerInteractiveEntry) {
    entries.push({
      title: 'Enter values manually',
      args: [...extraArgs, `${KERNEL_ARG.interactive}=1`],
    })
  }
  return entries
}

/** `interactive-sections` に入れるセクション名（重複なし、決定的な順序）。 */
export function interactiveSectionsFor(runtime: RuntimeValuesConfig): string[] {
  const out: string[] = []
  for (const field of RUNTIME_FIELDS) {
    if (runtime[field] === 'interactive') out.push(RUNTIME_FIELD_SECTION[field])
  }
  return [...new Set(out)]
}

/** kernel-arg モードの項目が 1 つでもあるか（プレースホルダと early-commands が必要になる）。 */
export function usesKernelArgs(runtime: RuntimeValuesConfig): boolean {
  return RUNTIME_FIELDS.some((f) => runtime[f] === 'kernel-arg')
}

// ---------------------------------------------------------------------------
// grub.cfg への反映（実際のパッチ適用は @autoinstall/media 側）
// ---------------------------------------------------------------------------

/** grub.cfg のすべての casper エントリに付けるカーネル引数。 */
export function baseKernelArgs(extraKernelArgs: string): string[] {
  const extra = extraKernelArgs
    .split(/\s+/)
    .map((a) => a.trim())
    .filter(Boolean)
  // autoinstall が無いと「Continue with autoinstall?」で止まるので必ず付ける
  return ['autoinstall', ...extra]
}
