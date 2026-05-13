import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isExecutionCancelled, isRedisCancellationEnabled } from '@/lib/execution/cancellation'
import { readUserFileContent } from '@/lib/execution/payloads/materialization.server'
import { createFileContent, type MessageContent } from '@/lib/uploads/utils/file-utils'
import type { BlockOutput } from '@/blocks/types'
import { normalizeFileInput } from '@/blocks/utils'
import { BlockType } from '@/executor/constants'
import type { BlockHandler, ExecutionContext, UserFile } from '@/executor/types'
import { buildAPIUrl, buildAuthHeaders, extractAPIErrorMessage } from '@/executor/utils/http'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('MothershipBlockHandler')
const CANCELLATION_CHECK_INTERVAL_MS = 500
const MAX_MOTHERSHIP_ATTACHMENT_BYTES = 10 * 1024 * 1024

type MothershipFileAttachment = MessageContent & {
  filename?: string
}

function toUserFile(file: object): UserFile {
  const candidate = file as Record<string, unknown>
  const key = typeof candidate.key === 'string' ? candidate.key : ''
  const name = typeof candidate.name === 'string' ? candidate.name : ''
  const url =
    typeof candidate.url === 'string'
      ? candidate.url
      : typeof candidate.path === 'string'
        ? candidate.path
        : key
  const size = typeof candidate.size === 'number' ? candidate.size : Number(candidate.size)
  const type = typeof candidate.type === 'string' ? candidate.type : ''
  const id = typeof candidate.id === 'string' ? candidate.id : key

  if (!id || !key || !name || !url || !Number.isFinite(size) || !type) {
    throw new Error('Mothership attachment must include file name, key, url/path, size, and type.')
  }

  return {
    id,
    key,
    name,
    url,
    size,
    type,
    ...(typeof candidate.context === 'string' ? { context: candidate.context } : {}),
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
    const userFile = toUserFile(file)
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

    const content = createFileContent(Buffer.from(base64, 'base64'), userFile.type)
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
  ): Promise<BlockOutput> {
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

    let response: Response
    try {
      response = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: abortController.signal,
      })
    } finally {
      if (cancellationPoller) {
        clearInterval(cancellationPoller)
      }
      ctx.abortSignal?.removeEventListener('abort', onAbort)
    }

    if (!response.ok) {
      const errorMsg = await extractAPIErrorMessage(response)
      throw new Error(`Mothership execution failed: ${errorMsg}`)
    }

    const result = await response.json()

    const formattedList = (result.toolCalls || []).map((tc: Record<string, unknown>) => ({
      name: tc.name,
      arguments: tc.params || {},
      result: tc.result,
      error: tc.error,
      duration: tc.durationMs || 0,
    }))
    const toolCalls = { list: formattedList, count: formattedList.length }

    return {
      content: result.content || '',
      model: result.model || 'mothership',
      conversationId: result.conversationId || chatId,
      tokens: result.tokens || {},
      toolCalls,
      cost: result.cost || undefined,
    }
  }
}
