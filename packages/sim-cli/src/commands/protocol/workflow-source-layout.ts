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

import { createHash } from 'node:crypto'
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
import { dirname, join, posix } from 'node:path'
import { chunkArray } from '@sim/utils/helpers'
import { isRecordLike, toRecord } from '@sim/utils/object'
import {
  CODE_FILE_EXTENSIONS,
  SOURCE_ENTRY_FILE,
  SOURCE_CODE_DIR as SOURCE_FUNCTIONS_DIR,
} from '@sim/workflow-code/limits'
import { embedStore } from '../../embed-context'
import { SimApiError } from '../../http/client'
import { embeddedFileContent } from '../../transfer/local-file'
import { removeStagingOnSignal, saveToFile } from './files-get'

/** The identity lock (`WorkflowLockV1`). */
export const SOURCE_LOCK_FILE = '.sim/lock.json'
/** The freshness facts for the lock in this environment (`SourceBase`). */
export const SOURCE_BASE_FILE = '.sim/base.json'
/** Generated SDK declarations: every block in the workspace catalog, plus `workspace.d.ts`. */
export const SOURCE_SDK_DIR = '.sim/sdk'
/** A short guide for an agent working in the directory; never a top-level `AGENTS.md`. */
export const SOURCE_AGENTS_FILE = '.sim/AGENTS.md'
/**
 * One correct example of each common block, rewritten on every get like the agent guide. It names
 * example resources the workspace may lack, so the written `tsconfig.json` never includes it.
 */
export const SOURCE_COOKBOOK_FILE = '.sim/examples/cookbook.ts'
/** Pins the source files to LF, merged into whatever the directory already holds. */
export const SOURCE_GITATTRIBUTES_FILE = '.gitattributes'
/**
 * A digest of each source file as the CLI last wrote it, so a later get can tell an unapplied
 * edit from a file it may replace. The CLI's own record: never sent to the server.
 */
export const SOURCE_WRITTEN_FILE = '.sim/written.json'

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
function orphanedCodeFiles(
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

/** `.gitattributes` with `lines` appended where missing, or `null` when it has them all. */
export function mergedGitattributes(
  existing: string | null,
  lines: readonly string[] = GITATTRIBUTES_LINES
): string | null {
  const present = new Set((existing ?? '').split('\n').map((line) => line.trim()))
  const missing = lines.filter((line) => !present.has(line))
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
 * The text of `path` in the source directory without a leading byte-order mark and with CRLF line
 * endings turned into LF (a Windows editor or checkout must not turn an unchanged source into an
 * edit, or hide its `// @sim-sdk` header), or `null` when it does not exist.
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
  return text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
}

/** What one write does to the source directory: files to remove first, then files to write. */
export interface SourceDirChange {
  write: ReadonlyArray<readonly [path: string, text: string]>
  /** Files or directories (removed recursively); an embedded run cannot remove, so skips these. */
  remove?: readonly string[]
}

/** `run` over `items`, at most `WRITE_CONCURRENCY` at a time; results in `items` order. */
export async function inBatches<T, R>(items: T[], run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  for (const batch of chunkArray(items, WRITE_CONCURRENCY)) {
    results.push(...(await Promise.all(batch.map(run))))
  }
  return results
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

/** `.sim/written.json`: each source file's digest as the CLI last wrote it. */
interface WrittenRecord {
  version: 1
  files: Record<string, string>
}

/** The digest `.sim/written.json` records for a file's text. */
export function digest(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * `.sim/written.json` for `files` as they are about to be written, keeping the `kept` digests of
 * files this write leaves as they are.
 */
export function writtenRecord(
  files: Record<string, string>,
  kept: Record<string, string> = {}
): string {
  const record: WrittenRecord = {
    version: 1,
    files: {
      ...kept,
      ...Object.fromEntries(Object.entries(files).map(([path, text]) => [path, digest(text)])),
    },
  }
  return `${JSON.stringify(record, null, 2)}\n`
}

/** The digests the CLI recorded for its last write, empty when it recorded none. */
export async function readWrittenDigests(dir: string): Promise<Record<string, string>> {
  const text = await readSourceText(dir, SOURCE_WRITTEN_FILE)
  if (text === null) return {}
  try {
    const files = toRecord(toRecord(JSON.parse(text)).files)
    return Object.fromEntries(
      Object.entries(files).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    )
  } catch {
    return {}
  }
}

/**
 * The files among `touched` (path → the text about to be written, or `null` for a removal) whose
 * text on disk is neither what the CLI last wrote there nor what it is about to write: a write
 * would destroy an edit no apply has saved. A file the CLI has no record of counts as edited, so a
 * hand-written file is never replaced silently either.
 */
export async function editedFiles(
  dir: string,
  touched: ReadonlyMap<string, string | null>
): Promise<string[]> {
  const written = await readWrittenDigests(dir)
  const entries = [...touched]
  const texts = await inBatches(entries, ([path]) => readSourceText(dir, path))
  return entries.flatMap(([path, next], index) => {
    const current = texts[index]
    if (current === null || current === next) return []
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
  return editedFiles(dir, touched)
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
  const write = [
    ...Object.entries(answer.files),
    [SOURCE_LOCK_FILE, `${JSON.stringify(answer.lock, null, 2)}\n`] as const,
    [SOURCE_BASE_FILE, `${JSON.stringify(answer.base, null, 2)}\n`] as const,
    [SOURCE_WRITTEN_FILE, writtenRecord(answer.files)] as const,
    ...extra.write,
  ]
  await updateSourceDir(dir, {
    write,
    remove: [
      ...orphanedCodeFiles(previousLock, answer.lock, Object.keys(answer.files)),
      ...(extra.remove ?? []),
    ],
  })
  return write.length
}
