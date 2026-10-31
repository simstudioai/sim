import { fstat, read, type Stats } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { DesktopLocalFileRead } from '@sim/desktop-bridge'
import { app } from 'electron'
import { openWin32NativeFile } from '@/main/win32-native-files'

/** At most `limit` entries of one directory, and whether more were left unread. */
export interface NativeDirectoryListing {
  entries: NonNullable<DesktopLocalFileRead['entries']>
  truncated: boolean
}

/** A file or directory opened beneath the identity of a granted directory. */
export interface NativeFileHandle {
  readonly fd: number
  stat: () => Promise<Stats>
  read: (
    buffer: Buffer,
    offset: number,
    length: number,
    position: number
  ) => Promise<{ bytesRead: number }>
  /**
   * Lists the opened directory, scanning at most `limit + 1` names. Symlinks
   * (and, on Windows, junctions) are reported as `symlink`, never followed.
   */
  readDirectory: (limit: number) => Promise<NativeDirectoryListing>
  close: () => Promise<void>
}

interface NativeDirectoryBridge {
  closeFile: (descriptor: number) => Promise<void>
  readDirectory: (descriptor: number, limit: number) => Promise<NativeDirectoryListing>
  openApproved: (
    root: string,
    relativePath: string,
    dev: bigint,
    ino: bigint,
    directory: boolean
  ) => Promise<number>
}

let bridge: NativeDirectoryBridge | undefined
const statDescriptor = promisify(fstat)
const readDescriptor = promisify(read)

function nativeBridge(): NativeDirectoryBridge {
  bridge ??= require(
    join(app.getAppPath(), 'dist', 'native', 'directory.node')
  ) as NativeDirectoryBridge
  return bridge
}

/**
 * Opens through the POSIX native module, which walks each component with
 * `openat(O_NOFOLLOW)` from a descriptor verified against the grant identity,
 * and enumerates with `fdopendir` on the opened descriptor.
 */
export async function openPosixNativeFile(
  root: string,
  relativePath: string,
  identity: { dev: bigint; ino: bigint },
  directory: boolean
): Promise<NativeFileHandle> {
  let descriptor = await nativeBridge().openApproved(
    root,
    relativePath,
    identity.dev,
    identity.ino,
    directory
  )
  return {
    get fd() {
      return descriptor
    },
    stat: () => statDescriptor(descriptor),
    read: (buffer, offset, length, position) =>
      readDescriptor(descriptor, buffer, offset, length, position),
    readDirectory: (limit) => nativeBridge().readDirectory(descriptor, limit),
    close: async () => {
      if (descriptor < 0) return
      const closing = descriptor
      descriptor = -1
      await nativeBridge().closeFile(closing)
    },
  }
}

/**
 * Opens `relativePath` (in the host's separators) beneath `root`. Refuses
 * unless `root` still has the granted `identity` and the target is a regular
 * file, or a directory when `directory` is set. Node has no descriptor-relative
 * open on Windows, so Windows uses {@link openWin32NativeFile}; macOS and Linux
 * use the POSIX native module.
 */
export const openNativeFile =
  process.platform === 'win32' ? openWin32NativeFile : openPosixNativeFile
