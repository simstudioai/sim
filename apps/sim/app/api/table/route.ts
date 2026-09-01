import { resolvePrincipalSubject } from '@sim/auth/principal'
import { createTableContract, listTablesContract } from '@/lib/api/contracts/tables'
import {
  defineInternalJsonRoute,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
  internalRateLimits,
} from '@/lib/api/server/routes'
import { captureServerEvent } from '@/lib/posthog/server'
import { internalTableSessionOrExecutorAuth } from '@/lib/table/api'
import { tableOperations } from '@/lib/table/application/operations'
import { createTableUseCase, listTableDefinitionsUseCase } from '@/lib/table/application/tables'
import { normalizeColumn, toTableListItem, toWireTimestamp } from '@/lib/table/wire'

const rateLimit = internalRateLimits.none({
  reason: 'Preserve existing internal table list and create behavior',
})

const createErrorPolicy = {
  ...internalOrchestrationErrorPolicy,
  unhandled: () => internalErrorResponse(500, { error: 'Failed to create table' }),
}

const listErrorPolicy = {
  ...internalOrchestrationErrorPolicy,
  unhandled: () => internalErrorResponse(500, { error: 'Failed to list tables' }),
}

export const POST = defineInternalJsonRoute({
  contract: createTableContract,
  operation: tableOperations.create,
  auth: internalTableSessionOrExecutorAuth,
  rateLimit,
  errorPolicy: createErrorPolicy,
  mapInput: ({ body }, { principal }) => ({
    workspaceId: principal.kind === 'delegated' ? principal.workspaceId : body.workspaceId,
    name: body.name,
    description: body.description,
    schema: { columns: body.schema.columns.map(normalizeColumn) },
    folderId: body.folderId,
    initialRowCount: body.initialRowCount,
  }),
  useCase: createTableUseCase,
  onSuccess: ({ principal, result }) => {
    const subject = resolvePrincipalSubject(principal)
    if (subject?.kind !== 'sim_user') return
    captureServerEvent(
      subject.userId,
      'table_created',
      {
        table_id: result.table.id,
        workspace_id: result.table.workspaceId,
        column_count: result.table.schema.columns.length,
      },
      {
        groups: { workspace: result.table.workspaceId },
        setOnce: { first_table_created_at: new Date().toISOString() },
      }
    )
  },
  present: ({ table }) => ({
    success: true as const,
    data: {
      table: {
        id: table.id,
        name: table.name,
        description: table.description,
        schema: { columns: table.schema.columns.map(normalizeColumn) },
        rowCount: table.rowCount,
        maxRows: table.maxRows,
        folderId: table.folderId ?? null,
        locks: table.locks,
        workspaceId: table.workspaceId,
        createdBy: table.createdBy,
        createdAt: toWireTimestamp(table.createdAt),
        updatedAt: toWireTimestamp(table.updatedAt),
      },
      message: 'Table created successfully',
    },
  }),
})

export const GET = defineInternalJsonRoute({
  contract: listTablesContract,
  operation: tableOperations.list,
  auth: internalTableSessionOrExecutorAuth,
  rateLimit,
  errorPolicy: listErrorPolicy,
  mapInput: ({ query }, { principal }) => ({
    workspaceId: principal.kind === 'delegated' ? principal.workspaceId : query.workspaceId,
    scope: query.scope,
  }),
  useCase: listTableDefinitionsUseCase,
  present: ({ tables }) => ({
    success: true as const,
    data: {
      tables: tables.map(toTableListItem),
      totalCount: tables.length,
    },
  }),
})
