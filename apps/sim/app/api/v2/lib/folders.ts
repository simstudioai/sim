import type { folder } from '@sim/db/schema'
import type { NextResponse } from 'next/server'
import type { FolderResourceType } from '@/lib/api/contracts/folders'
import type { OrchestrationErrorCode } from '@/lib/core/orchestration/types'
import { withFolderTreeLock } from '@/lib/folders/locks'
import {
  type FolderPathIndex,
  isFolderPathEffectivelyLocked,
  ROOT_FOLDER_PATH,
  toFolderPathView,
} from '@/lib/folders/paths'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import { v2ErrorForOrchestration } from '@/app/api/v2/lib/response'

type FolderRow = typeof folder.$inferSelect

export function resolveFolderPathId(
  index: FolderPathIndex<FolderRow>,
  path: string
): string | null | undefined {
  return path === ROOT_FOLDER_PATH ? null : index.idByPath.get(path)
}

export type ResolvedFolderPathIdentity =
  | { found: false }
  | { found: true; folderId: string | null; index: FolderPathIndex<FolderRow> }

/** Resolves a path to its stable internal identity under a short-lived folder tree lock. */
export async function resolveFolderPathIdentity(params: {
  workspaceId: string
  resourceType: FolderResourceType
  path: string
}): Promise<ResolvedFolderPathIdentity> {
  return withFolderTreeLock(params.workspaceId, params.resourceType, async (tx) => {
    const index = await loadActiveFolderPathIndex(params.workspaceId, params.resourceType, tx)
    const folderId = resolveFolderPathId(index, params.path)
    return folderId === undefined ? { found: false } : { found: true, folderId, index }
  })
}

export function folderPathForId(
  index: FolderPathIndex<FolderRow>,
  folderId: string | null | undefined
): string {
  if (!folderId) return ROOT_FOLDER_PATH
  const path = index.pathById.get(folderId)
  if (!path) throw new Error('Resource references an inactive or missing folder')
  return path
}

export function toV2PathFolder(
  row: FolderRow,
  index: FolderPathIndex<FolderRow>,
  includeLocked: boolean
) {
  const path = index.pathById.get(row.id)
  if (!path) throw new Error('Folder path index is missing a listed folder')
  const base = toFolderPathView(row, path)
  return includeLocked ? { ...base, locked: isFolderPathEffectivelyLocked(index, row.id) } : base
}

export function v2FolderPathMutationError(
  errorCode: OrchestrationErrorCode | undefined,
  message: string
): NextResponse {
  return v2ErrorForOrchestration(errorCode, message)
}
