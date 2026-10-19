# subiquity autoinstall JSON schemas (third-party files)

The `autoinstall-schema.*.json` files in this directory are **not** covered by
this repository's MIT license. They are unmodified copies of
`autoinstall-schema.json` from [canonical/subiquity](https://github.com/canonical/subiquity),
which is licensed under the **GNU Affero General Public License v3.0 or later**
(Copyright Canonical Ltd.). The license text is in
[`LICENSE-AGPL-3.0.txt`](LICENSE-AGPL-3.0.txt).

They are used only by the test suite (`schema.test.ts`, `raid.test.ts`,
`bond.test.ts`, `scripts/e2e-*.mts`) to check that the generated configuration is
accepted by the official schema of each Ubuntu release. They are **not** shipped in
the application packages.

| File | subiquity tag | Commit | Blob |
|---|---|---|---|
| `autoinstall-schema.22.04.2.json` | [`22.04.2`](https://github.com/canonical/subiquity/blob/a80a0bd1819faedb0f3644a244482f33fa2af17e/autoinstall-schema.json) | `a80a0bd1819faedb0f3644a244482f33fa2af17e` | `cd950b54f29b7c312e338a4d779d1b59b6dc3d82` |
| `autoinstall-schema.24.04.4.json` | [`24.04.4`](https://github.com/canonical/subiquity/blob/e0ebd8770fb8c342b137a53b0c6088296142ff68/autoinstall-schema.json) | `e0ebd8770fb8c342b137a53b0c6088296142ff68` | `e16195ac3eaeeb5fe21b5988bff5d2f9d80bad82` |
| `autoinstall-schema.25.10.json` | [`25.10`](https://github.com/canonical/subiquity/blob/5761009e91c9ce4afffbfca8b483b08e36e9bd21/autoinstall-schema.json) | `5761009e91c9ce4afffbfca8b483b08e36e9bd21` | `ddfa5a6aa73e54176d6f4338324b3d60c01f763b` |
| `autoinstall-schema.26.04.1.json` | [`26.04.1`](https://github.com/canonical/subiquity/blob/f759e0adbdc20ceab674946f9be42ed4c0c4f18c/autoinstall-schema.json) | `f759e0adbdc20ceab674946f9be42ed4c0c4f18c` | `4d5ef49879a19b30a0875cee0e4ce3f8e05e8b84` |
| `autoinstall-schema.26.10.json` | [`26.10`](https://github.com/canonical/subiquity/blob/233463112af9da37a4c411a7bd2531f12842d1da/autoinstall-schema.json) | `233463112af9da37a4c411a7bd2531f12842d1da` | `4d5ef49879a19b30a0875cee0e4ce3f8e05e8b84` |

The blob column is `git hash-object <file>`; it matches the upstream object exactly,
so the files are byte-for-byte identical to the tagged upstream versions.
`26.10` is identical to `26.04.1`, and the `24.04.5` tag carries the same blob as `24.04.4`.
