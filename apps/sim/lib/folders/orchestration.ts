import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { folder as folderTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage, getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull, min } from 'drizzle-orm'
import type { FolderCascadeCountsApi, FolderResourceType } from '@/lib/api/contracts/folders'
import { asOrchestrationError, type OrchestrationErrorCode } from '@/lib/core/orchestration/types'
import { withTransactionRetry } from '@/lib/db/transaction'
import type { DbOrTx } from '@/lib/db/types'
import {
  archiveFolderCascade,
  collectArchivedSubtreeIds,
  collectCascadeSubtreeIds,
  restoreFolderChildren,
  restoreFolderRows,
  toCascadeCounts,
} from '@/lib/folders/cascade'
import { folderResourceConfig } from '@/lib/folders/config'
import { FolderCollectionLimitExceededError } from '@/lib/folders/errors'
import { acquireFolderMutationLock, withFolderTreeLock } from '@/lib/folders/locks'
import { deduplicateFolderName } from '@/lib/folders/naming'
import {
  type FolderPathIndex,
  folderNameFromPath,
  parentFolderPath,
  requireNonRootFolderPath,
} from '@/lib/folders/paths'
import {
  assertFolderCollectionHasRoom,
  loadActiveFolderPathIndex,
  wouldCreateFolderCycle,
} from '@/lib/folders/queries'
import type { FolderMutationErrorCode } from '@/lib/folders/status'
import { notifyFolderResourceChanged } from '@/lib/realtime/notify'

const logger = createLogger('FolderOrchestration')

const DUPLICATE_NAME_ERROR = 'A folder with this name already exists in this location'

export interface CreateFolderParams {
  resourceType: FolderResourceType
  userId: string
  workspaceId: string
  name: string
  id?: string
  parentId?: string | null
  sortOrder?: number
}

export interface FolderMutationResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  folder?: typeof folderTable.$inferSelect
}

export interface UpdateFolderParams {
  resourceType: FolderResourceType
  folderId: string
  workspaceId: string
  userId: string
  name?: string
  locked?: boolean
  parentId?: string | null
  sortOrder?: number
}

export interface DeleteFolderParams {
  resourceType: FolderResourceType
  folderId: string
  workspaceId: string
  userId: string
  folderName?: string
  folderPath?: string
  maxFolderRows?: number
}

export interface DeleteFolderResult {
  success: boolean
  error?: string
  errorCode?: FolderMutationErrorCode
  deletedItems?: FolderCascadeCountsApi
}

export interface RestoreFolderParams {
  resourceType: FolderResourceType
  folderId: string
  workspaceId: string
  userId: string
  folderName?: string
}

export interface RestoreFolderResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  restoredItems?: FolderCascadeCountsApi
}

export interface FolderPathMutationResult extends FolderMutationResult {
  path?: string
}

export interface DeleteFolderByPathParams {
  resourceType: FolderResourceType
  workspaceId: string
  userId: string
  path: string
  recursive: boolean
  maxFolderRows?: number
  effects?: boolean
  throwInfrastructure?: boolean
}

export interface DeleteFolderByPathResult extends DeleteFolderResult {
  path?: string
  folderId?: string
  folderName?: string
}

function validatePathLeafName(path: string): string {
  const name = folderNameFromPath(path)
  if (name.trim() !== name || name.length === 0 || name.length > 255) {
    throw new Error('Folder path leaf must be between 1 and 255 characters without outer spaces')
  }
  return name
}

function resolveRequiredFolderId(index: FolderPathIndex, path: string): string {
  const folderId = index.idByPath.get(path)
  if (!folderId) throw new Error('Folder not found')
  return folderId
}

function isEffectivelyLocked(index: FolderPathIndex<typeof folderTable.$inferSelect>, id: string) {
  let currentId: string | null = id
  while (currentId) {
    const row = index.rowById.get(currentId)
    if (!row) throw new Error('Folder hierarchy references a missing ancestor')
    if (row.locked) return true
    currentId = row.parentId
  }
  return false
}

