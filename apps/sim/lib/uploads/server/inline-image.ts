import { getWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { getFileMetadataByKey } from '@/lib/uploads/server/metadata'

/**
 * A markdown-embedded image reference: either a workspace file `fileId` (view-URL embeds) or a
 * workspace storage `key` (serve-URL embeds). Exactly one is set — enforced at the route boundary.
 */
export interface InlineImageRef {
  key?: string
  fileId?: string
}

/** The fields a serve handler needs to return an embedded image. */
export interface ResolvedInlineImage {
  key: string
  contentType: string
  filename: string
}

/**
 * Resolve an embedded-image reference to its storage key + metadata, **scoped to `workspaceId`**.
 * Returns null whenever the reference is not a live `workspace` file in that workspace — a
 * cross-workspace, non-workspace, missing, or deleted file. This is the single workspace-scope gate
 * shared by the in-app inline route and the public-share cascade, mirroring how the user-facing file
 * view resolves a file within its workspace ({@link getWorkspaceFile}).
 */
export async function resolveWorkspaceInlineImage(
  workspaceId: string,
  ref: InlineImageRef
): Promise<ResolvedInlineImage | null> {
  if (ref.fileId) {
    const file = await getWorkspaceFile(workspaceId, ref.fileId)
    return file ? { key: file.key, contentType: file.type, filename: file.name } : null
  }
  if (ref.key) {
    const record = await getFileMetadataByKey(ref.key, 'workspace')
    if (!record || record.workspaceId !== workspaceId) return null
    return { key: record.key, contentType: record.contentType, filename: record.originalName }
  }
  return null
}
