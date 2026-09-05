// @autoinstall/shared — main / renderer / CLI が共有する TS ソース契約

export const APP_ID = 'app.autoinstall-ui.desktop'
export const APP_NAME = 'Autoinstall USB Creator'

export * from './autoinstall/advanced.js'
export * from './autoinstall/model.js'
export * from './autoinstall/provisioning.js'
export * from './autoinstall/runtime-values.js'
export * from './autoinstall/defaults.js'
export * from './autoinstall/generate.js'
export * from './autoinstall/generate-provisioning.js'
export * from './autoinstall/migrate.js'
export * from './autoinstall/presets.js'
export * from './autoinstall/validate.js'
// Node 専用（node:crypto を使う）のでバレルには載せない。main からは
// '@autoinstall/shared/crypt' を直接 import する。renderer に Node の型を持ち込まないための境界。
export * from './crypt/validate.js'
export * from './device/safety.js'
export * from './iso/catalog.js'
export * from './i18n/index.js'
export * from './ipc/types.js'
