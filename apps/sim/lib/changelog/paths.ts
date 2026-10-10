import { decodeVfsPathSegments } from '@/lib/mothership/vfs/path-utils'

/** Release bodies live flat in this namespace as `changelog/<releaseId>.md`. */
const CHANGELOG_FILE_PREFIX = 'changelog/'
export const CHANGELOG_FILE_SUFFIX = '.md'

export function changelogFilePath(releaseId: string): string {
  return `${CHANGELOG_FILE_PREFIX}${releaseId}${CHANGELOG_FILE_SUFFIX}`
}

/** The release id in a `changelog/<releaseId>.md` reference; null for any other reference. */
export function parseChangelogFileReference(reference: string): string | null {
  const trimmed = reference.trim().replace(/^\/+/, '')
  if (!trimmed.startsWith(CHANGELOG_FILE_PREFIX)) return null
  const segments = decodeVfsPathSegments(trimmed)
  if (segments.length !== 2 || !segments[1].endsWith(CHANGELOG_FILE_SUFFIX)) return null
  const releaseId = segments[1].slice(0, -CHANGELOG_FILE_SUFFIX.length)
  return releaseId.length > 0 ? releaseId : null
}
