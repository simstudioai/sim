/**
 * The source directory on disk, for `workflows source` (one workflow's directory) and
 * `workspaces source` (whose `workflows/<key>/` folders are each one): its layout beside the
 * printed files, and the only code that reads or writes it. One definition, so the commands
 * cannot drift apart.
 *
 * Every path is relative to `realpath(--dir)` and no component below it may be a symbolic link,
 * so nothing is read from or written to outside the directory, whatever a link in it points at.
 * Writes are staged in the directory first and moved into place, so a failed write leaves the
 * files it did not reach as they were. An embedded run reads and writes through its host instead.
 */

import { createHash } from 'node:crypto'
import type { Dirent, Stats } from 'node:fs'
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { basename, dirname, join, posix, resolve } from 'node:path'
import { mapWithConcurrency } from '@sim/utils/concurrency'
import { isRecordLike, toRecord } from '@sim/utils/object'
import {
  CODE_FILE_EXTENSIONS,
  SOURCE_BASE_FILE,
  SOURCE_ENTRY_FILE,
  SOURCE_CODE_DIR as SOURCE_FUNCTIONS_DIR,
  SOURCE_LOCK_FILE,
} from '@sim/workflow-code/limits'
import { fingerprintOf, KIND_DIRS } from '@sim/workspace-code'
import { embedStore } from '../../embed-context'
import { SOURCE_BUSY_EXIT_CODE } from '../../exit-codes'
import { SimApiError } from '../../http/client'
import { embeddedFileContent } from '../../transfer/local-file'
import { removeStagingOnSignal, saveToFile } from './files-get'

/** Generated SDK declarations: every block in the workspace catalog, plus `workspace.d.ts`. */
export const SOURCE_SDK_DIR = '.sim/sdk'
/** A short guide for an agent working in the directory; never a top-level `AGENTS.md`. */
export const SOURCE_AGENTS_FILE = '.sim/AGENTS.md'
/**
 * Example workflows (`cookbook.ts`, `integrations.ts`, `agents.ts`): together one correct example
 * of each common block, rewritten on every get like the agent guide. They name example resources
 * the workspace may lack, so the written `tsconfig.json` never includes them.
 */
export const SOURCE_EXAMPLES_DIR = '.sim/examples'
/** Pins the source files to LF, merged into whatever the directory already holds. */
export const SOURCE_GITATTRIBUTES_FILE = '.gitattributes'
/** Keeps a command's transient files out of a repository, merged like `.gitattributes`. */
export const SOURCE_GITIGNORE_FILE = '.gitignore'
/**
 * A digest of each source file as the CLI last wrote it, so a later get can tell an unapplied
 * edit from a file it may replace. The CLI's own record: never sent to the server.
 */
export const SOURCE_WRITTEN_FILE = '.sim/written.json'
/**
 * Where a workspace get keeps the blobs it verified until they move into place. A get that fails
 * leaves them there, so the next one downloads only the rest; the one that completes removes the
 * folder.
 */
export const SOURCE_DOWNLOADS_DIR = '.sim/downloads'
/** The folder a write stages its files in before moving them into place; removed when it ends. */
export const SOURCE_STAGING_PREFIX = '.sim-staging-'

/**
 * The only files a server answer may name: the entry file and function code under `functions/`,
 * named as the printer names them (`functions/<kebab ident>[-n].<js|py|sh>`). Anything else
 * (`.git/hooks/*`, `conftest.py`, a dotfile) is refused, whatever base URL answered.
 */
const FUNCTION_FILE = new RegExp(
  `^${SOURCE_FUNCTIONS_DIR}/[a-z0-9$-]+\\.(?:${Object.values(CODE_FILE_EXTENSIONS).join('|')})$`
)

/** Whether a server answer may write `path` into the source directory. */
function isPrintedSourcePath(path: string): boolean {
  return path === SOURCE_ENTRY_FILE || FUNCTION_FILE.test(path)
}

/** Refuses a server answer naming a file the printer never writes, before anything is written. */
export function assertPrintedSourcePaths(files: Record<string, string>): void {
  for (const path of Object.keys(files)) {
    if (!isPrintedSourcePath(path)) {
      throw new SimApiError(`The workflow source named an unsafe file path: ${path}`, 0)
    }
  }
}

