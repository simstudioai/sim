import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isTriggerDevEnabled } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { runDetached } from '@/lib/core/utils/background'
import {
  batchInsertRows,
  buildAutoMapping,
  type ColumnDefinition,
  CSV_MAX_BATCH_SIZE,
  type CsvHeaderMapping,
  CsvImportValidationError,
  coerceRowsForTable,
  getWorkspaceTableLimits,
  type RowData,
  replaceTableRows,
  type TableDefinition,
  validateMapping,
} from '@/lib/table'
import { defineAuthorizedTableUseCase } from '@/lib/table/application/authorized-table-use-case'
import {
  resolveActiveTableContext,
  resolveTableWorkspaceContext,
} from '@/lib/table/application/context'
import { tableOperations } from '@/lib/table/application/operations'
import { signalTableRowsChanged } from '@/lib/table/events'
import { runTableImport, type TableImportPayload } from '@/lib/table/import-runner'
import {
  markTableJobRunningInWorkspace,
  releaseJobClaimInWorkspace,
} from '@/lib/table/jobs/service'
import { createExactEmptyTableRowSecretProvenance } from '@/lib/table/rows/secret-provenance'
import { createTable, deleteTable } from '@/lib/table/service'

const logger = createLogger('TableWorkspaceFileImportApplication')

export interface TableWorkspaceFileSource {
  id: string
  workspaceId: string
  key: string
  name: string
  type: string
  size: number
}

interface CreateTableFromWorkspaceFileBaseInput {
  workspaceId: string
  sourceFile: TableWorkspaceFileSource
  name: string
  description: string
}

export type CreateTableFromWorkspaceFileInput = CreateTableFromWorkspaceFileBaseInput &
  (
    | { kind: 'background' }
    | {
        kind: 'inline'
        columns: ColumnDefinition[]
        headerToColumn: Map<string, string>
        rows: Record<string, unknown>[]
        assertNotAborted?: () => void
      }
  )

export type CreateTableFromWorkspaceFileResult =
  | {
      kind: 'background'
      table: TableDefinition
      jobId: string
      sourceFile: TableWorkspaceFileSource
    }
  | {
      kind: 'inline'
      table: TableDefinition
      columns: ColumnDefinition[]
      insertedCount: number
      droppedRows: number
      maxRowsPerTable: number
      sourceFile: TableWorkspaceFileSource
    }

interface ImportWorkspaceFileBaseInput {
  tableId: string
  assertedWorkspaceId: string
  sourceFile: TableWorkspaceFileSource
  mode: 'append' | 'replace'
  mapping?: CsvHeaderMapping
}

export type ImportWorkspaceFileInput = ImportWorkspaceFileBaseInput &
  (
    | { kind: 'background' }
    | {
        kind: 'inline'
        loadRows: () => Promise<{ headers: string[]; rows: Record<string, unknown>[] }>
        assertNotAborted?: () => void
      }
  )

export type ImportWorkspaceFileResult =
  | {
      kind: 'background'
      table: TableDefinition
      jobId: string
      mode: 'append' | 'replace'
    }
  | {
      kind: 'empty'
      table: TableDefinition
      mode: 'append' | 'replace'
    }
  | {
      kind: 'inline'
      table: TableDefinition
      mode: 'append'
      matchedColumns: string[]
      skippedColumns: string[]
      insertedCount: number
      sourceFileName: string
    }
  | {
      kind: 'inline'
      table: TableDefinition
      mode: 'replace'
      matchedColumns: string[]
      skippedColumns: string[]
      insertedCount: number
      deletedCount: number
      sourceFileName: string
    }

function requestId(): string {
  return generateId().slice(0, 8)
}

function requireCanonicalSource(
  source: TableWorkspaceFileSource,
  workspaceId: string
): TableWorkspaceFileSource {
  if (!source.id || !source.key || !source.name || source.workspaceId !== workspaceId) {
    throw new OrchestrationError('not_found', 'Workspace file not found')
  }
  return source
}

async function batchInsertAll(params: {
  table: TableDefinition
  rows: RowData[]
  workspaceId: string
  userId: string
  assertNotAborted?: () => void
}): Promise<number> {
  let inserted = 0
  for (let index = 0; index < params.rows.length; index += CSV_MAX_BATCH_SIZE) {
    params.assertNotAborted?.()
    const batch = params.rows.slice(index, index + CSV_MAX_BATCH_SIZE)
    const result = await batchInsertRows(
      {
        tableId: params.table.id,
        rows: batch,
        workspaceId: params.workspaceId,
        userId: params.userId,
        secretProvenance: batch.map(createExactEmptyTableRowSecretProvenance),
      },
      { ...params.table, rowCount: params.table.rowCount + inserted },
      requestId()
    )
    inserted += result.length
  }
  return inserted
}

