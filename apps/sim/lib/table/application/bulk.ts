import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { type BulkItemDisposition, classifyBulkItemError } from '@/lib/core/application/bulk-items'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  bulkDeleteFolders,
  bulkMoveFolders,
  foldFolderPlan,
  planFolderSelection,
} from '@/lib/folders/bulk'
import { findActiveFolder } from '@/lib/folders/queries'
import { notifyWorkspaceTablesChanged } from '@/lib/realtime/notify'
import { deleteTable, moveTableToFolder } from '@/lib/table'
import { authorizeTableOperation } from '@/lib/table/application/authorization'
import { defineAuthorizedTableUseCase } from '@/lib/table/application/authorized-table-use-case'
import {
  type BoundedTableSelection,
  BULK_DELETE_TABLES_COST_POLICY,
  BULK_MOVE_TABLES_COST_POLICY,
  requireBoundedTableSelection,
  rethrowTableBatchTerminalFailure,
  type TableBatchExecutionResult,
} from '@/lib/table/application/batch-policy'
import {
  type ActiveTableContext,
  resolveActiveTableInWorkspace,
  resolveTableWorkspaceContext,
  type TableWorkspaceContext,
} from '@/lib/table/application/context'
import { tableOperations } from '@/lib/table/application/operations'
import { signalTableSchemaChanged } from '@/lib/table/events'
import { TableLockedError } from '@/lib/table/mutation-locks'

const logger = createLogger('TableBulkApplication')

const TABLE_FOLDER_RESOURCE_TYPE = 'table' as const

export type BulkTableItemKind = 'table' | 'folder'

export interface BulkTableItem {
  kind: BulkTableItemKind
  id: string
  name: string
}

export interface BulkTableFailure extends BulkTableItem {
  reason: string
}

/** An id the batch could not resolve. No name, because nothing was found to name. */
export interface BulkTableMissing {
  kind: BulkTableItemKind
  id: string
}

interface BulkTablesContext extends TableWorkspaceContext, BoundedTableSelection {}

export interface BulkMoveTablesInput {
  assertedWorkspaceId: string
  tableIds: string[]
  folderIds: string[]
  targetFolderId: string | null
}

export interface BulkDeleteTablesInput {
  assertedWorkspaceId: string
  tableIds: string[]
  folderIds: string[]
}

interface BulkTablesOutcome {
  skipped: BulkTableItem[]
  notFound: BulkTableMissing[]
  failed: BulkTableFailure[]
}

export interface BulkMoveTablesResult extends BulkTablesOutcome {
  moved: BulkTableItem[]
}

export interface BulkDeleteTablesResult extends BulkTablesOutcome {
  deleted: BulkTableItem[]
  /** Totals across the explicit deletes and every folder cascade they triggered. */
  deletedItems: { tables: number; folders: number }
}

interface BulkMoveTablesExecutionResult extends BulkMoveTablesResult, TableBatchExecutionResult {}
interface BulkDeleteTablesExecutionResult
  extends BulkDeleteTablesResult,
    TableBatchExecutionResult {}

async function resolveBulkTablesContext(
  input: { assertedWorkspaceId: string; tableIds: string[]; folderIds: string[] },
  maxItems: number
): Promise<BulkTablesContext> {
  const selection = requireBoundedTableSelection(input.tableIds, input.folderIds, maxItems)
  return {
    ...(await resolveTableWorkspaceContext(input.assertedWorkspaceId)),
    ...selection,
  }
}

/**
 * A lock is a per-table verdict, not an infrastructure fault: one locked table
 * must not strand the rest of the selection. `TableLockedError` is an
 * `HttpError`, so it never carries an orchestration code of its own and the
 * shared classification cannot see it.
 */
function tableLockVerdict(error: unknown): BulkItemDisposition | undefined {
  if (error instanceof TableLockedError) return { kind: 'failed', reason: error.message }
  return undefined
}

