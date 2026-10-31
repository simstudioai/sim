import type { LocalFilesystemEntryKind } from '@sim/desktop-bridge'

/**
 * A file's identity as `stat(path, { bigint: true })` reports it. Bigint because NTFS file IDs
 * exceed 2^53, and rounded IDs could compare equal.
 */
export interface FileIdentity {
  dev: bigint
  ino: bigint
}

/** What `fs.Stats` and `fs.Dirent` both say about a file's type. */
export interface FileTypeInfo {
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

export function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

/** The entry kind a listing reports for a stat or directory entry. */
export function fileEntryKind(info: FileTypeInfo): LocalFilesystemEntryKind {
  if (info.isFile()) return 'file'
  if (info.isDirectory()) return 'directory'
  if (info.isSymbolicLink()) return 'symlink'
  return 'other'
}
