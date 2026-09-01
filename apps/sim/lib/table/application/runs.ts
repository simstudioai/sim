import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { getRequestContext } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { capabilityGovernedPrincipalUserId } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  DEFAULT_TABLE_PLAN_LIMITS,
  getRowById,
  getTableById,
  requireTableRowIds,
  TABLE_LIMITS,
  type TableDefinition,
  type TablePredicate,
} from '@/lib/table'
import type { TableAuthorizationContext } from '@/lib/table/application/authorization'
import { defineAuthorizedTableUseCase } from '@/lib/table/application/authorized-table-use-case'
import {
  resolveActiveTableContext,
  resolveTableWorkspaceContext,
} from '@/lib/table/application/context'
import { tableOperations } from '@/lib/table/application/operations'
import { tablePredicateNamesToFilter } from '@/lib/table/application/rows'
import {
  cancelDispatchById,
  type DispatchLimit,
  type DispatchMode,
  type DispatchRow,
  listActiveDispatches,
  readDispatch,
} from '@/lib/table/dispatcher'
import { signalTableRowsChanged } from '@/lib/table/events'
import { cancelWorkflowGroupRuns, runWorkflowColumn } from '@/lib/table/workflow-columns'

interface TableRunInput {
  tableId: string
  assertedWorkspaceId?: string
  requestId?: string
}

interface TableRunResult {
  table: TableDefinition
}

function requestId(input: TableRunInput): string {
  return input.requestId ?? getRequestContext()?.requestId ?? generateId().slice(0, 8)
}

function actorUserId(
  principal: Parameters<typeof resolvePrincipalAttribution>[0],
  billedAccountUserId: string
): string {
  return resolvePrincipalAttribution(principal, {
    workspaceBillingOwnerUserId: billedAccountUserId,
  }).attributedUserId
}

interface StartSelectionRunInput extends TableRunInput {
  kind: 'selection'
  groupIds: string[]
  mode: Extract<DispatchMode, 'all' | 'incomplete'>
  rowIds?: string[]
  predicate?: TablePredicate
  excludeRowIds?: string[]
  limit?: DispatchLimit
}

interface StartRowEnrichmentInput extends TableRunInput {
  kind: 'row_enrichment'
  rowId: string
  groupId: string
}

export type StartTableRunInput = StartSelectionRunInput | StartRowEnrichmentInput

export interface StartTableRunResult extends TableRunResult {
  dispatchId: string | null
  shouldSignalRowsChanged: boolean
}

function requireCanonicalGroups(table: TableDefinition, groupIds: string[]): void {
  if (groupIds.length === 0) {
    throw new OrchestrationError('validation', 'At least one workflow group is required')
  }
  if (groupIds.length > TABLE_LIMITS.MAX_COLUMNS_PER_TABLE) {
    throw new OrchestrationError(
      'validation',
      `Cannot run more than ${TABLE_LIMITS.MAX_COLUMNS_PER_TABLE} groups`
    )
  }
  const canonicalGroupIds = new Set((table.schema.workflowGroups ?? []).map((group) => group.id))
  const missing = [...new Set(groupIds)].filter((groupId) => !canonicalGroupIds.has(groupId))
  if (missing.length > 0) throw new OrchestrationError('not_found', 'Workflow group not found')
}