const GITATTRIBUTES_LINES = [
  `${SOURCE_ENTRY_FILE} text eol=lf`,
  `${SOURCE_FUNCTIONS_DIR}/** text eol=lf`,
]
/** Files read or written at once on a local disk; the declarations run to thousands of small files. */
export const FILE_CONCURRENCY = 32

/**
 * A path inside the source directory, normalized (`./functions/x.js` → `functions/x.js`), or
 * `null` for an absolute path, a drive letter or a `..` escape.
 */
export function sourceRelativePath(path: string): string | null {
  const normalized = posix.normalize(path.replace(/\\/g, '/'))
  if (
    normalized.startsWith('/') ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../')
  ) {
    return null
  }
  return normalized.startsWith('./') ? normalized.slice(2) : normalized
}

/** Every `codeFile` a lock records, as source-relative paths. */
export function lockCodeFiles(lock: unknown): Set<string> {
  const paths = new Set<string>()
  const blocks = toRecord(toRecord(lock).blocks)
  for (const block of Object.values(blocks)) {
    const path =
      isRecordLike(block) && typeof block.codeFile === 'string'
        ? sourceRelativePath(block.codeFile)
        : null
    if (path) paths.add(path)
  }
  return paths
}

/**
 * The function files a write leaves behind: named by the lock the directory held (so the CLI
 * wrote them), no longer named by the new lock, and not being written now. A file the person
 * added and no lock ever named is never pruned.
 */
export function orphanedCodeFiles(
  previousLock: unknown,
  nextLock: unknown,
  written: Iterable<string>
): string[] {
  const kept = lockCodeFiles(nextLock)
  for (const path of written) kept.add(path)
  return [...lockCodeFiles(previousLock)].filter(
    (path) => path.startsWith(`${SOURCE_FUNCTIONS_DIR}/`) && !kept.has(path)
  )
}

/**
 * The lock an earlier get, apply or create left, read leniently (missing or invalid is `null`):
 * it names the function files the CLI wrote, which is all a prune needs from it.
 */
export function readPreviousLock(dir: string): Promise<unknown> {
  return readSourceJson(dir, SOURCE_LOCK_FILE)
}

/** A JSON file in the source directory, read leniently: `null` when it is missing or invalid. */
export async function readSourceJson(dir: string, path: string): Promise<unknown> {
  const text = await readSourceText(dir, path)
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * A line file (`.gitattributes`, `.gitignore`) with `lines` appended where missing, or `null`
 * when it has them all.
 */
export function withMissingLines(
  existing: string | null,
  lines: readonly string[] = GITATTRIBUTES_LINES
): string | null {
  const present = new Set((existing ?? '').split('\n').map((line) => line.trim()))
  const missing = lines.filter((line) => !present.has(line))
  if (missing.length === 0) return null
  const prefix = existing && !existing.endsWith('\n') ? `${existing}\n` : (existing ?? '')
  return `${prefix}${missing.join('\n')}\n`
}

/** Whether a file-system error means the path does not exist (`ENOENT`, or a file as a folder). */
export function isMissing(error: unknown): boolean {
  const code = errorCode(error)
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/**
 * The absolute path of `path` under `root` (already a realpath), refusing a symbolic link at any
 * component that exists. `verified` caches directories already checked across one operation.
 */
export async function checkedPath(
  root: string,
  path: string,
  verified: Set<string>
): Promise<string> {
  const segments = path.split('/')
  let current = root
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment)
    if (verified.has(current)) continue
    let stats: Awaited<ReturnType<typeof lstat>>
    try {
      stats = await lstat(current)
    } catch (error) {
      if (isMissing(error)) return join(root, ...segments)
      throw error
    }
    if (stats.isSymbolicLink()) {
      throw new SimApiError(
        `Refusing ${segments.slice(0, index + 1).join('/')}: it is a symbolic link, and the source directory only holds plain files.`,
        0,
        'SOURCE_SYMLINK'
      )
    }
    if (index < segments.length - 1) verified.add(current)
  }
  return current
}

