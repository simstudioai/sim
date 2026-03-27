import { db } from '@sim/db'
import { userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { parse as csvParse } from 'csv-parse/sync'
import { eq } from 'drizzle-orm'
import { FunctionExecute, Read as ReadTool } from '@/lib/copilot/generated/tool-catalog-v1'
import type { ExecutionContext, ToolCallResult } from '@/lib/copilot/request/types'
import { getTableById } from '@/lib/table/service'

const logger = createLogger('CopilotToolResultTables')

const MAX_OUTPUT_TABLE_ROWS = 10_000
const BATCH_CHUNK_SIZE = 500

export async function maybeWriteOutputToTable(
  toolName: string,
  params: Record<string, unknown> | undefined,
  result: ToolCallResult,
  context: ExecutionContext
): Promise<ToolCallResult> {
  if (toolName !== FunctionExecute.id) return result
  if (!result.success || !result.output) return result
  if (!context.workspaceId || !context.userId) return result

  const outputTable = params?.outputTable as string | undefined
  if (!outputTable) return result

  try {
    const table = await getTableById(outputTable)
    if (!table) {
      return {
        success: false,
        error: `Table "${outputTable}" not found`,
      }
    }

    const rawOutput = result.output
    let rows: Array<Record<string, unknown>>

    if (rawOutput && typeof rawOutput === 'object' && 'result' in rawOutput) {
      const inner = (rawOutput as Record<string, unknown>).result
      if (Array.isArray(inner)) {
        rows = inner
      } else {
        return {
          success: false,
          error: 'outputTable requires the code to return an array of objects',
        }
      }
    } else if (Array.isArray(rawOutput)) {
      rows = rawOutput
    } else {
      return {
        success: false,
        error: 'outputTable requires the code to return an array of objects',
      }
    }

    if (rows.length > MAX_OUTPUT_TABLE_ROWS) {
      return {
        success: false,
        error: `outputTable row limit exceeded: got ${rows.length}, max is ${MAX_OUTPUT_TABLE_ROWS}`,
      }
    }

    if (rows.length === 0) {
      return {
        success: false,
        error: 'outputTable requires at least one row — code returned an empty array',
      }
    }

    if (context.abortSignal?.aborted) {
      throw new Error('Request aborted before tool mutation could be applied')
    }
    await db.transaction(async (tx) => {
      if (context.abortSignal?.aborted) {
        throw new Error('Request aborted before tool mutation could be applied')
      }
      await tx.delete(userTableRows).where(eq(userTableRows.tableId, outputTable))

      const now = new Date()
      for (let i = 0; i < rows.length; i += BATCH_CHUNK_SIZE) {
        if (context.abortSignal?.aborted) {
          throw new Error('Request aborted before tool mutation could be applied')
        }
        const chunk = rows.slice(i, i + BATCH_CHUNK_SIZE)
        const values = chunk.map((rowData, j) => ({
          id: `row_${crypto.randomUUID().replace(/-/g, '')}`,
          tableId: outputTable,
          workspaceId: context.workspaceId!,
          data: rowData,
          position: i + j,
          createdAt: now,
          updatedAt: now,
          createdBy: context.userId,
        }))
        await tx.insert(userTableRows).values(values)
      }
    })

    logger.info('Tool output written to table', {
      toolName,
      tableId: outputTable,
      rowCount: rows.length,
    })

    return {
      success: true,
      output: {
        message: `Wrote ${rows.length} rows to table ${outputTable}`,
        tableId: outputTable,
        rowCount: rows.length,
      },
    }
  } catch (err) {
    logger.warn('Failed to write tool output to table', {
      toolName,
      outputTable,
      error: err instanceof Error ? err.message : String(err),
    })
    return {
      success: false,
      error: `Failed to write to table: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

export async function maybeWriteReadCsvToTable(
  toolName: string,
  params: Record<string, unknown> | undefined,
  result: ToolCallResult,
  context: ExecutionContext
): Promise<ToolCallResult> {
  if (toolName !== ReadTool.id) return result
  if (!result.success || !result.output) return result
  if (!context.workspaceId || !context.userId) return result

  const outputTable = params?.outputTable as string | undefined
  if (!outputTable) return result

  try {
    const table = await getTableById(outputTable)
    if (!table) {
      return { success: false, error: `Table "${outputTable}" not found` }
    }

    const output = result.output as Record<string, unknown>
    const content = (output.content as string) || ''
    if (!content.trim()) {
      return { success: false, error: 'File has no content to import into table' }
    }

    const filePath = (params?.path as string) || ''
    const ext = filePath.split('.').pop()?.toLowerCase()

    let rows: Record<string, unknown>[]

    if (ext === 'json') {
      const parsed = JSON.parse(content)
      if (!Array.isArray(parsed)) {
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

    if (rows.length === 0) {
      return { success: false, error: 'File has no data rows to import' }
    }

    if (rows.length > MAX_OUTPUT_TABLE_ROWS) {
      return {
        success: false,
        error: `Row limit exceeded: got ${rows.length}, max is ${MAX_OUTPUT_TABLE_ROWS}`,
      }
    }

    if (context.abortSignal?.aborted) {
      throw new Error('Request aborted before tool mutation could be applied')
    }
    await db.transaction(async (tx) => {
      if (context.abortSignal?.aborted) {
        throw new Error('Request aborted before tool mutation could be applied')
      }
      await tx.delete(userTableRows).where(eq(userTableRows.tableId, outputTable))

      const now = new Date()
      for (let i = 0; i < rows.length; i += BATCH_CHUNK_SIZE) {
        if (context.abortSignal?.aborted) {
          throw new Error('Request aborted before tool mutation could be applied')
        }
        const chunk = rows.slice(i, i + BATCH_CHUNK_SIZE)
        const values = chunk.map((rowData, j) => ({
          id: `row_${crypto.randomUUID().replace(/-/g, '')}`,
          tableId: outputTable,
          workspaceId: context.workspaceId!,
          data: rowData,
          position: i + j,
          createdAt: now,
          updatedAt: now,
          createdBy: context.userId,
        }))
        await tx.insert(userTableRows).values(values)
      }
    })

    logger.info('Read output written to table', {
      toolName,
      tableId: outputTable,
      tableName: table.name,
      rowCount: rows.length,
      filePath,
    })

    return {
      success: true,
      output: {
        message: `Imported ${rows.length} rows from "${filePath}" into table "${table.name}"`,
        tableId: outputTable,
        tableName: table.name,
        rowCount: rows.length,
      },
    }
  } catch (err) {
    logger.warn('Failed to write read output to table', {
      toolName,
      outputTable,
      error: err instanceof Error ? err.message : String(err),
    })
    return {
      success: false,
      error: `Failed to import into table: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
