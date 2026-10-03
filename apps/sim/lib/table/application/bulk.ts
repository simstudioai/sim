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
import { ROOT_FOLDER_PATH } from '@/lib/folders/paths'
import { findActiveFolder, resolveFolderPathFromIndex } from '@/lib/folders/queries'
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
import { resolveTableFolderPath } from '@/lib/table/application/folder-paths'
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

interface BulkTablesContext extends TableWorkspaceContext, BoundedTableSelection {
  /**
   * Projects a folder id back to the canonical path the caller named it by, for
   * a path-keyed selection. Absent for an id-keyed one, whose caller already
   * speaks ids.
   */
  folderPathById?: ReadonlyMap<string, string>
  /**
   * Path-keyed entries that resolved to no active folder, carried forward as
   * `notFound` rather than failing the batch — the same disposition an id that
   * resolves to nothing gets.
   */
  unresolvedFolders: string[]
  /** Resolves a destination folder reference under the same keying. */
  resolveTargetFolderId: (target: string | null) => string | null | undefined
}

/**
 * How a caller names the folders in a bulk selection.
 *
 * The internal Tables list holds folder ids, so it addresses them directly.
 * The v2 surface addresses folders by canonical PATH everywhere, so it names
 * them that way here too and never sees an id. Resolving a path is an
 * authorization-sensitive lookup against the workspace's active folder tree, so
 * it happens inside the use case's context resolution, never at a route.
 *
 * Required on every input so a new surface must choose, in the same shape as
 * the row surfaces' `dataKeying`.
 */
export type TableFolderKeying = 'ids' | 'paths'

interface BulkTablesSelectionInput {
  assertedWorkspaceId: string
  /** See {@link TableFolderKeying}. */
  folderKeying: TableFolderKeying
  tableIds: string[]
  /** Folder identifiers or canonical folder paths, per {@link folderKeying}. */
  folders: string[]
}

export interface BulkMoveTablesInput extends BulkTablesSelectionInput {
  /**
   * Destination folder identifier or canonical path, per `folderKeying`.
   * `null` — and, for a path-keyed caller, `'/'` — is the workspace root.
   */
  targetFolder: string | null
}

export type BulkDeleteTablesInput = BulkTablesSelectionInput

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

interface BulkMoveTablesExecutionResult extends BulkMoveTablesResult, TableBatchExecutionResult {
  /** Canonical destination, resolved once in `execute` so audit reads it rather than re-deriving it. */
  targetFolderId: string | null
}
interface BulkDeleteTablesExecutionResult
  extends BulkDeleteTablesResult,
    TableBatchExecutionResult {
  /**
   * Every deletion keyed by canonical id, for the audit projection only. The
   * published `deleted` is keyed the way the caller addressed the batch, which
   * on the path-keyed route is a display path.
   */
  auditedDeletions: BulkTableItem[]
}

async function resolveBulkTablesContext(
  input: BulkTablesSelectionInput,
  maxItems: number
): Promise<BulkTablesContext> {
  const selection = requireBoundedTableSelection(input.tableIds, input.folders, maxItems)
  const workspace = await resolveTableWorkspaceContext(input.assertedWorkspaceId)
  if (input.folderKeying === 'ids') {
    return {
      ...workspace,
      ...selection,
      unresolvedFolders: [],
      resolveTargetFolderId: (target) => target,
    }
  }

  /**
   * One index for the whole batch. `resolveTableFolderPath` takes the folder
   * tree lock per call, so resolving 100 paths through it would be 100 lock
   * acquisitions of the same tree; taking it once and resolving from the
   * returned index is the same read under one lock.
   */
  const resolution = await resolveTableFolderPath(workspace.workspaceId, ROOT_FOLDER_PATH)
  if (!resolution) throw new OrchestrationError('not_found', 'Folder not found in this workspace')

  const folderIds: string[] = []
  const unresolvedFolders: string[] = []
  const folderPathById = new Map<string, string>()
  for (const folderPath of selection.folderIds) {
    const folderId = resolveFolderPathFromIndex(resolution.index, folderPath)
    /**
     * `undefined` names no folder; `null` is the workspace root, which is not a
     * folder row and cannot be moved or deleted. Both are reported as an entry
     * the batch could not resolve rather than failing the whole selection.
     */
    if (!folderId) {
      unresolvedFolders.push(folderPath)
      continue
    }
    /**
     * The selection deduplicates PATHS, but two distinct spellings of the same
     * folder resolve to one id — so the batch would carry that id twice while
     * `folderPathById` is last-wins, leaving one of the two paths unreportable.
     * Deduplicate after resolution, keeping the first path that named the
     * folder so the reported spelling matches the first one the caller sent.
     */
    if (folderPathById.has(folderId)) continue
    folderIds.push(folderId)
    folderPathById.set(folderId, folderPath)
  }

  return {
    ...workspace,
    tableIds: selection.tableIds,
    folderIds,
    unresolvedFolders,
    folderPathById,
    resolveTargetFolderId: (target) =>
      target === null ? null : resolveFolderPathFromIndex(resolution.index, target),
  }
}

/**
 * Presents one batch item under the caller's own folder keying: a path-keyed
 * caller gets back the canonical path it named, never an id it has no way to
 * use.
 */