async function dispatchImportJob(payload: TableImportPayload): Promise<void> {
  if (isTriggerDevEnabled) {
    try {
      const [{ tableImportTask }, { tasks }, { resolveTriggerRegion }] = await Promise.all([
        import('@/background/table-import'),
        import('@trigger.dev/sdk'),
        import('@/lib/core/async-jobs/region'),
      ])
      await tasks.trigger<typeof tableImportTask>('table-import', payload, {
        tags: [`tableId:${payload.tableId}`, `jobId:${payload.importId}`],
        region: await resolveTriggerRegion(),
      })
    } catch (error) {
      try {
        const released = await releaseJobClaimInWorkspace(
          payload.tableId,
          payload.workspaceId,
          payload.importId
        )
        if (!released) throw new Error('Table import claim was no longer active')
      } catch (cleanupError) {
        logger.error('Failed to release table import claim after dispatch failure', {
          tableId: payload.tableId,
          jobId: payload.importId,
          error: getErrorMessage(cleanupError),
        })
      }
      throw error
    }
    return
  }
  runDetached('table-import', () => runTableImport(payload))
}

async function withReleasedTableJobClaim<T>(
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
      const released = await releaseJobClaimInWorkspace(tableId, workspaceId, jobId)
      if (!released) throw new Error('Table import claim was no longer active')
    } catch (cleanupError) {
      logger.error('Failed to release table import claim after operation failure', {
        tableId,
        workspaceId,
        jobId,
        error: getErrorMessage(cleanupError),
      })
    }
    throw error
  }
  const released = await releaseJobClaimInWorkspace(tableId, workspaceId, jobId)
  if (!released) throw new Error('Table import claim was no longer active')
  return result
}

export const createTableFromWorkspaceFile = defineAuthorizedTableUseCase({
  operation: tableOperations.createFromWorkspaceFile,
  resolveContext: ({ input }: { input: CreateTableFromWorkspaceFileInput }) =>
    resolveTableWorkspaceContext(input.workspaceId),
  async execute({ principal, input, context }): Promise<CreateTableFromWorkspaceFileResult> {
    const sourceFile = requireCanonicalSource(input.sourceFile, context.workspaceId)
    const userId = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    }).attributedUserId
    const limits = await getWorkspaceTableLimits(context.workspaceId)

    if (input.kind === 'background') {
      const jobId = generateId()
      const table = await createTable(
        {
          name: input.name,
          description: input.description,
          schema: { columns: [{ name: 'column_1', type: 'string' }] },
          workspaceId: context.workspaceId,
          userId,
          maxRows: limits.maxRowsPerTable,
          maxTables: limits.maxTables,
          jobStatus: 'running',
          jobType: 'import',
          jobId,
        },
        requestId()
      )
      try {
        await dispatchImportJob({
          importId: jobId,
          tableId: table.id,
          workspaceId: context.workspaceId,
          userId,
          fileKey: sourceFile.key,
          fileName: sourceFile.name,
          delimiter: sourceFile.name.toLowerCase().endsWith('.tsv') ? '\t' : ',',
          mode: 'create',
          deleteSourceFile: false,
        })
      } catch (error) {
        try {
          await deleteTable(table.id, requestId())
        } catch (cleanupError) {
          logger.error('Failed to remove placeholder table after import dispatch failure', {
            tableId: table.id,
            error: getErrorMessage(cleanupError),
          })
        }
        throw error
      }
      return { kind: input.kind, table, jobId, sourceFile }
    }

    const droppedRows = Math.max(0, input.rows.length - limits.maxRowsPerTable)
    const rows = droppedRows > 0 ? input.rows.slice(0, limits.maxRowsPerTable) : input.rows
    const table = await createTable(
      {
        name: input.name,
        description: input.description,
        schema: { columns: input.columns },
        workspaceId: context.workspaceId,
        userId,
        maxTables: limits.maxTables,
      },
      requestId()
    )
    try {
      const insertedCount = await batchInsertAll({
        table,
        rows: coerceRowsForTable(rows, table.schema, input.headerToColumn),
        workspaceId: context.workspaceId,
        userId,
        assertNotAborted: input.assertNotAborted,
      })
      return {
        kind: input.kind,
        table,
        columns: input.columns,
        insertedCount,
        droppedRows,
        maxRowsPerTable: limits.maxRowsPerTable,
        sourceFile,
      }
    } catch (error) {
      try {
        await deleteTable(table.id, requestId())
      } catch (cleanupError) {
        logger.error('Failed to roll back table after import failure', {
          tableId: table.id,
          error: getErrorMessage(cleanupError),
        })
      }
      throw error
    }
  },
  projectAudit({ result }) {
    return {
      action: AuditAction.TABLE_CREATED,
      resourceType: AuditResourceType.TABLE,
      resourceId: result.table.id,
      resourceName: result.table.name,
      description: `Created table "${result.table.name}" from workspace file`,
      metadata: { sourceFileId: result.sourceFile.id, importMode: result.kind },
    }
  },
  afterSuccess({ result }) {
    if (result.kind === 'inline' && result.insertedCount > 0) {
      signalTableRowsChanged(result.table.id)
    }
  },
})

