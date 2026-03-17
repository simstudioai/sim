import { db } from '@sim/db'
import { userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import {
  TOOL_DECISION_INITIAL_POLL_MS,
  TOOL_DECISION_MAX_POLL_MS,
  TOOL_DECISION_POLL_BACKOFF,
} from '@/lib/copilot/constants'
import { getToolConfirmation } from '@/lib/copilot/orchestrator/persistence'
import {
  asRecord,
  markToolResultSeen,
  wasToolResultSeen,
} from '@/lib/copilot/orchestrator/sse/utils'
import { executeToolServerSide, markToolComplete } from '@/lib/copilot/orchestrator/tool-executor'
import type {
  ExecutionContext,
  OrchestratorOptions,
  SSEEvent,
  StreamingContext,
  ToolCallResult,
} from '@/lib/copilot/orchestrator/types'
import {
  extractDeletedResourcesFromToolResult,
  extractResourcesFromToolResult,
  hasDeleteCapability,
  isResourceToolName,
  persistChatResources,
  removeChatResources,
} from '@/lib/copilot/resources'
import { getTableById } from '@/lib/table/service'
import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'

const logger = createLogger('CopilotSseToolExecution')

const OUTPUT_PATH_TOOLS = new Set(['function_execute', 'user_table'])

/**
 * Try to pull a flat array of row-objects out of the various shapes that
 * `function_execute` and `user_table` can return.
 */
function extractTabularData(output: unknown): Record<string, unknown>[] | null {
  if (!output || typeof output !== 'object') return null

  if (Array.isArray(output)) {
    if (output.length > 0 && typeof output[0] === 'object' && output[0] !== null) {
      return output as Record<string, unknown>[]
    }
    return null
  }

  const obj = output as Record<string, unknown>

  // function_execute shape: { result: [...], stdout: "..." }
  if (Array.isArray(obj.result)) {
    const rows = obj.result
    if (rows.length > 0 && typeof rows[0] === 'object' && rows[0] !== null) {
      return rows as Record<string, unknown>[]
    }
  }

  // user_table query_rows shape: { data: { rows: [{ data: {...} }], totalCount } }
  if (obj.data && typeof obj.data === 'object' && !Array.isArray(obj.data)) {
    const data = obj.data as Record<string, unknown>
    if (Array.isArray(data.rows) && data.rows.length > 0) {
      const rows = data.rows as Record<string, unknown>[]
      // user_table rows nest actual values inside .data
      if (typeof rows[0].data === 'object' && rows[0].data !== null) {
        return rows.map((r) => r.data as Record<string, unknown>)
      }
      return rows
    }
  }

  return null
}

function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function convertRowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''

  const headerSet = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      headerSet.add(key)
    }
  }
  const headers = [...headerSet]

  const lines = [headers.map(escapeCsvValue).join(',')]
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvValue(row[h])).join(','))
  }
  return lines.join('\n')
}

type OutputFormat = 'json' | 'csv' | 'txt' | 'md' | 'html'

const EXT_TO_FORMAT: Record<string, OutputFormat> = {
  '.json': 'json',
  '.csv': 'csv',
  '.txt': 'txt',
  '.md': 'md',
  '.html': 'html',
}

const FORMAT_TO_CONTENT_TYPE: Record<OutputFormat, string> = {
  json: 'application/json',
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/markdown',
  html: 'text/html',
}

function resolveOutputFormat(fileName: string, explicit?: string): OutputFormat {
  if (explicit && explicit in FORMAT_TO_CONTENT_TYPE) return explicit as OutputFormat
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
  return EXT_TO_FORMAT[ext] ?? 'json'
}

function serializeOutputForFile(output: unknown, format: OutputFormat): string {
  if (typeof output === 'string') return output

  if (format === 'csv') {
    const rows = extractTabularData(output)
    if (rows && rows.length > 0) {
      return convertRowsToCsv(rows)
    }
  }

  return JSON.stringify(output, null, 2)
}