async function realRoot(dir: string): Promise<string | null> {
  try {
    return await realpath(dir)
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
}

/**
 * Source text as the CLI reads and compares it: no leading byte-order mark and LF line endings, so
 * a Windows editor or checkout never turns an unchanged source into an edit, or hides its
 * `// @sim-sdk` header.
 */
function normalizeSourceText(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
}

/**
 * The text of `path` in the source directory, normalized by `normalizeSourceText`, or `null` when
 * it does not exist. A symbolic link anywhere below the directory is refused rather than followed.
 */
export async function readSourceText(dir: string, path: string): Promise<string | null> {
  const embedded = embedStore.getStore()
  let text: string
  if (embedded) {
    try {
      const content = await embeddedFileContent(embedded, posix.join(dir, path))
      text = typeof content === 'string' ? content : new TextDecoder().decode(content)
    } catch {
      return null
    }
  } else {
    const root = await realRoot(dir)
    if (root === null) return null
    const target = await checkedPath(root, path, new Set())
    try {
      text = await readFile(target, 'utf8')
    } catch (error) {
      if (isMissing(error)) return null
      throw new SimApiError(`Cannot read ${join(dir, path)}: ${(error as Error).message}`, 0)
    }
  }
  return normalizeSourceText(text)
}

/** What one write does to the source directory: files to remove first, then files to write. */
export interface SourceDirChange {
  write: ReadonlyArray<readonly [path: string, text: string]>
  /**
   * Files whose bytes `stage` writes into the staged file it is handed (a download), before
   * anything is moved into place: one that throws leaves the directory as it was.
   */
  fetch?: ReadonlyArray<readonly [path: string, stage: (stagedFile: string) => Promise<void>]>
  /** Files or directories (removed recursively); an embedded run cannot remove, so skips these. */
  remove?: readonly string[]
}

/**
 * The files that record what the directory was read from: each workflow's lock, base and
 * `.sim/written.json`, and the workspace base. They move into place only after every other file,
 * so a write cut short leaves the old records beside whatever text did land: the next apply is
 * refused as stale, never sent as if the old text were current.
 */
const RECORD_FILES = [SOURCE_BASE_FILE, SOURCE_LOCK_FILE, SOURCE_WRITTEN_FILE]

function isRecordFile(path: string): boolean {
  return RECORD_FILES.some((file) => path === file || path.endsWith(`/${file}`))
}

/**
 * Applies a change to the source directory, creating it when absent. Every target is checked
 * before anything is touched; the files are written to a staging directory inside it, then the
 * removals run and each file is renamed into place, never through a link, the record files last.
 */
export async function updateSourceDir(dir: string, change: SourceDirChange): Promise<void> {
  const fetches = change.fetch ?? []
  const writes = [...change.write.map(([path]) => path), ...fetches.map(([path]) => path)]
  for (const path of [...writes, ...(change.remove ?? [])]) {
    if (sourceRelativePath(path) !== path) {
      throw new SimApiError(`Refusing to write ${path} outside ${dir}`, 0)
    }
  }
  if (embedStore.getStore()) {
    const fetched: Array<readonly [string, Uint8Array<ArrayBuffer>]> = []
    if (fetches.length > 0) {
      const scratch = await mkdtemp(join(tmpdir(), 'sim-source-fetch-'))
      try {
        for (const [path, stage] of fetches) {
          const file = join(scratch, String(fetched.length))
          await stage(file)
          fetched.push([path, new Uint8Array(await readFile(file))])
        }
      } finally {
        await rm(scratch, { recursive: true, force: true })
      }
    }
    const all = [...change.write, ...fetched]
    // The host has no rename, so the records go last here too: after every file and blob.
    for (const [path, content] of [
      ...all.filter(([path]) => !isRecordFile(path)),
      ...all.filter(([path]) => isRecordFile(path)),
    ]) {
      await saveToFile(new Blob([content]).stream(), posix.join(dir, path), true)
    }
    return
  }

  await mkdir(dir, { recursive: true })
  const root = await realpath(dir)
  const verified = new Set<string>()
  const targets: string[] = []
  for (const path of writes) targets.push(await checkedPath(root, path, verified))
  const removals: string[] = []
  for (const path of change.remove ?? []) removals.push(await checkedPath(root, path, verified))

  let staging: string | null = null
  const disposeSignalCleanup = removeStagingOnSignal(() => staging)
  try {
    const stagingDir = await mkdtemp(join(root, SOURCE_STAGING_PREFIX))
    staging = stagingDir
    const indexes = writes.map((_, index) => index)
    const staged = (index: number) => join(stagingDir, String(index))
    await mapWithConcurrency(indexes, FILE_CONCURRENCY, (index) =>
      index < change.write.length
        ? writeFile(staged(index), change.write[index][1], { flag: 'wx' })
        : fetches[index - change.write.length][1](staged(index))
    )
    for (const target of removals) await rm(target, { recursive: true, force: true })
    const parents = new Map<string, Promise<unknown>>()
    const moveIntoPlace = async (index: number) => {
      const parent = dirname(targets[index])
      let created = parents.get(parent)
      if (!created) {
        created = mkdir(parent, { recursive: true })
        parents.set(parent, created)
      }
      await created
      await rename(staged(index), targets[index])
    }
    await mapWithConcurrency(
      indexes.filter((index) => !isRecordFile(writes[index])),
      FILE_CONCURRENCY,
      moveIntoPlace
    )
    await mapWithConcurrency(
      indexes.filter((index) => isRecordFile(writes[index])),
      FILE_CONCURRENCY,
      moveIntoPlace
    )
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true })
    disposeSignalCleanup()
  }
}