/**
 * Resolves the destination folder once, before anything is written, so an
 * invalid target fails the whole request rather than leaving half the selection
 * moved. Scoped to `resourceType: 'table'` so a folder id from another
 * resource's tree cannot file tables somewhere the Tables list never renders.
 */
async function requireTableFolder(workspaceId: string, folderId: string | null): Promise<void> {
  if (folderId === null) return
  if (!(await findActiveFolder(folderId, workspaceId, TABLE_FOLDER_RESOURCE_TYPE))) {
    throw new OrchestrationError('not_found', 'Folder not found in this workspace')
  }
}

/**
 * Sends ONE live-list notification for the whole batch.
 *
 * Every per-table notify is an internal HTTP round trip with an identical body
 * and broadcasts an identical workspace-wide invalidation, so a per-item
 * fan-out would make every connected client refetch the same list once per
 * item, and — with a 2s timeout each — could stall a 100-item request for
 * minutes when the socket pod is unreachable. The per-item notifies are
 * therefore suppressed at the mutation and replaced by this one call, made from
 * a `finally` so a batch that ends early still announces what it did commit.
 *
 * Folder items are excluded: `bulkMoveFolders`/`bulkDeleteFolders` send their
 * own single folder-resource notification, which fans out to the same room.
 */
async function notifyBatchedTableChanges(
  workspaceId: string,
  items: readonly BulkTableItem[]
): Promise<void> {
  if (items.some((item) => item.kind === 'table')) {
    await notifyWorkspaceTablesChanged(workspaceId)
  }
}

/**
 * Walks the table half of the selection.
 *
 * A table filed inside one of the selected folders is skipped: the folder
 * operation already carries it, and acting on it separately would either pull
 * it out of the folder it is travelling with or archive it under a second
 * timestamp its folder's restore could never recover.
 */
async function runTableItems(
  tableIds: readonly string[],
  workspace: TableWorkspaceContext,
  covered: ReadonlySet<string>,
  authorize: (canonical: ActiveTableContext) => Promise<void>,
  /** Runs against an already-authorized canonical table. Returns its authoritative name. */
  apply: (canonical: ActiveTableContext) => Promise<string>,
  succeeded: BulkTableItem[],
  outcome: BulkTablesOutcome
): Promise<unknown | undefined> {
  for (const tableId of tableIds) {
    let tableName = tableId
    try {
      const canonical = await resolveActiveTableInWorkspace(tableId, workspace)
      tableName = canonical.table.name
      if (canonical.table.folderId && covered.has(canonical.table.folderId)) {
        outcome.skipped.push({ kind: 'table', id: canonical.table.id, name: tableName })
        continue
      }
      await authorize(canonical)
      succeeded.push({
        kind: 'table',
        id: canonical.table.id,
        name: await apply(canonical),
      })
    } catch (error) {
      const disposition = classifyBulkItemError(error, tableLockVerdict)
      if (disposition.kind === 'notFound') {
        outcome.notFound.push({ kind: 'table', id: tableId })
        continue
      }
      if (disposition.kind === 'failed') {
        outcome.failed.push({
          kind: 'table',
          id: tableId,
          name: tableName,
          reason: disposition.reason,
        })
        continue
      }
      return disposition.error
    }
  }
  return undefined
}

