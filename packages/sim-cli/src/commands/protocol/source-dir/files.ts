/**
 * Reading and writing the source directory's files. Every path is relative to `realpath(--dir)`
 * and no component below it may be a symbolic link, so nothing is read from or written to outside
 * the directory, whatever a link in it points at. Writes are staged in the directory first and
 * moved into place, so a failed write leaves the files it did not reach as they were. An embedded
 * run reads and writes through its host instead.
 */

import type { Dirent } from 'node:fs'
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, posix } from 'node:path'
import { mapWithConcurrency } from '@sim/utils/concurrency'
import { isRecordLike } from '@sim/utils/object'
import {
  SOURCE_BASE_FILE,
  SOURCE_ENTRY_FILE,
  SOURCE_CODE_DIR as SOURCE_FUNCTIONS_DIR,
  SOURCE_LOCK_FILE,
} from '@sim/workflow-code/limits'
import { embedStore } from '../../../embed-context'
import { embeddedFileContent } from '../../../transfer/local-file'
import { removeStagingOnSignal, saveToFile } from '../files-get'
import { SourceDirError } from '../local-errors'
import {
  SOURCE_STAGING_PREFIX,
  SOURCE_STORED_EDGES_FILE,
  SOURCE_WRITTEN_FILE,
  sourceRelativePath,
} from './layout'

const GITATTRIBUTES_LINES = [
  `${SOURCE_ENTRY_FILE} text eol=lf`,
  `${SOURCE_FUNCTIONS_DIR}/** text eol=lf`,
]
/** Files read or written at once on a local disk; a catalog's declarations run to hundreds of small files. */
export const FILE_CONCURRENCY = 32

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
      throw new SourceDirError(
        `Refusing ${segments.slice(0, index + 1).join('/')}: it is a symbolic link, and the source directory only holds plain files.`,
        { code: 'SOURCE_SYMLINK' }
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
export function normalizeSourceText(text: string): string {
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
    } catch (error) {
      // The host's reader names no missing-file error, so a failure reads as a missing file; a
      // stopped run does not.
      if (embedded.identity.signal?.aborted) throw error
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
      throw new SourceDirError(`Cannot read ${join(dir, path)}: ${(error as Error).message}`)
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
 * The files that record what the directory was read from: each workflow's lock, base,
 * `.sim/written.json` and stored edges, and the workspace base. They move into place only after every other file,
 * so a write cut short leaves the old records beside whatever text did land: the next apply is
 * refused as stale, never sent as if the old text were current.
 */
const RECORD_FILES = [
  SOURCE_BASE_FILE,
  SOURCE_LOCK_FILE,
  SOURCE_WRITTEN_FILE,
  SOURCE_STORED_EDGES_FILE,
]

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
      throw new SourceDirError(`Refusing to write ${path} outside ${dir}`)
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
 * Every plain file under `folder` in the source directory, as source-relative paths. A symbolic
 * link anywhere is refused rather than followed; a missing folder lists nothing.
 */
export async function listSourceFiles(dir: string, folder: string): Promise<string[]> {
  if (embedStore.getStore()) {
    throw new SourceDirError('Workspace source directories need a local disk.')
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
        throw new SourceDirError(
          `Refusing ${path}: it is a symbolic link, and the source directory only holds plain files.`,
          { code: 'SOURCE_SYMLINK' }
        )
      }
      if (entry.isDirectory()) await walk(join(absolute, entry.name), path)
      else if (entry.isFile()) files.push(path)
    }
  }
  await walk(start, folder)
  return files
}

/** A file-system or process error's code (`EEXIST`, `ESRCH`), if it has one. */
export function errorCode(error: unknown): string | undefined {
  return isRecordLike(error) && typeof error.code === 'string' ? error.code : undefined
}
