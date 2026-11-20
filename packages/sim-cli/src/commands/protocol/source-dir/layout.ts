/**
 * The source directory's layout beside the printed files: the CLI's own record and cache paths,
 * which paths a server answer may write, and the function files a lock names.
 */

import { posix } from 'node:path'
import { isRecordLike, toRecord } from '@sim/utils/object'
import {
  isCodeFilePath,
  SOURCE_ENTRY_FILE,
  SOURCE_CODE_DIR as SOURCE_FUNCTIONS_DIR,
} from '@sim/workflow-code/limits'
import { printError } from '#sim-cli/output/io'
import { SourceDirError } from '../local-errors'

/** Generated SDK declarations: the blocks the source uses (every block's are cached), plus `workspace.d.ts`. */
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
 * The workspace a starter written by `workflows source create` was typed for, so the create that
 * follows targets that workspace. The CLI's own record: never sent, and removed once the workflow
 * exists.
 */
export const SOURCE_STARTER_FILE = '.sim/starter.json'
/**
 * The edges of the workflow a get or apply printed, by lock key, with the base fingerprint they
 * belong to, so an offline check tells an edge the stored workflow holds from one the source
 * adds. The CLI's own record: never sent to the server.
 */
export const SOURCE_STORED_EDGES_FILE = '.sim/stored-edges.json'
/**
 * Where a workspace get keeps the blobs it verified until they move into place. A get that fails
 * leaves them there, so the next one downloads only the rest; the one that completes removes the
 * folder.
 */
export const SOURCE_DOWNLOADS_DIR = '.sim/downloads'
/** The folder a write stages its files in before moving them into place; removed when it ends. */
export const SOURCE_STAGING_PREFIX = '.sim-staging-'

/**
 * Whether a server answer may write `path` into the source directory: the entry file, or a code
 * file as {@link isCodeFilePath} (the rule the compiler applies to `codeFile()`) names one.
 * Anything else (`.git/hooks/*`, `conftest.py`, a dotfile) is refused, whatever base URL answered.
 */
function isPrintedSourcePath(path: string): boolean {
  return path === SOURCE_ENTRY_FILE || isCodeFilePath(path)
}

/** The paths of `files` that {@link isPrintedSourcePath} refuses, in their order. */
function refusedSourcePaths(files: Record<string, string>): string[] {
  return Object.keys(files).filter((path) => !isPrintedSourcePath(path))
}

/** Refuses a server answer naming a file the printer never writes, before anything is written. */
export function assertPrintedSourcePaths(files: Record<string, string>): void {
  const [refused] = refusedSourcePaths(files)
  if (refused !== undefined) {
    throw new SourceDirError(`The workflow source named an unsafe file path: ${refused}`)
  }
}

/**
 * Refuses, before a write is sent, a code file the server would store but the CLI could never
 * write back: one rule ({@link isCodeFilePath}) for both, so an apply is never stored and then
 * reported as failed.
 */
export function assertSendableCodeFiles(files: Record<string, string>): void {
  const refused = refusedSourcePaths(files)
  if (refused.length === 0) return
  throw new SourceDirError(
    `${refused.join(', ')} ${refused.length === 1 ? 'is not a code file path' : 'are not code file paths'} a workflow directory holds, so nothing was sent. Move the code to ${SOURCE_FUNCTIONS_DIR}/<name>.js (or .py, .sh: letters, digits, _, $, - and dots, not starting with a dot) and update its codeFile().`,
    { code: 'E_CODE_FILE_PATH' }
  )
}

/**
 * A path inside the source directory, normalized (`./functions/x.js` → `functions/x.js`), or
 * `null` for an absolute path, a drive letter, a `..` escape or a NUL byte (which no file name
 * holds, so the compile refuses the path as `E_CODE_FILE_PATH`).
 */
export function sourceRelativePath(path: string): string | null {
  const normalized = posix.normalize(path.replace(/\\/g, '/'))
  if (
    normalized.includes('\0') ||
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
 * The function files a write leaves behind: named by the lock the directory held, recorded as
 * written by the CLI (`recorded`, the written record's paths relative to the same directory), no
 * longer named by the new lock, and not being written now. A file the CLI never wrote is never
 * pruned, even when a hand-edited lock names it (say as a trigger's `codeFile`), nor is an entry
 * that is no code file (such as `functions/`), whose removal would take the whole folder.
 */
export function orphanedCodeFiles(
  previousLock: unknown,
  nextLock: unknown,
  written: Iterable<string>,
  recorded: Readonly<Record<string, string>>
): string[] {
  const kept = lockCodeFiles(nextLock)
  for (const path of written) kept.add(path)
  return [...lockCodeFiles(previousLock)].filter(
    (path) =>
      path.startsWith(`${SOURCE_FUNCTIONS_DIR}/`) &&
      isCodeFilePath(path) &&
      Object.hasOwn(recorded, path) &&
      !kept.has(path)
  )
}

/**
 * The files of a stored write's answer the CLI may write: every one {@link isPrintedSourcePath}
 * accepts. The write is already stored, so a path refused here is left as it is on disk (it is
 * the author's own file, which the server echoed) with a warning, never thrown: the lock and base
 * are still written, so the directory matches the stored workflow.
 */
export function writableFiles(files: Record<string, string>): Record<string, string> {
  const refused = refusedSourcePaths(files)
  if (refused.length === 0) return files
  printError(
    `warning: the answer named ${refused.join(', ')}, which the CLI never writes; the write was saved and the lock and base were written, but ${refused.length === 1 ? 'that file was' : 'those files were'} left as ${refused.length === 1 ? 'it is' : 'they are'} on disk.`
  )
  return Object.fromEntries(Object.entries(files).filter(([path]) => isPrintedSourcePath(path)))
}