export const startTableRun = defineAuthorizedTableUseCase({
  operation: tableOperations.startRun,
  resolveContext: ({ input }: { input: StartTableRunInput }) => resolveActiveTableContext(input),
  async execute({ principal, input, context }): Promise<StartTableRunResult> {
    const triggeredByUserId = actorUserId(principal, context.billedAccountUserId)
    /**
     * The gate's subject, which is not the meter's. `actorUserId` substitutes
     * the workspace billed account when the credential names no human, so a
     * workspace-API-key run would otherwise carry that bystander into the
     * cells' tool denylist. Null here means no acting person and no per-tool
     * gate — the same answer an executor delegation gets from the funnel.
     */
    const capabilityGovernedUserId = capabilityGovernedPrincipalUserId(principal)
    if (input.kind === 'row_enrichment') {
      requireCanonicalGroups(context.table, [input.groupId])
      const row = await getRowById(context.tableId, input.rowId, context.workspaceId)
      if (!row) throw new OrchestrationError('not_found', 'Row not found')
      const result = await runWorkflowColumn({
        tableId: context.tableId,
        workspaceId: context.workspaceId,
        groupIds: [input.groupId],
        rowIds: [input.rowId],
        mode: 'all',
        requestId: requestId(input),
        triggeredByUserId,
        capabilityGovernedUserId,
      })
      return {
        table: context.table,
        dispatchId: result.dispatchId,
        shouldSignalRowsChanged: result.shouldSignalRowsChanged,
      }
    }

    if (input.rowIds && input.predicate) {
      throw new OrchestrationError('validation', 'Provide either predicate or rowIds, but not both')
    }
    if (input.rowIds && input.excludeRowIds) {
      throw new OrchestrationError(
        'validation',
        'excludeRowIds only applies to select-all scope (no rowIds)'
      )
    }
    const groupIds = [...new Set(input.groupIds)]
    requireCanonicalGroups(context.table, groupIds)
    const maxTargetRows = DEFAULT_TABLE_PLAN_LIMITS.enterprise.maxRowsPerTable
    if (input.rowIds?.length === 0) {
      throw new OrchestrationError('validation', 'At least one row ID is required')
    }
    if (input.rowIds && input.rowIds.length > maxTargetRows) {
      throw new OrchestrationError('validation', `Cannot target more than ${maxTargetRows} rows`)
    }
    const rowIds = input.rowIds ? [...new Set(input.rowIds)] : undefined
    if (rowIds) await requireTableRowIds(context.tableId, context.workspaceId, rowIds)
    if (input.excludeRowIds && input.excludeRowIds.length > TABLE_LIMITS.MAX_EXCLUDE_ROW_IDS) {
      throw new OrchestrationError(
        'validation',
        `Cannot exclude more than ${TABLE_LIMITS.MAX_EXCLUDE_ROW_IDS} rows`
      )
    }
    const excludeRowIds = input.excludeRowIds ? [...new Set(input.excludeRowIds)] : undefined
    if (
      input.limit &&
      (!Number.isSafeInteger(input.limit.max) ||
        input.limit.max < 1 ||
        input.limit.max > maxTargetRows)
    ) {
      throw new OrchestrationError('validation', `Run limit must be between 1 and ${maxTargetRows}`)
    }
    const filter = input.predicate
      ? tablePredicateNamesToFilter(input.predicate, context.table)
      : undefined
    const result = await runWorkflowColumn({
      tableId: context.tableId,
      workspaceId: context.workspaceId,
      groupIds,
      mode: input.mode,
      rowIds,
      filter,
      excludeRowIds,
      limit: input.limit,
      requestId: requestId(input),
      triggeredByUserId,
      capabilityGovernedUserId,
    })
    return {
      table: context.table,
      dispatchId: result.dispatchId,
      shouldSignalRowsChanged: result.shouldSignalRowsChanged,
    }
  },
  afterSuccess: ({ context, result }) => {
    if (result.shouldSignalRowsChanged) signalTableRowsChanged(context.tableId)
  },
})

interface CancelAllTableRunsInput extends TableRunInput {
  scope: 'all'
  predicate?: TablePredicate
  excludeRowIds?: string[]
}

interface CancelRowTableRunsInput extends TableRunInput {
  scope: 'row'
  rowId: string
}

export type CancelTableRunsInput = CancelAllTableRunsInput | CancelRowTableRunsInput

export interface CancelTableRunsResult extends TableRunResult {
  cancelled: number
}

export const cancelTableRuns = defineAuthorizedTableUseCase({
  operation: tableOperations.cancelRuns,
  resolveContext: ({ input }: { input: CancelTableRunsInput }) => resolveActiveTableContext(input),
  async execute({ input, context }): Promise<CancelTableRunsResult> {
    if (input.scope === 'row') {
      const row = await getRowById(context.tableId, input.rowId, context.workspaceId)
      if (!row) throw new OrchestrationError('not_found', 'Row not found')
    }
    const filter =
      input.scope === 'all' && input.predicate
        ? tablePredicateNamesToFilter(input.predicate, context.table)
        : undefined
    const cancelled = await cancelWorkflowGroupRuns(
      context.tableId,
      input.scope === 'row' ? input.rowId : undefined,
      {
        filter,
        excludeRowIds: input.scope === 'all' ? input.excludeRowIds : undefined,
      }
    )
    return { table: context.table, cancelled }
  },
  afterSuccess: ({ context, result }) => {
    if (result.cancelled > 0) signalTableRowsChanged(context.tableId)
  },
})

