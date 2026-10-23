import { fstat, read } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { DesktopLocalFileRead } from '@sim/desktop-bridge'
import { app } from 'electron'

interface NativeDirectoryListing {
  entries: NonNullable<DesktopLocalFileRead['entries']>
  truncated: boolean
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

/** Owns a descriptor opened beneath the identity of a granted directory. */
export async function openNativeFile(
  root: string,
  relativePath: string,
  identity: { dev: bigint; ino: bigint },
  directory: boolean
) {
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
    read: (buffer: Buffer, offset: number, length: number, position: number) =>
      readDescriptor(descriptor, buffer, offset, length, position),
    close: async () => {
      if (descriptor < 0) return
      const closing = descriptor
      descriptor = -1
      await nativeBridge().closeFile(closing)
    },
  }
}

/** Enumerates the already-validated descriptor without resolving a pathname again. */
export function readNativeDirectory(
  descriptor: number,
  limit: number
): Promise<NativeDirectoryListing> {
  return nativeBridge().readDirectory(descriptor, limit)
}