async function maybeWriteOutputToFile(
  toolName: string,
  params: Record<string, unknown> | undefined,
  result: ToolCallResult,
  context: ExecutionContext
): Promise<ToolCallResult> {
  if (!result.success || !result.output) return result
  if (!OUTPUT_PATH_TOOLS.has(toolName)) return result
  if (!context.workspaceId || !context.userId) return result

  const args = params?.args as Record<string, unknown> | undefined
  const outputPath =
    (params?.outputPath as string | undefined) ?? (args?.outputPath as string | undefined)
  if (!outputPath) return result

  const explicitFormat =
    (params?.outputFormat as string | undefined) ?? (args?.outputFormat as string | undefined)
  const fileName = outputPath.replace(/^files\//, '')
  const format = resolveOutputFormat(fileName, explicitFormat)

  try {
    const content = serializeOutputForFile(result.output, format)
    const contentType = FORMAT_TO_CONTENT_TYPE[format]

    const buffer = Buffer.from(content, 'utf-8')
    const uploaded = await uploadWorkspaceFile(
      context.workspaceId,
      context.userId,
      buffer,
      fileName,
      contentType
    )

    logger.info('Tool output written to file', {
      toolName,
      fileName,
      size: buffer.length,
      fileId: uploaded.id,
    })

    return {
      success: true,
      output: {
        message: `Output written to files/${fileName} (${buffer.length} bytes)`,
        fileId: uploaded.id,
        fileName,
        size: buffer.length,
        downloadUrl: uploaded.url,
      },
    }
  } catch (err) {
    logger.warn('Failed to write tool output to file', {
      toolName,
      outputPath,
      error: err instanceof Error ? err.message : String(err),
    })
    return result
  }
}

const MAX_OUTPUT_TABLE_ROWS = 10_000
const BATCH_CHUNK_SIZE = 500

async function maybeWriteOutputToTable(
  toolName: string,
  params: Record<string, unknown> | undefined,
  result: ToolCallResult,
  context: ExecutionContext
): Promise<ToolCallResult> {
  if (toolName !== 'function_execute') return result
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

    await db.transaction(async (tx) => {
      await tx.delete(userTableRows).where(eq(userTableRows.tableId, outputTable))

      const now = new Date()
      for (let i = 0; i < rows.length; i += BATCH_CHUNK_SIZE) {
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

async function maybeWriteReadCsvToTable(
  toolName: string,
  params: Record<string, unknown> | undefined,
  result: ToolCallResult,
  context: ExecutionContext
): Promise<ToolCallResult> {
  if (toolName !== 'read') return result
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
      const { parse } = await import('csv-parse/sync')
      rows = parse(content, {
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

    await db.transaction(async (tx) => {
      await tx.delete(userTableRows).where(eq(userTableRows.tableId, outputTable))

      const now = new Date()
      for (let i = 0; i < rows.length; i += BATCH_CHUNK_SIZE) {
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

export async function executeToolAndReport(
  toolCallId: string,
  context: StreamingContext,
  execContext: ExecutionContext,
  options?: OrchestratorOptions
): Promise<void> {
  const toolCall = context.toolCalls.get(toolCallId)
  if (!toolCall) return

  if (toolCall.status === 'executing') return
  if (wasToolResultSeen(toolCall.id)) return

  toolCall.status = 'executing'

  logger.info('Tool execution started', {
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    params: toolCall.params,
  })

  try {
    let result = await executeToolServerSide(toolCall, execContext)
    result = await maybeWriteOutputToFile(toolCall.name, toolCall.params, result, execContext)
    result = await maybeWriteOutputToTable(toolCall.name, toolCall.params, result, execContext)
    result = await maybeWriteReadCsvToTable(toolCall.name, toolCall.params, result, execContext)
    toolCall.status = result.success ? 'success' : 'error'
    toolCall.result = result
    toolCall.error = result.error
    toolCall.endTime = Date.now()

    if (result.success) {
      logger.info('Tool execution succeeded', {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        output: result.output,
      })
    } else {
      logger.warn('Tool execution failed', {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        error: result.error,
        params: toolCall.params,
      })
    }

    // If create_workflow was successful, update the execution context with the new workflowId.
    // This ensures subsequent tools in the same stream have access to the workflowId.
    const output = asRecord(result.output)
    if (
      toolCall.name === 'create_workflow' &&
      result.success &&
      output.workflowId &&
      !execContext.workflowId
    ) {
      execContext.workflowId = output.workflowId as string
      if (output.workspaceId) {
        execContext.workspaceId = output.workspaceId as string
      }
    }

    markToolResultSeen(toolCall.id)

    // Fire-and-forget: notify the copilot backend that the tool completed.
    // IMPORTANT: We must NOT await this — the Go backend may block on the
    // mark-complete handler until it can write back on the SSE stream, but
    // the SSE reader (our for-await loop) is paused while we're in this
    // handler.  Awaiting here would deadlock: sim waits for Go's response,
    // Go waits for sim to drain the SSE stream.
    markToolComplete(
      toolCall.id,
      toolCall.name,
      result.success ? 200 : 500,
      result.error || (result.success ? 'Tool completed' : 'Tool failed'),
      result.output
    ).catch((err) => {
      logger.error('markToolComplete fire-and-forget failed', {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        error: err instanceof Error ? err.message : String(err),
      })
    })

    const resultEvent: SSEEvent = {
      type: 'tool_result',
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      success: result.success,
      result: result.output,
      data: {
        id: toolCall.id,
        name: toolCall.name,
        success: result.success,
        result: result.output,
      },
    }
    await options?.onEvent?.(resultEvent)

    if (result.success && execContext.chatId) {
      let isDeleteOp = false

      if (hasDeleteCapability(toolCall.name)) {
        const deleted = extractDeletedResourcesFromToolResult(
          toolCall.name,
          toolCall.params,
          result.output
        )
        if (deleted.length > 0) {
          isDeleteOp = true
          removeChatResources(execContext.chatId, deleted).catch((err) => {
            logger.warn('Failed to remove chat resources after deletion', {
              chatId: execContext.chatId,
              error: err instanceof Error ? err.message : String(err),
            })
          })

          for (const resource of deleted) {
            await options?.onEvent?.({
              type: 'resource_deleted',
              resource: { type: resource.type, id: resource.id, title: resource.title },
            })
          }
        }
      }

      if (!isDeleteOp) {
        const resources =
          result.resources && result.resources.length > 0
            ? result.resources
            : isResourceToolName(toolCall.name)
              ? extractResourcesFromToolResult(toolCall.name, toolCall.params, result.output)
              : []

        if (resources.length > 0) {
          persistChatResources(execContext.chatId, resources).catch((err) => {
            logger.warn('Failed to persist chat resources', {
              chatId: execContext.chatId,
              error: err instanceof Error ? err.message : String(err),
            })
          })

          for (const resource of resources) {
            await options?.onEvent?.({
              type: 'resource_added',
              resource: { type: resource.type, id: resource.id, title: resource.title },
            })
          }
        }
      }
    }
  } catch (error) {
    toolCall.status = 'error'
    toolCall.error = error instanceof Error ? error.message : String(error)
    toolCall.endTime = Date.now()

    logger.error('Tool execution threw', {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      error: toolCall.error,
      params: toolCall.params,
    })

    markToolResultSeen(toolCall.id)

    // Fire-and-forget (same reasoning as above).
    // Pass error as structured data so the Go side can surface it to the LLM.
    markToolComplete(toolCall.id, toolCall.name, 500, toolCall.error, {
      error: toolCall.error,
    }).catch((err) => {
      logger.error('markToolComplete fire-and-forget failed', {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        error: err instanceof Error ? err.message : String(err),
      })
    })

    const errorEvent: SSEEvent = {
      type: 'tool_error',
      state: 'error',
      toolCallId: toolCall.id,
      data: {
        id: toolCall.id,
        name: toolCall.name,
        error: toolCall.error,
      },
    }
    await options?.onEvent?.(errorEvent)
  }
}

function abortAwareSleep(ms: number, abortSignal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (abortSignal?.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(resolve, ms)
    abortSignal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
  })
}

export async function waitForToolDecision(
  toolCallId: string,
  timeoutMs: number,
  abortSignal?: AbortSignal
): Promise<{ status: string; message?: string } | null> {
  const start = Date.now()
  let interval = TOOL_DECISION_INITIAL_POLL_MS
  const maxInterval = TOOL_DECISION_MAX_POLL_MS
  while (Date.now() - start < timeoutMs) {
    if (abortSignal?.aborted) return null
    const decision = await getToolConfirmation(toolCallId)
    if (decision?.status) {
      return decision
    }
    await abortAwareSleep(interval, abortSignal)
    interval = Math.min(interval * TOOL_DECISION_POLL_BACKOFF, maxInterval)
  }
  return null
}

/**
 * Wait for a tool completion signal (success/error/rejected) from the client.
 * Unlike waitForToolDecision which returns on any status, this ignores the
 * initial 'accepted' status and only returns on terminal statuses:
 * - success: client finished executing successfully
 * - error: client execution failed
 * - rejected: user clicked Skip (subagent run tools where user hasn't auto-allowed)
 *
 * Used for client-executable run tools: the client executes the workflow
 * and posts success/error to /api/copilot/confirm when done. The server
 * polls here until that completion signal arrives.
 */
export async function waitForToolCompletion(
  toolCallId: string,
  timeoutMs: number,
  abortSignal?: AbortSignal
): Promise<{ status: string; message?: string; data?: Record<string, unknown> } | null> {
  const start = Date.now()
  let interval = TOOL_DECISION_INITIAL_POLL_MS
  const maxInterval = TOOL_DECISION_MAX_POLL_MS
  while (Date.now() - start < timeoutMs) {
    if (abortSignal?.aborted) return null
    const decision = await getToolConfirmation(toolCallId)
    // Return on completion/terminal statuses, not intermediate 'accepted'
    if (
      decision?.status === 'success' ||
      decision?.status === 'error' ||
      decision?.status === 'rejected' ||
      decision?.status === 'background' ||
      decision?.status === 'cancelled'
    ) {
      return decision
    }
    await abortAwareSleep(interval, abortSignal)
    interval = Math.min(interval * TOOL_DECISION_POLL_BACKOFF, maxInterval)
  }
  return null
}