function pathMutationError(error: unknown): FolderPathMutationResult {
  const message = getErrorMessage(error, 'Internal server error')
  const classified = asOrchestrationError(error)
  if (classified) return { success: false, error: classified.message, errorCode: classified.code }
  if (message === 'Folder not found' || message === 'Parent folder not found') {
    return { success: false, error: message, errorCode: 'not_found' }
  }
  if (
    message === DUPLICATE_NAME_ERROR ||
    message === 'Folder is not empty' ||
    getPostgresErrorCode(error) === '23505'
  ) {
    return { success: false, error: message, errorCode: 'conflict' }
  }
  if (message === 'Folder is locked') {
    return { success: false, error: message, errorCode: 'locked' }
  }
  if (
    message.includes('Folder path') ||
    message.includes('root path') ||
    message.includes('descendant') ||
    message.includes('canonical folder path')
  ) {
    return { success: false, error: message, errorCode: 'validation' }
  }
  logger.error('Folder path mutation failed', { error })
  return { success: false, error: 'Internal server error', errorCode: 'internal' }
}

async function executeCreateFolderAtPath(
  params: Omit<CreateFolderParams, 'name' | 'parentId' | 'sortOrder' | 'id'> & {
    path: string
    effects?: boolean
    throwInfrastructure?: boolean
    maxFolderRows?: number
  },
  projectLegacyLifecycle: boolean
): Promise<FolderPathMutationResult> {
  try {
    requireNonRootFolderPath(params.path)
    const name = validatePathLeafName(params.path)
    const folder = await withTransactionRetry(
      async (tx) => {
        await acquireFolderMutationLock(tx, params.workspaceId, params.resourceType)
        const index = await loadActiveFolderPathIndex(params.workspaceId, params.resourceType, tx, {
          maxRows: params.maxFolderRows,
        })
        if (index.idByPath.has(params.path)) throw new Error(DUPLICATE_NAME_ERROR)

        const parentPath = parentFolderPath(params.path)
        const parentId = parentPath === '/' ? null : index.idByPath.get(parentPath)
        if (parentPath !== '/' && !parentId) throw new Error('Parent folder not found')
        if (
          parentId &&
          folderResourceConfig(params.resourceType).supportsLocking &&
          isEffectivelyLocked(index, parentId)
        ) {
          throw new Error('Folder is locked')
        }
        if (params.maxFolderRows !== undefined && index.rowById.size >= params.maxFolderRows) {
          throw new FolderCollectionLimitExceededError('path index', params.maxFolderRows)
        }

        const sortOrder = await nextFolderSortOrder(
          params.resourceType,
          params.workspaceId,
          parentId,
          tx
        )
        const now = new Date()
        const [created] = await tx
          .insert(folderTable)
          .values({
            id: generateId(),
            resourceType: params.resourceType,
            name,
            userId: params.userId,
            workspaceId: params.workspaceId,
            parentId,
            sortOrder,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
        return created
      },
      { label: 'create-folder-at-path' }
    )

    if (projectLegacyLifecycle && params.effects !== false) {
      recordAudit({
        workspaceId: params.workspaceId,
        actorId: params.userId,
        action: AuditAction.FOLDER_CREATED,
        resourceType: AuditResourceType.FOLDER,
        resourceId: folder.id,
        resourceName: folder.name,
        description: `Created ${folderResourceConfig(params.resourceType).label} folder "${params.path}"`,
        metadata: { path: params.path, folderResourceType: params.resourceType },
      })
    }
    if (params.effects !== false) {
      await notifyFolderResourceChanged(params.resourceType, params.workspaceId)
    }
    return { success: true, folder, path: params.path }
  } catch (error) {
    const result = pathMutationError(error)
    if (params.throwInfrastructure && result.errorCode === 'internal') throw error
    return result
  }
}

/** Creates exactly the leaf identified by `path`; every ancestor must already exist. */
export async function createFolderAtPath(
  params: Omit<CreateFolderParams, 'name' | 'parentId' | 'sortOrder' | 'id'> & {
    path: string
    effects?: boolean
    throwInfrastructure?: boolean
    maxFolderRows?: number
  }
): Promise<FolderPathMutationResult> {
  return executeCreateFolderAtPath(params, true)
}

/** Applies the authoritative mutation without projecting legacy audit. */
export async function createFolderAtPathTransition(
  params: Omit<CreateFolderParams, 'name' | 'parentId' | 'sortOrder' | 'id'> & {
    path: string
    maxFolderRows?: number
  }
): Promise<FolderPathMutationResult> {
  return executeCreateFolderAtPath(params, false)
}

type RelocateFolderByPathParams = {
  resourceType: FolderResourceType
  workspaceId: string
  userId: string
  path: string
  destinationPath: string
  effects?: boolean
  throwInfrastructure?: boolean
  maxFolderRows?: number
}

async function executeRelocateFolderByPath(
  params: RelocateFolderByPathParams,
  projectLegacyLifecycle: boolean
): Promise<FolderPathMutationResult> {
  try {
    requireNonRootFolderPath(params.path)
    requireNonRootFolderPath(params.destinationPath)
    const name = validatePathLeafName(params.destinationPath)

    const folder = await withTransactionRetry(
      async (tx) => {
        await acquireFolderMutationLock(tx, params.workspaceId, params.resourceType)
        const index = await loadActiveFolderPathIndex(params.workspaceId, params.resourceType, tx, {
          maxRows: params.maxFolderRows,
        })
        const folderId = resolveRequiredFolderId(index, params.path)
        if (index.idByPath.has(params.destinationPath)) throw new Error(DUPLICATE_NAME_ERROR)

        const destinationParentPath = parentFolderPath(params.destinationPath)
        if (
          destinationParentPath === params.path ||
          destinationParentPath.startsWith(`${params.path}/`)
        ) {
          throw new Error('Cannot move a folder into one of its descendants')
        }
        const resolvedParentId =
          destinationParentPath === '/' ? null : index.idByPath.get(destinationParentPath)
        if (resolvedParentId === undefined) throw new Error('Parent folder not found')
        const parentId = resolvedParentId

        const config = folderResourceConfig(params.resourceType)
        if (
          config.supportsLocking &&
          (isEffectivelyLocked(index, folderId) ||
            (parentId !== null && isEffectivelyLocked(index, parentId)))
        ) {
          throw new Error('Folder is locked')
        }

        const [updated] = await tx
          .update(folderTable)
          .set({ name, parentId, updatedAt: new Date() })
          .where(
            and(
              eq(folderTable.id, folderId),
              eq(folderTable.workspaceId, params.workspaceId),
              eq(folderTable.resourceType, params.resourceType),
              isNull(folderTable.deletedAt)
            )
          )
          .returning()
        if (!updated) throw new Error('Folder not found')
        return updated
      },
      { label: 'relocate-folder-by-path' }
    )

    if (projectLegacyLifecycle && params.effects !== false) {
      recordAudit({
        workspaceId: params.workspaceId,
        actorId: params.userId,
        action: AuditAction.FOLDER_MOVED,
        resourceType: AuditResourceType.FOLDER,
        resourceId: folder.id,
        resourceName: folder.name,
        description: `Moved ${folderResourceConfig(params.resourceType).label} folder to "${params.destinationPath}"`,
        metadata: {
          sourcePath: params.path,
          destinationPath: params.destinationPath,
          folderResourceType: params.resourceType,
        },
      })
    }
    if (params.effects !== false) {
      await notifyFolderResourceChanged(params.resourceType, params.workspaceId)
    }
    return { success: true, folder, path: params.destinationPath }
  } catch (error) {
    const result = pathMutationError(error)
    if (params.throwInfrastructure && result.errorCode === 'internal') throw error
    return result
  }
}

/** Renames, moves, or both by replacing one canonical path with another. */
export async function relocateFolderByPath(
  params: RelocateFolderByPathParams
): Promise<FolderPathMutationResult> {
  return executeRelocateFolderByPath(params, true)
}

/** Applies the authoritative mutation without projecting legacy audit. */
export async function relocateFolderByPathTransition(
  params: RelocateFolderByPathParams
): Promise<FolderPathMutationResult> {
  return executeRelocateFolderByPath(params, false)
}

async function executeDeleteFolderByPath(
  params: DeleteFolderByPathParams,
  projectLegacyLifecycle: boolean
): Promise<DeleteFolderByPathResult> {
  try {
    requireNonRootFolderPath(params.path)
    const resolved = await withFolderTreeLock(
      params.workspaceId,
      params.resourceType,
      async (tx) => {
        const index = await loadActiveFolderPathIndex(params.workspaceId, params.resourceType, tx, {
          maxRows: params.maxFolderRows,
        })
        const folderId = resolveRequiredFolderId(index, params.path)
        if (
          folderResourceConfig(params.resourceType).supportsLocking &&
          isEffectivelyLocked(index, folderId)
        ) {
          throw new Error('Folder is locked')
        }

        if (!params.recursive) {
          const hasChildFolder = [...index.pathById.values()].some((candidate) =>
            candidate.startsWith(`${params.path}/`)
          )
          const config = folderResourceConfig(params.resourceType)
          const [child] = await tx
            .select({ id: config.idColumn })
            .from(config.table)
            .where(
              and(
                eq(config.folderIdColumn, folderId),
                eq(config.workspaceColumn, params.workspaceId),
                isNull(config.deletedColumn),
                config.scope
              )
            )
            .limit(1)
          if (hasChildFolder || child) throw new Error('Folder is not empty')
        }

        const row = index.rowById.get(folderId)
        if (!row) throw new Error('Folder not found')
        return {
          resourceType: params.resourceType,
          folderId,
          workspaceId: params.workspaceId,
          userId: params.userId,
          folderName: row.name,
          folderPath: params.path,
          maxFolderRows: params.maxFolderRows,
        }
      }
    )

    const effects = params.effects !== false
    const result = await deleteFolderWithoutTreeLock(resolved, null, {
      projectAudit: projectLegacyLifecycle && effects,
      notify: effects,
    })
    return {
      ...result,
      path: result.success ? params.path : undefined,
      folderId: result.success ? resolved.folderId : undefined,
      folderName: result.success ? resolved.folderName : undefined,
    }
  } catch (error) {
    const result = pathMutationError(error)
    if (params.throwInfrastructure && result.errorCode === 'internal') throw error
    return result
  }
}

/** Resolves a public path under the tree lock, then delegates the cascade to the domain engine. */
export async function deleteFolderByPath(
  params: DeleteFolderByPathParams
): Promise<DeleteFolderByPathResult> {
  return executeDeleteFolderByPath(params, true)
}

/** Applies the authoritative mutation without projecting legacy audit. */
export async function deleteFolderByPathTransition(
  params: DeleteFolderByPathParams
): Promise<DeleteFolderByPathResult> {
  return executeDeleteFolderByPath(params, false)
}

/**
 * Verifies that a prospective parent folder exists, belongs to the target workspace, is of
 * the same `resourceType`, and is not archived.
 *
 * The resourceType check is not defensive padding: the DB trigger
 * `folder_parent_resource_type_match` enforces the same invariant, so an app layer that
 * skipped it would surface a raw trigger error instead of a 400.
 */
async function assertParentFolderInWorkspace(
  resourceType: FolderResourceType,
  parentId: string,
  workspaceId: string,
  tx: DbOrTx = db
): Promise<{ error: string; errorCode: OrchestrationErrorCode } | null> {
  const [parent] = await tx
    .select({
      workspaceId: folderTable.workspaceId,
      archivedAt: folderTable.deletedAt,
    })
    .from(folderTable)
    .where(and(eq(folderTable.id, parentId), eq(folderTable.resourceType, resourceType)))
    .limit(1)

  if (!parent || parent.workspaceId !== workspaceId || parent.archivedAt) {
    return { error: 'Parent folder not found', errorCode: 'validation' }
  }

  return null
}

/**
 * Places a new folder above its existing siblings. Workflows share one ordering space with
 * their folders, so their `sortOrder` participates; knowledge bases and tables have no
 * per-row ordering and are ignored via the absent `sortOrderColumn`.
 */
export async function nextFolderSortOrder(
  resourceType: FolderResourceType,
  workspaceId: string,
  parentId: string | null | undefined,
  tx: DbOrTx = db
): Promise<number> {
  const config = folderResourceConfig(resourceType)
  const folderParentCondition = parentId
    ? eq(folderTable.parentId, parentId)
    : isNull(folderTable.parentId)

  /**
   * Both minima exclude soft-deleted rows. This returns `min - 1` to put a new folder at the
   * top, so counting archived rows lets every delete ratchet the floor further negative and
   * never recover — an archived folder at -400 pins the next new folder at -401 forever.
   */
  const folderMinPromise = tx
    .select({ minSortOrder: min(folderTable.sortOrder) })
    .from(folderTable)
    .where(
      and(
        eq(folderTable.workspaceId, workspaceId),
        eq(folderTable.resourceType, resourceType),
        folderParentCondition,
        isNull(folderTable.deletedAt)
      )
    )

  const childMinPromise: Promise<Array<{ minSortOrder: unknown }>> = config.sortOrderColumn
    ? tx
        .select({ minSortOrder: min(config.sortOrderColumn) })
        .from(config.table)
        .where(
          and(
            eq(config.workspaceColumn, workspaceId),
            parentId ? eq(config.folderIdColumn, parentId) : isNull(config.folderIdColumn),
            isNull(config.deletedColumn),
            config.scope
          )
        )
    : Promise.resolve([])

  const [[folderResult], [childResult]] = await Promise.all([folderMinPromise, childMinPromise])

  const candidates = [folderResult?.minSortOrder, childResult?.minSortOrder]
    .filter((value) => value != null)
    .map(Number)
    .filter((value) => Number.isFinite(value))

  return candidates.length > 0 ? Math.min(...candidates) - 1 : 0
}

export async function createFolder(params: CreateFolderParams): Promise<FolderMutationResult> {
  const config = folderResourceConfig(params.resourceType)

  try {
    const folderId = params.id || generateId()
    const parentId = params.parentId || null

    if (parentId === folderId) {
      return { success: false, error: 'Folder cannot be its own parent', errorCode: 'validation' }
    }

    const outcome = await withTransactionRetry(
      async (tx) => {
        await acquireFolderMutationLock(tx, params.workspaceId, params.resourceType)
        /**
         * The path-owned create enforces the same ceiling from its index; this
         * one has no index to count, so it asks the collection directly. Under
         * the mutation lock the count cannot be raced past the cap.
         */
        await assertFolderCollectionHasRoom(params.workspaceId, params.resourceType, tx)
        if (parentId) {
          const parentError = await assertParentFolderInWorkspace(
            params.resourceType,
            parentId,
            params.workspaceId,
            tx
          )
          if (parentError) return { parentError }
        }

        const sortOrder =
          params.sortOrder !== undefined
            ? params.sortOrder
            : await nextFolderSortOrder(params.resourceType, params.workspaceId, parentId, tx)

        const now = new Date()
        const [folder] = await tx
          .insert(folderTable)
          .values({
            id: folderId,
            resourceType: params.resourceType,
            name: params.name.trim(),
            userId: params.userId,
            workspaceId: params.workspaceId,
            parentId,
            sortOrder,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
        return { folder }
      },
      { label: 'create-folder' }
    )
    if ('parentError' in outcome) return { success: false, ...outcome.parentError }
    const { folder } = outcome

    logger.info('Created folder', {
      folderId,
      resourceType: params.resourceType,
      workspaceId: params.workspaceId,
      parentId,
    })

    recordAudit({
      workspaceId: params.workspaceId,
      actorId: params.userId,
      action: AuditAction.FOLDER_CREATED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: folderId,
      resourceName: folder.name,
      description: `Created ${config.label} folder "${folder.name}"`,
      metadata: {
        name: folder.name,
        workspaceId: params.workspaceId,
        folderResourceType: params.resourceType,
        parentId: parentId || undefined,
        sortOrder: folder.sortOrder,
      },
    })

    // Live resource list (e.g. tables): a new folder appears in the browser. No-op for resource
    // types without an invalidation room.
    await notifyFolderResourceChanged(params.resourceType, params.workspaceId)
    return { success: true, folder }
  } catch (error) {
    // The partial unique index on active (workspaceId, resourceType, parent, name) makes a
    // duplicate sibling name rejectable here. Create is a path where the user chooses the
    // name, so surface a 409 rather than silently deduplicating.
    if (getPostgresErrorCode(error) === '23505') {
      return { success: false, error: DUPLICATE_NAME_ERROR, errorCode: 'conflict' }
    }
    // The collection ceiling is a caller-fixable refusal, not a fault: surface its own
    // message and status rather than the generic 500 an unclassified throw would get.
    const classified = asOrchestrationError(error)
    if (classified) {
      return { success: false, error: classified.message, errorCode: classified.code }
    }
    logger.error('Failed to create folder', { error, resourceType: params.resourceType })
    return { success: false, error: 'Internal server error', errorCode: 'internal' }
  }
}

export async function updateFolder(
  params: UpdateFolderParams,
  /**
   * `notify: false` for a caller that mutates several folders in one gesture
   * and sends a single batch notification of its own. Every per-folder notify
   * carries an identical body and triggers an identical workspace-wide
   * invalidation, so a batch would otherwise fan out one internal round trip
   * per item. Omitted, the orchestration notifies as before.
   */
  options?: { notify?: boolean }
): Promise<FolderMutationResult> {
  const config = folderResourceConfig(params.resourceType)

  try {
    if (params.parentId && params.parentId === params.folderId) {
      return { success: false, error: 'Folder cannot be its own parent', errorCode: 'validation' }
    }

    // Typed against the table rather than `Record<string, unknown>`: the loose type is what
    // let `color`/`isExpanded` survive an earlier cutover after the create path dropped them.
    const updates: Partial<typeof folderTable.$inferInsert> = { updatedAt: new Date() }
    if (params.name !== undefined) updates.name = params.name.trim()
    // Backstop for the route's rejection: the engine is also reachable from the copilot
    // tools, and a `locked` value on a type that has no lock semantics must never persist.
    if (params.locked !== undefined && config.supportsLocking) updates.locked = params.locked
    if (params.parentId !== undefined) updates.parentId = params.parentId || null
    if (params.sortOrder !== undefined) updates.sortOrder = params.sortOrder

    /**
     * `isNull(deletedAt)` closes a lock bypass, not just a tidiness gap: `getFolderLockStatus`
     * skips archived rows, so an archived-but-locked folder reports unlocked. Without this,
     * deleting a parent would make every locked subfolder beneath it freely renameable and
     * reparentable. The engine is reachable from the copilot tools as well as the route, so
     * the guard belongs here rather than only at the boundary.
     */
    const outcome = await withTransactionRetry(
      async (tx) => {
        await acquireFolderMutationLock(tx, params.workspaceId, params.resourceType)
        if (params.parentId) {
          const parentError = await assertParentFolderInWorkspace(
            params.resourceType,
            params.parentId,
            params.workspaceId,
            tx
          )
          if (parentError) return { parentError }

          const wouldCreateCycle = await wouldCreateFolderCycle(
            params.folderId,
            params.parentId,
            params.resourceType,
            tx
          )
          if (wouldCreateCycle) {
            return {
              parentError: {
                error: 'Cannot create circular folder reference',
                errorCode: 'validation' as const,
              },
            }
          }
        }

        const [folder] = await tx
          .update(folderTable)
          .set(updates)
          .where(
            and(
              eq(folderTable.id, params.folderId),
              eq(folderTable.workspaceId, params.workspaceId),
              eq(folderTable.resourceType, params.resourceType),
              isNull(folderTable.deletedAt)
            )
          )
          .returning()
        return { folder }
      },
      { label: 'update-folder' }
    )
    if ('parentError' in outcome) return { success: false, ...outcome.parentError }
    const { folder } = outcome

    if (!folder) {
      return { success: false, error: 'Folder not found', errorCode: 'not_found' }
    }

    logger.info('Updated folder', {
      folderId: params.folderId,
      resourceType: params.resourceType,
      updates,
    })

    // Live resource list (e.g. tables): a rename/move changes the folder in the browser.
    if (options?.notify ?? true) {
      await notifyFolderResourceChanged(params.resourceType, params.workspaceId)
    }
    return { success: true, folder }
  } catch (error) {
    if (getPostgresErrorCode(error) === '23505') {
      return { success: false, error: DUPLICATE_NAME_ERROR, errorCode: 'conflict' }
    }
    logger.error('Failed to update folder', { error, resourceType: params.resourceType })
    return { success: false, error: 'Internal server error', errorCode: 'internal' }
  }
}

/**
 * Soft-deletes a folder and everything under it. The subtree is resolved once, handed to
 * the resource's optional delete guard, then archived under one shared timestamp so
 * {@link restoreFolder} can bring back exactly this set and nothing else.
 *
 * Deleting an already-archived folder reuses that folder's existing `deletedAt` rather than
 * stamping a fresh one. A new timestamp here would be unrecoverable: the folder row keeps
 * its original stamp (the cascade only archives active folders), so anything archived under
 * the new stamp would never match on restore and would be stranded permanently.
 */
export async function deleteFolder(
  params: DeleteFolderParams,
  /**
   * `projectAudit: false` for a caller that projects `FOLDER_DELETED` itself —
   * an application use case attributes the entry to the acting `Principal`,
   * which the `actorId: userId` entry below cannot express for a non-human
   * principal. Omitted, the orchestration keeps recording its own entry, so
   * every existing caller is unchanged.
   *
   * `notify: false` for a caller deleting several folders in one gesture that
   * sends a single batch notification of its own — see {@link bulkDeleteFolders}.
   * `referenceCheckCompleted: true` reuses that batch's reference scan; the
   * table guard still checks deletion locks, and the table service rechecks
   * references under its own transaction locks before archiving the cohort.
   */
  options?: { projectAudit?: boolean; notify?: boolean; referenceCheckCompleted?: boolean }
): Promise<DeleteFolderResult> {
  const existing = await withFolderTreeLock(params.workspaceId, params.resourceType, async (tx) => {
    const [row] = await tx
      .select({ deletedAt: folderTable.deletedAt })
      .from(folderTable)
      .where(
        and(
          eq(folderTable.id, params.folderId),
          eq(folderTable.workspaceId, params.workspaceId),
          eq(folderTable.resourceType, params.resourceType)
        )
      )
      .limit(1)
    return row
  })

  if (!existing) {
    return { success: false, error: 'Folder not found', errorCode: 'not_found' }
  }

  return deleteFolderWithoutTreeLock(params, existing.deletedAt, {
    projectAudit: options?.projectAudit ?? true,
    notify: options?.notify ?? true,
    referenceCheckCompleted: options?.referenceCheckCompleted,
  })
}

async function deleteFolderWithoutTreeLock(
  params: DeleteFolderParams,
  deletedAt: Date | null,
  options: { projectAudit: boolean; notify: boolean; referenceCheckCompleted?: boolean }
): Promise<DeleteFolderResult> {
  const { resourceType, folderId, workspaceId, userId, folderName, folderPath } = params
  const config = folderResourceConfig(resourceType)

  // Resolve the timestamp before the subtree, because the subtree walk needs it: on a retry
  // it is what distinguishes folders this cascade already stamped from folders archived
  // independently.
  const timestamp = deletedAt ?? new Date()
  const folderIds =
    params.maxFolderRows === undefined
      ? await collectCascadeSubtreeIds(db, workspaceId, resourceType, folderId, timestamp)
      : await collectCascadeSubtreeIds(
          db,
          workspaceId,
          resourceType,
          folderId,
          timestamp,
          params.maxFolderRows
        )

  const rejection = await config.guardDelete?.({
    workspaceId,
    folderIds,
    ...(options.referenceCheckCompleted ? { referenceCheckCompleted: true } : {}),
  })
  if (rejection) {
    return { success: false, error: rejection.error, errorCode: rejection.errorCode }
  }

  let counts: Awaited<ReturnType<typeof archiveFolderCascade>>
  try {
    counts = await archiveFolderCascade(db, config, workspaceId, folderIds, timestamp)
  } catch (error) {
    const classified = asOrchestrationError(error)
    if (classified?.code === 'locked' || classified?.code === 'conflict') {
      await restoreFolderRows(db, config, workspaceId, folderIds, timestamp, new Date())
      return { success: false, error: classified.message, errorCode: classified.code }
    }
    throw error
  }

  logger.info('Deleted folder and all contents', { folderId, resourceType, counts })

  if (options.projectAudit) {
    recordAudit({
      workspaceId,
      actorId: userId,
      action: AuditAction.FOLDER_DELETED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: folderId,
      resourceName: folderName,
      description: `Deleted ${config.label} folder "${folderPath ?? folderName ?? folderId}"`,
      metadata: {
        folderResourceType: resourceType,
        path: folderPath,
        affected: {
          [config.countKey]: counts.children,
          subfolders: Math.max(counts.folders - 1, 0),
        },
      },
    })
  }
  // Live resource list (e.g. tables): a delete removes the folder and cascades to its contents.
  if (options.notify) await notifyFolderResourceChanged(resourceType, workspaceId)
  return { success: true, deletedItems: toCascadeCounts(config, counts) }
}

/**
 * Restores an archived folder together with everything archived alongside it.
 *
 * Two name hazards are handled before the cascade runs, both inside the transaction:
 * a folder whose parent is still archived is re-rooted, and the restored name is
 * deduplicated against the *resolved* parent's active siblings — the caller cannot rename
 * an archived folder, so a taken name would otherwise make it permanently unrestorable.
 */
async function restoreFolderWithoutTreeLock(
  params: RestoreFolderParams,
  options: { projectAudit: boolean }
): Promise<RestoreFolderResult> {
  const { resourceType, folderId, workspaceId, userId, folderName } = params
  const config = folderResourceConfig(resourceType)

  const [folder] = await db
    .select()
    .from(folderTable)
    .where(
      and(
        eq(folderTable.id, folderId),
        eq(folderTable.workspaceId, workspaceId),
        eq(folderTable.resourceType, resourceType)
      )
    )

  if (!folder) {
    return { success: false, error: 'Folder not found', errorCode: 'not_found' }
  }

  const archivedAt = folder.deletedAt
  if (!archivedAt) {
    return { success: true, restoredItems: toCascadeCounts(config, { folders: 0, children: 0 }) }
  }

  const { getWorkspaceWithOwner } = await import('@/lib/workspaces/permissions/utils')
  const ws = await getWorkspaceWithOwner(workspaceId)
  if (!ws || ws.archivedAt) {
    return {
      success: false,
      error: 'Cannot restore folder into an archived workspace',
      errorCode: 'validation',
    }
  }

  const folderIds = await collectArchivedSubtreeIds(
    db,
    workspaceId,
    resourceType,
    folderId,
    archivedAt
  )

  // Resources with a `restoreChildren` hook come back BEFORE the folder rows. Those hooks
  // call canonical restores that open their own transactions, so they cannot run inside the
  // one below — and doing them first is what keeps a partial failure recoverable. Restoring
  // folders first would clear the root's `deletedAt`, so a later child failure would
  // short-circuit every retry on the `!archivedAt` early return above, stranding whatever
  // had not come back yet. In this order a failure leaves the folder archived and the whole
  // restore simply retryable; children already restored no longer match the timestamp and
  // are skipped.
  //
  // The cost is a visible intermediate state if the transaction below fails: the children are
  // active while their folders are still archived. They are not lost — the Knowledge and Tables
  // lists fall an unresolvable `folderId` back to the workspace root, so the rows stay reachable
  // — but they sit at the root until the restore is retried.
  const hookChildren = config.restoreChildren
    ? await config.restoreChildren({ workspaceId, folderIds, timestamp: archivedAt })
    : null

  let counts: { folders: number; children: number }
  try {
    counts = await db.transaction(async (tx) => {
      const now = new Date()

      let resolvedParentId = folder.parentId
      if (folder.parentId) {
        const [parentFolder] = await tx
          .select({ archivedAt: folderTable.deletedAt })
          .from(folderTable)
          .where(
            and(eq(folderTable.id, folder.parentId), eq(folderTable.resourceType, resourceType))
          )

        if (!parentFolder || parentFolder.archivedAt) {
          resolvedParentId = null
          await tx
            .update(folderTable)
            .set({ parentId: null })
            .where(and(eq(folderTable.id, folderId), eq(folderTable.resourceType, resourceType)))
        }
      }

      // Safe to rename while the row is still archived: the unique index only covers active
      // rows, so this cannot collide before the cascade below clears `deletedAt`. Only the
      // restore root can conflict — descendants come back alongside the siblings they were
      // archived with.
      const restoredName = await deduplicateFolderName(
        tx,
        workspaceId,
        resolvedParentId,
        folder.name,
        resourceType
      )
      if (restoredName !== folder.name) {
        logger.info('Renamed folder on restore to avoid a sibling name conflict', {
          folderId,
          resourceType,
          from: folder.name,
          to: restoredName,
        })
        await tx
          .update(folderTable)
          .set({ name: restoredName })
          .where(
            and(
              eq(folderTable.id, folderId),
              eq(folderTable.workspaceId, workspaceId),
              eq(folderTable.resourceType, resourceType)
            )
          )
      }

      const folders = await restoreFolderRows(tx, config, workspaceId, folderIds, archivedAt, now)

      const children =
        hookChildren ??
        (await restoreFolderChildren(tx, config, workspaceId, folderIds, archivedAt, now))

      return { folders, children }
    })
  } catch (error) {
    // Clearing `deletedAt` brings the row back under the partial unique index on active
    // (workspaceId, resourceType, parent, name). Dedup above covers the restore root, but a
    // concurrent create can still take the name between the check and the write.
    if (getPostgresErrorCode(error) === '23505') {
      return { success: false, error: DUPLICATE_NAME_ERROR, errorCode: 'conflict' }
    }
    throw error
  }

  logger.info('Restored folder and all contents', { folderId, resourceType, counts })

  if (options.projectAudit) {
    recordAudit({
      workspaceId,
      actorId: userId,
      action: AuditAction.FOLDER_RESTORED,
      resourceType: AuditResourceType.FOLDER,
      resourceId: folderId,
      resourceName: folderName ?? folder.name,
      description: `Restored ${config.label} folder "${folderName ?? folder.name}"`,
      metadata: {
        folderResourceType: resourceType,
        affected: {
          [config.countKey]: counts.children,
          subfolders: Math.max(counts.folders - 1, 0),
        },
      },
    })
  }

  // Live resource list (e.g. tables): a restore brings the folder and its contents back.
  await notifyFolderResourceChanged(resourceType, workspaceId)
  return { success: true, restoredItems: toCascadeCounts(config, counts) }
}

/**
 * Restores a folder while serializing against every writer for the resource tree.
 *
 * `projectAudit: false` for a caller that projects `FOLDER_RESTORED` itself — an application
 * use case attributes the entry to the acting `Principal`, which the `actorId: userId` entry
 * inside cannot express for a non-human principal. Omitted, the orchestration keeps recording
 * its own entry, so every existing caller is unchanged. Mirrors {@link deleteFolder}.
 */
export async function restoreFolder(
  params: RestoreFolderParams,
  options?: { projectAudit?: boolean }
): Promise<RestoreFolderResult> {
  return withFolderTreeLock(params.workspaceId, params.resourceType, () =>
    restoreFolderWithoutTreeLock(params, { projectAudit: options?.projectAudit ?? true })
  )
}
