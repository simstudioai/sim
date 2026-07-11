import {
  db,
  folder,
  type folderResourceTypeEnum,
  knowledgeBase,
  userTableDefinitions,
  workflow,
  workspaceFiles,
} from '@sim/db'
import type * as schema from '@sim/db/schema'
import type { ExtractTablesWithRelations } from 'drizzle-orm'
import { and, eq, isNull } from 'drizzle-orm'
import type { PgColumn, PgTable, PgTransaction } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'

export type FolderResourceType = (typeof folderResourceTypeEnum.enumValues)[number]

/** Allows a caller to join its own transaction instead of the module-level `db`. */
type DbOrTx =
  | typeof db
  | PgTransaction<
      PostgresJsQueryResultHKT,
      typeof schema,
      ExtractTablesWithRelations<typeof schema>
    >

export interface LockStatus {
  locked: boolean
  directLocked: boolean
  inheritedLocked: boolean
  lockedBy: 'resource' | 'folder' | null
  lockedFolderId: string | null
}

/**
 * `status = 423` (Locked) for every resourceType. `inherited` distinguishes a
 * direct lock on the resource/folder itself from one inherited from an ancestor
 * folder, so callers (and `instanceof` subclasses in `workflow.ts`) can render a
 * more specific message.
 */
export class ResourceLockedError extends Error {
  readonly status = 423
  readonly resourceType: FolderResourceType
  readonly inherited: boolean

  constructor(resourceType: FolderResourceType, inherited: boolean, message?: string) {
    super(message ?? `${resourceType} is locked`)
    this.name = 'ResourceLockedError'
    this.resourceType = resourceType
    this.inherited = inherited
  }
}

interface ResourceLockConfig {
  table: PgTable
  idColumn: PgColumn
  lockedColumn: PgColumn
  folderIdColumn: PgColumn
}

/**
 * One row per `FolderResourceType`, capturing the single delta (table + columns)
 * needed to run the shared lock-status/assert algorithms below. Mirrors the
 * config-driven pattern established by `PINNED_RESOURCE_LOOKUP`
 * (`apps/sim/app/api/pinned-items/route.ts`) and `FolderCascadeConfig`
 * (`apps/sim/lib/folders/orchestration.ts`).
 */
const RESOURCE_LOCK_LOOKUP: Record<FolderResourceType, ResourceLockConfig> = {
  workflow: {
    table: workflow,
    idColumn: workflow.id,
    lockedColumn: workflow.locked,
    folderIdColumn: workflow.folderId,
  },
  file: {
    table: workspaceFiles,
    idColumn: workspaceFiles.id,
    lockedColumn: workspaceFiles.locked,
    folderIdColumn: workspaceFiles.folderId,
  },
  knowledge_base: {
    table: knowledgeBase,
    idColumn: knowledgeBase.id,
    lockedColumn: knowledgeBase.locked,
    folderIdColumn: knowledgeBase.folderId,
  },
  table: {
    table: userTableDefinitions,
    idColumn: userTableDefinitions.id,
    lockedColumn: userTableDefinitions.locked,
    folderIdColumn: userTableDefinitions.folderId,
  },
}

const UNLOCKED_STATUS: LockStatus = {
  locked: false,
  directLocked: false,
  inheritedLocked: false,
  lockedBy: null,
  lockedFolderId: null,
}

/**
 * Walks the folder ancestor chain starting at `folderId`, returning the first
 * locked folder found (direct or inherited) for the given `resourceType`.
 */
export async function getFolderLockStatus(
  folderId: string | null,
  resourceType: FolderResourceType,
  dbClient: DbOrTx = db
): Promise<LockStatus> {
  if (!folderId) return UNLOCKED_STATUS

  let currentFolderId: string | null = folderId
  let isDirect = true
  const visited = new Set<string>()

  while (currentFolderId && !visited.has(currentFolderId)) {
    visited.add(currentFolderId)
    const [folderRow] = await dbClient
      .select({
        id: folder.id,
        parentId: folder.parentId,
        locked: folder.locked,
      })
      .from(folder)
      .where(
        and(
          eq(folder.id, currentFolderId),
          eq(folder.resourceType, resourceType),
          isNull(folder.deletedAt)
        )
      )
      .limit(1)

    if (!folderRow) break
    if (folderRow.locked) {
      return {
        locked: true,
        directLocked: isDirect,
        inheritedLocked: !isDirect,
        lockedBy: 'folder',
        lockedFolderId: folderRow.id,
      }
    }

    currentFolderId = folderRow.parentId
    isDirect = false
  }

  return UNLOCKED_STATUS
}

/**
 * Checks the resource's own `locked` column first, falling back to
 * {@link getFolderLockStatus} on its containing folder chain when unset.
 */
export async function getResourceLockStatus(
  resourceType: FolderResourceType,
  resourceId: string,
  dbClient: DbOrTx = db
): Promise<LockStatus> {
  const config = RESOURCE_LOCK_LOOKUP[resourceType]

  const [row] = await dbClient
    .select({
      locked: config.lockedColumn,
      folderId: config.folderIdColumn,
    })
    .from(config.table)
    .where(eq(config.idColumn, resourceId))
    .limit(1)

  if (!row) return UNLOCKED_STATUS

  if (row.locked) {
    return {
      locked: true,
      directLocked: true,
      inheritedLocked: false,
      lockedBy: 'resource',
      lockedFolderId: null,
    }
  }

  return getFolderLockStatus(row.folderId as string | null, resourceType, dbClient)
}

export async function assertFolderMutable(
  folderId: string | null,
  resourceType: FolderResourceType,
  dbClient: DbOrTx = db
): Promise<void> {
  const status = await getFolderLockStatus(folderId, resourceType, dbClient)
  if (status.locked) {
    throw new ResourceLockedError(
      resourceType,
      status.inheritedLocked,
      status.inheritedLocked ? 'Folder is locked by an ancestor folder' : 'Folder is locked'
    )
  }
}

export async function assertResourceMutable(
  resourceType: FolderResourceType,
  resourceId: string,
  dbClient: DbOrTx = db
): Promise<void> {
  const status = await getResourceLockStatus(resourceType, resourceId, dbClient)
  if (status.locked) {
    throw new ResourceLockedError(
      resourceType,
      status.lockedBy === 'folder',
      status.lockedBy === 'folder'
        ? `${resourceType} is locked by its containing folder`
        : `${resourceType} is locked`
    )
  }
}
