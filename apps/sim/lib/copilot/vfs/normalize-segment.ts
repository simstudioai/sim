import { encodeVfsSegment } from '@/lib/copilot/vfs/path-utils'

/**
 * Normalize and encode a string for use as one canonical VFS path segment.
 *
 * Uses the platform URL encoder for escaping rather than hand-written character maps.
 * Slashes are encoded inside a segment, so callers must still join path segments with `/`.
 */
export function normalizeVfsSegment(name: string): string {
  return encodeVfsSegment(name)
}