/**
 * What identifies a file's bytes without reading them, taken when its digest was: the file (device
 * and inode), its size, and its modification and change times. The change time is the one a user
 * tool cannot set back (`cp -p`, `rsync -t` and `touch -d` restore only the modification time), so
 * any write since the digest moves it even when the size and modification time match.
 */
export interface FileStat {
  dev: number
  ino: number
  size: number
  mtimeMs: number
  ctimeMs: number
}

/** The {@link FileStat} of a `stat` result. */
export function fileStatOf(stats: FileStat): FileStat {
  const { dev, ino, size, mtimeMs, ctimeMs } = stats
  return { dev, ino, size, mtimeMs, ctimeMs }
}

/** Whether two stats name the same, unchanged bytes. */
export function sameFileStat(a: FileStat, b: FileStat): boolean {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs
  )
}

/** A blob's SHA-256 with the stat of the file it was read from. */
export interface StatDigest extends FileStat {
  sha256: string
}

/**
 * `.sim/written.json`: each source file's digest as the CLI last wrote it, normalized, and for a
 * blob the stat its digest was taken at, so a later command reuses the digest of an untouched blob
 * instead of reading it again.
 */
interface WrittenRecord {
  version: 1
  files: Record<string, string>
  stats?: Record<string, FileStat>
}

/** `.sim/written.json` as one command reads it, once. */
export interface Written {
  digests: Record<string, string>
  stats: Record<string, FileStat>
}

/** The digest of `text` as `readSourceText` would read it back. */
export function digest(text: string): string {
  return createHash('sha256').update(normalizeSourceText(text), 'utf8').digest('hex')
}

/**
 * What `.sim/written.json` records for `files` as they are about to be written, keeping the `kept`
 * digests of files this write leaves as they are. A blob's stat is recorded only beside the digest
 * it was taken with.
 */
export function writtenRecord(
  files: Record<string, string>,
  kept: Record<string, string> = {},
  stats: ReadonlyMap<string, StatDigest> = new Map()
): Written {
  const digests: Record<string, string> = {
    ...kept,
    ...Object.fromEntries(Object.entries(files).map(([path, text]) => [path, digest(text)])),
  }
  const recorded = [...stats].flatMap(([path, { sha256, ...stat }]) =>
    digests[path] === sha256 ? [[path, fileStatOf(stat)] as const] : []
  )
  return { digests, stats: Object.fromEntries(recorded) }
}

/** The text of `.sim/written.json` for `written`. */
export function writtenFile(written: Written): string {
  const record: WrittenRecord = {
    version: 1,
    files: written.digests,
    ...(Object.keys(written.stats).length > 0 ? { stats: written.stats } : {}),
  }
  return `${JSON.stringify(record, null, 2)}\n`
}

/** What the CLI recorded for its last write, empty when it recorded nothing. */
export async function readWritten(dir: string): Promise<Written> {
  const record = toRecord(await readSourceJson(dir, SOURCE_WRITTEN_FILE))
  const digests = Object.fromEntries(
    Object.entries(toRecord(record.files)).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  )
  const stats: Record<string, FileStat> = {}
  for (const [path, stat] of Object.entries(toRecord(record.stats))) {
    const { dev, ino, size, mtimeMs, ctimeMs } = toRecord(stat)
    if (
      typeof dev === 'number' &&
      typeof ino === 'number' &&
      typeof size === 'number' &&
      typeof mtimeMs === 'number' &&
      typeof ctimeMs === 'number'
    ) {
      stats[path] = { dev, ino, size, mtimeMs, ctimeMs }
    }
  }
  return { digests, stats }
}

