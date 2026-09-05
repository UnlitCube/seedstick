import { KEYBOARDS, LOCALE_CHOICES, TIMEZONES } from '@autoinstall/shared'
import { useStore } from '../store.js'
import { useT } from '../lib/i18n.js'
import { Card, Field, Select, TextInput } from '../components/ui.js'

export function BasicsStep(): React.JSX.Element {
  const t = useT()
  const locale = useStore((s) => s.locale)
  const profile = useStore((s) => s.profile)
  const update = useStore((s) => s.updateProfile)
  const label = (c: { labelJa: string; labelEn: string }): string =>
    locale === 'ja' ? c.labelJa : c.labelEn

  const hostnameInvalid =
    profile.basics.hostname.length > 0 &&
    !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i.test(profile.basics.hostname)

  const keyboardValue = `${profile.basics.keyboard.layout}:${profile.basics.keyboard.variant}`

  return (
    <div className="space-y-5">
      <Card title={t('basics.title')}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t('basics.locale')}>
            {(id) => (
              <Select
                id={id}
                value={profile.basics.locale}
                onChange={(v) =>
                  update((p) => ({ ...p, basics: { ...p.basics, locale: v } }))
                }
                options={LOCALE_CHOICES.map((c) => ({ value: c.value, label: `${label(c)} (${c.value})` }))}
              />
            )}
          </Field>

          <Field label={t('basics.keyboard')}>
            {(id) => (
              <Select
                id={id}
                value={keyboardValue}
                onChange={(v) => {
                  const chosen = KEYBOARDS.find((k) => k.value === v)
                  if (!chosen) return
                  update((p) => ({
                    ...p,
                    basics: {
                      ...p.basics,
                      keyboard: { layout: chosen.layout, variant: chosen.variant, toggle: null },
                    },
                  }))
                }}
                options={KEYBOARDS.map((k) => ({ value: k.value, label: label(k) }))}
              />
            )}
          </Field>

          <Field label={t('basics.timezone')}>
            {(id) => (
              <Select
                id={id}
                value={profile.basics.timezone}
                onChange={(v) => update((p) => ({ ...p, basics: { ...p.basics, timezone: v } }))}
                options={TIMEZONES.map((z) => ({ value: z.value, label: label(z) }))}
              />
            )}
          </Field>

          <Field
            label={t('basics.hostname')}
            hint={t('basics.hostnameHint')}
            required
            {...(hostnameInvalid
              ? { error: t('basics.hostnameInvalid') }
              : {})}
          >
            {(id) => (
              <TextInput
                id={id}
                value={profile.basics.hostname}
                invalid={hostnameInvalid}
                spellCheck={false}
                autoComplete="off"
                placeholder="ubuntu-server"
                onChange={(e) =>
                  update((p) => ({ ...p, basics: { ...p.basics, hostname: e.target.value } }))
                }
              />
            )}
          </Field>
        </div>
      </Card>
    </div>
  )
}
