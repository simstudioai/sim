import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { runDetached } from '@/lib/core/utils/background'
import {
  batchUpdateRows,
  CSV_MAX_BATCH_SIZE,
  deleteRowsByFilter,
  type Filter,
  queryRows,
  type RowData,
  rowDataNameToId,
  TABLE_LIMITS,
  type TableDeleteJobPayload,
  type TablePredicate,
  type TableUpdateJobPayload,
  updateRowsByFilter,
} from '@/lib/table'
import { defineAuthorizedTableUseCase } from '@/lib/table/application/authorized-table-use-case'
import { resolveActiveTableContext } from '@/lib/table/application/context'
import { tableOperations } from '@/lib/table/application/operations'
import { tablePredicateNamesToFilter } from '@/lib/table/application/rows'
import { buildIdByName } from '@/lib/table/column-keys'
import { markTableDeleteFailed, runTableDelete } from '@/lib/table/delete-runner'
import { signalTableRowsChanged } from '@/lib/table/events'
import {
  markTableJobRunningInWorkspace,
  releaseJobClaimInWorkspace,
} from '@/lib/table/jobs/service'
import { assertRowDelete, assertRowUpdate, patchColumnIds } from '@/lib/table/mutation-locks'
import { createExactEmptyTableRowSecretProvenance } from '@/lib/table/rows/secret-provenance'
import { markTableUpdateFailed, runTableUpdate } from '@/lib/table/update-runner'

const logger = createLogger('CopilotBulkRowsApplication')

interface CopilotBulkRowsInput {
  tableId: string
  assertedWorkspaceId: string
}

export interface CopilotUpdateRowsByFilterInput extends CopilotBulkRowsInput {
  filter: TablePredicate
  data: RowData
  limit?: number
}

export type CopilotUpdateRowsByFilterResult =
  | { kind: 'inline'; affectedCount: number; affectedRowIds: string[] }
  | { kind: 'background'; affectedCount: number; jobId: string }

export interface CopilotDeleteRowsByFilterInput extends CopilotBulkRowsInput {
  filter: TablePredicate
  limit?: number
}

export type CopilotDeleteRowsByFilterResult =
  | { kind: 'inline'; affectedCount: number; affectedRowIds: string[] }
  | { kind: 'background'; doomedCount: number; jobId: string; bounded: boolean }

export interface CopilotBatchUpdateRowsInput extends CopilotBulkRowsInput {
  updates: Array<{ rowId: string; data: RowData }>
}

export interface CopilotBatchUpdateRowsResult {
  affectedCount: number
  affectedRowIds: string[]
}

function requestId(): string {
  return generateId().slice(0, 8)
}

function validateLimit(limit: number | undefined): void {
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) {
    throw new OrchestrationError('validation', 'Limit must be an integer of at least 1')
  }
}

async function releaseClaim(tableId: string, workspaceId: string, jobId: string): Promise<void> {
  const released = await releaseJobClaimInWorkspace(tableId, workspaceId, jobId)
  if (!released) throw new Error('Table job claim was no longer active')
}

async function withReleasedClaim<T>(
  tableId: string,
  workspaceId: string,
  jobId: string,
  run: () => Promise<T>
): Promise<T> {
  let result: T
  try {
    result = await run()
  } catch (error) {
    try {
      await releaseClaim(tableId, workspaceId, jobId)
    } catch (cleanupError) {
      logger.error('Failed to release table job claim after operation failure', {
        tableId,
        workspaceId,
        jobId,
        error: getErrorMessage(cleanupError),
      })
    }
    throw error
  }
  await releaseClaim(tableId, workspaceId, jobId)
  return result
}

async function releaseClaimAfterDispatchFailure(params: {
  tableId: string
  workspaceId: string
  jobId: string
}): Promise<void> {
  try {
    await releaseClaim(params.tableId, params.workspaceId, params.jobId)
  } catch (cleanupError) {
    logger.error('Failed to release table job claim after dispatch failure', {
      ...params,
      error: getErrorMessage(cleanupError),
    })
  }
}

async function dispatchUpdateJob(params: {
  jobId: string
  tableId: string
  workspaceId: string
  filter: Filter
  data: RowData
  cutoff: Date
  maxRows?: number
}): Promise<void> {
  if (isTriggerDevEnabled) {
    try {
      const [{ tableUpdateTask }, { tasks }, { resolveTriggerRegion }] = await Promise.all([
        import('@/background/table-update'),
        import('@trigger.dev/sdk'),
        import('@/lib/core/async-jobs/region'),
      ])
      await tasks.trigger<typeof tableUpdateTask>(
        'table-update',
        { ...params, cutoff: params.cutoff.toISOString() },
        {
          tags: [`tableId:${params.tableId}`, `jobId:${params.jobId}`],
          region: await resolveTriggerRegion(),
        }
      )
    } catch (error) {
      await releaseClaimAfterDispatchFailure(params)
      throw error
    }
    return
  }
  runDetached('table-update', () =>
    runTableUpdate(params).catch(async (error) => {
      await markTableUpdateFailed(params.tableId, params.jobId, error)
      throw error
    })
  )
}