function projectFolderItem(item: BulkTableItem, context: BulkTablesContext): BulkTableItem {
  if (item.kind !== 'folder' || !context.folderPathById) return item
  const path = context.folderPathById.get(item.id) ?? item.id
  return { kind: 'folder', id: path, name: path }
}

/**
 * Folds path-keyed entries that named no active folder into `notFound`, where
 * an unresolvable id already lands.
 */
function withUnresolvedFolders<T extends BulkTablesOutcome>(
  outcome: T,
  context: BulkTablesContext
): T {
  if (context.unresolvedFolders.length === 0) return outcome
  return {
    ...outcome,
    notFound: [
      ...outcome.notFound,
      ...context.unresolvedFolders.map((id) => ({ kind: 'folder' as const, id })),
    ],
  }
}

function projectBulkOutcome<T extends BulkTablesOutcome>(
  outcome: T,
  context: BulkTablesContext
): T {
  if (!context.folderPathById) return outcome
  return {
    ...outcome,
    skipped: outcome.skipped.map((item) => projectFolderItem(item, context)),
    notFound: outcome.notFound.map((item) =>
      item.kind === 'folder'
        ? { kind: 'folder' as const, id: context.folderPathById?.get(item.id) ?? item.id }
        : item
    ),
    failed: outcome.failed.map((item) => ({
      ...projectFolderItem(item, context),
      reason: item.reason,
    })),
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
    const targetFolderId = context.resolveTargetFolderId(input.targetFolder)
    if (targetFolderId === undefined) {
      throw new OrchestrationError('not_found', 'Folder not found in this workspace')
    }

    /**
     * The destination check and the folder plan read different rows and share
     * no data, so they overlap rather than serialize. Both still complete
     * before anything is written: an invalid target must fail the whole request
     * rather than leave half the selection moved.
     */
    const [, plan] = await Promise.all([
      requireTableFolder(context.workspaceId, targetFolderId),
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
    if (targetFolderId !== null && plan.covered.has(targetFolderId)) {
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
              targetFolderId,
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
          targetParentId: targetFolderId,
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
        moved: moved.map((item) => projectFolderItem(item, context)),
        targetFolderId,
        ...withUnresolvedFolders(projectBulkOutcome(outcome, context), context),
        ...(terminalError !== undefined && { terminalFailure: { error: terminalError } }),
      }
    } finally {
      await notifyBatchedTableChanges(context.workspaceId, moved)
    }
  },
  projectAudit: ({ result }) =>
    result.moved.map((item) =>
      item.kind === 'folder'
        ? {
            action: AuditAction.FOLDER_MOVED,
            resourceType: AuditResourceType.FOLDER,
            resourceId: item.id,
            resourceName: item.name,
            description:
              result.targetFolderId === null
                ? `Moved table folder "${item.name}" to the workspace root`
                : `Moved table folder "${item.name}" into another folder`,
            metadata: {
              folderResourceType: TABLE_FOLDER_RESOURCE_TYPE,
              parentId: result.targetFolderId,
              bulk: true,
            },
          }
        : {
            action: AuditAction.TABLE_UPDATED,
            resourceType: AuditResourceType.TABLE,
            resourceId: item.id,
            resourceName: item.name,
            description:
              result.targetFolderId === null
                ? `Moved table "${item.name}" to the workspace root`
                : `Moved table "${item.name}" into a folder`,
            metadata: { op: 'move', folderId: result.targetFolderId, bulk: true },
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
        deleted: deleted.map((item) => projectFolderItem(item, context)),
        /**
         * The same deletions still keyed by canonical id.
         *
         * `deleted` above is keyed for the caller, and on the path-keyed v2
         * route `projectFolderItem` replaces a folder's id with its display
         * path. Auditing from that list wrote the path into
         * `FOLDER_DELETED.resourceId`, so the same action recorded a path here
         * and an id from `DELETE /api/folders/[id]` — two spellings of one
         * resource that no query could join. The projection stays a
         * presentation concern; the audit reads the canonical ids.
         */
        auditedDeletions: deleted.map((item) => ({ ...item })),
        deletedItems,
        ...withUnresolvedFolders(projectBulkOutcome(outcome, context), context),
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
  projectAudit: ({ context, result }) =>
    result.auditedDeletions.map((item) => {
      if (item.kind !== 'folder') {
        return {
          action: AuditAction.TABLE_DELETED,
          resourceType: AuditResourceType.TABLE,
          resourceId: item.id,
          resourceName: item.name,
          description: `Archived table "${item.name}"`,
          metadata: { bulk: true },
        }
      }
      /**
       * The v2 audit formatter nulls `resourceId` for every folder row, so the
       * caller's own path is the only thing left that distinguishes two
       * same-named folders — the single delete records it for the same reason.
       * Present only for a path-keyed selection: an id-keyed one deliberately
       * skips the folder-tree index read that builds the map.
       */
      const path = context.folderPathById?.get(item.id)
      return {
        action: AuditAction.FOLDER_DELETED,
        resourceType: AuditResourceType.FOLDER,
        resourceId: item.id,
        resourceName: item.name,
        description: `Deleted table folder "${path ?? item.name}"`,
        metadata: {
          folderResourceType: TABLE_FOLDER_RESOURCE_TYPE,
          ...(path !== undefined && { path }),
          affected: result.deletedItems,
          bulk: true,
        },
      }
    }),
  afterSuccess: ({ result }) => {
    rethrowTableBatchTerminalFailure(result)
  },
})
