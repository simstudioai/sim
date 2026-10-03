import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import {
  OrchestrationError,
  type OrchestrationErrorCode,
  type OrchestrationRequestContext,
} from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { captureServerEvent } from '@/lib/posthog/server'
import { TableLockedError } from '@/lib/table/mutation-locks'
import { deleteRow } from '@/lib/table/rows/service'
import { deleteTable, moveTableToFolder, renameTable, updateTableLocks } from '@/lib/table/service'
import {
  TABLE_LOCK_FLAGS,
  TABLE_LOCK_KINDS,
  type TableDefinition,
  type TableLockKind,
  type TableLocks,
} from '@/lib/table/types'

const logger = createLogger('TableOrchestration')

export interface PerformDeleteTableParams {
  table: TableDefinition
  userId: string
  requestId?: string
  /** Forwarded to the audit record for IP / user-agent capture. */
  request?: OrchestrationRequestContext
}

export interface PerformDeleteTableResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  /** Which lock rejected the write. Set only when `errorCode` is `'locked'`. */
  lock?: TableLockKind
}

/**
 * Archives a table on behalf of `userId`.
 *
 * The audit lives here rather than in `deleteTable` so that auditing follows
 * from "a user performed this operation", not from which function a caller
 * reached for. The rollback and cleanup paths call the service directly and
 * are silent by construction, and a repeat delete of an already-archived table
 * logs nothing because the service reports that it archived no row.
 */
export async function performDeleteTable(
  params: PerformDeleteTableParams
): Promise<PerformDeleteTableResult> {
  const { table, userId, request } = params
  const requestId = params.requestId ?? generateRequestId()

  let archived: { name: string; workspaceId: string | null } | null
  try {
    ;({ archived } = await deleteTable(table.id, requestId))
  } catch (error) {
    if (error instanceof TableLockedError) {
      return { success: false, error: error.message, errorCode: 'locked', lock: error.lock }
    }
    if (error instanceof OrchestrationError) {
      return { success: false, error: error.message, errorCode: error.code }
    }
    logger.error(`[${requestId}] Failed to delete table ${table.id}`, { error })
    return { success: false, error: toError(error).message, errorCode: 'internal' }
  }

  // Both the audit and the analytics event describe an archive that happened, so
  // both hang off the same evidence that one did. A repeat delete of an
  // already-archived table succeeds and records nothing.
  if (archived) {
    recordAudit({
      workspaceId: archived.workspaceId,
      actorId: userId,
      action: AuditAction.TABLE_DELETED,
      resourceType: AuditResourceType.TABLE,
      resourceId: table.id,
      resourceName: archived.name,
      description: `Archived table "${archived.name}"`,
      ...(request ? { request } : {}),
    })
    captureServerEvent(
      userId,
      'table_deleted',
      { table_id: table.id, workspace_id: table.workspaceId },
      { groups: { workspace: table.workspaceId } }
    )
  }

  return { success: true }
}

export interface PerformDeleteTableRowParams {
  table: TableDefinition
  rowId: string
  requestId?: string
}

export interface PerformDeleteTableRowResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  /** Which lock rejected the write. Set only when `errorCode` is `'locked'`. */
  lock?: TableLockKind
}

/**
 * Deletes a single row through the row service, so the delete lock is enforced
 * and the row-count and ordering bookkeeping runs. A raw `db.delete` skips both
 * and returns success on a locked table.
 */
export async function performDeleteTableRow(
  params: PerformDeleteTableRowParams
): Promise<PerformDeleteTableRowResult> {
  const { table, rowId } = params
  const requestId = params.requestId ?? generateRequestId()

  try {
    await deleteRow(table, rowId, requestId)
    return { success: true }
  } catch (error) {
    if (error instanceof TableLockedError) {
      return { success: false, error: error.message, errorCode: 'locked', lock: error.lock }
    }
    if (error instanceof OrchestrationError) {
      return { success: false, error: error.message, errorCode: error.code }
    }
    logger.error(`[${requestId}] Failed to delete row ${rowId} from table ${table.id}`, { error })
    return { success: false, error: toError(error).message, errorCode: 'internal' }
  }
}

export interface PerformRenameTableParams {
  table: TableDefinition
  newName: string
  userId: string
  requestId?: string
  /** Forwarded to the audit record for IP / user-agent capture. */
  request?: OrchestrationRequestContext
}

export interface PerformTableMutationResult {
  success: boolean
  error?: string
  errorCode?: OrchestrationErrorCode
  /** Which lock rejected the write. Set only when `errorCode` is `'locked'`. */
  lock?: TableLockKind
  table?: TableDefinition
}

