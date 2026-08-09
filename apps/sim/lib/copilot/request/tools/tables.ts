import { isDeepStrictEqual } from 'node:util'
import { createLogger } from '@sim/logger'
import { isPlainRecord } from '@sim/utils/object'
import { parse as csvParse } from 'csv-parse/sync'
import { executeCopilotTableUseCase } from '@/lib/copilot/application/execute-table-use-case'
import { messageForCopilotTableError } from '@/lib/copilot/auth/table-delegation'
import { FunctionExecute, Read as ReadTool } from '@/lib/copilot/generated/tool-catalog-v1'
import { CopilotTableOutcome } from '@/lib/copilot/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/copilot/generated/trace-attributes-v1'
import { TraceEvent } from '@/lib/copilot/generated/trace-events-v1'
import { TraceSpan } from '@/lib/copilot/generated/trace-spans-v1'
import { withCopilotSpan } from '@/lib/copilot/request/otel'
import { denyOutputWriteWithoutWritePermission } from '@/lib/copilot/request/tools/permissions'
import {
  projectToolErrorMessageForCopilot,
  projectToolOutputForPersistence,
} from '@/lib/copilot/request/tools/resolved-secret-result'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import type { RowData, TableDefinition } from '@/lib/table'
import { replaceTableRows } from '@/lib/table/application/rows'
import { readTableUseCase } from '@/lib/table/application/tables'
import { columnTypeOf } from '@/lib/table/column-types'
import { createExactEmptyTableRowSecretProvenance } from '@/lib/table/rows/secret-provenance'

const logger = createLogger('CopilotToolResultTables')

const MAX_OUTPUT_TABLE_ROWS = 10_000
const TABLE_SECRET_PROJECTION_UNSUPPORTED_ERROR =
  'Tool output could not be persisted safely because a resolved secret is incompatible with the target column type.'

function hasUnsupportedProjectedCell(
  table: TableDefinition,
  sourceRows: Array<Record<string, unknown>>,
  projectedRows: Array<Record<string, unknown>>
): boolean {
  const columnsByName = new Map(table.schema.columns.map((column) => [column.name, column]))
  for (let rowIndex = 0; rowIndex < projectedRows.length; rowIndex += 1) {
    for (const [name, projectedValue] of Object.entries(projectedRows[rowIndex])) {
      const column = columnsByName.get(name)
      if (!column || isDeepStrictEqual(sourceRows[rowIndex]?.[name], projectedValue)) continue
      const type = columnTypeOf(column).id
      if (type !== 'string' && type !== 'json') return true
    }
  }
  return false
}

/**
 * Replaces a table's rows with wire rows keyed by column name. Translates the
 * keys to stable column ids (unknown keys are dropped, matching every other
 * name-translating boundary) and delegates to `replaceTableRows`, which owns
 * locking, validation, plan row limits, batching, and rowCount maintenance.
 */
async function replaceTableRowsFromWire(
  tableId: string,
  rows: Array<Record<string, unknown>>,
  context: ExecutionContext
): Promise<
  | { success: false; error: string }
  | { success: true; table: TableDefinition; insertedCount: number; deletedCount: number }
> {
  const workspaceId = context.workspaceId
  if (!workspaceId) throw new Error('Table persistence requires a workspace ID')
  const { table } = await executeCopilotTableUseCase(context, readTableUseCase, {
    tableId,
    workspaceId,
  })
  const persistenceProjection = context.resolvedSecretTraceRegistry
    ? projectToolOutputForPersistence(rows, context.resolvedSecretTraceRegistry)
    : { safe: true as const, value: rows }
  if (!persistenceProjection.safe) {
    return { success: false, error: persistenceProjection.error }
  }
  if (
    !Array.isArray(persistenceProjection.value) ||
    !persistenceProjection.value.every(isPlainRecord)
  ) {
    return { success: false, error: 'Table rows could not be persisted safely' }
  }
  if (hasUnsupportedProjectedCell(table, rows, persistenceProjection.value)) {
    return { success: false, error: TABLE_SECRET_PROJECTION_UNSUPPORTED_ERROR }
  }

  const projectedRows = persistenceProjection.value.map((row) => row as RowData)
  const columnNames = new Set(table.schema.columns.map((column) => column.name))
  const emptyIndex = projectedRows.findIndex(
    (row) => !Object.keys(row).some((name) => columnNames.has(name))
  )
  if (emptyIndex !== -1) {
    return {
      success: false,
      error: `Row ${emptyIndex + 1} has no keys matching columns on table "${table.name}" (columns: ${table.schema.columns.map((c) => c.name).join(', ')})`,
    }
  }
  const replacement = await executeCopilotTableUseCase(context, replaceTableRows, {
    tableId: table.id,
    assertedWorkspaceId: workspaceId,
    rows: projectedRows,
    secretProvenance: projectedRows.map(createExactEmptyTableRowSecretProvenance),
  })
  if (replacement.insertedCount !== projectedRows.length) {
    throw new Error('Table row replacement inserted an unexpected row count')
  }
  return {
    success: true,
    table,
    insertedCount: replacement.insertedCount,
    deletedCount: replacement.deletedCount,
  }
}