/** The blob digests `written` holds with their stats, to carry into the next record. */
export function recordedStats(written: Written): Map<string, StatDigest> {
  return new Map(
    Object.entries(written.stats).flatMap(([path, stat]) =>
      Object.hasOwn(written.digests, path)
        ? [[path, { ...stat, sha256: written.digests[path] }] as const]
        : []
    )
  )
}

/**
 * The files among `touched` (path → the text about to be written, or `null` for a removal) whose
 * text on disk is neither what the CLI last wrote there nor what it is about to write: a write
 * would destroy an edit no apply has saved. A file the CLI has no record of counts as edited, so a
 * hand-written file is never replaced silently either; so does one the CLI wrote that is missing
 * now and would be written again, a delete no apply has sent.
 */
export async function editedFiles(
  dir: string,
  touched: ReadonlyMap<string, string | null>,
  written: Written['digests']
): Promise<string[]> {
  const entries = [...touched]
  const texts = await mapWithConcurrency(entries, FILE_CONCURRENCY, ([path]) =>
    readSourceText(dir, path)
  )
  return entries.flatMap(([path, next], index) => {
    const current = texts[index]
    if (current === null) return next !== null && Object.hasOwn(written, path) ? [path] : []
    if (next !== null && current === normalizeSourceText(next)) return []
    return written[path] !== digest(current) ? [path] : []
  })
}

/**
 * The source files a write of `answer` would destroy edits in: a file it replaces or prunes whose
 * text on disk is neither what the CLI last wrote there nor what it is about to write.
 */
export async function locallyEditedFiles(
  dir: string,
  answer: Pick<PrintedSourceAnswer, 'files' | 'lock'>,
  previousLock: unknown
): Promise<string[]> {
  const touched = new Map<string, string | null>(Object.entries(answer.files))
  for (const path of orphanedCodeFiles(previousLock, answer.lock, touched.keys())) {
    touched.set(path, null)
  }
  return editedFiles(dir, touched, (await readFolderWritten(dir)).digests)
}

/**
 * A `workflows/<key>` folder of a workspace directory: `root` holds a workspace `.sim/base.json`.
 * The workspace's `.sim/written.json` and base are the folder's records too, so a single-workflow
 * write keeps them instead of writing a record of its own the workspace commands never read.
 */
export interface WorkspaceFolder {
  root: string
  workspaceId: string
  /** The folder's key under `workflows/`. */
  key: string
}

/** The workspace directory `dir` is a workflow folder of, or `null`. */
export async function workspaceFolderOf(dir: string): Promise<WorkspaceFolder | null> {
  const folder = resolve(dir)
  if (basename(dirname(folder)) !== KIND_DIRS.workflow) return null
  const root = dirname(dirname(folder))
  const base = toRecord(await readSourceJson(root, SOURCE_BASE_FILE))
  if (typeof base.workspaceId !== 'string' || base.workflowId !== undefined) return null
  return { root, workspaceId: base.workspaceId, key: basename(folder) }
}

/** `path` of the workflow folder `key`, relative to its workspace directory. */
function inWorkspace(key: string, path: string): string {
  return `${KIND_DIRS.workflow}/${key}/${path}`
}

/**
 * What the CLI last wrote into the workflow directory `dir`: its own `.sim/written.json`, or for a
 * workflow folder of a workspace directory, the workspace record's entries for the folder (its
 * `.sim/` records left out). A write into such a folder records there and never in the folder, but
 * a CLI from before that left a record of the folder's own. That record wins only when it is the
 * later one: when the workspace record's digest of the folder's `.sim/base.json` is not the base on
 * disk, a single-workflow write replaced the base after the workspace record was taken. Otherwise
 * the folder's own record is stale and ignored.
 */
export async function readFolderWritten(dir: string): Promise<Written> {
  const own = await readWritten(dir)
  const folder = await workspaceFolderOf(dir)
  if (!folder) return own
  const record = await readWritten(folder.root)
  if (Object.keys(own.digests).length > 0) {
    const base = await readSourceText(dir, SOURCE_BASE_FILE)
    const recorded = record.digests[inWorkspace(folder.key, SOURCE_BASE_FILE)]
    if (base !== null && recorded !== digest(base)) return own
  }
  const prefix = inWorkspace(folder.key, '')
  const inFolder = <T>(entries: Record<string, T>) =>
    Object.fromEntries(
      Object.entries(entries).flatMap(([path, value]) => {
        const relative = path.startsWith(prefix) ? path.slice(prefix.length) : null
        return relative !== null && !relative.startsWith('.sim/') ? [[relative, value]] : []
      })
    )
  return { digests: inFolder(record.digests), stats: inFolder(record.stats) }
}