async function dispatchDeleteJob(params: {
  jobId: string
  tableId: string
  workspaceId: string
  filter: Filter
  cutoff: Date
  maxRows?: number
}): Promise<void> {
  if (isTriggerDevEnabled) {
    try {
      const [{ tableDeleteTask }, { tasks }, { resolveTriggerRegion }] = await Promise.all([
        import('@/background/table-delete'),
        import('@trigger.dev/sdk'),
        import('@/lib/core/async-jobs/region'),
      ])
      await tasks.trigger<typeof tableDeleteTask>(
        'table-delete',
        { ...params, cutoff: params.cutoff.toISOString() },
        {
          tags: [`tableId:${params.tableId}`, `jobId:${params.jobId}`],
          region: await resolveTriggerRegion(),
        }
      )
    } catch (error) {
      await releaseClaimAfterDispatchFailure(params)
      throw error
    }
    return
  }
  runDetached('table-delete', () =>
    runTableDelete(params).catch(async (error) => {
      await markTableDeleteFailed(params.tableId, params.jobId, error)
      throw error
    })
  )
}

export const copilotUpdateRowsByFilter = defineAuthorizedTableUseCase({
  operation: tableOperations.updateRows,
  resolveContext: ({ input }: { input: CopilotUpdateRowsByFilterInput }) =>
    resolveActiveTableContext(input),
  async execute({ principal, input, context }): Promise<CopilotUpdateRowsByFilterResult> {
    validateLimit(input.limit)
    const idData = rowDataNameToId(input.data, buildIdByName(context.table.schema))
    const filter = tablePredicateNamesToFilter(input.filter, context.table)
    const patchTouchesUnique = context.table.schema.columns.some(
      (column) => column.unique === true && (column.id ?? column.name) in idData
    )
    const inlineEligible =
      input.limit !== undefined && input.limit <= TABLE_LIMITS.MAX_BULK_OPERATION_SIZE

    if (!inlineEligible && !patchTouchesUnique) {
      const { totalCount } = await queryRows(
        context.table,
        { filter, limit: 1, withExecutions: false },
        requestId()
      )
      const matchCount = totalCount ?? 0
      const target = input.limit === undefined ? matchCount : Math.min(input.limit, matchCount)
      if (target > TABLE_LIMITS.MAX_BULK_OPERATION_SIZE) {
        const cutoff = new Date()
        const jobId = generateId()
        const payload: TableUpdateJobPayload = {
          filter,
          data: idData,
          cutoff: cutoff.toISOString(),
          affectedCount: target,
          maxRows: input.limit,
        }
        assertRowUpdate(context.table, patchColumnIds(idData))
        const claimed = await markTableJobRunningInWorkspace(
          context.tableId,
          context.workspaceId,
          jobId,
          'update',
          payload
        )
        if (!claimed) {
          throw new OrchestrationError('conflict', 'A job is already in progress for this table')
        }
        await dispatchUpdateJob({
          jobId,
          tableId: context.tableId,
          workspaceId: context.workspaceId,
          filter,
          data: idData,
          cutoff,
          maxRows: input.limit,
        })
        return { kind: 'background', affectedCount: target, jobId }
      }
    }

    const result = await updateRowsByFilter(
      context.table,
      {
        filter,
        data: idData,
        limit: input.limit,
        actorUserId: resolvePrincipalAttribution(principal, {
          workspaceBillingOwnerUserId: context.billedAccountUserId,
        }).attributedUserId,
        secretProvenance: createExactEmptyTableRowSecretProvenance(idData),
      },
      requestId()
    )
    return { kind: 'inline', ...result }
  },
  projectAudit({ context, result }) {
    if (result.kind !== 'inline' || result.affectedCount === 0) return []
    return {
      action: AuditAction.TABLE_UPDATED,
      resourceType: AuditResourceType.TABLE,
      resourceId: context.tableId,
      resourceName: context.table.name,
      description: `Updated ${result.affectedCount} row(s) in table "${context.table.name}"`,
      metadata: { op: 'bulk_update', rowsUpdated: result.affectedCount },
    }
  },
  afterSuccess({ context, result }) {
    if (result.kind === 'inline' && result.affectedCount > 0) {
      signalTableRowsChanged(context.tableId)
    }
  },
})