export interface TableDispatchResourceInput {
  dispatchId: string
  workspaceId: string
  /** The table the caller addressed the dispatch under; asserted against the stored row. */
  tableId: string
}

export interface TableDispatchResult {
  dispatch: DispatchRow
}

interface TableDispatchContext extends TableAuthorizationContext {
  dispatch: DispatchRow
}

/**
 * Loads one dispatch and derives its canonical table and workspace from the
 * stored row, then asserts the caller's asserted scope against them.
 *
 * The canonical scope always comes from the dispatch itself — the asserted
 * workspace and table are compared to it, never substituted for it. A workspace
 * mismatch, a `tableId` naming a different table, a dispatch whose table was
 * deleted, and a dispatch that never existed all report the same not-found, so
 * the id space leaks nothing across tenants or across tables.
 */
async function resolveTableDispatchContext(
  input: TableDispatchResourceInput
): Promise<TableDispatchContext> {
  const dispatch = await readDispatch(input.dispatchId)
  if (
    !dispatch ||
    dispatch.workspaceId !== input.workspaceId ||
    dispatch.tableId !== input.tableId
  ) {
    throw new OrchestrationError('not_found', 'Table run dispatch not found')
  }
  const table = await getTableById(dispatch.tableId)
  if (!table || table.workspaceId !== dispatch.workspaceId) {
    throw new OrchestrationError('not_found', 'Table run dispatch not found')
  }
  return { ...(await resolveTableWorkspaceContext(dispatch.workspaceId)), dispatch }
}

/** Polls one run dispatch in any of its four states, including the terminal two. */
export const readTableDispatch = defineAuthorizedTableUseCase({
  operation: tableOperations.readRun,
  resolveContext: ({ input }: { input: TableDispatchResourceInput }) =>
    resolveTableDispatchContext(input),
  async execute({ context }): Promise<TableDispatchResult> {
    return { dispatch: context.dispatch }
  },
})

/**
 * Cancels one dispatch by id — the counterpart to `POST /cancel-runs`, which cancels by
 * predicate scope and cannot name a single dispatch.
 *
 * Stops the scheduler: the dispatcher observes the `cancelled` status at its next iteration
 * and enqueues nothing further. Cells already handed to the queue are NOT cancelled here,
 * because nothing links a cell execution back to the dispatch that enqueued it — cancelling
 * those means `POST /cancel-runs`, whose predicate scope is the only way to name them.
 *
 * Idempotent: a dispatch already in a terminal state is returned unchanged.
 */
export const cancelTableDispatch = defineAuthorizedTableUseCase({
  operation: tableOperations.cancelRuns,
  resolveContext: ({ input }: { input: TableDispatchResourceInput }) =>
    resolveTableDispatchContext(input),
  async execute({ context }): Promise<TableDispatchResult> {
    if (context.dispatch.status === 'complete' || context.dispatch.status === 'cancelled') {
      return { dispatch: context.dispatch }
    }
    await cancelDispatchById(context.dispatch.id)
    const dispatch = await readDispatch(context.dispatch.id)
    return { dispatch: dispatch ?? context.dispatch }
  },
})

export interface ListTableDispatchesInput extends TableRunInput {
  assertedWorkspaceId: string
}

export interface ListTableDispatchesResult extends TableRunResult {
  dispatches: DispatchRow[]
}

/**
 * The dispatches still in flight on one table. Bounded by the dispatcher rather
 * than by a page size, which is why the surface publishes it unpaged.
 */
export const listTableDispatches = defineAuthorizedTableUseCase({
  operation: tableOperations.readRun,
  resolveContext: ({ input }: { input: ListTableDispatchesInput }) =>
    resolveActiveTableContext(input),
  async execute({ context }): Promise<ListTableDispatchesResult> {
    return { table: context.table, dispatches: await listActiveDispatches(context.tableId) }
  },
})
