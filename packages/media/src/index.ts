// @autoinstall/media — Electron に依存しない、イメージ生成と USB 書き込みのエンジン。
// GUI からも CLI からも同じコードを使う。

export const MEDIA_ENGINE_VERSION = '0.1.0'

export {
  SECTOR_SIZE,
  ISO_SECTOR_SIZE,
  FileBlockDevice,
  MemoryBlockDevice,
  SparseFixtureDevice,
  OverlayBlockDevice,
  ReadOnlyError,
  type BlockDevice,
  type IsoFixture,
} from './blockdev/index.js'
export { RawBlockDevice, type RawDeviceOptions } from './blockdev/raw.js'

export {
  readIsoStructure,
  readDirectory,
  readFile,
  resolvePath,
  type DirectoryRecord,
  type IsoStructure,
  type ElToritoInfo,
} from './iso9660/reader.js'

export {
  GPT_ATTR,
  GPT_ENTRY_SIZE,
  GPT_HEADER_SIZE,
  GPT_SIGNATURE,
  PARTITION_TYPE,
  buildGpt,
  computeHeaderCrc,
  guidToBuffer,
  guidToString,
  parseMbr,
  randomGuid,
  readGpt,
  updateProtectiveMbr,
  type GptInfo,
  type GptImage,
  type GptPartitionEntry,
  type MbrInfo,
} from './gpt/index.js'

export {
  BYTES_PER_SECTOR,
  buildFatImage,
  makeShortName,
  needsLongName,
  shortNameChecksum,
  type BuildFatOptions,
  type FatFile,
  type FatImage,
  type FatType,
} from './fat/build.js'
export { readFatImage, type FatFilesystem, type FatDirEntry } from './fat/read.js'

export {
  countPatchableKernelLines,
  nocloudSeedArg,
  patchGrubCfg,
  remainingGrubBytes,
  type ExtraMenuEntry,
  type GrubPatchOptions,
  type GrubPatchResult,
} from './grub/patch.js'

export {
  applyPatchesToChunk,
  assertPatchesDisjoint,
  buildIsoPatches,
  inspectIso,
  IsoValidationError,
  type IsoInspection,
  type IsoPatchPlan,
  type Patch,
} from './isopatch/index.js'

export {
  ALIGNMENT_BYTES,
  CIDATA_LABEL,
  DEFAULT_CIDATA_SIZE_BYTES,
  LayoutError,
  minimumDiskSize,
  planUsbLayout,
  type PlanUsbLayoutOptions,
  type UsbLayoutPlan,
  type WriteOp,
} from './layout/plan.js'

export {
  DEFAULT_CHUNK_SIZE,
  executeWritePlan,
  survivingRanges,
  VerificationError,
  WriteCancelledError,
  type ExecuteOptions,
  type WriteProgress,
  type WriteResult,
  type WritePhase,
} from './writer/execute.js'

export {
  classifyDevice,
  needsExtraCaution,
  EXTRA_CAUTION_SIZE_BYTES,
  elevationHint,
  formatSize,
  getPlatformOps,
  UnsupportedPlatformError,
  parseLsblk,
  parsePlist,
  parseWindowsDisks,
  type DeviceBus,
  type PlatformOps,
  type RemovableDevice,
} from './platform/index.js'

export {
  decodeMessages,
  encodeMessage,
  type ControlMessage,
  type WorkerJob,
  type WorkerMessage,
} from './worker/protocol.js'
export { connectReporter, runWorkerJob, type WorkerReporter } from './worker/run.js'
