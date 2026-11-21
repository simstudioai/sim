/**
 * The CLI's record of what it last wrote into a source directory (`.sim/written.json`, and the
 * machine-local stat cache beside it), and the edits on disk that record tells apart from its own
 * writes.
 */

import { createHash } from 'node:crypto'
import { mapWithConcurrency } from '@sim/utils/concurrency'
import { toRecord } from '@sim/utils/object'
import { compareStrings } from '@sim/utils/string'
import { SOURCE_BASE_FILE } from '@sim/workflow-code/limits'
import { KIND_DIRS } from '@sim/workspace-code'
import { workspaceFolderOf } from './dir-kind'
import { FILE_CONCURRENCY, normalizeSourceText, readSourceJson, readSourceText } from './files'
import { orphanedCodeFiles, SOURCE_WRITTEN_FILE } from './layout'

/**
 * Machine-local cache the CLI keeps beside its records: the stat each blob digest was taken at,
 * which names this machine's files (device, inode, times) and so is never committed. The folder
 * ignores itself (`.sim/cache/.gitignore`), whatever the repository's own `.gitignore` says.
 */
const SOURCE_CACHE_DIR = '.sim/cache'
const SOURCE_STATS_FILE = `${SOURCE_CACHE_DIR}/stats.json`
const SOURCE_CACHE_IGNORE_FILE = `${SOURCE_CACHE_DIR}/.gitignore`

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
 * `.sim/written.json`: each source file's digest as the CLI last wrote it, normalized, sorted by
 * path. It holds nothing about this machine, so a clone reads it the same and a write that changes
 * no file leaves it byte for byte.
 */
interface WrittenRecord {
  version: 1
  files: Record<string, string>
}

/**
 * `.sim/cache/stats.json`: for a blob, the stat its digest was taken at, beside that digest, so a
 * later command on this machine reuses the digest of an untouched blob instead of reading it
 * again. A stat whose digest is not the one `.sim/written.json` records is ignored.
 */
interface StatsRecord {
  version: 1
  stats: Record<string, StatDigest>
}

/**
 * What the CLI last wrote, as one command reads it, once: the digests from `.sim/written.json`
 * and the stats from `.sim/cache/stats.json` that still match them.
 */
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

/** `record` with its keys in path order, so the same entries always print the same text. */
function sortedByPath<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => compareStrings(a, b)))
}

/**
 * The files that record `written`: `.sim/written.json` (committed) and, when a blob stat is
 * recorded, the machine-local `.sim/cache/stats.json` with the cache folder's own `.gitignore`.
 */
export function writtenFiles(written: Written): Array<readonly [string, string]> {
  const record: WrittenRecord = { version: 1, files: sortedByPath(written.digests) }
  const files: Array<readonly [string, string]> = [
    [SOURCE_WRITTEN_FILE, `${JSON.stringify(record, null, 2)}\n`],
  ]
  const stats = Object.entries(written.stats).flatMap(([path, stat]) =>
    Object.hasOwn(written.digests, path)
      ? [[path, { sha256: written.digests[path], ...fileStatOf(stat) }] as const]
      : []
  )
  if (stats.length === 0) return files
  const cache: StatsRecord = { version: 1, stats: sortedByPath(Object.fromEntries(stats)) }
  return [
    ...files,
    [SOURCE_STATS_FILE, `${JSON.stringify(cache, null, 2)}\n`],
    [SOURCE_CACHE_IGNORE_FILE, '*\n'],
  ]
}

/** What the CLI recorded for its last write, empty when it recorded nothing. */
export async function readWritten(dir: string): Promise<Written> {
  const record = toRecord(await readSourceJson(dir, SOURCE_WRITTEN_FILE))
  const digests = Object.fromEntries(
    Object.entries(toRecord(record.files)).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  )
  const cache = toRecord(await readSourceJson(dir, SOURCE_STATS_FILE))
  const stats: Record<string, FileStat> = {}
  for (const [path, stat] of Object.entries(toRecord(cache.stats))) {
    const { sha256, dev, ino, size, mtimeMs, ctimeMs } = toRecord(stat)
    if (
      typeof sha256 === 'string' &&
      Object.hasOwn(digests, path) &&
      digests[path] === sha256 &&
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
  const { digests } = await readFolderWritten(dir)
  for (const path of orphanedCodeFiles(previousLock, answer.lock, touched.keys(), digests)) {
    touched.set(path, null)
  }
  return editedFiles(dir, touched, digests)
}

/** `path` of the workflow folder `key`, relative to its workspace directory. */
export function inWorkspace(key: string, path: string): string {
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

/** What the server answers a get, apply or create with: the printed files, lock and base. */
export interface PrintedSourceAnswer {
  files: Record<string, string>
  lock: unknown
  base: unknown
}
