/**
 * The command lock of a source directory (`.sim/command.lock`): held while a command reads and
 * rewrites the directory, so two commands on it never interleave their writes.
 */

import { rmSync, type Stats } from 'node:fs'
import { lstat, mkdir, readFile, realpath, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { toRecord } from '@sim/utils/object'
import { embedStore } from '../../../embed-context'
import { SOURCE_BUSY_EXIT_CODE } from '../../../exit-codes'
import { removeStagingOnSignal } from '../files-get'
import { SourceDirError } from '../local-errors'
import { workspaceFolderOf } from './dir-kind'
import { checkedPath, errorCode, isMissing } from './files'

/**
 * Held while a command reads and rewrites a source directory, so two commands on one directory
 * (an agent and a person, two terminals) never interleave their writes: each file moves into
 * place atomically, but a set of them does not, and records from one command beside text from
 * another would send stale text as an edit. A folder, since creating one is atomic everywhere.
 */
export const SOURCE_DIR_LOCK = '.sim/command.lock'

/** The help line every command that holds {@link SOURCE_DIR_LOCK} adds to its exit codes. */
export const SOURCE_DIR_BUSY_HELP = `
Exit ${SOURCE_BUSY_EXIT_CODE} (busy, retry): another sim workspaces source or workflows source command is using
this directory or a workflow folder in it (SOURCE_DIR_BUSY); nothing was read or written. Run this one
again once it finished.`

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
 * machine no longer runs, or it never recorded an owner (no owner file, or one `writeFile` created
 * but had not yet filled) and had not changed for a minute when it was seen. The age is the
 * sighting's, not the folder's now, because a takeover's own claim changes the folder. A lock
 * another machine holds (a shared folder) is never taken over.
 */
async function isStaleLock(lock: string, seen: LockSighting): Promise<boolean> {
  const owner = toRecord(
    await readFile(join(lock, LOCK_OWNER_FILE), 'utf8')
      .then((text): unknown => JSON.parse(text))
      .catch(() => null)
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
  // `mkdir` resolves `..` after following links and the cleanup climbs lexically: resolved, both
  // walk one path.
  dir = resolve(dir)
  const absent = async (path: string) =>
    lstat(path).then(
      () => false,
      () => true
    )
  /** The outermost folder the lock created on the way to `dir`, when `dir` was missing. */
  let createdFrom: string | undefined
  let root: string
  let records: string | undefined
  let createdRecords = false
  let lock: string
  let held = false
  /** Removes the folders the lock alone created, each only while it is empty. */
  const removeCreatedFolders = async () => {
    if (createdRecords && records !== undefined) await rmdir(records).catch(() => {})
    if (createdFrom !== undefined) await removeEmptyFolders(dir, createdFrom)
  }
  try {
    createdFrom = await mkdir(dir, { recursive: true })
    root = await realpath(dir)
    records = await checkedPath(root, '.sim', new Set())
    createdRecords = createdFrom !== undefined || (await absent(records))
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
    if (!UNWRITABLE_CODES.has(errorCode(error) ?? '')) {
      await removeCreatedFolders()
      throw error
    }
    // Nothing can rewrite a directory no one may write, so a command that only reads it needs
    // no lock; one that writes it is refused with the reason instead of a stack trace.
    if (options.readOnly) {
      try {
        return await run()
      } finally {
        await removeCreatedFolders()
      }
    }
    await removeCreatedFolders()
    throw new SourceDirError(
      `${dir} cannot be written (${errorCode(error)}), and this command writes it; nothing was read or written. Make it writable, or run the command on a writable copy.`,
      { code: 'SOURCE_DIR_UNWRITABLE' }
    )
  }
  if (!held) {
    await removeCreatedFolders()
    throw new SourceDirError(
      `Another sim command is using ${dir}; nothing was read or written. Run this one again once it finished. If none is running, remove ${join(dir, SOURCE_DIR_LOCK)}.`,
      { code: 'SOURCE_DIR_BUSY', exitCode: SOURCE_BUSY_EXIT_CODE }
    )
  }
  const owner: LockOwner = { pid: process.pid, host: hostname() }
  // An interrupt (Ctrl-C) releases the lock too: a lock left behind is taken over only by a
  // command on the same host, so one left on a folder shared with a container would stay. The
  // release stays installed until the lock is gone, since an interrupt a deferred write held is
  // raised again as `run` ends and would otherwise end the process mid-removal.
  const disposeSignalRelease = removeStagingOnSignal(() => lock)
  try {
    await writeFile(join(lock, LOCK_OWNER_FILE), JSON.stringify(owner))
    return await run()
  } finally {
    // An interrupt is handled only between turns of the event loop, so removing the lock and
    // uninstalling its release in one synchronous step leaves no turn in which the release could
    // remove a lock another command took after this one, or find this one half removed.
    try {
      const held = await checkedPath(root, SOURCE_DIR_LOCK, new Set())
      rmSync(held, { recursive: true, force: true })
    } finally {
      disposeSignalRelease()
    }
    // Folders the lock alone created go with it; one the command filled stays.
    await removeCreatedFolders()
  }
}

/** Removes `dir` and each parent up to `outermost`, stopping at the first that is not empty. */
async function removeEmptyFolders(dir: string, outermost: string): Promise<void> {
  const last = resolve(outermost)
  for (let folder = dir; ; folder = dirname(folder)) {
    try {
      await rmdir(folder)
    } catch {
      return
    }
    if (folder === last || dirname(folder) === folder) return
  }
}

/**
 * Runs a single-workflow command on `dir` holding the command lock it shares with every command
 * that may rewrite the same records: for a workflow folder of a workspace directory, the workspace
 * directory's lock (such a command rewrites the workspace's own records, see {@link writeBack}, so
 * it must not interleave with a workspace command, or with a workflow command in a sibling
 * folder); for any other directory, its own. Refused like a workspace command (`SOURCE_DIR_BUSY`,
 * exit 10), with nothing read or written. `readOnly` as {@link withSourceDirLock} takes it.
 */
export async function withSourceCommandLock<T>(
  dir: string,
  run: () => Promise<T>,
  options: { readOnly?: boolean } = {}
): Promise<T> {
  const folder = await workspaceFolderOf(dir)
  return withSourceDirLock(folder ? folder.root : dir, run, options)
}
