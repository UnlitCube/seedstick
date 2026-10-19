# Primary sources (upstream permalinks)

The research notes in this directory quote and cite upstream source files.
Earlier revisions kept local copies under `docs/research/sources/`; they were removed
before publishing because they are under other licenses (subiquity: AGPL-3.0 / GPL-3.0,
cloud-init: GPL-3.0 or Apache-2.0, subiquity documentation). The links below point to the
**exact upstream revisions** of those copies — each local file's `git hash-object` was
matched against the upstream tree, so line numbers quoted in the notes still apply.

Retrieved on 2026-09-03.

| Former local name | Upstream file (pinned) | License |
|---|---|---|
| `autoinstall-reference.rst` | [canonical/subiquity `doc/reference/autoinstall-reference.rst`](https://github.com/canonical/subiquity/blob/64618868eb788b46f10f7136f1b14475529048d5/doc/reference/autoinstall-reference.rst) | subiquity documentation |
| `autoinstall-quickstart.rst` | [canonical/subiquity `doc/howto/autoinstall-quickstart.rst`](https://github.com/canonical/subiquity/blob/64618868eb788b46f10f7136f1b14475529048d5/doc/howto/autoinstall-quickstart.rst) | subiquity documentation |
| `intro-to-autoinstall.rst` | [canonical/subiquity `doc/intro-to-autoinstall.rst`](https://github.com/canonical/subiquity/blob/64618868eb788b46f10f7136f1b14475529048d5/doc/intro-to-autoinstall.rst) | subiquity documentation |
| `providing-autoinstall.rst` | [canonical/subiquity `doc/tutorial/providing-autoinstall.rst`](https://github.com/canonical/subiquity/blob/64618868eb788b46f10f7136f1b14475529048d5/doc/tutorial/providing-autoinstall.rst) | subiquity documentation |
| `cloudinit-autoinstall-interaction.rst` | [canonical/subiquity `doc/explanation/cloudinit-autoinstall-interaction.rst`](https://github.com/canonical/subiquity/blob/64618868eb788b46f10f7136f1b14475529048d5/doc/explanation/cloudinit-autoinstall-interaction.rst) | subiquity documentation |
| `client.py` | [canonical/subiquity `subiquity/client/client.py`](https://github.com/canonical/subiquity/blob/64618868eb788b46f10f7136f1b14475529048d5/subiquity/client/client.py) | AGPL-3.0-or-later |
| `server.py` | [canonical/subiquity `subiquity/server/server.py`](https://github.com/canonical/subiquity/blob/64618868eb788b46f10f7136f1b14475529048d5/subiquity/server/server.py) | AGPL-3.0-or-later |
| `install.py` | [canonical/subiquity `subiquity/server/controllers/install.py`](https://github.com/canonical/subiquity/blob/64618868eb788b46f10f7136f1b14475529048d5/subiquity/server/controllers/install.py) | AGPL-3.0-or-later |
| `cmdlist.py` | [canonical/subiquity `subiquity/server/controllers/cmdlist.py`](https://github.com/canonical/subiquity/blob/64618868eb788b46f10f7136f1b14475529048d5/subiquity/server/controllers/cmdlist.py) | AGPL-3.0-or-later |
| `sqcore-utils.py` | [canonical/subiquity `subiquitycore/utils.py`](https://github.com/canonical/subiquity/blob/64618868eb788b46f10f7136f1b14475529048d5/subiquitycore/utils.py) | GPL-3.0 |
| `nocloud.py` | [canonical/cloud-init `cloudinit/sources/DataSourceNoCloud.py`](https://github.com/canonical/cloud-init/blob/3082dcb2a31491a4f7630dee75046316f046df3c/cloudinit/sources/DataSourceNoCloud.py) | GPL-3.0 or Apache-2.0 |

The JSON schemas used by the tests are kept (with their license) in [`schema/`](schema/README.md).

To fetch the exact copies again:

```sh
git clone --filter=blob:none https://github.com/canonical/subiquity.git
git -C subiquity show 64618868eb788b46f10f7136f1b14475529048d5:subiquity/server/server.py > server.py
```
