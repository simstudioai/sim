import type { V2FileVersion } from '@/lib/api/contracts/v2/file-versions'
import type { AuthoredFileVersion } from '@/lib/workspace-files/application/version-authors'

/** Serializes the version and author fields already projected by an authorized operation. */
export function toFileVersion(version: AuthoredFileVersion): V2FileVersion {
  return {
    fileId: version.fileId,
    version: version.version,
    isCurrent: version.isCurrent,
    size: version.size,
    contentType: version.contentType,
    source: version.source,
    authors: version.authors,
    restoredFromVersion: version.restoredFromVersion,
    createdAt: version.createdAt.toISOString(),
    updatedAt: version.updatedAt.toISOString(),
    supersededAt: version.supersededAt?.toISOString() ?? null,
  }
}
