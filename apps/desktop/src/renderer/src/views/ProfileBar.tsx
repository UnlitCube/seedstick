import { useState } from 'react'
import {
  Copy,
  FilePlus2,
  FolderOpen,
  Import,
  Pencil,
  Save,
  Trash2,
  Upload,
} from 'lucide-react'
import type { ProfileSummary } from '@autoinstall/shared'
import { useStore } from '../store.js'
import { useT } from '../lib/i18n.js'
import { Badge, Button, Callout, Modal, TextInput } from '../components/ui.js'

/** ヘッダーに出す「今開いているプロファイル」の表示と、ライブラリを開くボタン。 */
export function ProfileBar(): React.JSX.Element {
  const t = useT()
  const profile = useStore((s) => s.profile)
  const dirty = useStore((s) => s.dirty)
  const currentProfileId = useStore((s) => s.currentProfileId)
  const saveCurrentProfile = useStore((s) => s.saveCurrentProfile)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [saveAsOpen, setSaveAsOpen] = useState(false)
  const [saveAsName, setSaveAsName] = useState('')

  const quickSave = async (): Promise<void> => {
    if (currentProfileId === null) {
      setSaveAsName(profile.meta.name === 'default' ? '' : profile.meta.name)
      setSaveAsOpen(true)
      return
    }
    await saveCurrentProfile()
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setLibraryOpen(true)}
          className="flex max-w-56 items-center gap-2 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
          title={t('profile.library')}
        >
          <FolderOpen className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">
            {currentProfileId === null ? t('profile.unsaved') : profile.meta.name}
          </span>
          {dirty && <span className="size-1.5 shrink-0 rounded-full bg-amber-500" title={t('profile.dirty')} />}
        </button>
        <Button onClick={() => void quickSave()} title={t('profile.save')}>
          <Save className="size-4" aria-hidden />
        </Button>
      </div>

      <ProfileLibraryModal open={libraryOpen} onClose={() => setLibraryOpen(false)} />

      <Modal
        open={saveAsOpen}
        onClose={() => setSaveAsOpen(false)}
        title={t('profile.saveAs')}
        footer={
          <>
            <Button onClick={() => setSaveAsOpen(false)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              disabled={!saveAsName.trim()}
              onClick={() => {
                setSaveAsOpen(false)
                void saveCurrentProfile(saveAsName.trim())
              }}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <label className="mb-1.5 block text-sm font-medium text-slate-800 dark:text-slate-200">
          {t('profile.name')}
        </label>
        <TextInput
          value={saveAsName}
          autoFocus
          placeholder={t('profile.namePlaceholder')}
          onChange={(e) => setSaveAsName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && saveAsName.trim()) {
              setSaveAsOpen(false)
              void saveCurrentProfile(saveAsName.trim())
            }
          }}
        />
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('profile.saveHint')}</p>
      </Modal>
    </>
  )
}

function ProfileLibraryModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const locale = useStore((s) => s.locale)
  const profiles = useStore((s) => s.profiles)
  const currentProfileId = useStore((s) => s.currentProfileId)
  const openProfile = useStore((s) => s.openProfile)
  const dirty = useStore((s) => s.dirty)

  /**
   * 未保存の変更を捨ててよいか確かめる。
   * dirty を追跡して画面にも出しているのに、profile を差し替える経路が
   * どれもそれを見ていなかった（作りかけの設定が黙って消える）。
   */
  const confirmDiscard = (): boolean =>
    !dirty ||
    window.confirm('保存していない変更があります。破棄して続けますか？')
  const removeProfile = useStore((s) => s.removeProfile)
  const duplicateProfile = useStore((s) => s.duplicateProfile)
  const refreshProfiles = useStore((s) => s.refreshProfiles)
  const newProfile = useStore((s) => s.newProfile)
  const loadProfileFromDisk = useStore((s) => s.loadProfileFromDisk)
  const profileState = useStore((s) => s.profile)
  const [confirmDelete, setConfirmDelete] = useState<ProfileSummary | null>(null)
  const [renaming, setRenaming] = useState<{ item: ProfileSummary; name: string } | null>(null)

  const formatDate = (iso: string): string =>
    new Date(iso).toLocaleString(locale === 'ja' ? 'ja-JP' : 'en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={t('profile.library')}
        footer={
          <>
            <Button onClick={() => void window.autoinstall.revealProfilesFolder()}>
              <FolderOpen className="size-4" aria-hidden />
              {t('profile.revealFolder')}
            </Button>
            <Button onClick={onClose}>{t('common.close')}</Button>
          </>
        }
      >
        <div className="mb-4 flex flex-wrap gap-2">
          <Button
            onClick={() => {
              if (!confirmDiscard()) return
              newProfile()
              onClose()
            }}
          >
            <FilePlus2 className="size-4" aria-hidden />
            {t('profile.new')}
          </Button>
          <Button
            onClick={async () => {
              await window.autoinstall.importProfileToLibrary()
              await refreshProfiles()
            }}
          >
            <Import className="size-4" aria-hidden />
            {t('profile.import')}
          </Button>
          <Button
            onClick={() => {
              if (!confirmDiscard()) return
              void loadProfileFromDisk()
              onClose()
            }}
          >
            <Upload className="size-4" aria-hidden />
            {t('profile.openFile')}
          </Button>
          <Button onClick={() => void window.autoinstall.saveProfile(profileState)}>
            <Save className="size-4" aria-hidden />
            {t('profile.exportFile')}
          </Button>
        </div>

        {profiles.length === 0 ? (
          <Callout tone="info">{t('profile.empty')}</Callout>
        ) : (
          <ul className="space-y-2">
            {profiles.map((p) => (
              <li
                key={p.id}
                className={`rounded-lg border p-3 ${
                  p.id === currentProfileId
                    ? 'border-sky-400 bg-sky-50 dark:border-sky-700 dark:bg-sky-950/40'
                    : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      if (!confirmDiscard()) return
                      void openProfile(p.id)
                      onClose()
                    }}
                  >
                    <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">
                      {p.name}
                    </p>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                      Ubuntu {p.series} · {p.hostname} · {p.username} · {formatDate(p.updatedAt)}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {p.highlights.additionalUsers > 0 && (
                        <Badge>
                          {t('profile.badgeUsers')} {p.highlights.additionalUsers}
                        </Badge>
                      )}
                      {p.highlights.deployments > 0 && (
                        <Badge>
                          {t('profile.badgeDeployments')} {p.highlights.deployments}
                        </Badge>
                      )}
                      {p.highlights.services > 0 && (
                        <Badge>
                          {t('profile.badgeServices')} {p.highlights.services}
                        </Badge>
                      )}
                      {p.highlights.gpu && <Badge tone="info">GPU / CUDA</Badge>}
                      {p.highlights.staticIp && <Badge>{t('profile.badgeStaticIp')}</Badge>}
                    </div>
                  </button>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      title={t('profile.rename')}
                      onClick={() => setRenaming({ item: p, name: p.name })}
                    >
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      title={t('profile.duplicate')}
                      onClick={() => void duplicateProfile(p.id, `${p.name} のコピー`)}
                    >
                      <Copy className="size-4" aria-hidden />
                    </Button>
                    <Button variant="ghost" title={t('common.cancel')} onClick={() => setConfirmDelete(p)}>
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      <Modal
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title={t('profile.deleteTitle')}
        footer={
          <>
            <Button onClick={() => setConfirmDelete(null)}>{t('common.cancel')}</Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirmDelete) void removeProfile(confirmDelete.id)
                setConfirmDelete(null)
              }}
            >
              {t('profile.delete')}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700 dark:text-slate-300">
          {t('profile.deleteBody')}
          <br />
          <strong>{confirmDelete?.name}</strong>
        </p>
      </Modal>

      <Modal
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        title={t('profile.rename')}
        footer={
          <>
            <Button onClick={() => setRenaming(null)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              disabled={!renaming?.name.trim()}
              onClick={async () => {
                if (renaming?.name.trim()) {
                  await window.autoinstall.renameNamedProfile(renaming.item.id, renaming.name.trim())
                  await refreshProfiles()
                }
                setRenaming(null)
              }}
            >
              {t('common.save')}
            </Button>
          </>
        }
      >
        <TextInput
          value={renaming?.name ?? ''}
          autoFocus
          onChange={(e) => setRenaming(renaming ? { ...renaming, name: e.target.value } : null)}
        />
      </Modal>
    </>
  )
}