/**
 * Records a single-workflow write into workflow folder `folder` in the workspace records: each
 * written file's digest (`written`, folder-relative path → text) replaces the one before, a
 * `removed` file's is dropped, and the workspace base's entry for the workflow takes the
 * fingerprint of the folder's new base, as a workspace get would record it. Written after the
 * folder's files, so a write cut short leaves the old records.
 */
async function recordFolderWrite(
  folder: WorkspaceFolder,
  written: Record<string, string>,
  removed: readonly string[],
  base: unknown
): Promise<void> {
  const record = await readWritten(folder.root)
  const dropped = new Set(removed.map((path) => inWorkspace(folder.key, path)))
  const digests = {
    ...Object.fromEntries(Object.entries(record.digests).filter(([path]) => !dropped.has(path))),
    ...Object.fromEntries(
      Object.entries(written).map(([path, text]) => [inWorkspace(folder.key, path), digest(text)])
    ),
  }
  const write: Array<readonly [string, string]> = [
    [SOURCE_WRITTEN_FILE, writtenFile({ digests, stats: record.stats })],
  ]
  const workspaceBase = toRecord(await readSourceJson(folder.root, SOURCE_BASE_FILE))
  const resources = toRecord(workspaceBase.resources)
  const address = `workflow:${folder.key}`
  const entry = toRecord(resources[address])
  const { workflowId, fingerprint } = toRecord(base)
  if (entry.id === workflowId && typeof fingerprint === 'string') {
    const next = {
      ...workspaceBase,
      resources: {
        ...resources,
        [address]: { ...entry, fingerprint: fingerprintOf({ source: fingerprint }) },
      },
    }
    write.push([SOURCE_BASE_FILE, `${JSON.stringify(next, null, 2)}\n`])
  }
  await updateSourceDir(folder.root, { write })
}

/**
 * Every plain file under `folder` in the source directory, as source-relative paths. A symbolic
 * link anywhere is refused rather than followed; a missing folder lists nothing.
 */
export async function listSourceFiles(dir: string, folder: string): Promise<string[]> {
  if (embedStore.getStore()) {
    throw new SimApiError('Workspace source directories need a local disk.', 0)
  }
  const root = await realRoot(dir)
  if (root === null) return []
  const start = await checkedPath(root, folder, new Set())
  const files: string[] = []
  const walk = async (absolute: string, relative: string): Promise<void> => {
    let entries: Dirent[]
    try {
      entries = await readdir(absolute, { withFileTypes: true, encoding: 'utf8' })
    } catch (error) {
      if (isMissing(error)) return
      throw error
    }
    for (const entry of entries) {
      const path = `${relative}/${entry.name}`
      if (entry.isSymbolicLink()) {
        throw new SimApiError(
          `Refusing ${path}: it is a symbolic link, and the source directory only holds plain files.`,
          0,
          'SOURCE_SYMLINK'
        )
      }
      if (entry.isDirectory()) await walk(join(absolute, entry.name), path)
      else if (entry.isFile()) files.push(path)
    }
  }
  await walk(start, folder)
  return files
}

/** What the server answers a get, apply or create with: the printed files, lock and base. */
interface PrintedSourceAnswer {
  files: Record<string, string>
  lock: unknown
  base: unknown
}

/**
 * Writes a server answer into the source directory in one staged update: its files, lock and base,
 * plus `extra`, pruning the function files the previous lock named and the new one no longer does.
 * Returns how many files it wrote.
 */
export async function writeBack(
  dir: string,
  answer: PrintedSourceAnswer,
  previousLock: unknown,
  extra: SourceDirChange = { write: [] }
): Promise<number> {
  assertPrintedSourcePaths(answer.files)
  const folder = await workspaceFolderOf(dir)
  const printed: Array<readonly [string, string]> = [
    ...Object.entries(answer.files),
    [SOURCE_LOCK_FILE, `${JSON.stringify(answer.lock, null, 2)}\n`],
    [SOURCE_BASE_FILE, `${JSON.stringify(answer.base, null, 2)}\n`],
  ]
  const write = [
    ...printed,
    ...(folder ? [] : [[SOURCE_WRITTEN_FILE, writtenFile(writtenRecord(answer.files))] as const]),
    ...extra.write,
  ]
  const orphaned = orphanedCodeFiles(previousLock, answer.lock, Object.keys(answer.files))
  await updateSourceDir(dir, {
    write,
    remove: [
      ...orphaned,
      ...(extra.remove ?? []),
      // A record of the folder's own, from before, would shadow the workspace's.
      ...(folder ? [SOURCE_WRITTEN_FILE] : []),
    ],
  })
  if (folder) await recordFolderWrite(folder, Object.fromEntries(printed), orphaned, answer.base)
  return write.length
}

