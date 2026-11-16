/**
 * The source directory `workflows source get --dir` writes and `workflows source apply --dir`
 * (or `create --dir`) reads back: its layout, and the only code that reads or writes it on disk.
 * One definition, so the commands cannot drift apart.
 *
 * Every path is relative to `realpath(--dir)` and no component below it may be a symbolic link,
 * so nothing is read from or written to outside the directory, whatever a link in it points at.
 * Writes are staged in the directory first and moved into place, so a failed write leaves the
 * files it did not reach as they were. An embedded run reads and writes through its host instead.
 */

import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import { isRecordLike, toRecord } from '@sim/utils/object'
import { embedStore } from '../../embed-context'
import { SimApiError } from '../../http/client'
import { embeddedFileContent } from '../../transfer/local-file'
import { removeStagingOnSignal, saveToFile } from './files-get'

/** The entry file every source directory holds; function code sits beside it under `functions/`. */
export const SOURCE_ENTRY_FILE = 'workflow.ts'
/** Where function-code files live; the only files the CLI ever prunes. */
const SOURCE_FUNCTIONS_DIR = 'functions'
/** The identity lock (`WorkflowLockV1`). */
export const SOURCE_LOCK_FILE = '.sim/lock.json'
/** The freshness facts for the lock in this environment (`SourceBase`). */
export const SOURCE_BASE_FILE = '.sim/base.json'
/** Generated SDK declarations: every block in the workspace catalog, plus `workspace.d.ts`. */
export const SOURCE_SDK_DIR = '.sim/sdk'
/** A short guide for an agent working in the directory; never a top-level `AGENTS.md`. */
export const SOURCE_AGENTS_FILE = '.sim/AGENTS.md'
/** Pins the source files to LF, merged into whatever the directory already holds. */
export const SOURCE_GITATTRIBUTES_FILE = '.gitattributes'

const GITATTRIBUTES_LINES = [
  `${SOURCE_ENTRY_FILE} text eol=lf`,
  `${SOURCE_FUNCTIONS_DIR}/** text eol=lf`,
]
/** Files written at once on a local disk; the declarations run to thousands of small files. */
const WRITE_CONCURRENCY = 32

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
export async function readPreviousLock(dir: string): Promise<unknown> {
  const text = await readSourceText(dir, SOURCE_LOCK_FILE)
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** `.gitattributes` with the source lines appended where missing, or `null` when it has them. */
export function mergedGitattributes(existing: string | null): string | null {
  const present = new Set((existing ?? '').split('\n').map((line) => line.trim()))
  const missing = GITATTRIBUTES_LINES.filter((line) => !present.has(line))
  if (missing.length === 0) return null
  const prefix = existing && !existing.endsWith('\n') ? `${existing}\n` : (existing ?? '')
  return `${prefix}${missing.join('\n')}\n`
}

function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/**
 * The absolute path of `path` under `root` (already a realpath), refusing a symbolic link at any
 * component that exists. `verified` caches directories already checked across one operation.
 */
async function checkedPath(root: string, path: string, verified: Set<string>): Promise<string> {
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
 * The text of `path` in the source directory with CRLF line endings turned into LF (a Windows
 * checkout must not turn an unchanged source into an edit), or `null` when it does not exist.
 * A symbolic link anywhere below the directory is refused rather than followed.
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
  return text.replace(/\r\n/g, '\n')
}

/** What one write does to the source directory: files to remove first, then files to write. */
export interface SourceDirChange {
  write: ReadonlyArray<readonly [path: string, text: string]>
  /** Files or directories (removed recursively); an embedded run cannot remove, so skips these. */
  remove?: readonly string[]
}

async function inBatches<T>(items: readonly T[], run: (item: T) => Promise<void>): Promise<void> {
  for (let start = 0; start < items.length; start += WRITE_CONCURRENCY) {
    await Promise.all(items.slice(start, start + WRITE_CONCURRENCY).map(run))
  }
}

/**
 * Applies a change to the source directory, creating it when absent. Every target is checked
 * before anything is touched; the files are written to a staging directory inside it, then the
 * removals run and each file is renamed into place, never through a link.
 */
export async function updateSourceDir(dir: string, change: SourceDirChange): Promise<void> {
  for (const path of [...change.write.map(([path]) => path), ...(change.remove ?? [])]) {
    if (sourceRelativePath(path) !== path) {
      throw new SimApiError(`Refusing to write ${path} outside ${dir}`, 0)
    }
  }
  if (embedStore.getStore()) {
    for (const [path, text] of change.write) {
      await saveToFile(new Blob([text]).stream(), posix.join(dir, path), true)
    }
    return
  }

  await mkdir(dir, { recursive: true })
  const root = await realpath(dir)
  const verified = new Set<string>()
  const targets: string[] = []
  for (const [path] of change.write) targets.push(await checkedPath(root, path, verified))
  const removals: string[] = []
  for (const path of change.remove ?? []) removals.push(await checkedPath(root, path, verified))

  let staging: string | null = null
  const disposeSignalCleanup = removeStagingOnSignal(() => staging)
  try {
    const stagingDir = await mkdtemp(join(root, '.sim-staging-'))
    staging = stagingDir
    const indexes = change.write.map((_, index) => index)
    const staged = (index: number) => join(stagingDir, String(index))
    await inBatches(indexes, (index) =>
      writeFile(staged(index), change.write[index][1], { flag: 'wx' })
    )
    for (const target of removals) await rm(target, { recursive: true, force: true })
    const parents = new Map<string, Promise<unknown>>()
    await inBatches(indexes, async (index) => {
      const parent = dirname(targets[index])
      let created = parents.get(parent)
      if (!created) {
        created = mkdir(parent, { recursive: true })
        parents.set(parent, created)
      }
      await created
      await rename(staged(index), targets[index])
    })
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true })
    disposeSignalCleanup()
  }
}