export const bulkMoveTables = defineAuthorizedTableUseCase({
  operation: tableOperations.bulkMove,
  resolveContext: ({ input }: { input: BulkMoveTablesInput }) =>
    resolveBulkTablesContext(input, BULK_MOVE_TABLES_COST_POLICY.maxItems),
  async execute({ principal, input, context }): Promise<BulkMoveTablesExecutionResult> {
    /**
     * The destination check and the folder plan read different rows and share
     * no data, so they overlap rather than serialize. Both still complete
     * before anything is written: an invalid target must fail the whole request
     * rather than leave half the selection moved.
     */
    const [, plan] = await Promise.all([
      requireTableFolder(context.workspaceId, input.targetFolderId),
      planFolderSelection(context.workspaceId, TABLE_FOLDER_RESOURCE_TYPE, context.folderIds),
    ])

    /**
     * The target must not be inside the subtree that is moving. `plan.covered` is exactly the
     * selected folders plus their descendants, so this rejects both "into itself" and "into its
     * own child" before anything is written. Without it the tables move, the folders then fail
     * their cycle check, and the caller is left with a half-applied selection.
     *
     * This is a fast-fail optimization, not the enforcement point. It reads a snapshot taken
     * outside the folder mutation lock, so a concurrent reparent can invalidate it between the
     * check and the write. The invariant itself is enforced where it must be — `updateFolder`
     * re-checks `wouldCreateFolderCycle` inside `acquireFolderMutationLock`, so a cycle is never
     * created. Losing that race costs a reported per-folder `failed` alongside resources that
     * did move, which is the batch's documented `sequential_best_effort` outcome, not corruption.
     */
    if (input.targetFolderId !== null && plan.covered.has(input.targetFolderId)) {
      throw new OrchestrationError(
        'validation',
        'Cannot move a folder into itself or one of its own subfolders'
      )
    }

    const moved: BulkTableItem[] = []
    const outcome: BulkTablesOutcome = { skipped: [], notFound: [], failed: [] }
    foldFolderPlan(plan, outcome)

    try {
      const terminalError = await runTableItems(
        context.tableIds,
        context,
        plan.covered,
        (canonical) => authorizeTableOperation(principal, tableOperations.bulkMove, canonical),
        async (canonical) =>
          (
            await moveTableToFolder(
              canonical.table.id,
              context.workspaceId,
              input.targetFolderId,
              generateRequestId(),
              { notify: false }
            )
          ).name,
        moved,
        outcome
      )

      if (terminalError === undefined && plan.selected.length > 0) {
        const folders = await bulkMoveFolders({
          workspaceId: context.workspaceId,
          resourceType: TABLE_FOLDER_RESOURCE_TYPE,
          userId: resolvePrincipalAttribution(principal, {
            workspaceBillingOwnerUserId: context.billedAccountUserId,
          }).attributedUserId,
          folders: plan.selected,
          targetParentId: input.targetFolderId,
        })
        for (const folder of folders.succeeded) moved.push({ kind: 'folder', ...folder })
        for (const folder of folders.failed) outcome.failed.push({ kind: 'folder', ...folder })
      }

      logger.info('Bulk moved tables and folders', {
        workspaceId: context.workspaceId,
        moved: moved.length,
        skipped: outcome.skipped.length,
        notFound: outcome.notFound.length,
        failed: outcome.failed.length,
      })
      return {
        moved,
        ...outcome,
        ...(terminalError !== undefined && { terminalFailure: { error: terminalError } }),
      }
    } finally {
      await notifyBatchedTableChanges(context.workspaceId, moved)
    }
  },
  projectAudit: ({ input, result }) =>
    result.moved.map((item) =>
      item.kind === 'folder'
        ? {
            action: AuditAction.FOLDER_MOVED,
            resourceType: AuditResourceType.FOLDER,
            resourceId: item.id,
            resourceName: item.name,
            description:
              input.targetFolderId === null
                ? `Moved table folder "${item.name}" to the workspace root`
                : `Moved table folder "${item.name}" into another folder`,
            metadata: {
              folderResourceType: TABLE_FOLDER_RESOURCE_TYPE,
              parentId: input.targetFolderId,
              bulk: true,
            },
          }
        : {
            action: AuditAction.TABLE_UPDATED,
            resourceType: AuditResourceType.TABLE,
            resourceId: item.id,
            resourceName: item.name,
            description:
              input.targetFolderId === null
                ? `Moved table "${item.name}" to the workspace root`
                : `Moved table "${item.name}" into a folder`,
            metadata: { op: 'move', folderId: input.targetFolderId, bulk: true },
          }
    ),
  afterSuccess: ({ result }) => {
    try {
      for (const item of result.moved) {
        if (item.kind === 'table') signalTableSchemaChanged(item.id)
      }
    } finally {
      rethrowTableBatchTerminalFailure(result)
    }
  },
})

