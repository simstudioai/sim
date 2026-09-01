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
  CSV_ASYNC_IMPORT_THRESHOLD_BYTES,
  CSV_MAX_BATCH_SIZE,
  type CsvHeaderMapping,
  CsvImportValidationError,
  type CsvRejectionSummary,
  coerceRowsForTable,
  getWorkspaceTableLimits,
  inferSchemaFromCsv,
  parseFileRows,
  type RowData,
  replaceTableRows,
  sanitizeName,
  TABLE_LIMITS,
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
  type TableImportRejectionSummary,
} from '@/lib/table/jobs/service'
import { createExactEmptyTableRowSecretProvenance } from '@/lib/table/rows/secret-provenance'
import { createTable, deleteTable } from '@/lib/table/service'
import {
  fetchWorkspaceFileBuffer,
  loadActiveWorkspaceFileContext,
  resolveWorkspaceFileReference,
  type WorkspaceFileRecord,
} from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { getBoundWorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'

const logger = createLogger('TableWorkspaceFileImportApplication')

export interface TableWorkspaceFileSource {
  id: string
  workspaceId: string
  key: string
  name: string
  type: string
  size: number
}

const MAX_INLINE_FILE_BYTES = 50 * 1024 * 1024

export interface CreateTableFromWorkspaceFileInput {
  workspaceId: string
  fileReference: string
  name?: string
  description?: string
  assertNotAborted?: () => void
}

export type CreateTableFromWorkspaceFileResult =
  | {
      kind: 'empty'
      sourceFile: TableWorkspaceFileSource
    }
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
      /** Omitted when the file imported cleanly. See {@link summarizeRejections}. */
      rejections?: TableImportRejectionSummary
    }

export interface ImportWorkspaceFileInput {
  tableId: string
  assertedWorkspaceId: string
  fileReference: string
  mode: 'append' | 'replace'
  mapping?: CsvHeaderMapping
  assertNotAborted?: () => void
}

export type ImportWorkspaceFileResult =
  | {
      kind: 'background'
      table: TableDefinition
      jobId: string
      mode: 'append' | 'replace'
      sourceFileName: string
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
      /** Omitted when the file imported cleanly. See {@link summarizeRejections}. */
      rejections?: TableImportRejectionSummary
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
      /** Omitted when the file imported cleanly. See {@link summarizeRejections}. */
      rejections?: TableImportRejectionSummary
    }

function requestId(): string {
  return generateId().slice(0, 8)
}

async function resolveSafeSourceFile(
  workspaceId: string,
  reference: string
): Promise<WorkspaceFileRecord> {
  const file = await resolveWorkspaceFileReference(workspaceId, reference)
  if (!file) {
    if (reference.replace(/^\/+/, '').startsWith('uploads/')) {
      throw new OrchestrationError(
        'validation',
        `Cannot import "${reference}": chat uploads are not workspace files. Use save_upload to save it to a files/... path first, then pass that canonical path.`
      )
    }
    throw new OrchestrationError(
      'not_found',
      `File not found: "${reference}". Use glob("files/**") and read the canonical file path metadata to find workspace files.`
    )
  }
  const canonical = await loadActiveWorkspaceFileContext(file.id)
  if (!canonical || canonical.workspaceId !== workspaceId || file.workspaceId !== workspaceId) {
    throw new OrchestrationError('not_found', 'Workspace file not found')
  }
  const provenance = await getBoundWorkspaceFileSecretProvenance(workspaceId, {
    fileId: file.id,
    key: file.key,
    context: 'workspace',
  })
  if (provenance.status !== 'exact' || provenance.entries.length > 0) {
    throw new OrchestrationError(
      'validation',
      `Cannot import "${reference}": the file cannot be verified as free of resolved secrets.`
    )
  }
  return file
}

function shouldImportInBackground(file: TableWorkspaceFileSource): boolean {
  const extension = file.name.split('.').pop()?.toLowerCase()
  return (
    (extension === 'csv' || extension === 'tsv') && file.size >= CSV_ASYNC_IMPORT_THRESHOLD_BYTES
  )
}

async function loadInlineRows(file: WorkspaceFileRecord) {
  const content = await fetchWorkspaceFileBuffer(file, { maxBytes: MAX_INLINE_FILE_BYTES })
  return parseFileRows(content, file.name, file.type)
}

/**
 * What an inline (buffered) import reports about the data it lost, so a
 * partially imported file is not presented as a clean one — the same accounting
 * the streaming runner folds into the import record, returned inline because
 * these imports never create one.
 *
 * `undefined` when nothing was lost, leaving a clean import's result exactly
 * what it has always been. `rowsRejected` stays a FLOOR: one parser failure can
 * discard many records and is reported once. Any loss is also warned, so a
 * caller that discards the summary still leaves a trace.
 */
