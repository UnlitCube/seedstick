import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import {
  SERIES_FEATURES,
  isValidSizeSpec,
  type DiskMatch,
  type StorageConfig,
  type SwapMode,
} from '@autoinstall/shared'
import { useStore } from '../store.js'
import { useT } from '../lib/i18n.js'
import { Badge, Button, Callout, Card, Field, RadioGroup, Select, Switch, TextArea, TextInput } from '../components/ui.js'

type Mode = StorageConfig['mode']

// 先頭のコメント行だけは訳す（テキストエリアに出るので利用者の目に触れる）。
const RAW_TEMPLATE_BODY = `config:
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
  const features = SERIES_FEATURES[useStore((s) => s.profile.series)]
  const update = useStore((s) => s.updateProfile)
  const [revealPassphrase, setRevealPassphrase] = useState(false)

  const setStorage = (next: StorageConfig): void => update((p) => ({ ...p, storage: next }))

  const changeMode = (mode: Mode): void => {
    if (mode === storage.mode) return
    if (mode === 'raw') {
      setStorage({ mode: 'raw', yaml: `# ${t('storage.rawTemplateComment')}\n${RAW_TEMPLATE_BODY}` })
      return
    }
    // 構造化モード同士の切り替えは既存の設定を保つ
    if (storage.mode === 'raw') {
      setStorage({
        mode,
        match: { kind: 'largest' },
        useWholeDisk: false,
        encryptionPassphrase: '',
        swap: { mode: 'installer-default', size: '4G' },
        partitionTable: 'default',
        resetPartition: { enabled: false, size: '' },
      })
    } else {
      // 暗号化のパスフレーズは LVM レイアウトにしか無い設定なので、
      // 他のモードへ移るときは一緒に消す。
      // 残したままにすると「LVM でのみ使えます」という error が出るのに、
      // スイッチもパスフレーズ欄も LVM のときしか描画されないので、
      // 画面からは二度と解除できなくなる（書き込みボタンが沈黙する）。
      setStorage({
        ...storage,
        mode,
        encryptionPassphrase: mode === 'lvm' ? storage.encryptionPassphrase : '',
      })
    }
  }

  return (
    <div className="space-y-5">
      <Callout tone="danger" title={t('storage.warning')}>
        {t('storage.warningBody')}
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
              description: t('storage.layoutLvmHint'),
            },
            {
              value: 'direct',
              label: t('storage.layoutDirect'),
              description: t('storage.layoutDirectHint'),
            },
            {
              value: 'zfs',
              label: t('storage.layoutZfs'),
              description: t('storage.layoutZfsHint'),
            },
            {
              value: 'raw',
              label: t('storage.layoutRaw'),
              badge: <Badge>{t('common.advanced')}</Badge>,
              description: t('storage.layoutRawHint'),
            },
          ]}
        />
      </Card>

      {storage.mode !== 'raw' && (
        <>
          <Card title={t('storage.match')} description={t('storage.matchHint')}>
            <DiskMatchPicker value={storage.match} onChange={(match) => setStorage({ ...storage, match })} />
          </Card>

          <Card title={t('storage.detailsTitle')}>
            <div className="space-y-3">
              {storage.mode === 'lvm' && (
                <Switch
                  checked={storage.useWholeDisk}
                  onChange={(useWholeDisk) => setStorage({ ...storage, useWholeDisk })}
                  label={t('storage.wholeDisk')}
                  description={t('storage.wholeDiskHint')}
                />
              )}
              <Field label={t('adv.swapTitle')}>
                {(id) => (
                  <Select
                    id={id}
                    value={storage.swap.mode}
                    onChange={(mode) =>
                      setStorage({ ...storage, swap: { ...storage.swap, mode: mode as SwapMode } })
                    }
                    options={[
                      { value: 'installer-default', label: t('adv.swapAuto') },
                      { value: 'none', label: t('adv.swapNone') },
                      { value: 'size', label: t('adv.swapSize') },
                    ]}
                  />
                )}
              </Field>
              {storage.swap.mode === 'size' && (
                <Field
                  label={t('adv.swapSizeValue')}
                  hint={t('adv.swapSizeHint')}
                  error={
                    isValidSizeSpec(storage.swap.size) ? undefined : t('adv.swapSizeHint')
                  }
                >
                  {(id) => (
                    <TextInput
                      id={id}
                      value={storage.swap.size}
                      spellCheck={false}
                      placeholder="4G"
                      invalid={!isValidSizeSpec(storage.swap.size)}
                      onChange={(e) =>
                        setStorage({ ...storage, swap: { ...storage.swap, size: e.target.value } })
                      }
                    />
                  )}
                </Field>
              )}
              {features.resetPartition && (
                <Switch
                  checked={storage.resetPartition.enabled}
                  onChange={(enabled) =>
                    setStorage({ ...storage, resetPartition: { ...storage.resetPartition, enabled } })
                  }
                  label={t('adv.resetPartition')}
                  description={t('adv.resetPartitionHint')}
                />
              )}
              {features.resetPartition && storage.resetPartition.enabled && (
                <Field
                  label={t('adv.resetPartitionSize')}
                  hint={t('adv.swapSizeHint')}
                  error={
                    storage.resetPartition.size === '' || isValidSizeSpec(storage.resetPartition.size)
                      ? undefined
                      : t('adv.swapSizeHint')
                  }
                >
                  {(id) => (
                    <TextInput
                      id={id}
                      value={storage.resetPartition.size}
                      spellCheck={false}
                      placeholder="12G"
                      invalid={
                        storage.resetPartition.size !== '' &&
                        !isValidSizeSpec(storage.resetPartition.size)
                      }
                      onChange={(e) =>
                        setStorage({
                          ...storage,
                          resetPartition: { ...storage.resetPartition, size: e.target.value },
                        })
                      }
                    />
                  )}
                </Field>
              )}
              {storage.mode === 'lvm' && (
                <Switch
                  checked={storage.encryptionPassphrase.length > 0}
                  tone="warning"
                  onChange={(on) =>
                    setStorage({ ...storage, encryptionPassphrase: on ? 'change-me-please' : '' })
                  }
                  label={t('storage.encrypt')}
                  description={t('storage.encryptHint')}
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
                      { value: 'gpt', label: t('storage.ptableGpt') },
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
          title={t('storage.rawTitle')}
          description={t('storage.rawHint')}
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
        <Field label={t('storage.pathLabel')} hint={t('storage.pathHint')}>
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
          label={t('storage.serialLabel')}
          hint={t('storage.serialHint')}
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
        <Field label={t('storage.modelLabel')} hint={t('storage.modelHint')}>
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
        <Callout tone="info">{t('storage.usbExcluded')}</Callout>
      )}
    </div>
  )
}
