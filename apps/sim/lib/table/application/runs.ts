import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { getRequestContext } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  DEFAULT_TABLE_PLAN_LIMITS,
  getRowById,
  requireTableRowIds,
  TABLE_LIMITS,
  type TableDefinition,
  type TablePredicate,
} from '@/lib/table'
import { defineAuthorizedTableUseCase } from '@/lib/table/application/authorized-table-use-case'
import { resolveActiveTableContext } from '@/lib/table/application/context'
import { tableOperations } from '@/lib/table/application/operations'
import { tablePredicateNamesToFilter } from '@/lib/table/application/rows'
import type { DispatchLimit, DispatchMode } from '@/lib/table/dispatcher'
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
