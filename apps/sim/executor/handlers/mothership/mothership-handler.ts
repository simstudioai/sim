import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isExecutionCancelled, isRedisCancellationEnabled } from '@/lib/execution/cancellation'
import { readUserFileContent } from '@/lib/execution/payloads/materialization.server'
import {
  createFileContentFromBase64,
  type MessageContent,
  processSingleFileToUserFile,
  type RawFileInput,
} from '@/lib/uploads/utils/file-utils'
import type { BlockOutput } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import { BlockType } from '@/executor/constants'
import type {
  BlockHandler,
  ExecutionContext,
  NormalizedBlockOutput,
  StreamingExecution,
} from '@/executor/types'
import { buildAPIUrl, buildAuthHeaders, extractAPIErrorMessage } from '@/executor/utils/http'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('MothershipBlockHandler')
const CANCELLATION_CHECK_INTERVAL_MS = 500
const MAX_MOTHERSHIP_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MOTHERSHIP_EXECUTE_STREAM_HEADER = 'X-Mothership-Execute-Stream'
const MOTHERSHIP_EXECUTE_STREAM_VALUE = 'ndjson'

type MothershipFileAttachment = MessageContent & {
  filename?: string
}

type MothershipExecuteResult = {
  content?: string
  model?: string
  conversationId?: string
  tokens?: Record<string, unknown>
  toolCalls?: Array<Record<string, unknown>>
  cost?: unknown
}

type MothershipExecuteStreamEvent =
  | { type: 'heartbeat'; timestamp?: string }
  | { type: 'chunk'; content?: string }
  | { type: 'final'; data: MothershipExecuteResult }
  | { type: 'error'; error?: string }

function parseMothershipExecuteStreamLine(line: string): MothershipExecuteStreamEvent | undefined {
  const trimmed = line.trim()
  if (!trimmed) return undefined

  try {
    return JSON.parse(trimmed) as MothershipExecuteStreamEvent
  } catch {
    throw new Error('Mothership execution stream returned malformed data')
  }
}

function formatMothershipBlockOutput(
  result: MothershipExecuteResult,
  fallbackChatId: string
): NormalizedBlockOutput {
  const formattedList = (result.toolCalls || []).map((tc: Record<string, unknown>) => ({
    name: typeof tc.name === 'string' ? tc.name : String(tc.name ?? ''),
    arguments: (tc.params && typeof tc.params === 'object' ? tc.params : {}) as Record<
      string,
      unknown
    >,
    result: tc.result as any,
    error: typeof tc.error === 'string' ? tc.error : undefined,
    duration: typeof tc.durationMs === 'number' ? tc.durationMs : 0,
  }))
  const toolCalls: NormalizedBlockOutput['toolCalls'] = {
    list: formattedList,
    count: formattedList.length,
  }

  return {
    content: result.content || '',
    model: result.model || 'mothership',
    conversationId: result.conversationId || fallbackChatId,
    tokens: (result.tokens || {}) as NormalizedBlockOutput['tokens'],
    toolCalls,
    cost: result.cost as NormalizedBlockOutput['cost'] | undefined,
  }
}

function isContentSelectedForStreaming(ctx: ExecutionContext, block: SerializedBlock): boolean {
  if (!ctx.stream) return false

  return (
    ctx.selectedOutputs?.some((outputId) => {
      if (outputId === block.id) return true
      return outputId === `${block.id}.content` || outputId === `${block.id}_content`
    }) ?? false
  )
}

async function readMothershipExecuteResponse(response: Response): Promise<MothershipExecuteResult> {
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/x-ndjson')) {
    return response.json()
  }

  if (!response.body) {
    throw new Error('Mothership execution stream ended without a response body')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finalResult: MothershipExecuteResult | undefined

  const processLine = (line: string) => {
    const event = parseMothershipExecuteStreamLine(line)
    if (!event) return

    if (event.type === 'heartbeat' || event.type === 'chunk') {
      return
    }

    if (event.type === 'error') {
      throw new Error(`Mothership execution failed: ${event.error || 'Unknown error'}`)
    }

    if (event.type === 'final') {
      finalResult = event.data
      return
    }

    throw new Error('Mothership execution stream returned an unknown event')
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        processLine(line)
      }
    }

    buffer += decoder.decode()
    processLine(buffer)

    if (!finalResult) {
      throw new Error('Mothership execution stream ended without a final result')
    }

    return finalResult
  } finally {
    reader.releaseLock()
  }
}

