// サイトのダウンロードボタンが探す、Release の成果物の名前。
//
// **electron-builder が実際に付ける名前と一致していなければならない。**
// `${arch}` は拡張子によって書き換わる（AppImage は x86_64、deb は amd64）ので、
// 設定の文字列を目で見ただけでは分からない。一致は
// apps/desktop/src/main/artifact-names.test.ts が electron-builder 自身の関数で確かめる。
export const ASSET_PATTERNS = {
  winSetup: /^Seedstick-[0-9][0-9A-Za-z.-]*-win-x64-Setup\.exe$/,
  winPortable: /^Seedstick-[0-9][0-9A-Za-z.-]*-win-x64-portable\.exe$/,
  macArmDmg: /^Seedstick-[0-9][0-9A-Za-z.-]*-mac-arm64\.dmg$/,
  macX64Dmg: /^Seedstick-[0-9][0-9A-Za-z.-]*-mac-x64\.dmg$/,
  macArmZip: /^Seedstick-[0-9][0-9A-Za-z.-]*-mac-arm64\.zip$/,
  macX64Zip: /^Seedstick-[0-9][0-9A-Za-z.-]*-mac-x64\.zip$/,
  linuxDeb: /^Seedstick-[0-9][0-9A-Za-z.-]*-linux-x64\.deb$/,
  sums: /^SHA256SUMS\.txt$/,
}