/**
 * Held while a command reads and rewrites a source directory, so two commands on one directory
 * (an agent and a person, two terminals) never interleave their writes: each file moves into
 * place atomically, but a set of them does not, and records from one command beside text from
 * another would send stale text as an edit. A folder, since creating one is atomic everywhere.
 */
export const SOURCE_DIR_LOCK = '.sim/command.lock'

/** The help line every command that holds {@link SOURCE_DIR_LOCK} adds to its exit codes. */
export const SOURCE_DIR_BUSY_HELP = `
Exit 10 (busy, retry): another sim workspaces source command is using this directory
(SOURCE_DIR_BUSY); nothing was read or written. Run this one again once it finished.`

/** The file-system codes of a directory the user may not write: its lock cannot be taken. */
const UNWRITABLE_CODES: ReadonlySet<string> = new Set(['EACCES', 'EPERM', 'EROFS'])

/** A lock whose owner never recorded itself is stale after this long (it died while taking it). */
const UNRECORDED_LOCK_STALE_MS = 60_000

/** The file in the lock folder that records its owner. */
const LOCK_OWNER_FILE = 'owner.json'
/** The folder a command creates in a lock it found stale while it takes that lock over. */
const LOCK_TAKEOVER_DIR = 'takeover'

/** Who holds the lock, as its owner file records it. */
interface LockOwner {
  pid: number
  host: string
}

/** A file-system or process error's code (`EEXIST`, `ESRCH`), if it has one. */
function errorCode(error: unknown): string | undefined {
  return isRecordLike(error) && typeof error.code === 'string' ? error.code : undefined
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return errorCode(error) === 'EPERM'
  }
}

/** The lock folder a command found, as it found it: which folder, and when it last changed. */
type LockSighting = Pick<Stats, 'dev' | 'ino' | 'mtimeMs'>

/**
 * Whether the lock at `lock`, as `seen`, was left by a command that is gone: its process on this
 * machine no longer runs, or it never recorded an owner and had not changed for a minute when it
 * was seen. The age is the sighting's, not the folder's now, because a takeover's own claim
 * changes the folder. A lock another machine holds (a shared folder) is never taken over.
 */
async function isStaleLock(lock: string, seen: LockSighting): Promise<boolean> {
  const owner = toRecord(
    await readFile(join(lock, LOCK_OWNER_FILE), 'utf8').then(
      (text): unknown => JSON.parse(text),
      () => null
    )
  )
  if (typeof owner.pid === 'number' && typeof owner.host === 'string') {
    return owner.host === hostname() && !isAlive(owner.pid)
  }
  return Date.now() - seen.mtimeMs > UNRECORDED_LOCK_STALE_MS
}

/**
 * Removes the lock at `lock`, which the caller found stale as `seen`, unless another command took
 * it over first. Two commands can find one lock stale at once: one removes it and takes the lock,
 * and the other, acting on what it saw before, must not remove the live lock that replaced it. So
 * a takeover first claims the lock folder it means to remove (creating {@link LOCK_TAKEOVER_DIR}
 * in it, which only one command can), then removes it only while it is still the folder it saw
 * and still stale; a lock that replaced the stale one is another folder or records a live owner,
 * so the late command leaves it. A command that died mid-takeover leaves its claim in a stale
 * lock, which the busy message says to remove.
 */
export async function takeOverStaleLock(lock: string, seen: LockSighting): Promise<void> {
  const claim = join(lock, LOCK_TAKEOVER_DIR)
  try {
    await mkdir(claim)
  } catch (error) {
    if (errorCode(error) === 'EEXIST' || isMissing(error)) return
    throw error
  }
  const now = await stat(lock).catch(() => null)
  const sameFolder = now !== null && now.dev === seen.dev && now.ino === seen.ino
  if (sameFolder && (await isStaleLock(lock, seen)))
    await rm(lock, { recursive: true, force: true })
  else await rmdir(claim).catch(() => {})
}

