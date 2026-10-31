import type { Dir, Dirent } from 'node:fs'
import { type FileHandle, lstat, open, opendir, realpath } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type { LocalFilesystemEntryKind } from '@sim/desktop-bridge'
import { type FileIdentity, fileEntryKind, sameFileIdentity } from '@/main/file-identity'
import type { NativeDirectoryListing, NativeFileHandle } from '@/main/native-directory'
import { isWithinRoot } from '@/main/path-containment'
import { isWin32SafeSegment } from '@/main/win32-path'

/** The opens a swap has to race. Tests interpose on them to swap a path mid-check. */
export interface Win32NativeFileSystem {
  open: (path: string) => Promise<FileHandle>
  opendir: (path: string) => Promise<Dir>
}

const NODE_FILE_SYSTEM: Win32NativeFileSystem = { open: (path) => open(path, 'r'), opendir }

/**
 * Reparse points classified at once while listing. A OneDrive folder is all placeholders, each of
 * which needs its own `lstat`; awaiting them one by one makes a large folder slow to list.
 */
const ENTRY_KIND_CONCURRENCY = 16

const OUTSIDE_GRANT = 'The path must stay within the approved folder.'

function isRequestedKind(info: { isFile(): boolean; isDirectory(): boolean }, directory: boolean) {
  return directory ? info.isDirectory() : info.isFile()
}

/**
 * Windows enumeration marks every reparse point as a link, OneDrive placeholders
 * included, though those are ordinary files. `lstat` reports only symlinks and
 * junctions as links, so it settles the kind without following anything.
 */
async function entryKind(directory: string, entry: Dirent): Promise<LocalFilesystemEntryKind> {
  if (!entry.isSymbolicLink()) return fileEntryKind(entry)
  try {
    return fileEntryKind(await lstat(join(directory, entry.name)))
  } catch {
    return 'other'
  }
}

/**
 * Resolves `path` and requires that it is already canonical and beneath
 * `rootReal`. A link or junction anywhere in it, even one pointing back inside
 * the grant, is refused, as the POSIX module refuses any symlink component.
 * A path that resolves to a network share is refused too.
 */
async function canonicalBeneath(rootReal: string, path: string): Promise<string> {
  const real = await realpath(path)
  if (real.startsWith('\\\\') || !isWithinRoot(rootReal, real) || relative(path, real) !== '')
    throw new Error(OUTSIDE_GRANT)
  return real
}

/**
 * The Windows backend for {@link openNativeFile}, on Node fs. Node cannot open
 * relative to a descriptor here, so each check resolves a pathname: the root's
 * identity, a canonical path with no link component, the target's identity
 * before the open matching the opened handle's, and the root and path again
 * after it. A directory listing must leave the path naming the opened handle.
 * This narrows, but cannot close, a race against a process that swaps a path
 * component between a check and the open. Written against the host's
 * `node:path`, so it also runs on POSIX, where tests exercise it.
 */
export async function openWin32NativeFile(
  root: string,
  relativePath: string,
  identity: FileIdentity,
  directory: boolean,
  fs: Win32NativeFileSystem = NODE_FILE_SYSTEM
): Promise<NativeFileHandle> {
  const segments = relativePath === '' ? [] : relativePath.split(sep)
  if (!segments.every(isWin32SafeSegment)) throw new Error(OUTSIDE_GRANT)
  const assertRootCurrent = async () => {
    const info = await lstat(root, { bigint: true })
    if (!info.isDirectory() || !sameFileIdentity(info, identity))
      throw new Error('The approved folder changed. Request access again.')
  }
  await assertRootCurrent()
  const rootReal = await realpath(root)
  const path = await canonicalBeneath(rootReal, join(root, ...segments))
  const checked = await lstat(path, { bigint: true })
  if (!isRequestedKind(checked, directory))
    throw new Error('The approved path is not a regular file or directory.')

  const handle = await fs.open(path)
  try {
    const opened = await handle.stat({ bigint: true })
    if (!sameFileIdentity(opened, checked) || !isRequestedKind(opened, directory))
      throw new Error('The local path changed while it was being opened. Try again.')
    await canonicalBeneath(rootReal, path)
    await assertRootCurrent()
  } catch (error) {
    await handle.close()
    throw error
  }

  return {
    get fd() {
      return handle.fd
    },
    stat: () => handle.stat(),
    statBigint: () => handle.stat({ bigint: true }),
    read: (buffer, offset, length, position) => handle.read(buffer, offset, length, position),
    readDirectory: async (limit) => {
      const scanned: Dirent[] = []
      let truncated = false
      for await (const entry of await fs.opendir(path)) {
        if (scanned.length === limit) {
          truncated = true
          break
        }
        scanned.push(entry)
      }
      const entries: NativeDirectoryListing['entries'] = []
      for (let start = 0; start < scanned.length; start += ENTRY_KIND_CONCURRENCY) {
        const batch = scanned.slice(start, start + ENTRY_KIND_CONCURRENCY)
        const kinds = await Promise.all(batch.map((entry) => entryKind(path, entry)))
        batch.forEach((entry, index) => entries.push({ name: entry.name, kind: kinds[index] }))
      }
      const listed = await lstat(path, { bigint: true })
      if (!sameFileIdentity(listed, checked))
        throw new Error('The local directory changed while it was being read. Try again.')
      await canonicalBeneath(rootReal, path)
      return { entries, truncated }
    },
    close: () => handle.close(),
  }
}