function createMothershipStreamingExecution(
  response: Response,
  fallbackChatId: string,
  blockId: string,
  options: {
    onCancel?: (reason?: unknown) => void
    onDone?: () => void
  } = {}
): StreamingExecution {
  if (!response.body) {
    throw new Error('Mothership execution stream ended without a response body')
  }

  const output = formatMothershipBlockOutput({}, fallbackChatId)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let cancelled = false
  let cleanedUp = false
  const cleanup = () => {
    if (cleanedUp) return
    cleanedUp = true
    options.onDone?.()
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      reader = response.body!.getReader()
      const decoder = new TextDecoder()
      const encoder = new TextEncoder()
      let buffer = ''
      let sawFinal = false

      const processLine = (line: string) => {
        const event = parseMothershipExecuteStreamLine(line)
        if (!event) return

        if (event.type === 'heartbeat') {
          return
        }

        if (event.type === 'chunk') {
          if (event.content) {
            controller.enqueue(encoder.encode(event.content))
          }
          return
        }

        if (event.type === 'error') {
          throw new Error(`Mothership execution failed: ${event.error || 'Unknown error'}`)
        }

        if (event.type === 'final') {
          sawFinal = true
          Object.assign(output, formatMothershipBlockOutput(event.data, fallbackChatId))
          return
        }

        throw new Error('Mothership execution stream returned an unknown event')
      }

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (cancelled) return
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            processLine(line)
          }
        }

        buffer += decoder.decode()
        processLine(buffer)

        if (!sawFinal) {
          throw new Error('Mothership execution stream ended without a final result')
        }

        if (!cancelled) {
          controller.close()
        }
      } catch (error) {
        if (!cancelled) {
          controller.error(error)
        }
      } finally {
        cleanup()
        reader?.releaseLock()
      }
    },
    cancel(reason) {
      cancelled = true
      options.onCancel?.(reason)
      cleanup()
      return reader?.cancel(reason)
    },
  })

  return {
    stream,
    execution: {
      success: true,
      output,
      blockId,
      logs: [],
      metadata: {
        duration: 0,
        startTime: new Date().toISOString(),
      },
      isStreaming: true,
    } as StreamingExecution['execution'] & { blockId: string },
  }
}

async function buildMothershipFileAttachments(
  filesInput: unknown,
  ctx: ExecutionContext,
  requestId: string
): Promise<MothershipFileAttachment[] | undefined> {
  const files = normalizeFileInput(filesInput)
  if (!files || files.length === 0) {
    return undefined
  }

  if (!ctx.userId) {
    throw new Error('Mothership file attachments require an authenticated user.')
  }

  const attachments: MothershipFileAttachment[] = []
  for (const file of files) {
    const userFile = processSingleFileToUserFile(file as RawFileInput, requestId, logger)
    const base64 = await readUserFileContent(userFile, {
      encoding: 'base64',
      userId: ctx.userId,
      workspaceId: ctx.workspaceId,
      workflowId: ctx.workflowId,
      executionId: ctx.executionId,
      largeValueExecutionIds: ctx.largeValueExecutionIds,
      allowLargeValueWorkflowScope: ctx.allowLargeValueWorkflowScope,
      requestId,
      logger,
      maxBytes: MAX_MOTHERSHIP_ATTACHMENT_BYTES,
      maxSourceBytes: MAX_MOTHERSHIP_ATTACHMENT_BYTES,
    })

    const content = createFileContentFromBase64(base64, userFile.type)
    if (!content) {
      throw new Error(`File type is not supported for Mothership attachments: ${userFile.name}`)
    }

    attachments.push({ ...content, filename: userFile.name })
  }

  return attachments
}

/**
 * Handler for Mothership blocks that proxy requests to the Mothership AI agent.
 *
 * Unlike the Agent block (which calls LLM providers directly), the Mothership
 * block delegates to the full Mothership infrastructure: main agent, subagents,
 * integration tools, memory, and workspace context.
 */
