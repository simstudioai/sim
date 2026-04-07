import { db } from '@sim/db'
import { userTableRows } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { completeAsyncToolCall, markAsyncToolRunning } from '@/lib/copilot/async-runs/repository'
import { waitForToolConfirmation } from '@/lib/copilot/orchestrator/persistence'
import { asRecord, markToolResultSeen } from '@/lib/copilot/orchestrator/sse/utils'
import { executeToolServerSide, markToolComplete } from '@/lib/copilot/orchestrator/tool-executor'
import {
  type ExecutionContext,
  isTerminalToolCallStatus,
  type OrchestratorOptions,
  type SSEEvent,
  type StreamingContext,
  type ToolCallResult,
} from '@/lib/copilot/orchestrator/types'
import {
  extractDeletedResourcesFromToolResult,
  extractResourcesFromToolResult,
  hasDeleteCapability,
  isResourceToolName,
  persistChatResources,
  removeChatResources,
} from '@/lib/copilot/resources'
import { generateId } from '@/lib/core/utils/uuid'
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

function normalizeOutputWorkspaceFileName(outputPath: string): string {
  const trimmed = outputPath.trim().replace(/^\/+/, '')
  const withoutPrefix = trimmed.startsWith('files/') ? trimmed.slice('files/'.length) : trimmed
  if (!withoutPrefix) {
    throw new Error('outputPath must include a file name, e.g. "files/result.json"')
  }
  if (withoutPrefix.includes('/')) {
    throw new Error(
      'outputPath must target a flat workspace file, e.g. "files/result.json". Nested paths like "files/reports/result.json" are not supported.'
    )
  }
  return withoutPrefix
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

  try {
    const fileName = normalizeOutputWorkspaceFileName(outputPath)
    const format = resolveOutputFormat(fileName, explicitFormat)
    if (context.abortSignal?.aborted) {
      throw new Error('Request aborted before tool mutation could be applied')
    }
    const content = serializeOutputForFile(result.output, format)
    const contentType = FORMAT_TO_CONTENT_TYPE[format]

    const buffer = Buffer.from(content, 'utf-8')
    if (context.abortSignal?.aborted) {
      throw new Error('Request aborted before tool mutation could be applied')
    }
    const uploaded = await uploadWorkspaceFile(
      context.workspaceId,
      context.userId,
      buffer,
      fileName,
      contentType
    )

    logger.withMetadata({ messageId: context.messageId }).info('Tool output written to file', {
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
    const message = err instanceof Error ? err.message : String(err)
    logger
      .withMetadata({ messageId: context.messageId })
      .warn('Failed to write tool output to file', {
        toolName,
        outputPath,
        error: message,
      })
    return {
      success: false,
      error: `Failed to write output file: ${message}`,
    }
  }
}

const MAX_OUTPUT_TABLE_ROWS = 10_000
const BATCH_CHUNK_SIZE = 500

export interface AsyncToolCompletion {
  status: string
  message?: string
  data?: Record<string, unknown>
}

function abortRequested(
  context: StreamingContext,
  execContext: ExecutionContext,
  options?: OrchestratorOptions
): boolean {
  if (options?.userStopSignal?.aborted || execContext.userStopSignal?.aborted) {
    return true
  }
  if (context.wasAborted) {
    return true
  }
  return false
}

function cancelledCompletion(message: string): AsyncToolCompletion {
  return {
    status: 'cancelled',
    message,
    data: { cancelled: true },
  }
}

function terminalCompletionFromToolCall(toolCall: {
  status: string
  error?: string
  result?: { output?: unknown; error?: string }
}): AsyncToolCompletion {
  if (toolCall.status === 'cancelled') {
    return cancelledCompletion(toolCall.error || 'Tool execution cancelled')
  }

  if (toolCall.status === 'success') {
    return {
      status: 'success',
      message: 'Tool completed',
      data:
        toolCall.result?.output &&
        typeof toolCall.result.output === 'object' &&
        !Array.isArray(toolCall.result.output)
          ? (toolCall.result.output as Record<string, unknown>)
          : undefined,
    }
  }

  if (toolCall.status === 'skipped') {
    return {
      status: 'success',
      message: 'Tool skipped',
      data:
        toolCall.result?.output &&
        typeof toolCall.result.output === 'object' &&
        !Array.isArray(toolCall.result.output)
          ? (toolCall.result.output as Record<string, unknown>)
          : undefined,
    }
  }

  return {
    status: toolCall.status === 'rejected' ? 'rejected' : 'error',
    message: toolCall.error || toolCall.result?.error || 'Tool failed',
    data: { error: toolCall.error || toolCall.result?.error || 'Tool failed' },
  }
}

function reportCancelledTool(
  toolCall: { id: string; name: string },
  message: string,
  messageId?: string,
  data: Record<string, unknown> = { cancelled: true }
): void {
  markToolComplete(toolCall.id, toolCall.name, 499, message, data, messageId).catch((err) => {
    logger.withMetadata({ messageId }).error('markToolComplete failed (cancelled)', {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      error: err instanceof Error ? err.message : String(err),
    })
  })
}

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
          id: `row_${generateId().replace(/-/g, '')}`,
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

    logger.withMetadata({ messageId: context.messageId }).info('Tool output written to table', {
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
    logger
      .withMetadata({ messageId: context.messageId })
      .warn('Failed to write tool output to table', {
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
          id: `row_${generateId().replace(/-/g, '')}`,
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

    logger.withMetadata({ messageId: context.messageId }).info('Read output written to table', {
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
    logger
      .withMetadata({ messageId: context.messageId })
      .warn('Failed to write read output to table', {
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
): Promise<AsyncToolCompletion> {
  const toolCall = context.toolCalls.get(toolCallId)
  if (!toolCall) return { status: 'error', message: 'Tool call not found' }

  if (toolCall.status === 'executing') {
    return { status: 'running', message: 'Tool already executing' }
  }
  if (toolCall.endTime || isTerminalToolCallStatus(toolCall.status)) {
    return terminalCompletionFromToolCall(toolCall)
  }

  if (abortRequested(context, execContext, options)) {
    toolCall.status = 'cancelled'
    toolCall.endTime = Date.now()
    markToolResultSeen(toolCall.id)
    await completeAsyncToolCall({
      toolCallId: toolCall.id,
      status: 'cancelled',
      result: { cancelled: true },
      error: 'Request aborted before tool execution',
    }).catch(() => {})
    reportCancelledTool(toolCall, 'Request aborted before tool execution', context.messageId)
    return cancelledCompletion('Request aborted before tool execution')
  }

  toolCall.status = 'executing'
  await markAsyncToolRunning(toolCall.id, 'sim-stream').catch(() => {})

  logger.withMetadata({ messageId: context.messageId }).info('Tool execution started', {
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    params: toolCall.params,
  })

  try {
    let result = await executeToolServerSide(toolCall, execContext)
    if (toolCall.endTime || isTerminalToolCallStatus(toolCall.status)) {
      return terminalCompletionFromToolCall(toolCall)
    }
    if (abortRequested(context, execContext, options)) {
      toolCall.status = 'cancelled'
      toolCall.endTime = Date.now()
      markToolResultSeen(toolCall.id)
      await completeAsyncToolCall({
        toolCallId: toolCall.id,
        status: 'cancelled',
        result: { cancelled: true },
        error: 'Request aborted during tool execution',
      }).catch(() => {})
      reportCancelledTool(toolCall, 'Request aborted during tool execution', context.messageId)
      return cancelledCompletion('Request aborted during tool execution')
    }
    result = await maybeWriteOutputToFile(toolCall.name, toolCall.params, result, execContext)
    if (abortRequested(context, execContext, options)) {
      toolCall.status = 'cancelled'
      toolCall.endTime = Date.now()
      markToolResultSeen(toolCall.id)
      await completeAsyncToolCall({
        toolCallId: toolCall.id,
        status: 'cancelled',
        result: { cancelled: true },
        error: 'Request aborted during tool post-processing',
      }).catch(() => {})
      reportCancelledTool(
        toolCall,
        'Request aborted during tool post-processing',
        context.messageId
      )
      return cancelledCompletion('Request aborted during tool post-processing')
    }
    result = await maybeWriteOutputToTable(toolCall.name, toolCall.params, result, execContext)
    if (abortRequested(context, execContext, options)) {
      toolCall.status = 'cancelled'
      toolCall.endTime = Date.now()
      markToolResultSeen(toolCall.id)
      await completeAsyncToolCall({
        toolCallId: toolCall.id,
        status: 'cancelled',
        result: { cancelled: true },
        error: 'Request aborted during tool post-processing',
      }).catch(() => {})
      reportCancelledTool(
        toolCall,
        'Request aborted during tool post-processing',
        context.messageId
      )
      return cancelledCompletion('Request aborted during tool post-processing')
    }
    result = await maybeWriteReadCsvToTable(toolCall.name, toolCall.params, result, execContext)
    if (abortRequested(context, execContext, options)) {
      toolCall.status = 'cancelled'
      toolCall.endTime = Date.now()
      markToolResultSeen(toolCall.id)
      await completeAsyncToolCall({
        toolCallId: toolCall.id,
        status: 'cancelled',
        result: { cancelled: true },
        error: 'Request aborted during tool post-processing',
      }).catch(() => {})
      reportCancelledTool(
        toolCall,
        'Request aborted during tool post-processing',
        context.messageId
      )
      return cancelledCompletion('Request aborted during tool post-processing')
    }
    toolCall.status = result.success ? 'success' : 'error'
    toolCall.result = result
    toolCall.error = result.error
    toolCall.endTime = Date.now()

    if (result.success) {
      const raw = result.output
      const preview =
        typeof raw === 'string'
          ? raw.slice(0, 200)
          : raw && typeof raw === 'object'
            ? JSON.stringify(raw).slice(0, 200)
            : undefined
      logger.withMetadata({ messageId: context.messageId }).info('Tool execution succeeded', {
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        outputPreview: preview,
      })
    } else {
      logger.withMetadata({ messageId: context.messageId }).warn('Tool execution failed', {
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
    await completeAsyncToolCall({
      toolCallId: toolCall.id,
      status: result.success ? 'completed' : 'failed',
      result: result.success ? asRecord(result.output) : { error: result.error || 'Tool failed' },
      error: result.success ? null : result.error || 'Tool failed',
    }).catch(() => {})

    if (abortRequested(context, execContext, options)) {
      toolCall.status = 'cancelled'
      reportCancelledTool(
        toolCall,
        'Request aborted before tool result delivery',
        context.messageId
      )
      return cancelledCompletion('Request aborted before tool result delivery')
    }

    // Fire-and-forget: notify the copilot backend that the tool completed.
    // IMPORTANT: We must NOT await this — the server may block on the
    // mark-complete handler until it can write back on the SSE stream, but
    // the SSE reader (our for-await loop) is paused while we're in this
    // handler.  Awaiting here would deadlock: sim waits for the server's response,
    // the server waits for sim to drain the SSE stream.
    markToolComplete(
      toolCall.id,
      toolCall.name,
      result.success ? 200 : 500,
      result.error || (result.success ? 'Tool completed' : 'Tool failed'),
      result.output,
      context.messageId
    ).catch((err) => {
      logger
        .withMetadata({ messageId: context.messageId })
        .error('markToolComplete fire-and-forget failed', {
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

    if (abortRequested(context, execContext, options)) {
      toolCall.status = 'cancelled'
      return cancelledCompletion('Request aborted before resource persistence')
    }

    if (result.success && execContext.chatId && !abortRequested(context, execContext, options)) {
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
            logger
              .withMetadata({ messageId: context.messageId })
              .warn('Failed to remove chat resources after deletion', {
                chatId: execContext.chatId,
                error: err instanceof Error ? err.message : String(err),
              })
          })

          for (const resource of deleted) {
            if (abortRequested(context, execContext, options)) break
            await options?.onEvent?.({
              type: 'resource_deleted',
              resource: { type: resource.type, id: resource.id, title: resource.title },
            })
          }
        }
      }

      if (!isDeleteOp && !abortRequested(context, execContext, options)) {
        const resources =
          result.resources && result.resources.length > 0
            ? result.resources
            : isResourceToolName(toolCall.name)
              ? extractResourcesFromToolResult(toolCall.name, toolCall.params, result.output)
              : []

        if (resources.length > 0) {
          persistChatResources(execContext.chatId, resources).catch((err) => {
            logger
              .withMetadata({ messageId: context.messageId })
              .warn('Failed to persist chat resources', {
                chatId: execContext.chatId,
                error: err instanceof Error ? err.message : String(err),
              })
          })

          for (const resource of resources) {
            if (abortRequested(context, execContext, options)) break
            await options?.onEvent?.({
              type: 'resource_added',
              resource: { type: resource.type, id: resource.id, title: resource.title },
            })
          }
        }
      }
    }
    return {
      status: result.success ? 'success' : 'error',
      message: result.error || (result.success ? 'Tool completed' : 'Tool failed'),
      data: asRecord(result.output),
    }
  } catch (error) {
    if (abortRequested(context, execContext, options)) {
      toolCall.status = 'cancelled'
      toolCall.endTime = Date.now()
      markToolResultSeen(toolCall.id)
      await completeAsyncToolCall({
        toolCallId: toolCall.id,
        status: 'cancelled',
        result: { cancelled: true },
        error: 'Request aborted during tool execution',
      }).catch(() => {})
      reportCancelledTool(toolCall, 'Request aborted during tool execution', context.messageId)
      return cancelledCompletion('Request aborted during tool execution')
    }
    toolCall.status = 'error'
    toolCall.error = error instanceof Error ? error.message : String(error)
    toolCall.endTime = Date.now()

    logger.withMetadata({ messageId: context.messageId }).error('Tool execution threw', {
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      error: toolCall.error,
      params: toolCall.params,
    })

    markToolResultSeen(toolCall.id)
    await completeAsyncToolCall({
      toolCallId: toolCall.id,
      status: 'failed',
      result: { error: toolCall.error },
      error: toolCall.error,
    }).catch(() => {})

    // Fire-and-forget (same reasoning as above).
    // Pass error as structured data so the Go side can surface it to the LLM.
    markToolComplete(
      toolCall.id,
      toolCall.name,
      500,
      toolCall.error,
      {
        error: toolCall.error,
      },
      context.messageId
    ).catch((err) => {
      logger
        .withMetadata({ messageId: context.messageId })
        .error('markToolComplete fire-and-forget failed', {
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
    return {
      status: 'error',
      message: toolCall.error,
      data: { error: toolCall.error },
    }
  }
}

/**
 * Wait for a tool completion signal (success/error/rejected) from the client.
 * Ignores intermediate statuses like `accepted` and only returns terminal statuses:
 * - success: client finished executing successfully
 * - error: client execution failed
 * - rejected: user clicked Skip (subagent run tools where user hasn't auto-allowed)
 *
 * Used for client-executable run tools: the client executes the workflow
 * and posts success/error to /api/copilot/confirm when done. The server
 * waits here until that completion signal arrives.
 */
export async function waitForToolCompletion(
  toolCallId: string,
  timeoutMs: number,
  abortSignal?: AbortSignal
): Promise<{ status: string; message?: string; data?: Record<string, unknown> } | null> {
  const decision = await waitForToolConfirmation(toolCallId, timeoutMs, abortSignal, {
    acceptStatus: (status) =>
      status === 'success' ||
      status === 'error' ||
      status === 'rejected' ||
      status === 'background' ||
      status === 'cancelled' ||
      status === 'delivered',
  })
  if (
    decision?.status === 'success' ||
    decision?.status === 'error' ||
    decision?.status === 'rejected' ||
    decision?.status === 'background' ||
    decision?.status === 'cancelled' ||
    decision?.status === 'delivered'
  ) {
    return decision
  }
  return null
}
