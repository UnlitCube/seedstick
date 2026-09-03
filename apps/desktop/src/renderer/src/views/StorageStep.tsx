import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import type { DiskMatch, StorageConfig } from '@autoinstall/shared'
import { useStore } from '../store.js'
import { useT } from '../lib/i18n.js'
import { Badge, Button, Callout, Card, Field, RadioGroup, Select, Switch, TextArea, TextInput } from '../components/ui.js'

type Mode = StorageConfig['mode']

const RAW_TEMPLATE = `# curtin の storage config をそのまま書きます (UEFI + LVM の例)
config:
  - {type: disk, id: disk0, ptable: gpt, match: {size: largest}, wipe: superblock-recursive, grub_device: false, preserve: false}
  - {type: partition, id: p-esp, device: disk0, size: 1G, flag: boot, grub_device: true, preserve: false}
  - {type: format, id: f-esp, volume: p-esp, fstype: fat32, preserve: false}
  - {type: partition, id: p-boot, device: disk0, size: 2G, preserve: false}
  - {type: format, id: f-boot, volume: p-boot, fstype: ext4, preserve: false}
  - {type: partition, id: p-lvm, device: disk0, size: -1, preserve: false}
  - {type: lvm_volgroup, id: vg0, name: ubuntu-vg, devices: [p-lvm], preserve: false}
  - {type: lvm_partition, id: lv-root, name: ubuntu-lv, volgroup: vg0, size: -1, preserve: false}
  - {type: format, id: f-root, volume: lv-root, fstype: ext4, preserve: false}
  - {type: mount, id: m-root, device: f-root, path: /}
  - {type: mount, id: m-boot, device: f-boot, path: /boot}
  - {type: mount, id: m-esp, device: f-esp, path: /boot/efi}
`

export function StorageStep(): React.JSX.Element {
  const t = useT()
  const storage = useStore((s) => s.profile.storage)
  const update = useStore((s) => s.updateProfile)
  const [revealPassphrase, setRevealPassphrase] = useState(false)

  const setStorage = (next: StorageConfig): void => update((p) => ({ ...p, storage: next }))

  const changeMode = (mode: Mode): void => {
    if (mode === storage.mode) return
    if (mode === 'raw') {
      setStorage({ mode: 'raw', yaml: RAW_TEMPLATE })
      return
    }
    // 構造化モード同士の切り替えは既存の設定を保つ
    if (storage.mode === 'raw') {
      setStorage({
        mode,
        match: { kind: 'largest' },
        useWholeDisk: false,
        encryptionPassphrase: '',
        disableSwap: false,
        partitionTable: 'default',
      })
    } else {
      setStorage({ ...storage, mode })
    }
  }

  return (
    <div className="space-y-5">
      <Callout tone="danger" title={t('storage.warning')}>
        インストール先として選ばれたディスクは、既存のパーティションごと完全に消去されます。
        本番機で使う前に、必ず仮想マシンで一度試してください。
      </Callout>

      <Card title={t('storage.title')}>
        <RadioGroup<Mode>
          value={storage.mode}
          onChange={changeMode}
          options={[
            {
              value: 'lvm',
              label: t('storage.layoutLvm'),
              badge: <Badge tone="success">{t('common.recommended')}</Badge>,
              description:
                'あとから容量を増やしたりスナップショットを取ったりできます。Ubuntu の既定もこれです。',
            },
            {
              value: 'direct',
              label: t('storage.layoutDirect'),
              description: 'パーティションを直接切ります。構成が単純で分かりやすくなります。',
            },
            {
              value: 'zfs',
              label: t('storage.layoutZfs'),
              description: 'ZFS ルートを使います。スナップショットやデータ整合性チェックが強力です。',
            },
            {
              value: 'raw',
              label: t('storage.layoutRaw'),
              badge: <Badge>{t('common.advanced')}</Badge>,
              description: 'RAID や複雑なパーティション構成を自分で書く場合に選びます。',
            },
          ]}
        />
      </Card>

      {storage.mode !== 'raw' && (
        <>
          <Card title={t('storage.match')} description={t('storage.matchHint')}>
            <DiskMatchPicker value={storage.match} onChange={(match) => setStorage({ ...storage, match })} />
          </Card>

          <Card title="詳細">
            <div className="space-y-3">
              {storage.mode === 'lvm' && (
                <Switch
                  checked={storage.useWholeDisk}
                  onChange={(useWholeDisk) => setStorage({ ...storage, useWholeDisk })}
                  label={t('storage.wholeDisk')}
                  description={t('storage.wholeDiskHint')}
                />
              )}
              <Switch
                checked={storage.disableSwap}
                onChange={(disableSwap) => setStorage({ ...storage, disableSwap })}
                label={t('storage.disableSwap')}
                description="メモリに余裕があるサーバーや、swap を別に用意する場合に選びます。"
              />
              {storage.mode === 'lvm' && (
                <Switch
                  checked={storage.encryptionPassphrase.length > 0}
                  tone="warning"
                  onChange={(on) =>
                    setStorage({ ...storage, encryptionPassphrase: on ? 'change-me-please' : '' })
                  }
                  label={t('storage.encrypt')}
                  description="盗難時にデータを守れますが、起動のたびにパスフレーズの入力が必要になります。"
                />
              )}
            </div>

            {storage.mode === 'lvm' && storage.encryptionPassphrase.length > 0 && (
              <div className="mt-4 space-y-3">
                <Field label={t('storage.encryptPassphrase')} required>
                  {(id) => (
                    <div className="flex gap-2">
                      <TextInput
                        id={id}
                        type={revealPassphrase ? 'text' : 'password'}
                        value={storage.encryptionPassphrase}
                        onChange={(e) => setStorage({ ...storage, encryptionPassphrase: e.target.value })}
                      />
                      <Button type="button" onClick={() => setRevealPassphrase(!revealPassphrase)}>
                        {revealPassphrase ? (
                          <EyeOff className="size-4" aria-hidden />
                        ) : (
                          <Eye className="size-4" aria-hidden />
                        )}
                      </Button>
                    </div>
                  )}
                </Field>
                <Callout tone="warning">{t('storage.encryptWarning')}</Callout>
              </div>
            )}

            <div className="mt-4">
              <Field label={t('storage.partitionTable')}>
                {(id) => (
                  <Select
                    id={id}
                    value={storage.partitionTable}
                    onChange={(v) =>
                      setStorage({ ...storage, partitionTable: v as 'default' | 'gpt' | 'msdos' })
                    }
                    options={[
                      { value: 'default', label: t('storage.ptableDefault') },
                      { value: 'gpt', label: 'GPT（明示）' },
                      { value: 'msdos', label: t('storage.ptableMsdos') },
                    ]}
                  />
                )}
              </Field>
            </div>
          </Card>
        </>
      )}

      {storage.mode === 'raw' && (
        <Card
          title="curtin の storage config"
          description="autoinstall の storage キーにそのまま入ります。誤るとインストールが途中で失敗します。"
        >
          <TextArea
            rows={18}
            value={storage.yaml}
            spellCheck={false}
            onChange={(e) => setStorage({ mode: 'raw', yaml: e.target.value })}
          />
        </Card>
      )}
    </div>
  )
}