function summarizeRejections(
  rejections: CsvRejectionSummary,
  cellsRejected: number,
  file: TableWorkspaceFileSource
): TableImportRejectionSummary | undefined {
  if (rejections.rowsRejected === 0 && cellsRejected === 0) return undefined
  const summary = {
    rowsRejected: rejections.rowsRejected,
    cellsRejected,
    rejectedSamples: rejections.rejectedSamples,
  }
  logger.warn('Inline table import lost source data', {
    workspaceId: file.workspaceId,
    fileId: file.id,
    fileName: file.name,
    ...summary,
  })
  return summary
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
    const sourceFile = await resolveSafeSourceFile(context.workspaceId, input.fileReference)
    const userId = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    }).attributedUserId
    const limits = await getWorkspaceTableLimits(context.workspaceId)
    const name =
      input.name ??
      sanitizeName(sourceFile.name.replace(/\.[^.]+$/, ''), 'imported_table').slice(
        0,
        TABLE_LIMITS.MAX_TABLE_NAME_LENGTH
      )
    const description = input.description ?? `Imported from ${sourceFile.name}`

    if (shouldImportInBackground(sourceFile)) {
      input.assertNotAborted?.()
      const jobId = generateId()
      const table = await createTable(
        {
          name,
          description,
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
      return { kind: 'background', table, jobId, sourceFile }
    }

    const { headers, rows: sourceRows, rejections } = await loadInlineRows(sourceFile)
    if (sourceRows.length === 0) {
      summarizeRejections(rejections, 0, sourceFile)
      return { kind: 'empty', sourceFile }
    }
    const { columns, headerToColumn } = inferSchemaFromCsv(headers, sourceRows)
    input.assertNotAborted?.()
    const droppedRows = Math.max(0, sourceRows.length - limits.maxRowsPerTable)
    const rows = droppedRows > 0 ? sourceRows.slice(0, limits.maxRowsPerTable) : sourceRows
    const table = await createTable(
      {
        name,
        description,
        schema: { columns },
        workspaceId: context.workspaceId,
        userId,
        maxTables: limits.maxTables,
      },
      requestId()
    )
    let cellsRejected = 0
    try {
      const insertedCount = await batchInsertAll({
        table,
        rows: coerceRowsForTable(rows, table.schema, headerToColumn, undefined, () => {
          cellsRejected++
        }),
        workspaceId: context.workspaceId,
        userId,
        assertNotAborted: input.assertNotAborted,
      })
      const summary = summarizeRejections(rejections, cellsRejected, sourceFile)
      return {
        kind: 'inline',
        table,
        columns,
        insertedCount,
        droppedRows,
        maxRowsPerTable: limits.maxRowsPerTable,
        sourceFile,
        ...(summary ? { rejections: summary } : {}),
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
    if (result.kind === 'empty') return []
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
    const sourceFile = await resolveSafeSourceFile(context.workspaceId, input.fileReference)
    const userId = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    }).attributedUserId

    if (shouldImportInBackground(sourceFile)) {
      input.assertNotAborted?.()
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
      return {
        kind: 'background',
        table: context.table,
        jobId,
        mode: input.mode,
        sourceFileName: sourceFile.name,
      }
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
      const { headers, rows: sourceRows, rejections } = await loadInlineRows(sourceFile)
      input.assertNotAborted?.()
      if (sourceRows.length === 0) {
        summarizeRejections(rejections, 0, sourceFile)
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
      let cellsRejected = 0
      const rows = coerceRowsForTable(
        sourceRows,
        context.table.schema,
        validation.effectiveMap,
        undefined,
        () => {
          cellsRejected++
        }
      )
      const summary = summarizeRejections(rejections, cellsRejected, sourceFile)
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
          kind: 'inline',
          table: context.table,
          mode: input.mode,
          matchedColumns: validation.mappedHeaders,
          skippedColumns: validation.skippedHeaders,
          insertedCount: result.insertedCount,
          deletedCount: result.deletedCount,
          sourceFileName: sourceFile.name,
          ...(summary ? { rejections: summary } : {}),
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
        kind: 'inline',
        table: context.table,
        mode: input.mode,
        matchedColumns: validation.mappedHeaders,
        skippedColumns: validation.skippedHeaders,
        insertedCount,
        sourceFileName: sourceFile.name,
        ...(summary ? { rejections: summary } : {}),
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
