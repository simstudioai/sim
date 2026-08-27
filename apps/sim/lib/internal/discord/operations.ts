import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { validateNumericId } from '@/lib/core/security/input-validation'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { sendDiscordMessage } from '@/lib/internal/discord/client'
import { DiscordOperationError } from '@/lib/internal/discord/errors'
import type { DiscordSendMessageInput } from '@/lib/internal/discord/schema'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { docNotReadyMessage, isDocNotReadyError } from '@/lib/uploads/utils/doc-not-ready'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadServableFilesWithinBudget } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'

const logger = createLogger('DiscordOperations')

export interface DiscordOperationContext {
  requestId: string
  signal?: AbortSignal
  userId: string
}

async function deniedBody(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json().catch(() => null)
  return isRecordLike(body) ? body : { success: false, error: 'File not found' }
}

async function textMessage(input: DiscordSendMessageInput, signal?: AbortSignal) {
  const data = await sendDiscordMessage(
    input.botToken,
    input.channelId,
    JSON.stringify({ content: input.content || '' }),
    'json',
    signal
  )
  return {
    success: true,
    output: { message: typeof data.content === 'string' ? data.content : undefined, data },
  }
}

export async function executeDiscordSendMessage(
  input: DiscordSendMessageInput,
  context: DiscordOperationContext
) {
  context.signal?.throwIfAborted()
  const channelIdValidation = validateNumericId(input.channelId, 'channelId')
  if (!channelIdValidation.isValid) {
    throw new DiscordOperationError(channelIdValidation.error || 'Invalid channelId', 400)
  }
  if (!input.files || input.files.length === 0) return textMessage(input, context.signal)

  const userFiles = processFilesToUserFiles(input.files, context.requestId, logger)
  if (userFiles.length === 0) return textMessage(input, context.signal)
  for (const file of userFiles) {
    context.signal?.throwIfAborted()
    const denied = await assertToolFileAccess(file.key, context.userId, context.requestId, logger)
    context.signal?.throwIfAborted()
    if (denied) {
      throw new DiscordOperationError('File not found', denied.status, await deniedBody(denied))
    }
  }

  let resolved: Awaited<ReturnType<typeof downloadServableFilesWithinBudget>>
  try {
    resolved = await downloadServableFilesWithinBudget(userFiles, context.requestId, logger, {
      totalMaxBytes: MAX_BUFFERED_TRANSFER_BYTES,
      label: 'Total attachment size',
      signal: context.signal,
    })
  } catch (error) {
    context.signal?.throwIfAborted()
    if (isDocNotReadyError(error)) {
      throw new DiscordOperationError(docNotReadyMessage(), 409)
    }
    const message = `Failed to download attachment: ${getErrorMessage(error, 'Unknown error')}`
    throw new DiscordOperationError(message, isPayloadSizeLimitError(error) ? 413 : 500)
  }

  const formData = new FormData()
  formData.append('payload_json', JSON.stringify({ content: input.content || '' }))
  const files = userFiles.map((file, index) => {
    const downloaded = resolved[index]
    if (!downloaded)
      throw new DiscordOperationError('Failed to download attachment: Missing file data', 500)
    const mimeType = downloaded.contentType || file.type || 'application/octet-stream'
    formData.append(
      `files[${index}]`,
      new Blob([new Uint8Array(downloaded.buffer)], { type: mimeType }),
      file.name
    )
    return {
      name: file.name,
      mimeType,
      data: downloaded.buffer.toString('base64'),
      size: downloaded.buffer.length,
    }
  })
  const data = await sendDiscordMessage(
    input.botToken,
    input.channelId,
    formData,
    'multipart',
    context.signal
  )
  return {
    success: true,
    output: {
      message: typeof data.content === 'string' ? data.content : undefined,
      data,
      fileCount: userFiles.length,
      files,
    },
  }
}
