# Contributing to Seedstick

Thanks for your interest. Seedstick writes to disks and makes machines erase their
disks, so changes are reviewed with that in mind. Small, focused pull requests with
tests are the easiest to accept.

- **Bugs and ideas:** open an [issue](https://github.com/UnlitCube/seedstick/issues)
  first for anything larger than a small fix, so we can agree on the approach.
- **Security problems:** do not open a public issue; see [SECURITY.md](SECURITY.md).
- By contributing you agree that your contribution is licensed under the
  [MIT License](LICENSE), like the rest of the project.
- Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

Node.js 22 or later.

```bash
npm install
npm run dev          # Electron with hot reload for the UI (restart for main-process changes)
npm run typecheck    # all tsconfig projects, scripts included
npm run test:unit    # vitest
npm test             # typecheck + unit + a smoke test with a real ISO (skipped if none found)
```

The smoke test looks for live-server ISOs in `~/images`, `~/Downloads`, `C:/iso` and
`/var/lib/iso`, or takes a path: `npm run smoke -- <path to iso>`.

The developer notes are in [CLAUDE.md](CLAUDE.md) (Japanese): architecture, rules,
and a numbered list of pitfalls that were actually hit. When a test or comment says
"pitfall 98", that is where to look.

### Where things live

| Path | What |
|---|---|
| `packages/shared` | Profile model, YAML generation, validation, i18n, IPC contract. No Node APIs (the UI imports it). |
| `packages/media` | Disk image engine: ISO9660, GPT, FAT, grub.cfg patching, write plans, device enumeration. No Electron. |
| `apps/desktop` | Electron app (main, preload, React renderer) and the Windows installer (`installer/`). |
| `scripts/` | End-to-end checks with real ISOs, VMs and USB drives. |

### Rules that matter most

- **Never trust values from the renderer.** ISO paths must come from a file dialog,
  device IDs from the latest enumeration (`apps/desktop/src/main/ipc.ts`).
- **Dangerous devices are blocked at enumeration.** System disks, internal disks and
  disks over 2 TB must stay `selectable: false` (`classifyDevice`).
- **Quote every value that reaches a shell**, even if validation already checked it,
  and never write user input through a heredoc.
- **Validation and generation must not throw** on hand-edited profile JSON; report a
  problem instead.
- **Every user-visible string goes through the dictionary** (see Translations).
- **A regression test must fail when the fix is reverted.** Try it before you push.

### Changes to storage or networking

The autoinstall schema does not check the inside of `storage.config`, and passing
unit tests has not been enough in the past. If you change how disks, RAID, LVM or
bonds are generated, run an unattended install in a VM (WSL2 + QEMU) and mention
the result in the pull request:

```bash
npm run e2e:vm          # single disk, LVM
npm run e2e:vm:raid     # RAID1 + LVM over four disks
npm run e2e:vm:mirror   # ESP on two disks + NIC bonding
```

## Translations

There are two dictionaries:

| UI | File |
|---|---|
| The app | `packages/shared/src/i18n/<locale>.ts` (`ja.ts` is the source, `en.ts` the reference for translators) |
| The Windows installer | `apps/desktop/installer/shared/labels.ts` |

Seven of the nine languages were translated from English with machine assistance and
have not been reviewed by native speakers yet, so corrections are very welcome. You can
also just open a **Translation** issue with the screen, the current text and your
suggestion.

When you edit a dictionary:

- Keep placeholders exactly: `{name}`, `{n}`. You may move them within the sentence.
- Plurals use a small ICU subset: `{n, plural, one {# disk} other {# disks}}`.
  `#` is replaced with the number. Use the categories your language needs
  (`Intl.PluralRules`); `other` is required.
- **Do not weaken warnings about erasing data.** Some strings are required to contain
  the word for "erase" (`SAFETY_TERMS` in `packages/shared/src/i18n/i18n.test.ts`).
- Product and technical names stay as they are: Seedstick, Ubuntu, autoinstall,
  cloud-init, netplan, curtin, GRUB, CIDATA, YAML key names.
- Run `npm run test:unit`. It checks keys, placeholders, plural syntax, unexpected
  scripts (for example kana in a Chinese string) and unused keys.

To check the layout in every language, build and start the app with
`--remote-debugging-port=9333` and run `node .e2e/locale-sweep.mjs`; it walks every
step in every language, reports overflowing or untranslated text and saves
screenshots.

### Adding a language

1. Add an entry to `LOCALE_META` in `packages/shared/src/i18n/locales.ts`
   (endonym, `<html lang>` tag, `Intl` tag, allowed scripts, full-width punctuation).
2. Add `packages/shared/src/i18n/<locale>.ts` and register it in `DICTIONARIES` (`index.ts`).
3. Add the word for "erase" to `SAFETY_TERMS` in `i18n.test.ts`.
4. Add the same locale to `apps/desktop/installer/shared/locales.ts` and a dictionary
   in `labels.ts`. `installer-locales.test.ts` checks that both lists agree.

## Pull requests

- Describe what changed and why, and how you checked it.
- Commit messages in this repository are mostly in Japanese; English is fine.
- CI runs the unit tests on Linux, Windows and macOS, plus typecheck and generation
  checks on Linux, a device-enumeration self-check on Linux and macOS, and a
  package-and-launch check on Windows.

## Releasing (maintainers)

1. Rename `## vNext` in `CHANGELOG.md` to `## v<version>` (the release notes are taken
   from that section) and bump the version. The version is also written in a few
   source files; `npm run test:unit` fails if one is missed (`version-consistency.test.ts`).
2. Push a tag:

   ```bash
   npm run test:unit
   git tag v0.2.0 && git push origin v0.2.0
   ```

`.github/workflows/release.yml` builds on Windows, macOS and Linux, uploads the
packages and `SHA256SUMS.txt` to a GitHub Release, and updates the website.
A manual run (`workflow_dispatch`) only checks that the build works and creates no release.
