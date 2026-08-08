import { AuditAction, AuditResourceType } from '@sim/audit'
import { createLogger } from '@sim/logger'
import type { V2TableExport } from '@/lib/api/contracts/v2/tables'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getTableById, type TableDefinition } from '@/lib/table'
import type { TableAuthorizationContext } from '@/lib/table/application/authorization'
import { defineAuthorizedTableUseCase } from '@/lib/table/application/authorized-table-use-case'
import {
  resolveActiveTableContext,
  resolveTableWorkspaceContext,
} from '@/lib/table/application/context'
import { tableOperations } from '@/lib/table/application/operations'
import {
  cancelTableExportResource,
  createTableExportResource,
  requireTableExport,
  type TableExportRecord,
  tableExportResult,
  toV2TableExport,
} from '@/lib/table/orchestration/export-resource'
import { generatePresignedDownloadUrl } from '@/lib/uploads/core/storage-service'

const logger = createLogger('TableExportApplication')
const DOWNLOAD_TTL_SECONDS = 60 * 60

export interface CreateTableExportInput {
  tableId: string
  workspaceId: string
  format: 'csv' | 'json'
}

export interface TableExportResourceInput {
  exportId: string
  workspaceId: string
}

export interface TableExportResult {
  export: V2TableExport
}

export interface DownloadTableExportResult {
  url: string
  fileName: string
  expiresAt: string
}

interface TableExportContext extends TableAuthorizationContext {
  exportId: string
  tableId: string
  table: TableDefinition
  record: TableExportRecord
}

async function resolveTableExportContext(
  input: TableExportResourceInput
): Promise<TableExportContext> {
  const record = await requireTableExport(input.exportId, input.workspaceId)
  const table = await getTableById(record.tableId)
  if (!table || table.workspaceId !== record.workspaceId) {
    throw new OrchestrationError('not_found', 'Table export not found')
  }
  const workspace = await resolveTableWorkspaceContext(record.workspaceId)
  return {
    ...workspace,
    exportId: record.id,
    tableId: table.id,
    table,
    record,
  }
}

export const createTableExportUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.createExport,
  resolveContext: ({ input }: { input: CreateTableExportInput }) =>
    resolveActiveTableContext({
      tableId: input.tableId,
      assertedWorkspaceId: input.workspaceId,
    }),
  async execute({ principal, input, context }): Promise<TableExportResult> {
    const record = await createTableExportResource({ table: context.table, format: input.format })
    logger.info('Created table export', {
      exportId: record.id,
      tableId: context.table.id,
      workspaceId: context.workspaceId,
      format: input.format,
      principalKind: principal.kind,
    })
    return { export: toV2TableExport(record, true) }
  },
  projectAudit: ({ input, context }) => ({
    action: AuditAction.TABLE_EXPORTED,
    resourceType: AuditResourceType.TABLE,
    resourceId: context.table.id,
    resourceName: context.table.name,
    description: `Exported table "${context.table.name}" as ${input.format.toUpperCase()}`,
    metadata: { format: input.format, rowCount: context.table.rowCount },
  }),
})

export const readTableExportUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.readExport,
  resolveContext: ({ input }: { input: TableExportResourceInput }) =>
    resolveTableExportContext(input),
  async execute({ context }): Promise<TableExportResult> {
    return { export: toV2TableExport(context.record) }
  },
})

export const cancelTableExportUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.cancelExport,
  resolveContext: ({ input }: { input: TableExportResourceInput }) =>
    resolveTableExportContext(input),
  async execute({ principal, context }): Promise<TableExportResult> {
    const record = await cancelTableExportResource(context.record)
    logger.info('Canceled table export', {
      exportId: record.id,
      tableId: context.tableId,
      workspaceId: context.workspaceId,
      principalKind: principal.kind,
    })
    return { export: toV2TableExport(record) }
  },
})

export const downloadTableExportUseCase = defineAuthorizedTableUseCase({
  operation: tableOperations.downloadExport,
  resolveContext: ({ input }: { input: TableExportResourceInput }) =>
    resolveTableExportContext(input),
  async execute({ context }): Promise<DownloadTableExportResult> {
    const result = tableExportResult(context.record)
    return {
      url: await generatePresignedDownloadUrl(result.resultKey, 'workspace', DOWNLOAD_TTL_SECONDS),
      fileName: result.resultKey.split('/').pop() ?? `export.${result.format}`,
      expiresAt: new Date(Date.now() + DOWNLOAD_TTL_SECONDS * 1000).toISOString(),
    }
  },
})
