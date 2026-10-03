import { createLogger } from '@sim/logger'
import {
  type A2AFileInput,
  agentCardOutput,
  buildUserMessage,
  createA2AClient,
  isTaskResult,
  messageOutput,
  taskErrored,
  taskOutput,
} from '@/lib/a2a/client'
import { assertKnownSizeWithinLimit } from '@/lib/core/utils/stream-limits'
import { validateOpaqueModelInputProvenance } from '@/lib/execution/model-input-provenance'
import { A2AOperationError } from '@/lib/internal/a2a/errors'
import type {
  A2ACancelTaskInput,
  A2AGetAgentCardInput,
  A2AGetTaskInput,
  A2ASendMessageInput,
} from '@/lib/internal/a2a/input'
import {
  isModelSafeWorkspaceFileKey,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'

const logger = createLogger('A2AOperations')
const A2A_MAX_FILE_BYTES = 10 * 1024 * 1024

export interface A2AOperationContext {
  headers: Headers
  requestId: string
  signal?: AbortSignal
  userId: string
}

async function resolveA2AFiles(
  input: A2ASendMessageInput,
  context: A2AOperationContext
): Promise<A2AFileInput[] | undefined> {
  if (!input.files?.length) return undefined
  const userFiles = processFilesToUserFiles(input.files, context.requestId, logger)
  const files: A2AFileInput[] = []
  let totalBytes = 0

  for (const userFile of userFiles) {
    context.signal?.throwIfAborted()
    const denied = await assertToolFileAccess(
      userFile.key,
      context.userId,
      context.requestId,
      logger
    )
    context.signal?.throwIfAborted()
    if (denied) {
      let message = 'File not found'
      try {
        const body = (await denied.json()) as { error?: unknown }
        if (typeof body.error === 'string') message = body.error
      } catch {}
      throw new A2AOperationError(message, denied.status)
    }
    if (!(await isModelSafeWorkspaceFileKey(userFile.key))) {
      throw new A2AOperationError(MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE, 400)
    }

    assertKnownSizeWithinLimit(userFile.size, A2A_MAX_FILE_BYTES, 'A2A attachment')
    const { buffer, contentType } = await downloadServableFileFromStorage(
      userFile,
      context.requestId,
      logger,
      { maxBytes: A2A_MAX_FILE_BYTES, signal: context.signal }
    )
    totalBytes += buffer.length
    assertKnownSizeWithinLimit(totalBytes, MAX_BUFFERED_TRANSFER_BYTES, 'Total A2A attachment size')
    files.push({
      bytes: buffer,
      name: userFile.name,
      mediaType: contentType || userFile.type || 'application/octet-stream',
    })
  }
  return files
}

export async function sendA2AMessage(input: A2ASendMessageInput, context: A2AOperationContext) {
  const provenance = validateOpaqueModelInputProvenance({
    headers: context.headers,
    payload: input,
    isInternalRequest: true,
  })
  if (!provenance.success) throw new A2AOperationError(provenance.error, provenance.status)

  let data: unknown
  if (input.data !== undefined) {
    if (typeof input.data === 'string') {
      try {
        data = JSON.parse(input.data)
      } catch {
        throw new A2AOperationError('Data must be valid JSON', 400)
      }
    } else {
      data = input.data
    }
  }

  const files = await resolveA2AFiles(input, context)
  const client = await createA2AClient(input.agentUrl, input.apiKey, { signal: context.signal })
  const message = buildUserMessage({
    text: input.message,
    data,
    files,
    taskId: input.taskId,
    contextId: input.contextId,
  })
  const result = await client.sendMessage({
    tenant: '',
    message,
    configuration: undefined,
    metadata: undefined,
  })
  context.signal?.throwIfAborted()

  if (!isTaskResult(result)) {
    logger.info(`[${context.requestId}] A2A send returned a direct message`)
    return { success: true as const, output: messageOutput(result) }
  }
  const output = taskOutput(result)
  const errored = taskErrored(result)
  logger.info(`[${context.requestId}] A2A send produced task ${result.id} (${output.state})`)
  return {
    success: !errored,
    ...(errored ? { error: output.content || `Agent task ${output.state}` } : {}),
    output,
  }
}

export async function getA2ATask(input: A2AGetTaskInput, context: A2AOperationContext) {
  const client = await createA2AClient(input.agentUrl, input.apiKey, { signal: context.signal })
  const task = await client.getTask({
    tenant: '',
    id: input.taskId,
    historyLength: input.historyLength,
  })
  context.signal?.throwIfAborted()
  logger.info(`[${context.requestId}] Retrieved A2A task ${task.id}`)
  return { success: true as const, output: taskOutput(task) }
}

export async function cancelA2ATask(input: A2ACancelTaskInput, context: A2AOperationContext) {
  const client = await createA2AClient(input.agentUrl, input.apiKey, { signal: context.signal })
  const task = await client.cancelTask({ tenant: '', id: input.taskId, metadata: undefined })
  context.signal?.throwIfAborted()
  const output = taskOutput(task)
  logger.info(`[${context.requestId}] Cancel requested for A2A task ${task.id}`)
  return {
    success: true as const,
    output: { taskId: output.taskId, state: output.state, canceled: output.state === 'canceled' },
  }
}

export async function getA2AAgentCard(input: A2AGetAgentCardInput, context: A2AOperationContext) {
  const client = await createA2AClient(input.agentUrl, input.apiKey, { signal: context.signal })
  const card = await client.getAgentCard()
  context.signal?.throwIfAborted()
  logger.info(`[${context.requestId}] Fetched agent card for ${card.name}`)
  return { success: true as const, output: agentCardOutput(card, input.agentUrl) }
}