export const copilotDeleteRowsByFilter = defineAuthorizedTableUseCase({
  operation: tableOperations.deleteRows,
  resolveContext: ({ input }: { input: CopilotDeleteRowsByFilterInput }) =>
    resolveActiveTableContext(input),
  async execute({ input, context }): Promise<CopilotDeleteRowsByFilterResult> {
    validateLimit(input.limit)
    const filter = tablePredicateNamesToFilter(input.filter, context.table)
    const inlineEligible =
      input.limit !== undefined && input.limit <= TABLE_LIMITS.MAX_BULK_OPERATION_SIZE

    if (!inlineEligible) {
      const { totalCount } = await queryRows(
        context.table,
        { filter, limit: 1, withExecutions: false },
        requestId()
      )
      const matchCount = totalCount ?? 0
      const target = input.limit === undefined ? matchCount : Math.min(input.limit, matchCount)
      if (target > TABLE_LIMITS.MAX_BULK_OPERATION_SIZE) {
        const doomedCount = Math.min(target, context.table.rowCount)
        const cutoff = new Date()
        const jobId = generateId()
        const bounded = input.limit !== undefined
        const payload: TableDeleteJobPayload = bounded
          ? { filter, cutoff: cutoff.toISOString(), maxRows: input.limit }
          : { filter, cutoff: cutoff.toISOString(), doomedCount }
        assertRowDelete(context.table)
        const claimed = await markTableJobRunningInWorkspace(
          context.tableId,
          context.workspaceId,
          jobId,
          'delete',
          payload
        )
        if (!claimed) {
          throw new OrchestrationError('conflict', 'A job is already in progress for this table')
        }
        await dispatchDeleteJob({
          jobId,
          tableId: context.tableId,
          workspaceId: context.workspaceId,
          filter,
          cutoff,
          maxRows: input.limit,
        })
        return { kind: 'background', doomedCount, jobId, bounded }
      }
    }

    const jobId = generateId()
    const claimed = await markTableJobRunningInWorkspace(
      context.tableId,
      context.workspaceId,
      jobId,
      'delete'
    )
    if (!claimed) {
      throw new OrchestrationError('conflict', 'A job is already in progress for this table')
    }
    const result = await withReleasedClaim(context.tableId, context.workspaceId, jobId, () =>
      deleteRowsByFilter(context.table, { filter, limit: input.limit }, requestId())
    )
    return { kind: 'inline', ...result }
  },
  projectAudit({ context, result }) {
    if (result.kind !== 'inline' || result.affectedCount === 0) return []
    return {
      action: AuditAction.TABLE_UPDATED,
      resourceType: AuditResourceType.TABLE,
      resourceId: context.tableId,
      resourceName: context.table.name,
      description: `Deleted ${result.affectedCount} row(s) from table "${context.table.name}"`,
      metadata: { op: 'bulk_delete', rowsDeleted: result.affectedCount },
    }
  },
  afterSuccess({ context, result }) {
    if (result.kind === 'inline' && result.affectedCount > 0) {
      signalTableRowsChanged(context.tableId)
    }
  },
})

export const copilotBatchUpdateRows = defineAuthorizedTableUseCase({
  operation: tableOperations.updateRows,
  resolveContext: ({ input }: { input: CopilotBatchUpdateRowsInput }) =>
    resolveActiveTableContext(input),
  async execute({ principal, input, context }): Promise<CopilotBatchUpdateRowsResult> {
    if (input.updates.length < 1 || input.updates.length > CSV_MAX_BATCH_SIZE) {
      throw new OrchestrationError(
        'validation',
        `Batch update count must be between 1 and ${CSV_MAX_BATCH_SIZE}`
      )
    }
    const idByName = buildIdByName(context.table.schema)
    const updates = input.updates.map((update) => ({
      rowId: update.rowId,
      data: rowDataNameToId(update.data, idByName),
    }))
    return batchUpdateRows(
      {
        tableId: context.tableId,
        updates,
        workspaceId: context.workspaceId,
        actorUserId: resolvePrincipalAttribution(principal, {
          workspaceBillingOwnerUserId: context.billedAccountUserId,
        }).attributedUserId,
        secretProvenanceByRowId: Object.fromEntries(
          updates.map((update) => [
            update.rowId,
            createExactEmptyTableRowSecretProvenance(update.data),
          ])
        ),
      },
      context.table,
      requestId()
    )
  },
  projectAudit({ context, result }) {
    if (result.affectedCount === 0) return []
    return {
      action: AuditAction.TABLE_UPDATED,
      resourceType: AuditResourceType.TABLE,
      resourceId: context.tableId,
      resourceName: context.table.name,
      description: `Updated ${result.affectedCount} row(s) in table "${context.table.name}"`,
      metadata: { op: 'batch_update', rowsUpdated: result.affectedCount },
    }
  },
  afterSuccess({ context, result }) {
    if (result.affectedCount > 0) signalTableRowsChanged(context.tableId)
  },
})
