import { join } from 'node:path'
import type { DesktopLocalFileRead } from '@sim/desktop-bridge'
import { app } from 'electron'

interface NativeDirectoryListing {
  entries: NonNullable<DesktopLocalFileRead['entries']>
  truncated: boolean
}

interface NativeDirectoryBridge {
  readDirectory: (descriptor: number, limit: number) => Promise<NativeDirectoryListing>
}

let bridge: NativeDirectoryBridge | undefined

/** Enumerates the already-validated descriptor without resolving a pathname again. */
export function readNativeDirectory(
  descriptor: number,
  limit: number
): Promise<NativeDirectoryListing> {
  bridge ??= require(
    join(app.getAppPath(), 'dist', 'native', 'directory.node')
  ) as NativeDirectoryBridge
  return bridge.readDirectory(descriptor, limit)
}
