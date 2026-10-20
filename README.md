# Seedstick

**Build an unattended-install USB drive for Ubuntu Server, with a GUI.**
Pick the official ISO, fill in a wizard, write the drive. Plug it into a server,
power on, and the install runs to the end on its own: hostname, users, network,
disk layout, packages and post-install setup included.

Windows · macOS · Linux (Electron) · MIT License ·
[Website](https://unlitcube.github.io/seedstick/) · [日本語の README](README.ja.md)

```
┌────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
│ Pick the ISO   │ → │ Configure in the GUI │ → │ Write the USB drive  │
│ (official one) │   │ (YAML is generated)  │   │ (with safety checks) │
└────────────────┘   └──────────────────────┘   └──────────────────────┘
```

> [!CAUTION]
> **This tool erases things, twice.**
> 1. Writing **erases the whole USB drive** you select.
> 2. A machine booted from that drive **erases its target disk without asking**.
>    That is what "unattended" means: nobody is asked to confirm.
>
> Keep the drive away from machines you did not mean to reinstall, label it, and
> on machines with several disks select the target disk by **serial number**, not
> "largest disk". Seedstick is provided **without warranty** (see [LICENSE](LICENSE)).

## Features

- **A 10-step wizard with explanations for every field.** The generated
  `autoinstall` YAML is shown live, with comments in your language.
- **Stops dangerous settings before writing.** For example "SSH password login is
  off but no public key is registered" (you would be locked out), or a malformed
  password hash that makes Ubuntu 26.10's installer fail at the very end.
- **System disks are never offered.** Internal disks, the disk the OS runs from and
  anything over 2 TB are filtered out while enumerating. You type a confirmation
  word before anything is written.
- **Read-back verification** after writing catches bad cheap USB sticks.
- **The ISO is not rebuilt.** A few sectors are patched in place on the drive and a
  small `CIDATA` partition is appended, so writing takes about as long as copying
  the ISO. Your ISO file itself is never modified.
- **One drive for many machines.** Hostname, IP address and target disk can be
  fixed, picked from the boot menu (`web01`, `web02`, …) or typed in the installer.
- **After the install, too.** Extra users, files and archives (carried on the drive
  or downloaded on first boot), systemd services, `apt full-upgrade`, NVIDIA
  driver and CUDA, RAID + LVM, NIC bonding.
- **Escape hatches for experts.** Write netplan or curtin YAML directly, or merge
  your own YAML over the generated config.
- **Save and reuse profiles** as JSON.
- **9 languages:** 日本語, English, 简体中文, 繁體中文, 한국어, Español, Français,
  Deutsch, Português (Brasil). See [Translations](#translations).

## Supported Ubuntu releases

| Release | Status |
|---|---|
| 22.04 LTS (Jammy) | supported |
| 24.04 LTS (Noble) | supported, verified end-to-end in a VM (single disk, RAID + LVM, bonding) |
| 25.10 (Questing) | usable, but **end of life since July 2026** — the app warns |
| 26.04 LTS (Resolute) | supported |
| 26.10 (Stonking) | supported, verified end-to-end in a VM (single disk) |

Use the **live-server** ISO (amd64 or arm64). NVIDIA driver / CUDA setup needs an
amd64 ISO and an LTS release (NVIDIA publishes no CUDA repository for 25.10 or 26.10).

## Download

Get the latest build from the
[Releases page](https://github.com/UnlitCube/seedstick/releases/latest).
Each release has a `SHA256SUMS.txt`.

| | Installer | Portable |
|---|---|---|
| Windows (x64) | `Seedstick-<v>-win-x64-Setup.exe` | `Seedstick-<v>-win-x64-portable.exe` |
| macOS (Intel / Apple Silicon) | `Seedstick-<v>-mac-{x64,arm64}.dmg` | `Seedstick-<v>-mac-{x64,arm64}.zip` |
| Linux (x64, experimental) | `Seedstick-<v>-linux-x64.deb` | `Seedstick-<v>-linux-x64.AppImage` |

The Windows installer installs for the current user only (no administrator rights
needed) and is removed from *Settings → Apps*. Writing to a USB drive asks for
administrator / root rights at that moment only; the app itself runs unprivileged.

### The builds are not code-signed (yet)

- **Windows:** SmartScreen shows "Windows protected your PC" on first launch.
  Click **More info → Run anyway**.
- **macOS:** Gatekeeper blocks the app. The app is ad-hoc signed so it runs on
  Apple Silicon, but you have to remove the quarantine flag yourself:

  ```bash
  xattr -dr com.apple.quarantine "/Applications/Seedstick.app"
  ```

  (On macOS 15 Sequoia and later, Control-click → Open no longer bypasses this; use
  the command above or *System Settings → Privacy & Security*.)
- **Linux:** device enumeration and the `pkexec` elevation have not been tested on
  real hardware yet. Reports are welcome.

## How to use

1. Download the **live-server** ISO from
   [ubuntu.com](https://ubuntu.com/download/server). Seedstick does not bundle or
   redistribute Ubuntu images.
2. Start Seedstick and pick the ISO.
3. Go through the wizard. The **Review** step shows the generated YAML and any
   problems found. Save the profile if you want to reuse it.
4. Choose the USB drive, type the confirmation word and write.
   You can also save a `.img` file instead and write it later with any tool.

> [!NOTE]
> A drive or `.img` made by Seedstick contains a **modified Ubuntu image**. Use it
> yourself or inside your organisation, but do not redistribute it: Canonical's
> [IP rights policy](https://ubuntu.com/legal/intellectual-property-policy) does
> not allow redistributing modified images under the Ubuntu trademarks.

## How it works

```
 LBA0    1..63          64 ────────── end of ISO   1 MiB ──────── end of disk
┌─────┬──────────────┬─────────────────────────┬──┬──────────────┬───────────┐
│ MBR │ GPT (primary)│ ISO9660 │ ESP │ Gap1    │  │ CIDATA (FAT) │ GPT backup│
│0xEE │              │ ← official ISO, as is → │  │ user-data    │           │
└─────┴──────────────┴─────────────────────────┴──┴──────────────┴───────────┘
```

1. The official ISO is written raw, so BIOS / UEFI boot behaves exactly like the
   official image.
2. Only `/boot/grub/grub.cfg` inside the ISO is patched in place to add the
   `autoinstall` kernel argument (without it the installer stops at
   *"Continue with autoinstall? (yes|no)"*). The matching line of `md5sum.txt` and
   the Joliet directory records are updated too.
3. A FAT partition labelled `CIDATA` is appended with `user-data` and `meta-data`.
   cloud-init's NoCloud data source finds it automatically.
4. The GPT is rebuilt to fit the drive. The partition table is written last, so a
   drive pulled out halfway never looks bootable.

Values picked from the boot menu travel as kernel arguments (`ai.hostname=web01`);
an `early-commands` script reads them and rewrites `/autoinstall.yaml` as YAML just
before the install starts. The generated config always contains working defaults,
so booting the default entry still completes.

The research behind these choices, with citations to primary sources and
measurements from real ISOs, is in [docs/research/](docs/research/).

## Building from source

Node.js 22 or later.

```bash
npm install
npm run dev              # development (on Windows, start-dev.bat also works)
npm test                 # typecheck + unit tests + smoke test with a real ISO (skipped if none)
npm run dist:win         # Windows portable (dist:mac / dist:linux for the others)
npm run dist:installer   # Windows installer (Setup.exe)
```

More checks (a full matrix with real ISOs, unattended installs in QEMU on WSL2,
writing to a real USB drive) are listed in [CLAUDE.md](CLAUDE.md#開発コマンド),
the project's developer notes (in Japanese).

## Translations

The UI was written in Japanese and English. The other seven languages were
**translated from English with machine assistance** and checked automatically
(placeholders, plural forms, scripts, layout overflow in every screen), but not yet
by native speakers. **Corrections are very welcome** — see
[CONTRIBUTING.md](CONTRIBUTING.md#translations).

## Contributing and security

- Bugs and ideas: [issues](https://github.com/UnlitCube/seedstick/issues).
  See [CONTRIBUTING.md](CONTRIBUTING.md).
- Security problems: please report privately, see [SECURITY.md](SECURITY.md).
- Everyone is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License and trademarks

Seedstick is released under the [MIT License](LICENSE).
Third-party licenses ship with every package as `THIRD_PARTY_NOTICES.txt`.

Seedstick is an independent open-source project. It is not affiliated with,
endorsed by, or sponsored by Canonical Ltd. Ubuntu and Canonical are registered
trademarks of Canonical Ltd. Other names are trademarks of their respective owners.
Details: [docs/LEGAL.md](docs/LEGAL.md).
