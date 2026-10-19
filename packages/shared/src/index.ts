// @autoinstall/shared — main / renderer / CLI が共有する TS ソース契約

export const APP_ID = 'jp.unlit-cube.seedstick'
export const APP_NAME = 'Seedstick'

export * from './autoinstall/advanced.js'
export * from './autoinstall/model.js'
export * from './autoinstall/provisioning.js'
export * from './autoinstall/runtime-values.js'
export * from './autoinstall/defaults.js'
export * from './autoinstall/generate.js'
export * from './autoinstall/generate-provisioning.js'
export * from './autoinstall/migrate.js'
export * from './autoinstall/presets.js'
export * from './autoinstall/raid.js'
export * from './autoinstall/generate-raid.js'
export * from './autoinstall/bond.js'
export * from './autoinstall/generate-bond.js'
export * from './autoinstall/validate.js'
// YAML の方言（1.1）。検証スクリプトも**同じ方言で読む**こと（落とし穴 108）。
export * from './autoinstall/yaml.js'
// Node 専用（node:crypto を使う）のでバレルには載せない。main からは
// '@autoinstall/shared/crypt' を直接 import する。renderer に Node の型を持ち込まないための境界。
export * from './crypt/validate.js'
export * from './device/safety.js'
export * from './iso/catalog.js'
export * from './i18n/index.js'
export * from './ipc/types.js'