export async function maybeWriteOutputToTable(
  toolName: string,
  params: Record<string, unknown> | undefined,
  result: ToolCallResult,
  context: ExecutionContext
): Promise<ToolCallResult> {
  if (toolName !== FunctionExecute.id) return result
  if (!result.success || !result.output) return result
  const outputTable = params?.outputTable as string | undefined
  if (!outputTable) return result

  const denied = denyOutputWriteWithoutWritePermission(context)
  if (denied) return denied

  return withCopilotSpan(
    TraceSpan.CopilotToolsWriteOutputTable,
    {
      [TraceAttr.ToolName]: toolName,
      [TraceAttr.CopilotTableId]: outputTable,
      [TraceAttr.WorkspaceId]: context.workspaceId ?? '',
    },
    async (span) => {
      try {
        const rawOutput = result.output
        let rows: Array<Record<string, unknown>>

        if (rawOutput && typeof rawOutput === 'object' && 'result' in rawOutput) {
          const inner = (rawOutput as Record<string, unknown>).result
          if (Array.isArray(inner)) {
            rows = inner
          } else {
            span.setAttribute(TraceAttr.CopilotTableOutcome, CopilotTableOutcome.InvalidShape)
            return {
              success: false,
              error: 'outputTable requires the code to return an array of objects',
            }
          }
        } else if (Array.isArray(rawOutput)) {
          rows = rawOutput
        } else {
          span.setAttribute(TraceAttr.CopilotTableOutcome, CopilotTableOutcome.InvalidShape)
          return {
            success: false,
            error: 'outputTable requires the code to return an array of objects',
          }
        }

        span.setAttribute(TraceAttr.CopilotTableRowCount, rows.length)

        if (rows.length > MAX_OUTPUT_TABLE_ROWS) {
          span.setAttribute(TraceAttr.CopilotTableOutcome, CopilotTableOutcome.RowLimitExceeded)
          return {
            success: false,
            error: `outputTable row limit exceeded: got ${rows.length}, max is ${MAX_OUTPUT_TABLE_ROWS}`,
          }
        }

        if (rows.length === 0) {
          span.setAttribute(TraceAttr.CopilotTableOutcome, CopilotTableOutcome.EmptyRows)
          return {
            success: false,
            error: 'outputTable requires at least one row — code returned an empty array',
          }
        }

        if (context.abortSignal?.aborted) {
          throw new Error('Request aborted before tool mutation could be applied')
        }
        const replaceResult = await replaceTableRowsFromWire(outputTable, rows, context)
        if (!replaceResult.success) {
          span.setAttribute(TraceAttr.CopilotTableOutcome, CopilotTableOutcome.InvalidShape)
          return { success: false, error: replaceResult.error }
        }

        logger.info('Tool output written to table', {
          toolName,
          tableId: outputTable,
          rowCount: replaceResult.insertedCount,
          deletedCount: replaceResult.deletedCount,
        })
        span.setAttribute(TraceAttr.CopilotTableOutcome, CopilotTableOutcome.Wrote)
        return {
          success: true,
          output: {
            message: `Wrote ${replaceResult.insertedCount} rows to table ${outputTable}`,
            tableId: outputTable,
            rowCount: replaceResult.insertedCount,
          },
        }
      } catch (err) {
        const safeMessage = messageForCopilotTableError(err)
        const projectedMessage = projectToolErrorMessageForCopilot(
          safeMessage,
          context.resolvedSecretTraceRegistry
        )
        logger.warn('Failed to write tool output to table', {
          toolName,
          outputTable,
          error: projectedMessage,
        })
        span.setAttribute(TraceAttr.CopilotTableOutcome, CopilotTableOutcome.Failed)
        span.addEvent(TraceEvent.CopilotTableError, {
          [TraceAttr.ErrorMessage]: projectedMessage.slice(0, 500),
        })
        return {
          success: false,
          error: `Failed to write to table: ${projectedMessage}`,
        }
      }
    }
  )
}