/**
 * Runs `run` holding the directory's command lock ({@link SOURCE_DIR_LOCK}). A second command on
 * the directory meanwhile is refused (`SOURCE_DIR_BUSY`, exit 10) with nothing read or written; a
 * lock its command left behind when it died is taken over ({@link takeOverStaleLock}). Like every
 * other source path, `.sim` and the lock are never followed through a symbolic link
 * (`SOURCE_SYMLINK`). An embedded run has no local directory to lock.
 */
export async function withSourceDirLock<T>(
  dir: string,
  run: () => Promise<T>,
  options: { readOnly?: boolean } = {}
): Promise<T> {
  if (embedStore.getStore()) return run()
  const absent = async (path: string) =>
    lstat(path).then(
      () => false,
      () => true
    )
  const createdDir = await absent(dir)
  let root: string
  let records: string
  let createdRecords: boolean
  let lock: string
  let held = false
  try {
    await mkdir(dir, { recursive: true })
    root = await realpath(dir)
    records = await checkedPath(root, '.sim', new Set())
    createdRecords = createdDir || (await absent(records))
    await mkdir(records).catch((error: unknown) => {
      if (errorCode(error) !== 'EEXIST') throw error
    })
    lock = await checkedPath(root, SOURCE_DIR_LOCK, new Set())
    for (let attempt = 0; attempt < 2 && !held; attempt += 1) {
      try {
        await mkdir(lock)
        held = true
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') throw error
        await checkedPath(root, SOURCE_DIR_LOCK, new Set())
        const seen = attempt === 0 ? await stat(lock).catch(() => null) : null
        if (seen && (await isStaleLock(lock, seen))) await takeOverStaleLock(lock, seen)
      }
    }
  } catch (error) {
    if (!UNWRITABLE_CODES.has(errorCode(error) ?? '')) throw error
    // Nothing can rewrite a directory no one may write, so a command that only reads it needs
    // no lock; one that writes it is refused with the reason instead of a stack trace.
    if (options.readOnly) return run()
    throw new SimApiError(
      `${dir} cannot be written (${errorCode(error)}), and this command writes it; nothing was read or written. Make it writable, or run the command on a writable copy.`,
      0,
      'SOURCE_DIR_UNWRITABLE'
    )
  }
  if (!held) {
    throw new SimApiError(
      `Another sim command is using ${dir}; nothing was read or written. Run this one again once it finished. If none is running, remove ${join(dir, SOURCE_DIR_LOCK)}.`,
      0,
      'SOURCE_DIR_BUSY',
      undefined,
      SOURCE_BUSY_EXIT_CODE
    )
  }
  const owner: LockOwner = { pid: process.pid, host: hostname() }
  // An interrupt (Ctrl-C) releases the lock too: a lock left behind is taken over only by a
  // command on the same host, so one left on a folder shared with a container would stay.
  const disposeSignalRelease = removeStagingOnSignal(() => lock)
  try {
    await writeFile(join(lock, LOCK_OWNER_FILE), JSON.stringify(owner))
    return await run()
  } finally {
    disposeSignalRelease()
    await rm(await checkedPath(root, SOURCE_DIR_LOCK, new Set()), { recursive: true, force: true })
    // Folders the lock alone created go with it; one the command filled stays.
    if (createdRecords) await rmdir(records).catch(() => {})
    if (createdDir) await rmdir(dir).catch(() => {})
  }
}

/**
 * Runs a single-workflow command on `dir` holding the command lock of the workspace directory it
 * is a workflow folder of, if any: such a command rewrites the workspace's own records (see
 * {@link writeBack}), so it must not interleave with a workspace command, or with another workflow
 * command in a sibling folder. Refused like a workspace command (`SOURCE_DIR_BUSY`, exit 10), with
 * nothing read or written.
 */
export async function withWorkspaceFolderLock<T>(dir: string, run: () => Promise<T>): Promise<T> {
  const folder = await workspaceFolderOf(dir)
  return folder ? withSourceDirLock(folder.root, run) : run()
}

/** The help line every single-workflow command that writes a directory adds to its exit codes. */
export const WORKSPACE_FOLDER_BUSY_HELP = `
Exit 10 (busy, retry): --dir is a workflow folder of a workspace directory another sim command is
using (SOURCE_DIR_BUSY); nothing was read or written. Run this one again once it finished.`
