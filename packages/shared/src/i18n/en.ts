import type { MsgKey } from './ja.js'

// `satisfies Record<MsgKey, string>` により、キーの過不足がコンパイルエラーになる。
// つまり ja に追加したら必ずここにも追加することになり、訳し漏れが起きない。
export const en = {
  // --- common ---
  'app.name': 'Autoinstall USB Creator',
  'app.tagline': 'Build an unattended Ubuntu Server install USB',
  'common.next': 'Next',
  'common.back': 'Back',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.save': 'Save',
  'common.ok': 'OK',
  'common.optional': 'Optional',
  'common.required': 'Required',
  'common.add': 'Add',
  'common.delete': 'Delete',
  'common.advanced': 'Advanced',
  'common.recommended': 'Recommended',
  'common.warning': 'Warning',
  'common.error': 'Error',
  'common.yes': 'Yes',
  'common.no': 'No',
  'common.loading': 'Loading…',
  'common.refresh': 'Refresh',
  'common.copy': 'Copy',
  'common.copied': 'Copied',
  'common.show': 'Show',
  'common.hide': 'Hide',
  'common.edit': 'Edit',

  // --- formatting ---
  'format.etaMinutesSeconds': 'about {minutes}m {seconds}s',
  'format.etaSeconds': 'about {seconds}s',

  // --- steps ---
  'step.iso': 'Choose ISO',
  'step.basics': 'Basics',
  'step.user': 'User',
  'step.network': 'Network',
  'step.storage': 'Disk',
  'step.runtime': 'Runtime values',
  'step.software': 'Software',
  'step.postinstall': 'After install',
  'step.review': 'Review',
  'step.write': 'Write',

  // --- ISO ---
  'iso.title': 'Choose an Ubuntu Server ISO file',
  'iso.description':
    'Pick the live-server ISO you downloaded from Ubuntu. This tool never redistributes the ISO itself.',
  'iso.choose': 'Choose ISO file',
  'iso.dropHint': 'You can also drag an ISO file here',
  'iso.download': 'Download from the official site',
  'iso.detected': 'Recognized',
  'iso.version': 'Version',
  'iso.arch': 'Architecture',
  'iso.size': 'File size',
  'iso.checksum': 'Checksum (SHA-256)',
  'iso.checksumVerify': 'Verify against the official checksum',
  'iso.checksumOk': 'Matches the official checksum',
  'iso.checksumMismatch': 'Checksum mismatch. The download may be corrupted.',
  'iso.checksumOffline': 'Could not fetch the checksum (you may be offline)',
  'iso.unsupported': 'This ISO is not supported',
  'iso.notServer':
    'This does not look like the Ubuntu Server live-server edition (volume name: {volumeId}). Desktop and other flavours are not supported.',
  'iso.unknownSeries': 'This version is not supported ({version}).',
  'iso.rejectNotAFile': 'This is not a file.',
  'iso.rejectNotUbuntu': 'This does not look like an Ubuntu ISO (volume name: {volumeId}).',
  'iso.rejectNotFound': 'The file was not found.',
  'iso.rejectPermission': 'You do not have permission to read this file.',
  // Why the ISO structure was rejected. One key per IsoValidationError reason, so the
  // Callout body always says something the generic title does not.
  'iso.rejectNotIso9660':
    'This file could not be read as ISO9660. It may be truncated or corrupted, or it may not be an ISO image at all.',
  'iso.rejectNoCasper':
    'This ISO has no casper directory. It is probably not an Ubuntu live-server ISO.',
  'iso.rejectNoGrubCfg':
    'This ISO has no /boot/grub/grub.cfg, so the boot menu cannot be patched. The format is not supported.',
  'iso.rejectNoKernelLine':
    'No /casper kernel line was found in grub.cfg, so the autoinstall kernel argument cannot be added. The ISO is not structured the way this tool expects.',
  'iso.rejectGrubTooLarge':
    'The patched grub.cfg no longer fits in a single sector. Reduce the kernel arguments. The exact sizes are in the details below.',
  'iso.eol': 'This version has reached end of life',
  'iso.eolBody':
    'It no longer receives security updates. Do not use it for internet-facing servers; prefer an LTS release.',
  'iso.eolSoon': 'Support for this version ends soon',
  'iso.supportUntil': 'Supported until',
  'iso.approxSize': 'about {size}',
  'iso.build': 'Build',
  'iso.checksumComputing': 'Computing the checksum… {done} / {total}',
  'iso.checksumMismatchAdvice': 'Do not use this ISO. Download it again before you go any further.',
  'iso.checksumRun': 'Verify',
  'iso.checksumUnknownAdvice':
    'Could not fetch the official list. Compare the hash above with SHA256SUMS on the Ubuntu site by hand.',
  'iso.checksumVerifyHint':
    'Compares the file with the official checksum to catch a corrupted download (this takes a few minutes)',
  'iso.chooseAgain': 'Choose another',
  'iso.codename': 'Codename',
  'iso.eolBadge': 'End of life',
  'iso.eolDetail': 'Standard support for Ubuntu {series} ({codename}) ended on {eol}.',
  'iso.eolSoonDetail':
    'Standard support for Ubuntu {series} ends on {eol} (about {months} months from now).',
  'iso.grubExplain':
    'Only {path} inside the ISO is rewritten, to add {arg} to the kernel command line. Without it the installer stops at "Continue with autoinstall? (yes|no)" and waits for an answer, so this change is required. The ISO file itself is never modified.',
  'iso.grubHide': 'Hide the boot menu changes',
  'iso.grubShow': 'See what is changed in the boot menu',
  'iso.minimumDevice': 'Minimum USB size',
  'iso.minimumDeviceValue': '{size} or larger',
  'iso.noIsoDescription':
    'This tool does not bundle the ISO. Download it from the official Ubuntu site.',
  'iso.noIsoTitle': 'If you do not have an ISO yet',
  'iso.supportedEditionsOnly':
    'Only the {edition} edition of Ubuntu Server is supported. Desktop images, other flavors, and other distributions will not work.',

  // --- basics ---
  'basics.title': 'Language and keyboard',
  'basics.locale': 'System language',
  'basics.keyboard': 'Keyboard layout',
  'basics.timezone': 'Time zone',
  'basics.hostname': 'Hostname',
  'basics.hostnameHint': 'The name that identifies this server on the network (e.g. web-01)',
  'basics.hostnameInvalid':
    'Use only letters, digits, and hyphens, and start and end with a letter or a digit',

  // Option labels (LOCALE_CHOICES / KEYBOARDS / TIMEZONES in presets.ts)
  'basics.localeEnUs': 'English (US)',
  'basics.localeJaJp': 'Japanese',
  'basics.localeEnGb': 'English (UK)',
  'basics.localeDeDe': 'German',
  'basics.localeFrFr': 'French',
  'basics.localeEsEs': 'Spanish',
  'basics.localePtBr': 'Portuguese (Brazil)',
  'basics.localeZhCn': 'Chinese (Simplified)',
  'basics.localeKoKr': 'Korean',
  'basics.localeC': 'No locale (C.UTF-8)',
  'basics.keyboardUs': 'English (US)',
  'basics.keyboardJp': 'Japanese (JIS)',
  'basics.keyboardUsDvorak': 'English (Dvorak)',
  'basics.keyboardGb': 'English (UK)',
  'basics.keyboardDe': 'German',
  'basics.keyboardFr': 'French',
  'basics.keyboardEs': 'Spanish',
  'basics.keyboardKr104': 'Korean (104-key)',
  'basics.keyboardCn': 'Chinese',
  'basics.timezoneTokyo': 'Tokyo (JST)',
  'basics.timezoneUtc': 'UTC',
  'basics.timezoneGeoip': 'Detect from IP address',
  'basics.timezoneLosAngeles': 'Los Angeles',
  'basics.timezoneNewYork': 'New York',
  'basics.timezoneLondon': 'London',
  'basics.timezoneBerlin': 'Berlin',
  'basics.timezoneSingapore': 'Singapore',
  'basics.timezoneSeoul': 'Seoul',
  'basics.timezoneSydney': 'Sydney',

  // --- user ---
  'user.title': 'Create the first user',
  'user.description': 'This user becomes the administrator and can use sudo.',
  'user.realname': 'Full name',
  'user.username': 'Username',
  'user.usernameHint': 'Start with a lowercase letter; letters, digits and hyphens are allowed',
  'user.password': 'Password',
  'user.passwordConfirm': 'Password (confirm)',
  'user.passwordMismatch': 'Passwords do not match',
  'user.passwordStored': 'The password is stored hashed; the plain text is never kept',
  'user.passwordStrength': 'Password strength',
  'user.strengthWeak': 'Weak',
  'user.strengthFair': 'Fair',
  'user.strengthStrong': 'Strong',
  'user.sudoNoPassword': 'Allow sudo without a password',
  'user.generate': 'Generate a random password',
  'user.groupsModeAppend': 'Add to the defaults',
  'user.groupsModeDefault': "Leave the installer's defaults (sudo, adm, and so on)",
  'user.groupsModeOverride': 'Use only the groups listed here',
  'user.groupsOverrideWarning':
    'Leaving sudo out of the list removes administrator rights, so nothing can be changed after the installation.',
  'user.identityGroupsHint':
    'List the extra groups to join, such as docker or libvirt, separated by spaces.',
  'user.sudoNoPasswordHint':
    'Convenient for automation, but anyone who takes over this login has root immediately.',
  'user.usernameInvalid': 'Contains characters that cannot be used',
  'user.detailsTitle': 'Advanced settings',
  'user.detailsDescription': 'The installer never asks about these. Leaving them alone is fine.',

  // --- SSH ---
  'ssh.title': 'SSH settings',
  'ssh.installServer': 'Install the SSH server',
  'ssh.installServerHint': 'Lets you log in to this server over the network',
  'ssh.allowPassword': 'Allow SSH login with a password',
  'ssh.authorizedKeys': 'SSH public keys',
  'ssh.authorizedKeysHint': 'One per line, in the form ssh-ed25519 AAAA...',
  'ssh.keyInvalid': 'This public key is malformed',
  'ssh.importFile': 'Import from file',
  'ssh.allowPasswordHint':
    'With this off, only a public key can log in. Register a key before you turn it off.',
  'ssh.keyCount': 'Keys: {n}',
  'ssh.keysInvalid': 'Some keys are not in a valid format',
  'ssh.lockedOutBody':
    'Password login over SSH is disabled but no public key is registered. Add a public key, or allow password login.',
  'ssh.lockedOutTitle': 'You will not be able to log in',

  // --- network ---
  'network.title': 'Network settings',
  'network.modeDefault': 'Let the installer decide (DHCP)',
  'network.modeDefaultHint':
    'The installer configures wired networking automatically. This is right for almost every case.',
  'network.modeDhcp': 'Specify DHCP explicitly',
  'network.modeStatic': 'Use a static IP address',
  'network.modeRaw': 'Write netplan YAML directly',
  'network.interface': 'Target network card',
  'network.interfaceAny': 'All wired interfaces',
  'network.interfaceByName': 'By name',
  'network.interfaceByMac': 'By MAC address',
  'network.address': 'IP address / subnet',
  'network.addressHint': 'e.g. 192.168.1.10/24',
  'network.gateway': 'Default gateway',
  'network.nameservers': 'DNS servers',
  'network.searchDomains': 'Search domains',
  'network.optional': 'Do not wait for this interface at boot if it is unplugged',
  'network.optionalHint': 'Avoids a two-minute boot delay when the cable is not connected',
  'network.installerDefaultBody':
    'The installer tries DHCPv4 on every wired NIC matching {ethGlob} and {enGlob}, and automatically disables the ones that get no address. This is more reliable than writing the configuration by hand.',
  'network.interfaceName': 'Network card name',
  'network.interfaceNameHint': 'e.g. enp0s3, eno1, ens18. You need to know the name beforehand.',
  'network.macAddress': 'MAC address',
  'network.macAddressHint':
    'e.g. 52:54:00:12:34:56. It still matches after the machine is swapped out.',
  'network.modeDhcpHint': 'Choose this when only a specific network card should use DHCP.',
  'network.modeRawHint':
    'Choose this to write a complex setup yourself, such as a bond, a VLAN, or several NICs.',
  'network.modeStaticHint': 'Choose this when a server needs a fixed IP address.',
  'network.nameserversHint': 'Separate several servers with commas',
  'network.netplanReference': 'netplan reference',
  'network.rawDescription':
    'This goes straight into the autoinstall network key, in netplan v2 format.',
  'network.rawExample': 'e.g. a bond, a VLAN, or static settings for several NICs.{link}',
  'network.rawTitle': 'Write the netplan config directly',
  'network.searchDomainsHint': 'An internal domain, for example (optional)',
  'network.staticCloudInitNote':
    'On a physical server with a static IP, we recommend also turning on "Stop cloud-init from managing the network" in the After install settings. It keeps the configuration from being written back on every reboot.',
  'network.staticTitle': 'Static IP settings',
  'network.detailsTitle': 'Advanced settings',
  'network.detailsDescription':
    'The installer never asks about these. Leaving them alone is fine.',
  'network.detailsInactive':
    'Choose "Write the netplan YAML directly" above and the editor appears here.',

  // --- storage ---
  'storage.title': 'Disk layout',
  'storage.warning': 'Everything on the selected disk will be erased.',
  'storage.layoutLvm': 'LVM (recommended, easy to resize later)',
  'storage.layoutDirect': 'Simple (no LVM)',
  'storage.layoutZfs': 'ZFS',
  'storage.layoutRaw': 'Write the curtin config directly',
  'storage.match': 'Which disk to install to',
  'storage.matchLargest': 'The largest disk',
  'storage.matchSmallest': 'The smallest disk',
  'storage.matchSsd': 'An SSD',
  'storage.matchAny': 'Any single disk (for machines with only one)',
  'storage.matchPath': 'By device path',
  'storage.matchSerial': 'By serial number',
  'storage.matchModel': 'By model name',
  'storage.matchHint': 'On machines with several disks, matching by serial number or path is safer.',
  'storage.wholeDisk': 'Give the whole disk to the root filesystem',
  'storage.wholeDiskHint':
    'By default some space is left for snapshots. Turn this on to use all of it.',
  'storage.encrypt': 'Encrypt the whole disk (LUKS)',
  'storage.encryptPassphrase': 'Encryption passphrase',
  'storage.encryptWarning':
    'The passphrase is written in plain text into the config file. Handle the USB stick carefully. It must be typed at every boot.',
  'storage.disableSwap': 'Do not create swap',
  'storage.partitionTable': 'Partition table',
  'storage.ptableDefault': 'Automatic (GPT)',
  'storage.ptableMsdos': 'MBR (for older BIOS machines)',
  'storage.detailsTitle': 'Advanced settings',
  'storage.detailsDescription': 'The installer never asks about these. Leaving them alone is fine.',
  'storage.detailsRawActive':
    'While you write the curtin config directly, the swap, encryption and recovery partition settings are not used. The YAML below becomes the autoinstall storage section exactly as written.',
  'storage.detailsRawInactive':
    'Choose "Write the curtin config directly" above and the editor appears here.',
  'storage.encryptHint':
    'Protects the data if the machine is stolen, but the passphrase has to be typed at every boot.',
  'storage.layoutDirectHint':
    'Partitions are laid out directly on the disk, which keeps the result simple and easy to follow.',
  'storage.layoutLvmHint':
    'You can grow the volumes or take snapshots later. This is also the Ubuntu default.',
  'storage.layoutRawHint': 'Choose this to write RAID or a complex partition layout yourself.',
  'storage.layoutZfsHint':
    'Uses a ZFS root, with far stronger snapshots and data integrity checking.',
  'storage.modelHint': 'For example Samsung SSD*. Wildcards are allowed.',
  'storage.modelLabel': 'Model name',
  'storage.pathHint': 'For example /dev/nvme0n1 or /dev/sda. Wildcards (*) are allowed.',
  'storage.pathLabel': 'Device path',
  'storage.ptableGpt': 'GPT (explicit)',
  'storage.rawHint':
    'This goes into the autoinstall storage key exactly as written. A mistake here makes the installation fail partway through.',
  'storage.rawTemplateComment': 'Write the curtin storage config directly (UEFI + LVM example)',
  'storage.rawTitle': 'curtin storage config',
  'storage.serialHint':
    'Wildcards are allowed, as in CT500MX*. On a machine with several disks this is the most reliable way to name the one you mean.',
  'storage.serialLabel': 'Serial number',
  'storage.usbExcluded':
    'The installation USB itself is never matched by these rules (the installer excludes it).',
  'storage.warningBody':
    'The disk chosen for the installation is erased completely, existing partitions and all. Try the USB once in a virtual machine before you use it on a production machine.',

  // --- software ---
  'software.title': 'Software to install',
  'software.source': 'Installation scope',
  'software.sourceFull': 'Standard (ubuntu-server)',
  'software.sourceMinimal': 'Minimal (ubuntu-server-minimal)',
  'software.packages': 'Extra packages',
  'software.packagesHint': 'Requires an internet connection',
  'software.customPackages': 'Other packages (space separated)',
  'software.snaps': 'Snap packages',
  'software.updates': 'Updates during install',
  'software.updatesSecurity': 'Security updates only',
  'software.updatesAll': 'All updates',
  'software.drivers': 'Install third-party drivers automatically',
  'software.kernelCrashDumps': 'Kernel crash dumps (kdump)',
  'software.ubuntuPro': 'Ubuntu Pro token',
  'software.aptMirror': 'Package mirror',
  'software.aptMirrorDefault': 'Default',
  'software.aptMirrorCountry': 'Pick the nearest country mirror automatically',
  'software.aptMirrorCustom': 'Specify a URL',
  'software.aptProxy': 'APT proxy',
  'software.aptDebLineKeyNote':
    'When you write a deb line yourself, you have to supply its signing key (add `signed-by=` to the line, or write the key into {sources} in the raw YAML on the advanced tab).',
  'software.aptMirrorCountryHint':
    'The installer picks the nearest mirror for the country it connects from, which makes downloads faster.',
  'software.aptMirrorCustomHint': 'Point at your own mirror, such as one inside your network.',
  'software.aptMirrorDefaultHint': 'Uses archive.ubuntu.com.',
  'software.aptMirrorUrl': 'Mirror URL',
  'software.aptProxyHint': 'For fetching packages through a proxy on your network (optional)',
  'software.crashDumpsDefault': 'Let the installer decide',
  'software.crashDumpsOff': 'Disable',
  'software.crashDumpsOn': 'Enable',
  'software.customPackagesHint': 'Write package names that apt can install, separated by spaces',
  'software.driversHint':
    'Detects and installs third-party drivers, such as NVIDIA, automatically.',
  'software.snapsLabel': 'Snap names, one per line (write `name channel` to pick a channel)',
  'software.sourceFullHint':
    'The usual server install. The tools you normally reach for are already there.',
  'software.sourceMinimalHint':
    'Keeps the package set as small as possible. Good when the role is fixed, such as a container host.',
  'software.ubuntuProKeyNote':
    'On Ubuntu {series} this is written out as the {advantage} key ({pro} exists from 24.04 onward).',
  'software.ubuntuProTokenHint':
    'Starts with C and is 24 to 30 characters long. Setting it turns on services such as ESM (optional).',
  'software.ubuntuProTokenLabel': 'Token',
  'software.updatesDriversTitle': 'Updates and drivers',

  // The "advanced settings" disclosure (things the installer never asks about).
  'software.advancedTitle': 'Advanced settings',
  'software.advancedHint':
    'Things the installer never asks about: kernel flavor, extra repositories, Ubuntu Pro token.',

  // Option labels (APT_MIRROR_PRESETS / COMMON_PACKAGES in presets.ts)
  'software.aptMirrorPresetJp': 'Japan',
  'software.aptMirrorPresetDefault': 'Default',
  'software.aptMirrorPresetJaist': 'Japan (JAIST)',
  'software.aptMirrorPresetRiken': 'Japan (RIKEN)',
  'software.aptMirrorPresetUs': 'United States',
  'software.aptMirrorPresetDe': 'Germany',
  'software.packageOpensshServer': 'SSH server',
  'software.packageVim': 'vim editor',
  'software.packageCurl': 'curl',
  'software.packageGit': 'git',
  'software.packageHtop': 'htop',
  'software.packageTmux': 'tmux',
  'software.packageNetTools': 'net-tools',
  'software.packageBuildEssential': 'build-essential',
  'software.packageNfsCommon': 'NFS client',
  'software.packageLmSensors': 'lm-sensors',

  // --- after install ---
  'postinstall.title': 'What to do after installing',
  'postinstall.presets': 'Common options',
  'postinstall.lateCommands': 'Extra commands (run right after installing)',
  'postinstall.lateCommandsHint':
    'Prefix with curtin in-target -- to run inside the newly installed system',
  'postinstall.firstBoot': 'Commands to run on first boot',
  'postinstall.files': 'Files to ship on the USB and copy over',
  'postinstall.addFile': 'Add file',
  'postinstall.fileName': 'File name',
  'postinstall.fileTarget': 'Absolute destination path',
  'postinstall.fileMode': 'Permissions',
  'postinstall.fileOwner': 'Owner',
  'postinstall.fileContent': 'Content',
  'postinstall.adKeyMissing':
    'The autoinstall schema for Ubuntu {series} has no {key} key, so this is left out of the output.',
  'postinstall.edit': 'Edit',
  'postinstall.editFile': 'Edit file',
  'postinstall.extraKernelArgs': 'Extra kernel arguments',
  'postinstall.extraKernelArgsHint':
    'Appended to the kernel line in GRUB. You do not need to add autoinstall; it is put there for you. The characters ; & | are not allowed.',
  'postinstall.fileChars': '{n} characters',
  'postinstall.fileModeHint': 'e.g. 0644',
  'postinstall.fileNameHint': 'Name on the USB stick',
  'postinstall.fileOwnerHint': 'e.g. root',
  'postinstall.fileTargetHint': 'Absolute path on the installed system',
  'postinstall.filesEmpty': 'No files yet.',
  'postinstall.filesHint':
    'Write small config files directly here. For large files and archives, use Deployments instead.',
  'postinstall.firstBootDesc':
    'cloud-init runs these on the first boot after installation. They start once the network is up, so they suit anything that needs to reach the outside.',
  'postinstall.fullUpgradeExplain':
    'While "Updates during install" on the Software step applies security updates only, this runs {command} once the installation has finished, bringing every package up to date. The kernel may be replaced as well.',
  'postinstall.installerEnv': 'the installer environment',
  'postinstall.lateCommandsDesc':
    'These run when the installation has finished, just before the reboot. One command per line.',
  'postinstall.lateCommandsWhere': 'Mind where these run',
  'postinstall.lateCommandsWhereBody':
    'Commands run in {installerEnv}, with the new system mounted at {target}. To run something inside the new system, put {inTarget} in front of it.',
  'postinstall.needsNetwork': 'Needs internet',
  'postinstall.presetsHint': 'Tick the ones you want and the matching settings are added for you.',
  'postinstall.rawYaml': 'Override with raw YAML',
  'postinstall.rawYamlHint':
    'What you write here is merged into the generated autoinstall (matching keys are overwritten, arrays are replaced).',
  'postinstall.refreshChannelHint': 'Leave this empty to use the default subiquity channel.',
  'postinstall.reportingIgnored':
    'subiquity ignores reporting as soon as any section is interactive.',
  'postinstall.systemUpdate': 'System updates',

  // Post-install preset titles and descriptions (POST_INSTALL_PRESETS in presets.ts)
  'postinstall.presetSudoNopasswdTitle': 'Passwordless sudo',
  'postinstall.presetSudoNopasswdDesc':
    'Lets the created user run sudo without a password. Convenient for automation, but anyone who gets that login gets root immediately.',
  'postinstall.presetSshHardenTitle': 'Disable SSH password authentication',
  'postinstall.presetSshHardenDesc':
    'Allows public-key authentication only and forbids root SSH login. You will be locked out unless an SSH key is registered.',
  'postinstall.presetUnattendedUpgradesTitle': 'Automatic security updates',
  'postinstall.presetUnattendedUpgradesDesc':
    'Enables unattended-upgrades so security updates install automatically. It does not reboot on its own.',
  'postinstall.presetQemuGuestAgentTitle': 'Install QEMU guest agent',
  'postinstall.presetQemuGuestAgentDesc':
    'For KVM / Proxmox / QEMU guests. Lets the host shut the VM down cleanly and read its IP address.',
  'postinstall.presetDockerCeTitle': 'Install Docker (Ubuntu repository build)',
  'postinstall.presetDockerCeDesc':
    'Installs docker.io and docker-compose-v2 and adds the created user to the docker group. The docker group is effectively root.',
  'postinstall.presetChronyNtpTitle': 'Install time sync (chrony)',
  'postinstall.presetChronyNtpDesc':
    'Installs chrony for accurate clock sync, avoiding log skew and certificate errors.',
  'postinstall.presetUfwAllowSshTitle': 'Enable firewall, allow SSH only',
  'postinstall.presetUfwAllowSshDesc':
    'Enables ufw and allows only 22/tcp. Other services will need their ports opened manually.',
  'postinstall.presetDisableCloudInitNetTitle': 'Stop cloud-init from managing the network',
  'postinstall.presetDisableCloudInitNetDesc':
    'For physical servers with a static IP. Prevents cloud-init from rewriting the network config on each boot.',
  'postinstall.presetJaLocaleTitle': 'Install Japanese locale and manpages',
  'postinstall.presetJaLocaleDesc':
    'Installs language-pack-ja and manpages-ja. The server UI language itself stays English.',

  // --- review ---
  'review.title': 'Review your settings',
  'review.yaml': 'Generated configuration',
  'review.yamlUserData': 'user-data (cloud-init)',
  'review.yamlAutoinstall': 'autoinstall.yaml',
  'review.issues': 'Checks',
  'review.noIssues': 'No problems found',
  'review.errorsFound': 'There are errors. Please fix them.',
  'review.warningsFound': 'There are warnings',
  'review.export': 'Export settings',
  'review.exportProfile': 'Save profile (JSON)',
  'review.exportYaml': 'Save YAML',
  'review.exportBundle': 'Save everything as a ZIP',
  'review.importProfile': 'Load a profile',
  'review.unattended': 'Written as configured, the install runs start to finish with no input',
  'review.interactive': 'Some sections will be asked interactively during install',
  'review.aptUpgradeOff': 'No',
  'review.aptUpgradeOn': 'Yes',
  'review.deploymentCount': '{n} items',
  'review.deploymentCountWithSize': '{n} items ({size})',
  'review.diskRaw': 'Custom (curtin)',
  'review.exportDescription': 'You can export the settings on their own, without writing a USB.',
  'review.exportFolder': 'Export everything to a folder',
  'review.exportNote':
    'The profile JSON holds only the password hash, never the plain text. Use it when you build the same machine again and again.',
  'review.fixErrorsFirst': 'Fix the errors listed below before you continue.',
  'review.gpuNoDriver': 'No driver',
  'review.hintAutoinstall':
    'The same settings without the cloud-config wrapper. A copy is included on the USB so you can read it back later.',
  'review.hintGrub':
    'The /boot/grub/grub.cfg inside the ISO is rewritten to this. Without autoinstall the installer stops at a confirmation prompt.',
  'review.hintUserData':
    'This is what gets written to the USB configuration partition (CIDATA) as user-data. The leading #cloud-config line is the marker cloud-init requires.',
  'review.isoNotSelected': 'Not selected',
  'review.networkAuto': 'Automatic (DHCP)',
  'review.networkDhcp': 'DHCP (explicit)',
  'review.networkRaw': 'Custom YAML',
  'review.networkStatic': 'Static {address}',
  'review.none': 'None',
  'review.partlyInteractive': 'Some prompts',
  'review.runtimeAllFixed': 'None (all fixed)',
  'review.runtimeInteractive': 'manual entry',
  'review.runtimeKernelArg': 'boot menu',
  'review.runtimeMenuCount': '{n} menu entries',
  'review.shutdownPowerOff': 'Power off',
  'review.shutdownReboot': 'Reboot',
  'review.sshDisabled': 'Disabled',
  'review.sshEnabled': 'Enabled ({keys} keys / password {password})',
  'review.sshPasswordAllowed': 'allowed',
  'review.sshPasswordDenied': 'denied',
  'review.summary': 'Summary',
  'review.summaryAdditionalUsers': 'Additional users',
  'review.summaryLocaleKeyboard': 'Locale / keyboard',
  'review.summaryPostAction': 'After the install',
  'review.summaryServices': 'Services',
  'review.summaryUnattended': 'Fully unattended',

  // --- write ---
  'write.title': 'Write to a USB drive',
  'write.selectDevice': 'Choose where to write',
  'write.noDevices': 'No suitable USB drive found',
  'write.noDevicesHint': 'Insert a USB drive and press Refresh',
  'write.refreshDevices': 'Refresh devices',
  'write.deviceBlocked': 'This device cannot be written to',
  'write.systemDiskHidden': 'System disks are hidden for safety',
  'write.confirmTitle': 'Write now?',
  'write.confirmBody': 'Everything on this device will be erased. This cannot be undone.',
  'write.confirmTypeHint': 'Type ERASE to continue',
  'write.extraCaution': 'This device may be an external drive',
  'write.extraCautionBody':
    'It is large, or not connected over USB. Check what is on it before continuing.',
  'write.confirmWord': 'ERASE',
  'write.start': 'Start writing',
  'write.writing': 'Writing',
  'write.flushing': 'Finalizing the write',
  'write.verifying': 'Verifying the contents',
  'write.done': 'Done',
  'write.doneBody': 'Remove the USB drive and boot the target server from it.',
  'write.failed': 'Writing failed',
  'write.cancelled': 'Writing was cancelled',
  'write.cancelledBody': 'The USB drive is now corrupted. Please create it again.',
  'write.elevationNeeded': 'Administrator rights are required',
  'write.remaining': 'Remaining',
  'write.speed': 'Speed',
  'write.verifyOption': 'Verify after writing (roughly doubles the time)',
  'write.auditRecord': 'Leave a build record on the USB drive',
  'write.another': 'Make another one',
  'write.auditRecordHint':
    'Records the creation time, the ISO name, and a hash of the settings in autoinstall-usb.json. Passwords are never included.',
  'write.badgeCaution': 'Check first',
  'write.badgeElapsed': '{minutes} min {seconds} s',
  'write.badgeNotVerified': 'Not verified',
  'write.badgeTooSmall': 'Too small',
  'write.badgeVerified': 'Read-back verified',
  'write.badgeWritten': '{size} written',
  'write.configInvalid': 'The settings contain errors',
  'write.configInvalidBody': 'Fix the errors on the Review step before writing.',
  'write.currentlyMounted': 'Currently mounted at: {mountpoints}',
  'write.doNotRemove': 'Do not remove the USB drive while writing.',
  'write.elevationAllow': 'Approve the permission dialog when it appears.',
  'write.isoMissing': 'No ISO selected',
  'write.isoMissingBody': 'Go back to the first step and choose an ISO file.',
  'write.minimumSize': 'This ISO needs a USB drive of {size} or larger.',
  'write.next1': 'Safely eject the USB drive and plug it into the server you want to install.',
  'write.next2':
    'Power on the server and pick the USB drive as the boot device (F12, F11, or Esc on most machines).',
  'write.next3': 'In the GRUB menu, choose {entry} (it starts on its own after 30 seconds).',
  'write.next4Interactive': 'You will be asked to fill in a few items.',
  'write.next4Reboot': 'It reboots automatically once the installation finishes.',
  'write.next4Shutdown': 'It powers off automatically once the installation finishes.',
  'write.next4Unattended': 'From here on there is nothing to do but wait.',
  'write.next5Login': 'After the reboot you can log in as {user}.',
  'write.next5Ssh': 'For SSH, use {command}.',
  'write.nextTitle': 'What to do next',
  'write.optionsTitle': 'Write options',
  'write.showBlocked': 'Show devices that cannot be written to ({n})',
  'write.tooSmallBody': 'This device holds {size}, but {required} or more is required.',
  'write.troubleApplied':
    'The settings that were actually applied can be checked in {path} (readable by root only).',
  'write.troubleLogs': 'Logs are kept in {path} on the installed system.',
  'write.troubleTitle': 'If something goes wrong',
  'write.verifyOptionHint':
    'Reads the written data back and compares hashes, which catches defects in cheap USB drives.',

  // Progress and failures for the write itself (carried from main / media as LocalizedText)
  'write.deviceGone': 'The device is gone. Re-insert it and reload the list.',
  'write.deviceNotWritable': 'This device cannot be written to. Reload the device list.',
  'write.deviceStalled':
    'Writing to the USB drive stopped making progress. It may have been removed. Reinsert it and create the drive again.',
  'write.errorAlreadyRunning': 'A write is already in progress.',
  'write.errorCancelFailed':
    'The writing process running with administrator rights could not be stopped. The USB drive may still be being written to. Do not remove it. Either end that process in Task Manager or wait for it to finish.',
  'write.errorElevationDeclined':
    'Administrator rights were not granted. Writing to a USB drive requires administrator rights. Press "Start writing" again and choose Yes in the permission dialog.',
  'write.errorSpawnFailed': 'Could not start the writing process.',
  'write.errorWorkerExited': 'The writing process exited unexpectedly (exit code {code}).',
  'write.errorWorkerExitedNoOutput':
    'The writing process exited unexpectedly (exit code {code}). The request for administrator rights may have been cancelled. Please try again.',
  'write.isoNotSelected': 'This ISO has not been selected. Please choose it again.',
  'write.isoPrepareFailed': 'Could not prepare the ISO. The ISO file may be damaged.',
  'write.isoRecognized': 'ISO recognized: {volumeId}',
  'write.payloadMissing': 'Deployment files not found: {files}',
  'write.payloadNotSelected':
    'The deployment file "{name}" has not been selected. Please choose it again.',
  'write.quitAbort': 'Abort and quit',
  'write.quitContinue': 'Keep writing',
  'write.quitDetail':
    'If you quit now you will be left with a half-written USB drive that will not boot.\nEven if you choose "Abort and quit", the USB drive still has to be created again.',
  'write.quitMessage': 'The write to the USB drive has not finished.',
  'write.quitTitle': 'Writing in progress',
  'write.statusCheckingPrivileges': 'Checking permissions',
  'write.statusPreparing': 'Preparing to write',
  'write.statusStarted': 'Writing has started',
  'write.statusWaitingElevation': 'Waiting for administrator approval',
  'write.unmounting': 'Unmounting the device',
  'write.verifyMismatch':
    'The data read back does not match what was written (offset {offset}). The USB drive may be faulty, or it may have been removed during the write. Create the drive again, preferably with a different USB stick.',

  // --- devices (enumeration, and the worker re-checking them) ---
  'device.blockedSystemDisk': 'This is the system disk your OS runs from',
  'device.blockedReadOnly': 'This device is write-protected',
  'device.blockedUnknownSize': 'The capacity could not be read',
  'device.blockedVirtual': 'Virtual disks are not supported as a target',
  'device.blockedNotRemovable': 'This device could not be identified as removable',
  'device.blockedTooSmall': 'Capacity is too small ({min} or more is required)',
  'device.blockedTooLarge':
    'Devices larger than {max} are excluded, to prevent picking an external drive by mistake',
  'device.rejectedNotFound':
    'The target {path} was not found. It was removed, or it is not a device this tool is allowed to write to.',
  'device.rejectedNotWritable': '{path} cannot be written to: {reason}',
  'device.rejectedNotWritableUnknown': '{path} cannot be written to (it is not an eligible device).',
  'device.rejectedSizeMismatch':
    'The capacity of {path} does not match the job (expected {expected}, found {actual}). Please select the device again.',
  'device.rejectedSerialMismatch':
    '{path} is not the device you selected (serial: expected {expected}, found {actual}). It was re-inserted or swapped for another device. Please select it again.',
  'device.rejectedSerialMissing':
    '{path} is not the device you selected (serial: expected {expected}, none readable). It was re-inserted or swapped for another device. Please select it again.',
  'device.rejectedDescriptionMismatch':
    '{path} is not the device you selected (expected "{expected}", found "{actual}"). Please select it again.',

  // --- USB layout planning (fails before anything is written) ---
  'layout.notProtectiveMbr':
    'This ISO has no protective MBR. It may not be an Ubuntu live-server ISO.',
  'layout.noGpt': 'This ISO has no GPT. The format is not supported.',
  'layout.isoTruncated':
    'This ISO file is truncated. Partition "{partition}" runs to {needed}, but the file is only {fileSize}. Check that the download completed and that its SHA256 matches the official one.',
  'layout.diskTooSmall':
    'This USB drive is too small. Writing the ISO ({isoSize}) plus the config partition ({cidataSize}) needs at least {required}, but this device is {deviceSize}.',
  'layout.cidataTooSmall': 'The config partition must be at least 1 MiB.',

  // --- write steps (the label under the progress bar) ---
  'writeOp.clearTable': 'Invalidating the partition table',
  'writeOp.isoBody': 'ISO image body',
  'writeOp.clearStaleGpt': 'Erasing the stale backup GPT at the end of the ISO',
  'writeOp.clearGap': 'Erasing the gap up to the alignment boundary',
  'writeOp.cidata': 'Config partition (CIDATA)',
  'writeOp.backupGptEntries': 'Backup GPT entries',
  'writeOp.backupGptHeader': 'Backup GPT header',
  'writeOp.gptEntries': 'GPT partition entries',
  'writeOp.gptHeader': 'GPT header',
  'writeOp.protectiveMbr': 'Protective MBR (including GRUB boot code)',
  'writeOp.verifying': 'Reading the written data back to check it',
  'writeOp.flushing': 'Flushing pending writes to the device',

  // --- building the config partition (CIDATA) ---
  'seed.reservedNameFile':
    'The extra file name "{name}" is reserved on the configuration partition. Use a different name.',
  'seed.reservedNameDeployment':
    'The deployment name "{name}" is reserved on the configuration partition. Use a different name.',
  'seed.duplicateNameFile':
    'The extra file name "{name}" is duplicated. The configuration partition cannot hold two files with the same name.',
  'seed.duplicateNameDeployment':
    'The deployment name "{name}" is duplicated. The configuration partition cannot hold two files with the same name.',
  'seed.payloadTooLarge':
    '{name} is {size}, which does not fit on the USB configuration partition (limit {limit}). Switch to downloading it from a URL instead.',

  // --- when YAML generation stops ---
  'generate.overlaySyntax': 'Overlay YAML syntax error: {detail}',
  'generate.overlayNotMapping': 'The overlay YAML must be a mapping.',
  'generate.failed': 'Could not generate the YAML. Review the configuration.',

  // --- native OS dialogs (they never reach the renderer, so main translates them) ---
  'dialog.chooseIso': 'Choose an Ubuntu Server ISO file',
  'dialog.filterIso': 'ISO image',
  'dialog.saveProfile': 'Export the profile to a file',
  'dialog.openProfile': 'Open a profile from a file',
  'dialog.importProfile': 'Import a profile',
  'dialog.filterProfile': 'Profile',
  'dialog.exportBundleDir': 'Choose a folder for the generated configuration',
  'dialog.pickPayload': 'Choose a file to deploy onto the installed system',
  'dialog.filterArchive': 'Archive',
  'dialog.readTextFile': 'Choose a file',
  'dialog.filterPublicKey': 'Public key',
  'dialog.filterText': 'Text',
  'dialog.filterAllFiles': 'All files',

  // --- generated artefacts (a file, not a screen) ---
  'bundle.readme': `Ubuntu Server unattended install configuration

How to use these files (if you build the USB drive with another tool):
1. Write the Ubuntu live-server ISO to a USB drive with Rufus / balenaEtcher (DD mode).
2. Format a second USB drive as FAT32 and set its volume label to CIDATA.
3. Copy user-data and meta-data onto it.
4. Insert both drives and boot the server.
5. In the GRUB menu press e, add autoinstall at the end of the linux line (before ---), then press Ctrl+X to boot.
   Note: without this the installer stops at "Continue with autoinstall? (yes|no)".

If you build the USB drive with this tool, steps 2 to 5 are all done for you.

Caution: files configured under app deployment are not exported here.
         late-commands mounts the CIDATA partition and reads them from there.

Generated by: {tool}
Date: {date}`,

  // --- profiles ---
  'profile.library': 'Profiles',
  'profile.unsaved': 'Unsaved settings',
  'profile.dirty': 'You have unsaved changes',
  'profile.save': 'Save',
  'profile.saveAs': 'Save as',
  'profile.name': 'Profile name',
  'profile.namePlaceholder': 'e.g. Standard GPU server',
  'profile.saveHint': 'You can reopen and edit it later. Only the password hash is stored.',
  'profile.new': 'New',
  'profile.import': 'Import from file',
  'profile.openFile': 'Open a file',
  'profile.exportFile': 'Export to file',
  'profile.revealFolder': 'Open the profiles folder',
  'profile.empty': 'No saved profiles yet. Configure something and press Save.',
  'profile.rename': 'Rename',
  'profile.duplicate': 'Duplicate',
  'profile.delete': 'Delete',
  'profile.deleteTitle': 'Delete this profile?',
  'profile.deleteBody': 'The following profile will be deleted. This cannot be undone.',
  'profile.badgeUsers': 'users',
  'profile.badgeDeployments': 'deploys',
  'profile.badgeServices': 'services',
  'profile.badgeStaticIp': 'static IP',
  'profile.migrated': 'Profile loaded',
  'profile.badgeDeploymentsCount': 'Deployments: {n}',
  'profile.badgeServicesCount': 'Services: {n}',
  'profile.badgeUsersCount': 'Extra users: {n}',
  'profile.copyName': 'Copy of {name}',
  'profile.discardConfirm': 'You have unsaved changes. Discard them and continue?',

  // --- additional users ---
  'users.title': 'Additional users',
  'users.description':
    'Users created in addition to the administrator, e.g. dedicated accounts for running applications.',
  'users.add': 'Add user',
  'users.empty': 'No additional users.',
  'users.username': 'Username',
  'users.realname': 'Description / full name',
  'users.password': 'Password',
  'users.passwordHint': 'Leave empty to disable password login (SSH key only, or service-only account)',
  'users.sudo': 'sudo rights',
  'users.sudoNone': 'None',
  'users.sudoPassword': 'Yes (asks for a password)',
  'users.sudoNopasswd': 'Yes (no password)',
  'users.groups': 'Extra groups',
  'users.groupsHint': 'Comma separated, e.g. docker, adm',
  'users.shell': 'Login shell',
  'users.createHome': 'Create a home directory',
  'users.systemAccount': 'Make it a system account',
  'users.systemAccountHint': 'UID below 1000 and hidden from login lists. For service accounts.',
  'users.sshKeys': 'SSH public keys',
  'users.badgeNoLogin': 'Cannot log in',
  'users.clearPassword': 'Clear',
  'users.nopasswdWarning':
    'This user can become root without entering a password. For an account that only runs a service, choose "None" instead.',
  'users.passwordAlreadySet':
    'A password is already set. Fill this in only if you want to change it.',
  'users.sshKeyCount': '{n} SSH keys',

  // Option labels (SHELL_CHOICES in provisioning.ts)
  'users.shellBash': 'bash (default)',
  'users.shellSh': 'sh',
  'users.shellNologin': 'No login (for services)',

  // --- deployments ---
  'deploy.title': 'Deploy apps and files',
  'deploy.description':
    'Ship files on the USB drive, or fetch them from a URL on first boot, and unpack them into a directory.',
  'deploy.add': 'Add deployment',
  'deploy.empty': 'Nothing to deploy.',
  'deploy.kind': 'Kind',
  'deploy.kindFile': 'Place a single file',
  'deploy.kindArchive': 'Extract an archive',
  'deploy.sourceKind': 'Source',
  'deploy.sourceHostFile': 'A file on this PC, shipped on the USB drive',
  'deploy.sourceInline': 'Type the content here',
  'deploy.sourceUrl': 'Download from a URL on first boot',
  'deploy.pickFile': 'Choose a file',
  'deploy.selectedFile': 'Selected',
  'deploy.missingFile': 'The source file is missing. Please choose it again.',
  'deploy.url': 'Download URL',
  'deploy.sha256': 'SHA-256 (tamper check)',
  'deploy.sha256Hint': '64 hex characters. It works without one, but nothing is verified.',
  'deploy.archiveFormat': 'Archive format',
  'deploy.targetDir': 'Destination directory',
  'deploy.targetFile': 'Destination path',
  'deploy.owner': 'Owner',
  'deploy.group': 'Group',
  'deploy.chownRecursive': 'Set this owner on the whole destination',
  'deploy.chownRecursiveHint':
    'Even when off, the destination directory itself gets the owner above (its contents keep whatever the archive carries). Turn it on to change every extracted file as well.',
  'deploy.postCommand': 'Command to run after extracting',
  'deploy.postCommandHint': 'Runs in the destination directory, e.g. npm ci --omit=dev',
  'deploy.content': 'Content',
  'deploy.sizeWarning': 'Total size shipped on the USB drive',
  'deploy.bundleSizeWarning':
    '{size} will be shipped on the USB drive. That makes writing take longer and takes up room on the drive. For large files, "Download from a URL on first boot" is usually the better choice.',
  'deploy.fileNameOnUsb': 'File name on the USB drive',
  'deploy.summaryHostFile': 'Shipped on the USB drive · {size}',
  'deploy.summaryInline': 'Inline content · {size}',
  'deploy.summaryUrl': 'Downloaded from {url} on first boot',
  'deploy.unnamed': '(unnamed)',
  'deploy.urlDownloadNote':
    'The file is downloaded on first boot, so the machine needs an internet connection. {curl} is added automatically.',

  // --- services ---
  'service.title': 'Register systemd services',
  'service.description': 'Services that start automatically on the installed system.',
  'service.add': 'Add service',
  'service.empty': 'No services to register.',
  'service.name': 'Service name',
  'service.nameHint': 'Do not append .service, e.g. myapp',
  'service.descriptionField': 'Description',
  'service.execStart': 'Start command (ExecStart)',
  'service.execStartHint': 'Use an absolute path; systemd does not resolve PATH.',
  'service.execStartPre': 'Command to run first (ExecStartPre)',
  'service.workingDirectory': 'Working directory',
  'service.user': 'Run as user',
  'service.group': 'Run as group',
  'service.environment': 'Environment variables',
  'service.environmentHint': 'One KEY=VALUE per line',
  'service.environmentFile': 'Environment file',
  'service.type': 'Service type',
  'service.restart': 'Restart on failure',
  'service.restartNo': 'Never restart',
  'service.restartOnFailure': 'Only on failure',
  'service.restartAlways': 'Always',
  'service.restartSec': 'Seconds before restarting',
  'service.after': 'Start after (After)',
  'service.afterHint': 'Comma separated, e.g. network-online.target, docker.service',
  'service.wantedBy': 'Enable for (WantedBy)',
  'service.enabled': 'Enable autostart at install time',
  'service.preview': 'Unit file content',
  'service.badgeEnabled': 'Auto-start',
  'service.badgeManual': 'Manual',
  'service.nameInvalid': 'Contains characters that cannot be used',
  'service.noCommand': '(no command set)',
  'service.typeForking': 'forking (the program daemonizes itself)',
  'service.typeOneshot': 'oneshot (runs once and exits)',
  'service.typeSimple': 'simple (stays running)',
  'service.unnamed': '(unnamed)',
  'service.userRootDefault': 'root (default)',

  // --- GPU / CUDA ---
  'gpu.title': 'NVIDIA GPU / CUDA',
  'gpu.description':
    "Installs the driver and CUDA from NVIDIA's official repository on first boot. It downloads several GB.",
  'gpu.enable': 'Install the NVIDIA driver / CUDA',
  'gpu.driver': 'Driver',
  'gpu.driverNone': 'None (toolkit only)',
  'gpu.driverOpen': 'Open kernel modules (nvidia-open)',
  'gpu.driverOpenHint': 'Recommended for Turing (RTX 20 series) and newer.',
  'gpu.driverProprietary': 'Legacy driver (cuda-drivers)',
  'gpu.driverProprietaryHint': 'For older GPUs such as Maxwell through Volta.',
  'gpu.toolkit': 'CUDA toolkit',
  'gpu.setupPath': 'Set PATH and LD_LIBRARY_PATH',
  'gpu.setupPathHint': 'Writes /etc/profile.d/cuda.sh so nvcc is on the PATH after login.',
  'gpu.containerToolkit': 'Let Docker use the GPU',
  'gpu.containerToolkitHint': 'Installs nvidia-container-toolkit and registers it with Docker.',
  'gpu.rebootNote': 'If a driver is installed, the machine reboots automatically once setup finishes.',
  'gpu.unsupported': 'No CUDA repository exists for this version',
  'gpu.archUnsupportedBody':
    'This ISO is the {arch} build. CUDA can only be installed from an amd64 (x86_64) ISO.',
  'gpu.dockerMissing':
    'You asked to use the GPU from containers, but Docker will not be installed. Turn Docker on under "Common options" on the "After install" step.',
  'gpu.installNote':
    'On first boot {keyring} is installed first, then the packages are pulled in with apt.',
  'gpu.noRepoBody':
    'NVIDIA does not publish a CUDA repository for Ubuntu {series}. Use an LTS ISO (22.04 / 24.04 / 26.04) instead.',
  'gpu.nothingSelected': '(neither a driver nor a toolkit is selected)',
  'gpu.officialGuide': "NVIDIA's official instructions",
  'gpu.repoInUse': "Uses NVIDIA's {repo} repository.",
  'gpu.unsupportedSeries': 'No CUDA repository exists for Ubuntu {series}',
  'gpu.willInstall': 'What gets installed',

  // Option labels (CUDA_TOOLKIT_CHOICES in provisioning.ts)
  'gpu.toolkitLatest': 'Latest (cuda-toolkit)',
  'gpu.toolkitCuda133': 'CUDA 13.3',
  'gpu.toolkitCuda132': 'CUDA 13.2',
  'gpu.toolkitCuda131': 'CUDA 13.1',
  'gpu.toolkitCuda130': 'CUDA 13.0',
  'gpu.toolkitCuda129': 'CUDA 12.9',
  'gpu.toolkitCuda128': 'CUDA 12.8',
  'gpu.toolkitCuda126': 'CUDA 12.6',
  'gpu.toolkitNone': 'Driver only',

  // --- misc ---
  'postinstall.aptFullUpgrade': 'Upgrade every package (apt full-upgrade)',
  'postinstall.aptFullUpgradeHint':
    'Runs right after installing. It takes a while, but the system is fully up to date on first boot.',
  'postinstall.tabPresets': 'Common options',
  'postinstall.tabDeploy': 'Deployments',
  'postinstall.tabServices': 'Services',
  'postinstall.tabFiles': 'Files and commands',
  'postinstall.tabAdvanced': 'Advanced',
  'postinstall.advancedHint':
    'Settings the installer never asks about. You can usually leave this closed.',

  // --- Runtime values (per-host settings) ---
  'runtime.purposeTitle': 'What this step is for',
  'runtime.purposeBody':
    'One USB used to install several machines gives every machine the same hostname and the same IP address. This step lets the values that differ from machine to machine be decided while each machine installs, without building another USB. No USB per machine, and no configuration file per machine.',
  'runtime.purposeSkip':
    'If you are installing a single machine, leave this step at its default: every value comes from this profile.',
  'runtime.title': 'Values decided at install time',
  'runtime.intro':
    'Settings such as IP address and hostname differ per machine. Choose how each one is decided.',
  'runtime.fieldHostname': 'Hostname',
  'runtime.fieldNetwork': 'Network (IP / gateway / DNS)',
  'runtime.fieldDisk': 'Target disk',
  'runtime.modeFixed': 'Use the value from this profile',
  'runtime.modeFixedHint': 'Always the same value. Fine when you only build one machine.',
  'runtime.modeKernelArg': 'Pick from the boot menu',
  'runtime.modeKernelArgHint':
    'The USB boot menu lists entries such as "web01" and "web02"; the chosen values are written into the configuration.',
  'runtime.modeInteractive': 'Type it in the installer',
  'runtime.modeInteractiveHint':
    'The normal Ubuntu installer screen appears with these values pre-filled, ready to be edited.',
  'runtime.presetsTitle': 'Hosts listed in the boot menu',
  'runtime.presetsIntro':
    'Each row becomes one boot menu entry. Only the fields set to "Pick from the boot menu" are used.',
  'runtime.presetLabel': 'Menu name',
  'runtime.presetHostname': 'Hostname',
  'runtime.presetIpv4': 'IPv4 (CIDR)',
  'runtime.presetGateway': 'Gateway',
  'runtime.presetDns': 'DNS (comma separated)',
  'runtime.presetDisk': 'Disk',
  'runtime.addPreset': 'Add host',
  'runtime.removePreset': 'Remove this row',
  'runtime.noPresets': 'No hosts yet. Use "Add host" to create one.',
  'runtime.offerInteractiveEntry': 'Also offer an "enter values manually" boot entry',
  'runtime.offerInteractiveEntryHint':
    'An escape hatch for hosts that are not in the list. It opens the installer screens.',
  'runtime.grubFree': 'Boot menu space left',
  'runtime.grubFreeHint':
    'The boot menu must fit in 2048 bytes, because the ISO is patched in place rather than rebuilt.',
  'runtime.grubTooLarge':
    'Too many hosts: the boot menu no longer fits in 2048 bytes. Remove rows or shorten the menu names.',
  'runtime.howItWorks': 'How it works',
  'runtime.howItWorksBody':
    'Boot menu entries pass kernel arguments such as ai.hostname=. Just before the install starts, only the matching parts of autoinstall.yaml are rewritten. If no argument is present the profile value is used, so nothing stalls.',
  'runtime.previewTitle': 'Boot menu preview',
  'runtime.needIso': 'Select an ISO to preview the real boot menu.',
  'runtime.grubFreeBytes': '{bytes} bytes',
  'runtime.prereqDisk':
    'To pick the disk from the boot menu, the Disk step has to be set to select the disk by serial number.',
  'runtime.prereqNetwork':
    'To pick the network from the boot menu, the Network step has to be set to a static IP address (it is "{mode}" right now).',
  'runtime.prereqTitle': 'This setup needs a bit more',

  // --- Advanced (official options normally kept out of the way) ---
  'adv.kernelTitle': 'Kernel',
  'adv.kernelDefault': 'Default (linux-generic)',
  'adv.kernelHwe': 'Newer hardware (HWE)',
  'adv.kernelHweHint': 'Choose this when a recent CPU / NIC / GPU is not detected.',
  'adv.kernelCustom': 'Name the package',
  'adv.kernelFlavor': 'Kernel package name',
  'adv.searchDrivers': 'Look for third-party drivers',
  'adv.searchDriversHint': 'Lets the installer search for drivers such as NVIDIA (needs network).',
  'adv.searchDriversDefault': 'Let the installer decide',
  'adv.searchDriversOn': 'Search for them',
  'adv.searchDriversOff': 'Do not search',
  'adv.codecs': 'Install restricted codecs',
  'adv.codecsHint': 'Packages such as MP3 / H.264 that are separated for licensing reasons.',
  'adv.oem': 'Install in OEM mode',
  'adv.oemHint': 'For pre-shipment setup: user creation is redone on first boot.',
  'adv.aptTitle': 'Extra APT settings',
  'adv.aptSources': 'Additional repositories',
  'adv.aptSourcesHint':
    'One per line: either ppa:user/name or a full deb line. Enabled during installation.',
  'adv.aptPreserve': 'Keep the existing sources.list',
  'adv.aptPreserveHint': 'Disables mirror auto-configuration and uses only what you wrote.',
  'adv.aptFallback': 'When the mirror is unreachable',
  'adv.aptFallbackAbort': 'Abort',
  'adv.aptFallbackOffline': 'Continue offline (offline-install)',
  'adv.aptFallbackContinue': 'Ignore and continue (continue-anyway)',
  'adv.swapTitle': 'Swap',
  'adv.swapAuto': 'Let the installer decide',
  'adv.swapNone': 'No swap',
  'adv.swapSize': 'Set a size',
  'adv.swapSizeValue': 'Swap size',
  'adv.swapSizeHint': 'Write it with a unit, such as 4G or 2048M.',
  'adv.resetPartition': 'Create a recovery partition',
  'adv.resetPartitionHint': 'Ubuntu 24.04 and later. Reserves space for a factory reset.',
  'adv.resetPartitionSize': 'Recovery partition size',
  'adv.errorCommands': 'Commands to run on failure',
  'adv.errorCommandsHint': 'Run only when the install fails. One command per line.',
  'adv.collectLogs': 'Collect logs on failure',
  'adv.collectLogsHint':
    'Bundles /var/log/installer so the cause can be investigated later (uses error-commands).',
  'adv.debconf': 'debconf pre-answers',
  'adv.debconfHint':
    'Answers package questions in advance. One `package question type value` per line.',
  'adv.reporting': 'Install progress reporting',
  'adv.reportingConsole': 'Show on the console (default)',
  'adv.reportingNone': 'Do not report',
  'adv.reportingWebhook': 'Webhook (POST to a URL)',
  'adv.reportingRsyslog': 'rsyslog server',
  'adv.reportingUrl': 'Destination',
  'adv.reportingUrlHint': 'Progress is streamed there. Useful when building many machines at once.',
  'adv.adTitle': 'Join Active Directory',
  'adv.adHint': 'The domain join password is asked for during installation; it is never stored here.',
  'adv.adDomain': 'Domain name',
  'adv.adAdmin': 'Administrator used to join',
  'adv.adWarning': 'Enabling AD join means the install is no longer fully unattended.',
  'adv.refreshInstaller': 'Update the installer first',
  'adv.refreshInstallerHint': 'Refreshes subiquity itself from snap after boot (needs network).',
  'adv.interactiveAll': 'Confirm every section in the installer',
  'adv.interactiveAllHint':
    'Values are pre-filled but every screen must be stepped through by hand. Useful for dry runs.',
  'adv.identityGroups': 'Add the admin user to extra groups',
  'adv.identityGroupsUnsupported': 'Not available on this release (26.04 and later)',

  // Option labels (KERNEL_FLAVORS / APT_FALLBACK_CHOICES in advanced.ts)
  'adv.kernelFlavorGeneric': 'Standard (generic)',
  'adv.kernelFlavorHwe': 'HWE (newer hardware)',
  'adv.kernelFlavorGenericHwe': 'generic-hwe',
  'adv.kernelFlavorLowlatency': 'Low latency',
  'adv.aptFallbackChoiceAbort': 'Abort the install (default)',
  'adv.aptFallbackChoiceOffline': 'Continue offline',
  'adv.aptFallbackChoiceContinue': 'Continue with the broken mirror',

  // --- error boundary ---
  'boundary.body':
    'Rendering failed because the settings are not in the shape this screen expects. This can happen when you open a profile that was edited by hand or saved by a different version of this tool.',
  'boundary.reload': 'Reload the app',
  'boundary.retry': 'Try this screen again',
  'boundary.title': 'This screen could not be displayed',

  // --- store ---
  'store.seriesAligned':
    'This profile was saved for Ubuntu {savedSeries}, so it has been switched to match the selected ISO ({isoSeries}). Which settings are available differs between releases, so check the result on the confirmation screen.',
  'store.writeStartFailed': 'Could not start writing.',

  // --- Loading a saved profile (the safety notes behind pitfalls 49 / 50) ---
  'migrate.notAProfile': 'The file did not contain a profile.',
  'migrate.unsupportedSeries':
    'The saved Ubuntu version ({series}) is not supported, so it was reset to the default.',
  'migrate.enumReset':
    'The value {value} for {field} was not recognized, so it was reset to the default {fallback}.',
  'migrate.itemsDropped':
    'Skipped {count} entry/entries under {category} because they were not in a valid format.',
  'migrate.storageModeReset':
    'The disk layout method ({mode}) was not recognized, so it was reset to the default. The disk selection itself has been kept. Check it before you write.',
  'migrate.fromV1':
    'Loaded a profile saved in an older format. Extra users, app deployments, services and GPU are not configured.',
  'migrate.fromV2':
    'Loaded a profile saved in an older format. Values decided at boot time are not configured.',
  'migrate.fromV3':
    'Loaded a profile saved in an older format. Kernel choice, extra repositories and log collection on failure are not configured.',
  'migrate.fromNewer':
    'This profile was saved by a newer version of the tool. Settings that could not be recognized were ignored.',
  // Field and category names are interpolated into the sentences above, so that
  // languages with a different word order still read correctly.
  'migrate.field.softwareUpdates': 'the update scope (software.updates)',
  'migrate.field.aptFallback':
    'the action when the mirror is unavailable (apt.fallback)',
  'migrate.field.behaviorShutdown': 'the action after installation (behavior.shutdown)',
  'migrate.field.storagePartitionTable': 'the partition table (storage.partitionTable)',
  'migrate.category.snap': 'snaps',
  'migrate.category.file': 'extra files',
  'migrate.category.user': 'extra users',
  'migrate.category.service': 'services',
  'migrate.category.deployment': 'app deployments',


  // --- Profile validation (`validate.ts` issues) ---
  'validate.fieldOwner': 'owner',
  'validate.fieldGroup': 'group',
  'validate.hostFieldHostname': 'hostname',
  'validate.hostFieldIpv4': 'ipv4',
  'validate.hostFieldGateway': 'gateway',
  'validate.hostFieldNameservers': 'nameservers',
  'validate.hostFieldDisk': 'disk',

  'validate.unknownPreset':
    'Unknown preset "{id}". The profile may have been created by a newer version.',
  'validate.hostnameEmpty': 'Enter a hostname.',
  'validate.hostnameInvalid':
    'Hostname may contain only letters, digits and hyphens, must start and end alphanumeric, max 63 chars.',
  'validate.localeEmpty': 'Choose a locale.',
  'validate.keyboardEmpty': 'Choose a keyboard layout.',
  'validate.usernameEmpty': 'Enter a username.',
  'validate.usernameInvalid':
    'Username must start with a lowercase letter or underscore and contain only lowercase letters, digits, hyphens and underscores (max 32).',
  'validate.usernameReserved': '"{username}" is reserved by the system. Choose another name.',
  'validate.usernameSameAsHostname':
    'Username and hostname are identical; the installer may reject this.',
  'validate.passwordMissing': 'Set a password. It is stored hashed.',
  'validate.passwordPlainText':
    'The password is plain text. A crypt(3) hash starting with $6$ is required.',
  'validate.passwordHashNotSha512':
    'The password hash is not standard SHA-512 crypt. Verify that login works.',
  'validate.sshKeyMalformed':
    'SSH public key #{n} is malformed. Expected one line like "ssh-ed25519 AAAA...".',
  'validate.sshKeysWithoutServer':
    'SSH keys are configured but the SSH server will not be installed, so remote login is impossible.',
  'validate.sshHardenWithoutKeys':
    'SSH password authentication is disabled but no public key is registered. You would be locked out of SSH.',
  'validate.sshNoPasswordNoKey':
    'SSH password login is disabled and no public key is registered. You would be locked out of SSH.',
  'validate.networkAddressInvalid':
    'Enter the IP address with a prefix length, e.g. "192.168.1.10/24".',
  'validate.networkGatewayInvalid': 'The gateway address is invalid.',
  'validate.networkGatewayMissing':
    'No default gateway is set; the machine cannot reach other networks.',
  'validate.networkNameserverInvalid': 'DNS server #{n} is not a valid IP address.',
  'validate.networkNameserversMissing': 'No DNS server is set; name resolution and apt will fail.',
  'validate.networkYamlSyntax': 'Network YAML syntax error: {detail}',
  'validate.storageYamlSyntax': 'Storage YAML syntax error: {detail}',
  'validate.zfsEncryptionUnverified':
    'Encryption with the ZFS layout behaves differently across installer versions. Verify on real hardware.',
  'validate.encryptionPassphraseTooShort':
    'The disk encryption passphrase is too short (minimum 8 characters).',
  'validate.encryptionPassphrasePlainInYaml':
    'The disk encryption passphrase is written in plain text into the autoinstall YAML. Handle the USB stick accordingly.',
  'validate.encryptionRequiresLvm':
    'Disk encryption only works with the LVM layout; it is ignored for {mode}.',
  'validate.diskMatchEmpty': 'A disk match kind was chosen but left empty, so no disk will match.',
  'validate.diskMatchAny':
    'The install target is set to "any disk". On a machine with several disks there is no way to tell which one will be erased. Match by serial number or path.',
  'validate.diskMatchSizeBased':
    'On machines with several disks, matching by serial number or path is safer.',
  'validate.archiveFormatUnsupported':
    'Deployment "{name}" uses an unsupported archive format "{format}".',
  'validate.fileOwnerNotCreated':
    'File "{name}" is owned by "{owner}", which this config does not create. Unless it already exists, the install fails at the very end.',
  'validate.deploymentOwnerNotCreated':
    'Deployment "{name}" is owned by "{owner}", which this config does not create. Unless it already exists, the install fails at the very end.',
  'validate.resetPartitionUnsupported':
    'Ubuntu {series} has no reset partition; the setting is ignored.',
  'validate.aptSourceNameInvalid':
    'Repository name "{name}" is invalid; use letters, digits, dots, underscores and hyphens.',
  'validate.aptSourceNameDuplicated':
    'Repository name "{name}" is duplicated; the later entry silently replaces the earlier one.',
  'validate.aptFallbackUnsupported':
    'Ubuntu {series} does not support the apt mirror fallback setting; it is ignored.',
  'validate.cudaToolkitNameInvalid':
    'The CUDA toolkit name "{toolkit}" is not a valid apt package name.',
  'validate.fileOwnerInvalid':
    'File "{name}" has an invalid owner "{owner}"; use a user name or user:group.',
  'validate.deploymentOwnerFieldInvalid': 'Deployment "{name}" has an invalid {field} "{value}".',
  'validate.interfaceNameEmpty': 'The interface name is empty; netplan needs it as the key.',
  'validate.interfaceNameInvalid':
    'The interface name "{name}" is invalid; use letters, digits and . _ - starting with a letter.',
  'validate.macAddressInvalid': 'Enter the MAC address as "aa:bb:cc:dd:ee:ff".',
  'validate.aptMirrorUriEmpty':
    'Enter the mirror URL; leaving it empty silently falls back to the default mirror.',
  'validate.overlayOverridesDangerousKeys':
    'The overlay YAML overrides {keys}, so the disk and user settings from the UI no longer apply.',
  'validate.packagesWithoutGateway':
    'Extra packages or snaps are configured but there is no gateway, so the internet is unreachable.',
  'validate.ubuntuProTokenInvalid':
    'The Ubuntu Pro token is malformed (starts with C, 24-30 characters).',
  'validate.sourceKeyUnsupported':
    'Ubuntu {series} autoinstall has no source key; the minimal selection will be ignored.',
  'validate.kernelCrashDumpsUnsupported':
    'kernel-crash-dumps is not supported on Ubuntu {series} and will be ignored.',
  'validate.fileTargetPathNotAbsolute': 'File #{n} needs an absolute target path.',
  'validate.fileModeInvalid': 'File #{n} permission must be octal such as 0644.',
  'validate.fileNameInvalid': 'File #{n} has an invalid file name.',
  'validate.sudoNopasswdWarning':
    'Passwordless sudo is enabled. Anyone who takes that account gets root immediately.',
  'validate.additionalUserNameEmpty': 'Additional user #{n} has no username.',
  'validate.additionalUserNameInvalid': 'Additional user "{username}" has an invalid username.',
  'validate.additionalUserNameReserved': '"{username}" is reserved by the system.',
  'validate.additionalUserNameDuplicated': 'Username "{username}" is duplicated.',
  'validate.additionalUserPasswordPlainText': 'The password for "{username}" is plain text.',
  'validate.additionalUserNoLogin':
    '"{username}" has neither a password nor an SSH key and cannot log in (the account will be locked).',
  'validate.additionalUserSshKeyMalformed': 'SSH key #{n} for "{username}" is malformed.',
  'validate.additionalUserSudoNopasswd': '"{username}" can use sudo without a password.',
  'validate.deploymentTargetPathNotAbsolute': 'Deployment #{n} needs an absolute target path.',
  'validate.deploymentNameInvalid': 'Deployment #{n} has an invalid file name.',
  'validate.deploymentModeInvalid': 'Deployment #{n} permission must be octal such as 0644.',
  'validate.deploymentUrlInvalid': 'Deployment #{n} has an invalid URL.',
  'validate.deploymentSha256Missing':
    'Deployment #{n} downloads from a URL without a SHA-256 checksum, so tampering cannot be detected.',
  'validate.deploymentSha256Invalid': 'Deployment #{n} SHA-256 must be 64 hex characters.',
  'validate.deploymentSourceFileMissing': 'Deployment #{n} has no source file selected.',
  'validate.serviceNameInvalid':
    'Service #{n} has an invalid name (letters, digits and . _ - @ only; do not append .service).',
  'validate.serviceNameDuplicated': 'Service name "{name}" is duplicated.',
  'validate.serviceExecStartEmpty': 'Service "{name}" has no ExecStart command.',
  'validate.serviceExecStartNotAbsolute':
    'ExecStart for "{name}" should be an absolute path; systemd does not resolve PATH.',
  'validate.serviceUserNotCreated':
    'Service "{name}" runs as "{user}", which this config does not create.',
  'validate.serviceGroupNotCreated':
    'Service "{name}" uses the group "{group}", which this config does not create. Fine if it already exists.',
  'validate.serviceEnvironmentInvalid': 'Environment entries for "{name}" must be KEY=VALUE.',
  'validate.cudaRepoMissingForSeries':
    'NVIDIA does not publish a CUDA repository for Ubuntu {series}. Use an LTS release (22.04 / 24.04 / 26.04).',
  'validate.gpuNothingSelected':
    'GPU setup is enabled but neither a driver nor a toolkit is selected.',
  'validate.containerToolkitWithoutDocker':
    'The container toolkit is enabled but Docker is not installed. Enable Docker under "After install".',
  'validate.cudaDownloadsOnFirstBoot':
    'CUDA downloads several GB from the internet on first boot, then reboots automatically.',
  'validate.interactiveAllUnverified':
    'The ["*"] form is unverified on Ubuntu {series}, so it is omitted. Set individual items to "type it in the installer" instead.',
  'validate.rsyslogNotImplemented':
    'The rsyslog reporter is documented as not yet implemented in subiquity, so progress may never arrive.',
  'validate.interactiveSectionsUnsupported':
    'Ubuntu {series} has no interactive-sections, so a missing value falls back to the default instead of prompting.',
  'validate.hostsWithoutKernelArgs':
    '{n} host(s) are configured, but every value is fixed, so no boot menu is built and the list is not used.',
  'validate.kernelArgsWithoutHosts':
    'Values are passed as kernel arguments but no hosts are registered, so you will have to type them in GRUB with the e key.',
  'validate.hostLabelInvalid':
    'Host #{n} has an invalid label (no " $ or newlines; 40 characters max).',
  'validate.hostLabelDuplicated': 'Host label "{label}" is duplicated.',
  'validate.hostHostnameInvalid': 'Host "{label}" needs a hostname of letters, digits and hyphens.',
  'validate.hostGatewayInvalid': 'Host "{label}" needs a gateway like "192.168.1.1".',
  'validate.hostNameserverInvalid':
    'Host "{label}" has a nameserver "{ns}" that is not an IP address.',
  'validate.hostDiskNotSerial':
    'Host "{label}" needs a disk serial number; a path like "/dev/sda" will not match.',
  'validate.hostFieldEmpty': 'Host "{label}" has no {field}.',
  'validate.hostFieldInvalidChars':
    'Host "{label}" has invalid characters in {field} (only letters, digits and . _ : / , - are allowed).',
  'validate.hostIpv4Invalid': 'Host "{label}" needs an address like "192.168.1.10/24".',
  'validate.grubMenuHostSelection':
    'Pick a host from the GRUB menu at boot to apply its values. For a host not listed, press e and edit the arguments.',
  'validate.diskKernelArgWithRawStorage':
    'Passing the disk as a kernel argument cannot be combined with a raw curtin config.',
  'validate.networkKernelArgWithRawNetplan':
    'Passing the IP as a kernel argument cannot be combined with raw netplan YAML.',
  'validate.networkKernelArgNeedsStatic':
    'When the IP is chosen from the boot menu, set the network to a static address as well; it is used when no argument is passed.',
  'validate.defaultGatewayMissingForKernelArg':
    'No gateway is set, so a machine booted without arguments cannot reach outside. Fine on a closed network.',
  'validate.defaultNameserversMissingForKernelArg':
    'No nameservers are set, so a machine booted without arguments cannot resolve names. Fine on a closed network.',
  'validate.diskKernelArgNeedsSerialMatch':
    'When the disk is chosen from the boot menu, also match by serial number so there is a default for boots without an argument.',
  'validate.interactiveAllOverridesKernelArgs':
    'Because every screen is shown, kernel-argument values only appear as defaults.',
  'validate.kernelFlavorEmpty': 'Enter a kernel flavor.',
  'validate.kernelPackageEmpty': 'Enter a kernel package name.',
  'validate.oemConflictsWithKernel':
    'OEM meta-packages can pull in their own kernel and conflict with an explicit kernel choice.',
  'validate.aptSourceEmpty': 'APT source #{n} is empty.',
  'validate.aptSourceFormatInvalid':
    'APT source #{n} must be "ppa:user/name" or a "deb https://..." line.',
  'validate.aptSourceKeyMissing': 'APT source #{n} has no GPG key, so apt may refuse it.',
  'validate.preserveSourcesListIgnoresMirror':
    'The mirror will not be applied because sources.list is preserved.',
  'validate.swapSizeInvalid': 'Swap size must be written like 4G.',
  'validate.resetPartitionSizeInvalid': 'Reset partition size must be written like 12G.',
  'validate.identityGroupsUnsupported':
    'identity.groups was added in Ubuntu 26.04 and is ignored on {series}.',
  'validate.groupOverrideWithoutSudo':
    'The group override does not include sudo, so the admin user will lose sudo access.',
  'validate.activeDirectoryUnsupported':
    'active-directory is not available on Ubuntu {series} and will be ignored.',
  'validate.adDomainNameEmpty': 'Enter a domain name.',
  'validate.adAdminNameEmpty': 'Enter the administrator account used to join the domain.',
  'validate.adPasswordPrompt':
    'The AD password cannot be put in the config; the installer asks for it, so the install is not fully unattended.',
  'validate.webhookUrlInvalid': 'The webhook URL is invalid.',
  'validate.rsyslogDestinationEmpty': 'Enter an rsyslog destination, e.g. @192.168.0.1.',
  'validate.reportingIgnoredWhenInteractive':
    'When any section is interactive, the installer ignores the reporting configuration.',
  'validate.kernelArgsSpecialChars':
    'Kernel arguments cannot contain characters that are special in grub.cfg (" # $ \' { } \\ < > `).',
  'validate.kernelArgsCommandChars':
    'Kernel arguments cannot contain ; & | because they break the GRUB config line.',
  'validate.interactiveSectionsPause':
    'Interactive sections are configured, so the install will pause for input.',

  'validate.grubMenuTooLarge':
    'The boot menu does not fit in one sector (2048 bytes); it is {bytes} bytes too large. Remove hosts or shorten the menu names.',

  // --- navigation (sidebar groups and the one-line summaries) ---
  'nav.groupRequired': 'Must configure',
  'nav.groupRequiredHint': 'The installer always asks for these.',
  'nav.groupOptional': 'Change if needed',
  'nav.groupOptionalHint': 'The defaults work as they are.',
  'nav.groupExtra': 'Added by this tool',
  'nav.groupExtraHint': 'Not part of the installer. Nothing happens by default.',
  'nav.groupFinish': 'Finish',
  'nav.groupFinishHint': 'Review the settings and write the USB.',

  'nav.changedCount': '{n} changed',
  'nav.summaryDefault': 'Defaults ({detail})',
  'nav.summaryUnknown': 'Unreadable setting ({value})',
  'nav.summaryJoin2': '{a} / {b}',
  'nav.summaryJoin3': '{a} / {b} / {c}',
  'nav.summaryJoin4': '{a} / {b} / {c} / {d}',
  'nav.summaryMore': 'And {n} more',
  'nav.summaryOther': 'Other {n}',

  'nav.summaryNetworkInstallerDefault': 'DHCP (automatic)',
  'nav.summaryNetworkDhcp': 'DHCP (chosen NIC)',
  'nav.summaryNetworkStatic': 'Static IP {address}',
  'nav.summaryNetworkRaw': 'Raw netplan',

  'nav.summaryStorageRaw': 'Raw curtin config',
  'nav.summaryDiskLargest': 'Largest disk',
  'nav.summaryDiskSmallest': 'Smallest disk',
  'nav.summaryDiskSsd': 'Prefer SSD',
  'nav.summaryDiskAny': 'Any disk',
  'nav.summaryDiskPath': 'Path {path}',
  'nav.summaryDiskSerial': 'Serial {serial}',
  'nav.summaryDiskModel': 'Model {model}',
  'nav.summaryLayoutLvm': 'LVM',
  'nav.summaryLayoutDirect': 'Direct',
  'nav.summaryLayoutZfs': 'ZFS',
  'nav.summaryEncryptionOn': 'Encrypted',
  'nav.summaryEncryptionOff': 'Not encrypted',
  'nav.summaryWholeDisk': 'Use the whole disk',
  'nav.summarySwapCustom': 'Custom swap',
  'nav.summaryPartitionTable': 'Partition table {table}',
  'nav.summaryResetPartition': 'Reset partition',

  // Counts read "Packages 1" rather than "1 packages": the dictionary has no
  // plural machinery, and "1 snaps" is exactly the kind of wrong-looking detail
  // that makes the English build feel like an afterthought.
  'nav.summarySoftwareNone': 'No extras',
  'nav.summaryPackages': 'Packages {n}',
  'nav.summarySnaps': 'Snaps {n}',
  'nav.summarySourceMinimal': 'Minimal install',
  'nav.summaryUpdatesAll': 'All updates',
  'nav.summaryDrivers': 'Third-party drivers',
  'nav.summaryGpuOn': 'GPU enabled',
  'nav.summaryKernelCustom': 'Custom kernel',
  'nav.summaryUbuntuPro': 'Ubuntu Pro',
  'nav.summaryMirrorCustom': 'Custom mirror',
  'nav.summaryAptSources': 'Extra repositories {n}',

  'nav.summaryPostInstallNone': 'Nothing extra',
  'nav.summaryPresets': 'Presets {n}',
  'nav.summaryFiles': 'Files {n}',
  'nav.summaryUsers': 'Extra users {n}',
  'nav.summaryDeployments': 'Deployments {n}',
  'nav.summaryServices': 'Services {n}',
  'nav.summaryCommands': 'Commands {n}',
  'nav.summaryFullUpgrade': 'Full upgrade',
  'nav.summaryDebconf': 'debconf selections',
  'nav.summaryActiveDirectory': 'Join Active Directory',
  'nav.summaryRefreshInstaller': 'Installer updated',
  'nav.summaryInteractiveAll': 'Every screen waits for input',
  'nav.summaryRawOverlay': 'Overridden with YAML',
  'nav.summaryExtraKernelArgs': 'Extra kernel arguments',
  'nav.summaryReporting': 'Custom progress reporting',
  'nav.summaryNoLogCollect': 'No failure logs',

  'nav.summaryRuntimeFixed': 'All values fixed',
  'nav.summaryRuntimeKernelArg': '{field} from the boot menu',
  'nav.summaryRuntimeInteractive': '{field} typed in the installer',
  'nav.summaryRuntimeFieldHostname': 'Hostname',
  'nav.summaryRuntimeFieldNetwork': 'Network',
  'nav.summaryRuntimeFieldDisk': 'Disk',
  'nav.summaryRuntimeHosts': 'Hosts {n}',

  'nav.readyTitle': 'This is enough',
  'nav.readyBody':
    'If the rest can stay at its defaults, you can go straight to the review. You can always come back and change the network or the disk later.',
  'nav.readyButton': 'Go to review',

  // --- errors ---
  'error.isoTooBig': 'The USB drive is too small',
  'error.deviceRemoved': 'The USB drive was removed',
  'error.permissionDenied': 'Permission denied',
  'error.unknown': 'An unexpected error occurred',
} satisfies Record<MsgKey, string>