export const importWorkspaceFileIntoTable = defineAuthorizedTableUseCase({
  operation: tableOperations.importWorkspaceFile,
  resolveContext: ({ input }: { input: ImportWorkspaceFileInput }) =>
    resolveActiveTableContext({
      tableId: input.tableId,
      assertedWorkspaceId: input.assertedWorkspaceId,
    }),
  async execute({ principal, input, context }): Promise<ImportWorkspaceFileResult> {
    const sourceFile = requireCanonicalSource(input.sourceFile, context.workspaceId)
    const userId = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    }).attributedUserId

    if (input.kind === 'background') {
      const jobId = generateId()
      const claimed = await markTableJobRunningInWorkspace(
        context.table.id,
        context.workspaceId,
        jobId,
        'import'
      )
      if (!claimed)
        throw new OrchestrationError('conflict', 'A job is already in progress for this table')
      await dispatchImportJob({
        importId: jobId,
        tableId: context.table.id,
        workspaceId: context.workspaceId,
        userId,
        fileKey: sourceFile.key,
        fileName: sourceFile.name,
        delimiter: sourceFile.name.toLowerCase().endsWith('.tsv') ? '\t' : ',',
        mode: input.mode,
        mapping: input.mapping,
        deleteSourceFile: false,
      })
      return { kind: input.kind, table: context.table, jobId, mode: input.mode }
    }

    const jobId = generateId()
    const claimed = await markTableJobRunningInWorkspace(
      context.table.id,
      context.workspaceId,
      jobId,
      'import'
    )
    if (!claimed)
      throw new OrchestrationError('conflict', 'A job is already in progress for this table')
    return withReleasedTableJobClaim(context.table.id, context.workspaceId, jobId, async () => {
      const { headers, rows: sourceRows } = await input.loadRows()
      input.assertNotAborted?.()
      if (sourceRows.length === 0) {
        return { kind: 'empty', table: context.table, mode: input.mode }
      }
      const mapping = input.mapping ?? buildAutoMapping(headers, context.table.schema)
      let validation: ReturnType<typeof validateMapping>
      try {
        validation = validateMapping({
          csvHeaders: headers,
          mapping,
          tableSchema: context.table.schema,
        })
      } catch (error) {
        if (!(error instanceof CsvImportValidationError)) throw error
        throw new OrchestrationError('validation', error.message)
      }
      if (validation.mappedHeaders.length === 0) {
        throw new OrchestrationError(
          'validation',
          `No matching columns between file (${headers.join(', ')}) and table (${context.table.schema.columns.map((column) => column.name).join(', ')})`
        )
      }
      const rows = coerceRowsForTable(sourceRows, context.table.schema, validation.effectiveMap)
      if (input.mode === 'replace') {
        const result = await replaceTableRows(
          {
            tableId: context.table.id,
            rows,
            workspaceId: context.workspaceId,
            userId,
            secretProvenance: rows.map(createExactEmptyTableRowSecretProvenance),
          },
          context.table,
          requestId()
        )
        return {
          kind: input.kind,
          table: context.table,
          mode: input.mode,
          matchedColumns: validation.mappedHeaders,
          skippedColumns: validation.skippedHeaders,
          insertedCount: result.insertedCount,
          deletedCount: result.deletedCount,
          sourceFileName: sourceFile.name,
        }
      }
      const insertedCount = await batchInsertAll({
        table: context.table,
        rows,
        workspaceId: context.workspaceId,
        userId,
        assertNotAborted: input.assertNotAborted,
      })
      return {
        kind: input.kind,
        table: context.table,
        mode: input.mode,
        matchedColumns: validation.mappedHeaders,
        skippedColumns: validation.skippedHeaders,
        insertedCount,
        sourceFileName: sourceFile.name,
      }
    })
  },
  projectAudit({ result }) {
    if (result.kind !== 'inline') return []
    const affected = result.insertedCount + (result.mode === 'replace' ? result.deletedCount : 0)
    if (affected === 0) return []
    return {
      action: AuditAction.TABLE_UPDATED,
      resourceType: AuditResourceType.TABLE,
      resourceId: result.table.id,
      resourceName: result.table.name,
      description: `Imported workspace file into table "${result.table.name}"`,
      metadata: {
        op: 'workspace_file_import',
        mode: result.mode,
        rowsInserted: result.insertedCount,
        ...(result.mode === 'replace' ? { rowsDeleted: result.deletedCount } : {}),
      },
    }
  },
  afterSuccess({ result }) {
    if (
      result.kind === 'inline' &&
      (result.insertedCount > 0 || (result.mode === 'replace' && result.deletedCount > 0))
    ) {
      signalTableRowsChanged(result.table.id)
    }
  },
})
