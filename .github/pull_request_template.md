## What and why

<!-- What does this change, and what problem does it solve? Link the issue if there is one. -->

## How it was checked

<!-- Commands you ran and what you saw. -->

- [ ] `npm run typecheck` and `npm run test:unit` pass
- [ ] New or changed behaviour has a test, and the test fails when the change is reverted
- [ ] New user-visible text is a dictionary key in all nine `packages/shared/src/i18n/*.ts` files (or all nine dictionaries in `installer/shared/labels.ts`), not hard-coded. Copying the English text into languages you cannot translate is fine; the type check fails otherwise
- [ ] User-visible changes have a line under `## vNext` in `CHANGELOG.md`
- [ ] If disks, RAID, LVM or bonding generation changed: an `npm run e2e:vm*` run completed (say which)
- [ ] No secrets, real hostnames, serial numbers or IP addresses in tests or screenshots
