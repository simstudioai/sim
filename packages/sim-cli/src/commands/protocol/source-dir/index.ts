/**
 * The source directory on disk, for `workflows source` (one workflow's directory) and
 * `workspaces source` (whose `workflows/<key>/` folders are each one): its layout beside the
 * printed files, and the only code that reads or writes it. One definition, so the commands
 * cannot drift apart.
 */

export {
  SOURCE_DIR_BUSY_HELP,
  SOURCE_DIR_LOCK,
  takeOverStaleLock,
  withSourceCommandLock,
  withSourceDirLock,
} from './command-lock'
export {
  absoluteDirOption,
  assertSourceDirKind,
  directoryWorkspace,
  readStarterWorkspace,
  workspaceFolderOf,
} from './dir-kind'
export {
  checkedPath,
  FILE_CONCURRENCY,
  isMissing,
  listSourceFiles,
  readPreviousLock,
  readSourceJson,
  readSourceText,
  type SourceDirChange,
  updateSourceDir,
  withMissingLines,
} from './files'
export {
  assertPrintedSourcePaths,
  assertSendableCodeFiles,
  lockCodeFiles,
  orphanedCodeFiles,
  SOURCE_AGENTS_FILE,
  SOURCE_DOWNLOADS_DIR,
  SOURCE_EXAMPLES_DIR,
  SOURCE_GITATTRIBUTES_FILE,
  SOURCE_GITIGNORE_FILE,
  SOURCE_SDK_DIR,
  SOURCE_STAGING_PREFIX,
  SOURCE_STARTER_FILE,
  SOURCE_STORED_EDGES_FILE,
  SOURCE_WRITTEN_FILE,
  sourceRelativePath,
} from './layout'
export { writeBack } from './write-back'
export {
  digest,
  editedFiles,
  type FileStat,
  fileStatOf,
  locallyEditedFiles,
  readFolderWritten,
  readWritten,
  recordedStats,
  type StatDigest,
  sameFileStat,
  type Written,
  writtenFiles,
  writtenRecord,
} from './written'
