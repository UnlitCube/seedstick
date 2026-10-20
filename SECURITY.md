# Security policy

## Supported versions

Only the latest release receives fixes.

## Reporting a vulnerability

Please **do not open a public issue.** Report privately through GitHub:
[**Report a vulnerability**](https://github.com/UnlitCube/seedstick/security/advisories/new)
(the *Security* tab of the repository).

Include what you did, what happened, and what an attacker could gain. A proof of
concept helps. You should get a first answer within a week. Seedstick is maintained
in spare time, so a fix may take longer; we will keep you informed and credit you in
the advisory unless you prefer otherwise.

## What we are most interested in

Seedstick runs a privileged helper and generates scripts that run as root on the
target machine. Examples of issues we treat as security problems:

- A way to make the app write to a disk the user did not select, or to a system or
  internal disk.
- A way for another local process to control or impersonate the elevated write helper
  (it listens on a one-time `127.0.0.1` port with a token).
- A profile file, ISO or field value that makes the generated `user-data` or
  `early-commands` run unintended commands (shell or YAML injection).
- A way to make the app read and copy files the user did not pick (for example via a
  shared profile JSON).
- Plain-text login passwords ending up in saved profiles, logs or the USB drive.
  (Disk-encryption passphrases are written in plain text by design, because the
  installer needs them; the app warns about this.)

## What is out of scope

- The fact that a drive made with Seedstick erases the disk of the machine it boots.
  That is the purpose of the tool.
- Unsigned builds triggering SmartScreen or Gatekeeper warnings.
- Vulnerabilities in Ubuntu, subiquity, curtin or cloud-init themselves; please report
  those to [Canonical](https://ubuntu.com/security/disclosure-policy).
