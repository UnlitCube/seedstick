# Security policy

## Supported versions

Seedstick is experimental (0.x, published as pre-releases). Only the latest release
receives fixes; there are no long-term or back-ported fixes for older versions.

## Reporting a vulnerability

Please **do not open a public issue.** Report privately through GitHub:
[**Report a vulnerability**](https://github.com/UnlitCube/seedstick/security/advisories/new)
(the *Security* tab of the repository). If that form is not available to you, email
**unlit.cube@gmail.com** with `[SECURITY]` in the subject.

Include what you did, what happened, and what an attacker could gain. A proof of
concept helps. We aim to send a first answer within a week, but cannot promise it:
Seedstick is an experimental project maintained in spare time, so a fix may take
longer. We will keep you informed and credit you in the advisory unless you prefer
otherwise.

## What we are most interested in

Seedstick runs a privileged helper and generates scripts that run as root on the
target machine. Examples of issues we treat as security problems:

- A way to make the app write to a disk the user did not select, or to a system or
  internal disk.
- A way for another local process to control or impersonate the elevated write helper.
  The helper reports to the app over TCP: the app listens on a one-time `127.0.0.1`
  port, and only a connection that presents the per-job random token becomes the
  control channel.
- A profile file, ISO or field value that makes the generated `user-data` or
  `early-commands` run unintended commands (shell or YAML injection).
- A way to make the app read and copy files the user did not pick (for example via a
  shared profile JSON).
- Plain-text login passwords ending up in saved profiles, logs or the USB drive.
  (By design, a disk-encryption passphrase is stored in plain text on the USB drive
  and in saved or exported profiles, because the installer needs it; the app warns
  about this when one is set.)

## What is out of scope

- The fact that a drive made with Seedstick erases the disk of the machine it boots.
  That is the purpose of the tool.
- Unsigned builds triggering SmartScreen or Gatekeeper warnings.
- Vulnerabilities in Ubuntu, subiquity, curtin or cloud-init themselves; please report
  those to [Canonical](https://ubuntu.com/security/disclosure-policy).