export async function maybeWriteReadCsvToTable(
  toolName: string,
  params: Record<string, unknown> | undefined,
  result: ToolCallResult,
  context: ExecutionContext
): Promise<ToolCallResult> {
  if (toolName !== ReadTool.id) return result
  if (!result.success || !result.output) return result
  const outputTable = params?.outputTable as string | undefined
  if (!outputTable) return result

  const denied = denyOutputWriteWithoutWritePermission(context)
  if (denied) return denied

  return withCopilotSpan(
    TraceSpan.CopilotToolsWriteCsvToTable,
    {
      [TraceAttr.ToolName]: toolName,
      [TraceAttr.CopilotTableId]: outputTable,
      [TraceAttr.WorkspaceId]: context.workspaceId ?? '',
    },
    async (span) => {
      try {
        const output = result.output as Record<string, unknown>
        const content = output.content
        if (typeof content !== 'string') {
          span.setAttribute(TraceAttr.CopilotTableOutcome, CopilotTableOutcome.InvalidShape)
          return { success: false, error: 'File content must be text to import into a table' }
        }
        if (!content.trim()) {
          span.setAttribute(TraceAttr.CopilotTableOutcome, CopilotTableOutcome.EmptyContent)
          return { success: false, error: 'File has no content to import into table' }
        }

        const filePath = (params?.path as string) || ''
        const ext = filePath.split('.').pop()?.toLowerCase()
        span.setAttributes({
          [TraceAttr.CopilotTableSourcePath]: filePath,
          [TraceAttr.CopilotTableSourceFormat]: ext === 'json' ? 'json' : 'csv',
          [TraceAttr.CopilotTableSourceContentBytes]: content.length,
        })

        let rows: Record<string, unknown>[]

        if (ext === 'json') {
          const parsed = JSON.parse(content)
          if (!Array.isArray(parsed)) {
            span.setAttribute(TraceAttr.CopilotTableOutcome, CopilotTableOutcome.InvalidJsonShape)
            return {
              success: false,
              error: 'JSON file must contain an array of objects for table import',
            }
          }
          rows = parsed
        } else {
          rows = csvParse(content, {
            columns: true,
            skip_empty_lines: true,
            trim: true,
            relax_column_count: true,
            relax_quotes: true,
            skip_records_with_error: true,
            cast: false,
          }) as Record<string, unknown>[]
        }

        span.setAttribute(TraceAttr.CopilotTableRowCount, rows.length)

        if (rows.length === 0) {
          span.setAttribute(TraceAttr.CopilotTableOutcome, CopilotTableOutcome.EmptyRows)
          return { success: false, error: 'File has no data rows to import' }
        }

        if (rows.length > MAX_OUTPUT_TABLE_ROWS) {
          span.setAttribute(TraceAttr.CopilotTableOutcome, CopilotTableOutcome.RowLimitExceeded)
          return {
            success: false,
            error: `Row limit exceeded: got ${rows.length}, max is ${MAX_OUTPUT_TABLE_ROWS}`,
          }
        }

        if (context.abortSignal?.aborted) {
          throw new Error('Request aborted before tool mutation could be applied')
        }
        const replaceResult = await replaceTableRowsFromWire(outputTable, rows, context)
        if (!replaceResult.success) {
          span.setAttribute(TraceAttr.CopilotTableOutcome, CopilotTableOutcome.InvalidShape)
          return { success: false, error: replaceResult.error }
        }

        logger.info('Read output written to table', {
          toolName,
          tableId: outputTable,
          tableName: replaceResult.table.name,
          rowCount: replaceResult.insertedCount,
          deletedCount: replaceResult.deletedCount,
          filePath,
        })
        span.setAttribute(TraceAttr.CopilotTableOutcome, CopilotTableOutcome.Imported)
        return {
          success: true,
          output: {
            message: `Imported ${replaceResult.insertedCount} rows from "${filePath}" into table "${replaceResult.table.name}"`,
            tableId: outputTable,
            tableName: replaceResult.table.name,
            rowCount: replaceResult.insertedCount,
          },
        }
      } catch (err) {
        const safeMessage = messageForCopilotTableError(err)
        const projectedMessage = projectToolErrorMessageForCopilot(
          safeMessage,
          context.resolvedSecretTraceRegistry
        )
        logger.warn('Failed to write read output to table', {
          toolName,
          outputTable,
          error: projectedMessage,
        })
        span.setAttribute(TraceAttr.CopilotTableOutcome, CopilotTableOutcome.Failed)
        span.addEvent(TraceEvent.CopilotTableError, {
          [TraceAttr.ErrorMessage]: projectedMessage.slice(0, 500),
        })
        return {
          success: false,
          error: `Failed to import into table: ${projectedMessage}`,
        }
      }
    }
  )
}
