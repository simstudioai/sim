import { AuditAction, AuditResourceType } from '@sim/audit'
import { createLogger } from '@sim/logger'
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
  /**
   * The table the caller addressed the export under. v2 nests the export reads beneath their
   * parent table, so the id in the path is asserted against the export's stored `tableId` and
   * a mismatch reports the same not-found an unknown id does — an export id cannot be used to
   * probe which table it belongs to. The internal surface addresses exports by id alone and
   * leaves this undefined.
   */
  tableId?: string
}

export interface TableExportResult {
  export: TableExportRecord
}

export interface DownloadTableExportResult {
  url: string
  fileName: string
  expiresAt: string
}

interface TableExportContext extends TableAuthorizationContext {
  exportId: string
  table: TableDefinition
  record: TableExportRecord
}

async function resolveTableExportContext(
  input: TableExportResourceInput
): Promise<TableExportContext> {
  const record = await requireTableExport(input.exportId, input.workspaceId)
  if (input.tableId !== undefined && input.tableId !== record.tableId) {
    throw new OrchestrationError('not_found', 'Table export not found')
  }
  const table = await getTableById(record.tableId)
  if (!table || table.workspaceId !== record.workspaceId) {
    throw new OrchestrationError('not_found', 'Table export not found')
  }
  const workspace = await resolveTableWorkspaceContext(record.workspaceId)
  return {
    ...workspace,
    exportId: record.id,
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
    return { export: record }
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
    return { export: context.record }
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
      tableId: context.table.id,
      workspaceId: context.workspaceId,
      principalKind: principal.kind,
    })
    return { export: record }
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
