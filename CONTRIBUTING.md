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

- Node.js **22.18 or later** (the `.e2e` scripts and the website build load TypeScript
  files directly, which needs Node's type stripping).
- For the unit tests: a POSIX `sh` (Git Bash on Windows) and Python 3 with
  **PyYAML 6.0.1** (`python -m pip install PyYAML==6.0.1`). Some tests run the
  generated shell scripts and the YAML rewriting for real.

```bash
npm install
npm run dev          # Electron with hot reload for the UI (restart for main-process changes)
npm run typecheck    # all tsconfig projects, scripts included
npm run test:unit    # vitest
npm test             # typecheck + unit + a smoke test with a real ISO (skipped if none found)
```

The smoke test reads every `.iso` in `~/images`, `~/Downloads`, `C:/iso` and
`/var/lib/iso`, or takes a path: `npm run smoke -- <path to iso>`. Files named
`*live-server*.iso` are written to a temporary image (several GB, deleted afterwards)
and read back; any other ISO must be rejected as unsupported.

The developer notes are in [CLAUDE.md](CLAUDE.md) (Japanese): architecture, rules,
and a numbered list of pitfalls that were actually hit. When a test or comment says
"pitfall 98", that is where to look.

### Where things live

| Path | What |
|---|---|
| `packages/shared` | Profile model, YAML generation, validation, i18n, IPC contract. The main entry has no Node APIs (the UI imports it); Node-only code sits behind a subpath such as `@autoinstall/shared/crypt`, imported only by the main process. |
| `packages/media` | Disk image engine: ISO9660, GPT, FAT, grub.cfg patching, write plans, device enumeration. No Electron. |
| `apps/desktop` | Electron app (main, preload, React renderer) and the Windows installer (`installer/`). |
| `scripts/` | End-to-end checks with real ISOs, VMs and USB drives, and the website build. |
| `docs-site/` | Website strings, styles and screenshots (built by `scripts/build-site.mjs`). |

### Rules that matter most

- **Never trust values from the renderer.** An ISO path is accepted only after it was
  chosen in the file dialog or dropped onto the window and opened as a valid ISO
  (`chooseIso` / `openIso`); device IDs must come from the latest enumeration
  (`apps/desktop/src/main/ipc.ts`).
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
bonds are generated, run an unattended install in a VM and mention the result in the
pull request:

```bash
npm run e2e:vm          # single disk, LVM
npm run e2e:vm:raid     # two disks: RAID1 /boot + RAID1 → LVM root, plus a whole-disk RAID1 of two NVMe drives
npm run e2e:vm:mirror   # an ESP on two disks + NIC bonding
npm run e2e:vm:ip       # the shipped sample, picking an IP address from the boot menu
```

These need **Windows with WSL2**: a distro named `Ubuntu-24.04` with QEMU and OVMF
installed, used as root, and an Ubuntu live-server ISO in `~/images` (pass a path to
choose one). Each run takes 30–40 minutes. If you cannot run them, say so in the pull
request and a maintainer will.

## Translations

There are two dictionaries:

| UI | File |
|---|---|
| The app | `packages/shared/src/i18n/<locale>.ts` (`ja.ts` is the source, `en.ts` the reference for translators) |
| The Windows installer | `apps/desktop/installer/shared/labels.ts` |

The website has a third, small one: `docs-site/strings.mjs`.

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
- Run `npm run test:unit`. For the app dictionaries it checks keys, placeholders,
  plural syntax, unexpected scripts (for example kana in a Chinese string) and unused
  keys. For the installer dictionary it checks keys, placeholders and leftover kana.

To check the layout in every language:

1. `npm run build`, then `cd apps/desktop && npx electron out/main/index.js --remote-debugging-port=9333`
   (see [.e2e/README.md](.e2e/README.md)).
2. Choose an ISO in the app, so every step has content.
3. `node .e2e/locale-sweep.mjs` walks the initial view of every step in every
   language, reports leaked keys, mixed-in Japanese and overflowing text, and saves
   screenshots to `.e2e/locales/` (ignored by git; do not commit them).

### Adding a language

1. Add an entry to `LOCALE_META` in `packages/shared/src/i18n/locales.ts`
   (endonym, `<html lang>` tag, `Intl` tag, allowed scripts, full-width punctuation).
2. Add `packages/shared/src/i18n/<locale>.ts` and register it in `DICTIONARIES` (`index.ts`).
3. Add the word for "erase" to `SAFETY_TERMS` in `i18n.test.ts`.
4. Add the same locale to `apps/desktop/installer/shared/locales.ts` and a dictionary
   in `labels.ts`. `installer-locales.test.ts` checks that both lists agree.
5. Add the locale to `SITE_STRINGS` in `docs-site/strings.mjs` (the website build stops
   otherwise), to the language list in `.github/ISSUE_TEMPLATE/translation.yml`, and
   two screenshots to `docs-site/img/` (`<locale>-review.webp`, `<locale>-runtime.webp`).

## Pull requests

- Describe what changed and why, and how you checked it.
- Add a line under `## vNext` in `CHANGELOG.md` for changes users will notice
  (create the section if it is missing).
- Commit messages in this repository are mostly in Japanese; English is fine.
- CI runs the unit tests on Linux, Windows and macOS, plus typecheck and generation
  checks on Linux, a device-enumeration self-check on Linux and macOS, and a
  package-and-launch check on Windows.

## Releasing (maintainers)

1. Rename `## vNext` in `CHANGELOG.md` to `## v<version>` (the release notes are taken
   from that section, and the release stops if it is missing).
2. Bump the version in `package.json`, `apps/desktop/package.json`,
   `packages/shared/package.json` and `packages/media/package.json`, run `npm install`
   to update the lockfile, and update the places listed in `SITES` in
   `apps/desktop/src/main/version-consistency.test.ts` (`npm run test:unit` fails if
   one of those is missed).
3. Push a tag:

   ```bash
   npm run test:unit
   git tag v0.2.0 && git push origin v0.2.0
   ```

`.github/workflows/release.yml` builds on Windows, macOS and Linux, uploads the
packages and `SHA256SUMS.txt` to a GitHub Release, and then starts `pages.yml` on
`main` to point the website's download buttons at the new files. A manual run
(`workflow_dispatch`) runs everything except those last two steps: the builds, the
check that exactly the expected files were collected, and `SHA256SUMS.txt`. Run it
before tagging whenever you change what gets built or how it is named.
While the version is 0.x (tags `v0.*`), the release is published as a GitHub
*pre-release*, matching the beta status in the README. The website build
takes the newest non-draft release, pre-releases included, so its download buttons
still point at it.

### Repository setup (once)

- *Settings → Code security → Private vulnerability reporting*: on (SECURITY.md
  links to it). Open the link while logged out to check that it works.
- *Settings → Pages → Source*: **GitHub Actions**. Pages needs the repository to be
  public on the Free plan.
- Create the `translation` label (issue forms only apply labels that exist):
  `gh label create translation --description "Wrong or missing translation"`.