function classifyTableMutation(error: unknown, requestId: string, tableId: string) {
  if (error instanceof TableLockedError) {
    return {
      success: false as const,
      error: error.message,
      errorCode: 'locked' as const,
      lock: error.lock,
    }
  }
  // `TableConflictError` is an `OrchestrationError('conflict')`, so a duplicate
  // rename reaches 409 through this branch — by class, not by the message
  // happening to contain "already exists".
  if (error instanceof OrchestrationError) {
    return { success: false as const, error: error.message, errorCode: error.code }
  }
  logger.error(`[${requestId}] Table mutation failed for ${tableId}`, { error })
  return {
    success: false as const,
    error: toError(error).message,
    errorCode: 'internal' as const,
  }
}

/** Renames a table and records the rename against `userId`. */
export async function performRenameTable(
  params: PerformRenameTableParams
): Promise<PerformTableMutationResult> {
  const { table, newName, userId, request } = params
  const requestId = params.requestId ?? generateRequestId()

  try {
    const renamed = await renameTable(table.id, newName, requestId)
    recordAudit({
      workspaceId: table.workspaceId,
      actorId: userId,
      action: AuditAction.TABLE_UPDATED,
      resourceType: AuditResourceType.TABLE,
      resourceId: table.id,
      resourceName: renamed.name,
      description: `Renamed table to "${renamed.name}"`,
      metadata: { op: 'rename', previousName: table.name },
      ...(request ? { request } : {}),
    })
    return { success: true }
  } catch (error) {
    return classifyTableMutation(error, requestId, table.id)
  }
}

export interface PerformMoveTableParams {
  table: TableDefinition
  folderId: string | null
  userId: string
  requestId?: string
  /** Forwarded to the audit record for IP / user-agent capture. */
  request?: OrchestrationRequestContext
}

/** Moves a table between folders (or to the workspace root). */
export async function performMoveTableToFolder(
  params: PerformMoveTableParams
): Promise<PerformTableMutationResult> {
  const { table, folderId, userId, request } = params
  const requestId = params.requestId ?? generateRequestId()
  if (!table.workspaceId) {
    return { success: false, error: 'Table is not in a workspace', errorCode: 'validation' }
  }

  try {
    const { name } = await moveTableToFolder(table.id, table.workspaceId, folderId, requestId)
    recordAudit({
      workspaceId: table.workspaceId,
      actorId: userId,
      action: AuditAction.TABLE_UPDATED,
      resourceType: AuditResourceType.TABLE,
      resourceId: table.id,
      resourceName: name,
      description: folderId
        ? `Moved table "${name}" into a folder`
        : `Moved table "${name}" to the workspace root`,
      metadata: { op: 'move', folderId },
      ...(request ? { request } : {}),
    })
    return { success: true }
  } catch (error) {
    return classifyTableMutation(error, requestId, table.id)
  }
}

export interface PerformUpdateTableLocksParams {
  tableId: string
  partial: Partial<TableLocks>
  userId: string
  requestId?: string
  /** Forwarded to the audit record for IP / user-agent capture. */
  request?: OrchestrationRequestContext
}

/**
 * Applies a lock change and names the transitions in the audit description, so
 * the audit list answers "who locked my production table" without expanding
 * metadata. The before/after state comes back from the service because only the
 * locked write can observe it.
 */
export async function performUpdateTableLocks(
  params: PerformUpdateTableLocksParams
): Promise<PerformTableMutationResult> {
  const { tableId, partial, userId, request } = params
  const requestId = params.requestId ?? generateRequestId()

  try {
    const { table, previousLocks } = await updateTableLocks(tableId, partial, requestId)
    const flipped = TABLE_LOCK_KINDS.filter(
      (kind) => previousLocks[TABLE_LOCK_FLAGS[kind]] !== table.locks[TABLE_LOCK_FLAGS[kind]]
    )
    recordAudit({
      workspaceId: table.workspaceId,
      actorId: userId,
      action: AuditAction.TABLE_UPDATED,
      resourceType: AuditResourceType.TABLE,
      resourceId: tableId,
      resourceName: table.name,
      description: flipped.length
        ? `Table locks changed: ${flipped
            .map((kind) => `${kind} ${table.locks[TABLE_LOCK_FLAGS[kind]] ? 'locked' : 'unlocked'}`)
            .join(', ')}`
        : 'Updated table locks (no change)',
      metadata: { op: 'update_locks', before: previousLocks, after: table.locks },
      ...(request ? { request } : {}),
    })
    return { success: true, table }
  } catch (error) {
    return classifyTableMutation(error, requestId, tableId)
  }
}
