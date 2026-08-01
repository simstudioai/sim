import type { folder as folderTable } from '@sim/db/schema'
import { omit } from '@sim/utils/object'
import type { NextResponse } from 'next/server'
import type { FolderApi } from '@/lib/api/contracts/folders'
import type { V2Folder } from '@/lib/api/contracts/v2/folders'
import type { FolderMutationErrorCode } from '@/lib/folders/status'
import { v2Error } from '@/app/api/v2/lib/response'

/** Shared serialization + error mapping for the v2 folders surface. */

type FolderRow = typeof folderTable.$inferSelect

/**
 * Narrows an already-serialized {@link FolderApi} (what the shared list query
 * returns) to the public projection.
 */
export function toV2FolderFromApi(row: FolderApi): V2Folder {
  return omit(row, ['userId', 'workspaceId'])
}

/**
 * Public folder projection. `userId` and `workspaceId` are internal scoping
 * columns and are not exposed.
 */
export function toV2Folder(row: FolderRow): V2Folder {
  return {
    id: row.id,
    resourceType: row.resourceType,
    name: row.name,
    parentId: row.parentId,
    locked: row.locked,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  }
}

/**
 * Renders a folder mutation failure in the v2 error envelope. `locked` keeps its
 * 423, matching what the table domain returns when the same mutation lock blocks
 * a single-table delete.
 */
export function v2FolderMutationError(
  errorCode: FolderMutationErrorCode | undefined,
  message: string
): NextResponse {
  switch (errorCode) {
    case 'validation':
      return v2Error('BAD_REQUEST', message)
    case 'not_found':
      return v2Error('NOT_FOUND', 'Folder not found')
    case 'conflict':
      return v2Error('CONFLICT', message)
    case 'locked':
      return v2Error('LOCKED', message)
    default:
      return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
}
