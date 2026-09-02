import { createLogger } from '@sim/logger'
import { isRecordLike } from '@sim/utils/object'
import { parse as csvParse } from 'csv-parse/sync'
import { executeCopilotReplaceProjectedWireRows } from '@/lib/mothership/application/table-commands'
import { messageForCopilotTableError } from '@/lib/mothership/auth/table-delegation'
import { Read as ReadTool, RunFunction } from '@/lib/mothership/generated/tool-catalog-v1'
import { CopilotTableOutcome } from '@/lib/mothership/generated/trace-attribute-values-v1'
import { TraceAttr } from '@/lib/mothership/generated/trace-attributes-v1'
import { TraceEvent } from '@/lib/mothership/generated/trace-events-v1'
import { TraceSpan } from '@/lib/mothership/generated/trace-spans-v1'
import { withCopilotSpan } from '@/lib/mothership/request/otel'
import { denyOutputWriteWithoutWritePermission } from '@/lib/mothership/request/tools/permissions'
import { projectToolErrorMessageForCopilot } from '@/lib/mothership/request/tools/resolved-secret-result'
import type { ExecutionContext, ToolCallResult } from '@/lib/mothership/request/types'
import type { TableDefinition } from '@/lib/table'
import { ProjectedWireRowsValidationError } from '@/lib/table/application/rows'

const logger = createLogger('CopilotToolResultTables')

const MAX_OUTPUT_TABLE_ROWS = 10_000
/** Python has no top-level `return`; the sandbox reads the `__sim_result__` global instead. */
const RETURN_ROWS_HINT = 'JavaScript: `return [...]`; Python: assign `__sim_result__ = [...]`'
const ARRAY_OF_OBJECTS_ERROR = `outputTable requires the code to return an array of objects (${RETURN_ROWS_HINT})`

/**
 * Declared output files are written before the table step runs, so a table
 * failure after them is a partial success. The error result keeps the written
 * files so the caller sees what landed instead of re-running the code for it.
 */
function outputTableFailure(error: string, rawOutput: unknown): ToolCallResult {
  const files = isRecordLike(rawOutput) && Array.isArray(rawOutput.files) ? rawOutput.files : []
  if (files.length === 0) return { success: false, error }
  return {
    success: false,
    error: `${error}. The declared output files were already written.`,
    output: { files },
  }
}
/**
 * Replaces a table's rows with wire rows keyed by column name. Translates the
 * projected values through one authorized application command. That command
 * validates and translates against the table schema it holds under the schema
 * lock before performing the atomic replacement.
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
  let replacement: Awaited<ReturnType<typeof executeCopilotReplaceProjectedWireRows>>
  try {
    replacement = await executeCopilotReplaceProjectedWireRows(context, {
      tableId,
      assertedWorkspaceId: workspaceId,
      sourceRows: rows,
      projectedRows: rows,
      secretProvenance: {
        mode: 'resolved_output',
        registry: context.resolvedSecretTraceRegistry,
      },
    })
  } catch (error) {
    if (error instanceof ProjectedWireRowsValidationError) {
      return { success: false, error: error.message }
    }
    throw error
  }
  if (replacement.insertedCount !== rows.length) {
    throw new Error('Table row replacement inserted an unexpected row count')
  }
  return {
    success: true,
    table: replacement.table,
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
  if (toolName !== RunFunction.id) return result
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
            return outputTableFailure(ARRAY_OF_OBJECTS_ERROR, rawOutput)
          }
        } else if (Array.isArray(rawOutput)) {
          rows = rawOutput
        } else {
          span.setAttribute(TraceAttr.CopilotTableOutcome, CopilotTableOutcome.InvalidShape)
          return outputTableFailure(ARRAY_OF_OBJECTS_ERROR, rawOutput)
        }

        span.setAttribute(TraceAttr.CopilotTableRowCount, rows.length)

        if (rows.length > MAX_OUTPUT_TABLE_ROWS) {
          span.setAttribute(TraceAttr.CopilotTableOutcome, CopilotTableOutcome.RowLimitExceeded)
          return outputTableFailure(
            `outputTable row limit exceeded: got ${rows.length}, max is ${MAX_OUTPUT_TABLE_ROWS}`,
            rawOutput
          )
        }

        if (rows.length === 0) {
          span.setAttribute(TraceAttr.CopilotTableOutcome, CopilotTableOutcome.EmptyRows)
          return outputTableFailure(
            'outputTable requires at least one row — code returned an empty array',
            rawOutput
          )
        }

        if (context.abortSignal?.aborted) {
          throw new Error('Request aborted before tool mutation could be applied')
        }
        const replaceResult = await replaceTableRowsFromWire(outputTable, rows, context)
        if (!replaceResult.success) {
          span.setAttribute(TraceAttr.CopilotTableOutcome, CopilotTableOutcome.InvalidShape)
          return outputTableFailure(replaceResult.error, rawOutput)
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
