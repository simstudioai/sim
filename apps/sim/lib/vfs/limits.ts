export const MAX_VFS_PATH_ITEMS = 100
export const MAX_VFS_PATH_LENGTH = 4096
export const MAX_VFS_TOTAL_PATH_BYTES = 64 * 1024
export const MAX_VFS_PATH_SEGMENTS = 64
export const MAX_VFS_SEGMENT_LENGTH = 255

export class VfsPathLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'VfsPathLimitError'
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

export function validateVfsPathSegments(segments: readonly string[]): void {
  if (segments.length > MAX_VFS_PATH_SEGMENTS) {
    throw new VfsPathLimitError(`VFS paths cannot exceed ${MAX_VFS_PATH_SEGMENTS} segments`)
  }
  for (const segment of segments) {
    if (segment.length === 0 || byteLength(segment) > MAX_VFS_SEGMENT_LENGTH) {
      throw new VfsPathLimitError(
        `VFS path segments must be between 1 and ${MAX_VFS_SEGMENT_LENGTH} bytes`
      )
    }
  }
}

export function validateVfsPathBatch(paths: readonly string[]): void {
  if (paths.length > MAX_VFS_PATH_ITEMS) {
    throw new VfsPathLimitError(`VFS commands cannot exceed ${MAX_VFS_PATH_ITEMS} paths`)
  }
  let totalBytes = 0
  for (const path of paths) {
    const pathBytes = byteLength(path)
    totalBytes += pathBytes
    if (pathBytes > MAX_VFS_PATH_LENGTH) {
      throw new VfsPathLimitError(`VFS paths cannot exceed ${MAX_VFS_PATH_LENGTH} bytes`)
    }
    const segments = path
      .trim()
      .replace(/^\/+|\/+$/g, '')
      .split('/')
      .filter(Boolean)
      .map((segment) => {
        try {
          return decodeURIComponent(segment)
        } catch {
          return segment
        }
      })
    validateVfsPathSegments(segments)
  }
  if (totalBytes > MAX_VFS_TOTAL_PATH_BYTES) {
    throw new VfsPathLimitError(
      `VFS command paths cannot exceed ${MAX_VFS_TOTAL_PATH_BYTES} total bytes`
    )
  }
}