export const bulkDeleteTables = defineAuthorizedTableUseCase({
  operation: tableOperations.bulkDelete,
  resolveContext: ({ input }: { input: BulkDeleteTablesInput }) =>
    resolveBulkTablesContext(input, BULK_DELETE_TABLES_COST_POLICY.maxItems),
  async execute({ principal, context }): Promise<BulkDeleteTablesExecutionResult> {
    const plan = await planFolderSelection(
      context.workspaceId,
      TABLE_FOLDER_RESOURCE_TYPE,
      context.folderIds
    )

    const deleted: BulkTableItem[] = []
    const outcome: BulkTablesOutcome = { skipped: [], notFound: [], failed: [] }
    foldFolderPlan(plan, outcome)

    try {
      const terminalError = await runTableItems(
        context.tableIds,
        context,
        plan.covered,
        (canonical) => authorizeTableOperation(principal, tableOperations.bulkDelete, canonical),
        async (canonical) => {
          const { archived } = await deleteTable(canonical.table.id, generateRequestId(), {
            expectedWorkspaceId: context.workspaceId,
            skipNotify: true,
          })
          if (!archived) throw new OrchestrationError('not_found', 'Table not found')
          return archived.name
        },
        deleted,
        outcome
      )

      const deletedItems = { tables: deleted.length, folders: 0 }
      if (terminalError === undefined && plan.selected.length > 0) {
        const folders = await bulkDeleteFolders({
          workspaceId: context.workspaceId,
          resourceType: TABLE_FOLDER_RESOURCE_TYPE,
          userId: resolvePrincipalAttribution(principal, {
            workspaceBillingOwnerUserId: context.billedAccountUserId,
          }).attributedUserId,
          folders: plan.selected,
          countKey: 'tables',
        })
        for (const folder of folders.succeeded) deleted.push({ kind: 'folder', ...folder })
        for (const folder of folders.failed) outcome.failed.push({ kind: 'folder', ...folder })
        deletedItems.folders = folders.folderCount
        deletedItems.tables += folders.resourceCount
      }

      logger.info('Bulk archived tables and folders', {
        workspaceId: context.workspaceId,
        deleted: deleted.length,
        skipped: outcome.skipped.length,
        notFound: outcome.notFound.length,
        failed: outcome.failed.length,
        deletedItems,
      })
      return {
        deleted,
        deletedItems,
        ...outcome,
        ...(terminalError !== undefined && { terminalFailure: { error: terminalError } }),
      }
    } finally {
      await notifyBatchedTableChanges(context.workspaceId, deleted)
    }
  },
  /**
   * One entry per item the batch actually archived. A folder's entry carries
   * the cascade counts rather than one entry per cascaded table, matching what
   * `DELETE /api/folders/[id]` already records for a single folder — a cascade
   * is unbounded, and per-resource entries would let one request write
   * thousands of audit rows.
   */
  projectAudit: ({ result }) =>
    result.deleted.map((item) =>
      item.kind === 'folder'
        ? {
            action: AuditAction.FOLDER_DELETED,
            resourceType: AuditResourceType.FOLDER,
            resourceId: item.id,
            resourceName: item.name,
            description: `Deleted table folder "${item.name}"`,
            metadata: {
              folderResourceType: TABLE_FOLDER_RESOURCE_TYPE,
              affected: result.deletedItems,
              bulk: true,
            },
          }
        : {
            action: AuditAction.TABLE_DELETED,
            resourceType: AuditResourceType.TABLE,
            resourceId: item.id,
            resourceName: item.name,
            description: `Archived table "${item.name}"`,
            metadata: { bulk: true },
          }
    ),
  afterSuccess: ({ result }) => {
    rethrowTableBatchTerminalFailure(result)
  },
})