function DiskMatchPicker({
  value,
  onChange,
}: {
  value: DiskMatch
  onChange: (value: DiskMatch) => void
}): React.JSX.Element {
  const t = useT()
  return (
    <div className="space-y-3">
      <Select
        value={value.kind}
        onChange={(kind) => {
          switch (kind) {
            case 'largest':
            case 'smallest':
            case 'ssd':
            case 'any':
              onChange({ kind })
              break
            case 'path':
              onChange({ kind: 'path', path: '' })
              break
            case 'serial':
              onChange({ kind: 'serial', serial: '' })
              break
            default:
              onChange({ kind: 'model', model: '' })
          }
        }}
        options={[
          { value: 'largest', label: t('storage.matchLargest') },
          { value: 'smallest', label: t('storage.matchSmallest') },
          { value: 'ssd', label: t('storage.matchSsd') },
          { value: 'any', label: t('storage.matchAny') },
          { value: 'path', label: t('storage.matchPath') },
          { value: 'serial', label: t('storage.matchSerial') },
          { value: 'model', label: t('storage.matchModel') },
        ]}
      />
      {value.kind === 'path' && (
        <Field label="デバイスのパス" hint="例: /dev/nvme0n1、/dev/sda。ワイルドカード (*) が使えます。">
          {(id) => (
            <TextInput
              id={id}
              value={value.path}
              spellCheck={false}
              placeholder="/dev/nvme0n1"
              onChange={(e) => onChange({ kind: 'path', path: e.target.value })}
            />
          )}
        </Field>
      )}
      {value.kind === 'serial' && (
        <Field
          label="シリアル番号"
          hint="例: CT500MX* のようにワイルドカードが使えます。複数ディスク機で最も確実な指定方法です。"
        >
          {(id) => (
            <TextInput
              id={id}
              value={value.serial}
              spellCheck={false}
              placeholder="CT500MX*"
              onChange={(e) => onChange({ kind: 'serial', serial: e.target.value })}
            />
          )}
        </Field>
      )}
      {value.kind === 'model' && (
        <Field label="モデル名" hint="例: Samsung SSD*。ワイルドカードが使えます。">
          {(id) => (
            <TextInput
              id={id}
              value={value.model}
              spellCheck={false}
              placeholder="Samsung SSD*"
              onChange={(e) => onChange({ kind: 'model', model: e.target.value })}
            />
          )}
        </Field>
      )}
      {(value.kind === 'largest' || value.kind === 'smallest' || value.kind === 'ssd') && (
        <Callout tone="info">
          インストール USB 自身がこの条件で選ばれることはありません（インストーラが除外します）。
        </Callout>
      )}
    </div>
  )
}