export class MothershipBlockHandler implements BlockHandler {
  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.MOTHERSHIP
  }

  async execute(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<BlockOutput | StreamingExecution> {
    const prompt = inputs.prompt
    if (!prompt || typeof prompt !== 'string') {
      throw new Error('Prompt input is required')
    }
    const messages = [{ role: 'user' as const, content: prompt }]
    const providedConversationId =
      typeof inputs.conversationId === 'string' ? inputs.conversationId.trim() : ''
    const chatId = providedConversationId || generateId()
    const messageId = generateId()
    const requestId = generateId()
    const fileAttachments = await buildMothershipFileAttachments(inputs.files, ctx, requestId)

    const url = buildAPIUrl('/api/mothership/execute')
    const headers = await buildAuthHeaders(ctx.userId)
    headers.Accept = 'application/x-ndjson'
    headers[MOTHERSHIP_EXECUTE_STREAM_HEADER] = MOTHERSHIP_EXECUTE_STREAM_VALUE

    const body: Record<string, unknown> = {
      messages,
      workspaceId: ctx.workspaceId || '',
      userId: ctx.userId || '',
      chatId,
      messageId,
      requestId,
      ...(fileAttachments && { fileAttachments }),
      ...(ctx.workflowId ? { workflowId: ctx.workflowId } : {}),
      ...(ctx.executionId ? { executionId: ctx.executionId } : {}),
    }

    logger.info('Executing Mothership block', {
      blockId: block.id,
      messageId,
      requestId,
      workflowId: ctx.workflowId,
      executionId: ctx.executionId,
      chatId,
      fileAttachmentCount: fileAttachments?.length ?? 0,
    })

    const abortController = new AbortController()
    const onAbort = () => {
      if (!abortController.signal.aborted) {
        abortController.abort(ctx.abortSignal?.reason ?? 'workflow_abort')
      }
    }

    if (ctx.abortSignal?.aborted) {
      onAbort()
    } else {
      ctx.abortSignal?.addEventListener('abort', onAbort, { once: true })
    }

    const executionId = ctx.executionId
    const useRedisCancellation = isRedisCancellationEnabled() && !!executionId
    let pollInFlight = false
    const cancellationPoller =
      useRedisCancellation && executionId
        ? setInterval(() => {
            if (pollInFlight || abortController.signal.aborted) {
              return
            }
            pollInFlight = true
            void isExecutionCancelled(executionId)
              .then((cancelled) => {
                if (cancelled && !abortController.signal.aborted) {
                  abortController.abort('workflow_execution_cancelled')
                }
              })
              .catch((error) => {
                logger.warn('Failed to poll workflow cancellation for Mothership block', {
                  blockId: block.id,
                  executionId,
                  error: toError(error).message,
                })
              })
              .finally(() => {
                pollInFlight = false
              })
          }, CANCELLATION_CHECK_INTERVAL_MS)
        : undefined
    const cleanupAbortListeners = () => {
      if (cancellationPoller) {
        clearInterval(cancellationPoller)
      }
      ctx.abortSignal?.removeEventListener('abort', onAbort)
    }

    let response: Response
    let cleanupImmediately = true
    try {
      response = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: abortController.signal,
      })

      if (!response.ok) {
        const errorMsg = await extractAPIErrorMessage(response)
        throw new Error(`Mothership execution failed: ${errorMsg}`)
      }

      if (isContentSelectedForStreaming(ctx, block)) {
        const streamingExecution = createMothershipStreamingExecution(response, chatId, block.id, {
          onCancel: (reason) => {
            if (!abortController.signal.aborted) {
              abortController.abort(reason ?? 'mothership_stream_cancelled')
            }
          },
          onDone: cleanupAbortListeners,
        })
        cleanupImmediately = false
        return streamingExecution
      }

      const result = await readMothershipExecuteResponse(response)
      return formatMothershipBlockOutput(result, chatId)
    } finally {
      if (cleanupImmediately) {
        cleanupAbortListeners()
      }
    }
  }
}
