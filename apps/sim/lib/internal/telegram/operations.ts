import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { isPayloadSizeLimitError, readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { TelegramOperationError } from '@/lib/internal/telegram/errors'
import type { RawFileInput } from '@/lib/uploads/utils/file-schemas'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import type { TelegramSendDocumentResponse } from '@/tools/telegram/types'
import { convertMarkdownToHTML } from '@/tools/telegram/utils'

const logger = createLogger('TelegramSendDocumentOperation')
const MAX_TELEGRAM_DOCUMENT_BYTES = 50 * 1024 * 1024
const MAX_TELEGRAM_RESPONSE_BYTES = 2 * 1024 * 1024

export interface TelegramSendDocumentInput {
  botToken: string
  chatId: string
  files?: RawFileInput[] | null
  caption?: string | null
}

export interface TelegramOperationContext {
  userId: string
  requestId: string
  signal?: AbortSignal
}

interface TelegramApiResponse {
  ok?: boolean
  description?: string
  result?: TelegramSendDocumentResponse['output']['data']
}

export async function sendTelegramDocument(
  input: TelegramSendDocumentInput,
  context: TelegramOperationContext
): Promise<TelegramSendDocumentResponse> {
  context.signal?.throwIfAborted()
  if (!input.files?.length) {
    throw new TelegramOperationError(
      'At least one document file is required for sendDocument operation',
      400
    )
  }
  const userFiles = processFilesToUserFiles(input.files, context.requestId, logger)
  if (!userFiles.length) throw new TelegramOperationError('No valid files provided for upload', 400)
  const tooLarge = userFiles.filter((file) => file.size > MAX_TELEGRAM_DOCUMENT_BYTES)
  if (tooLarge.length) {
    const details = tooLarge
      .map((file) => `${file.name} (${(file.size / (1024 * 1024)).toFixed(2)}MB)`)
      .join(', ')
    throw new TelegramOperationError(
      `The following files exceed Telegram's 50MB limit: ${details}`,
      400
    )
  }

  const userFile = userFiles[0]
  const denied = await assertToolFileAccess(userFile.key, context.userId, context.requestId, logger)
  if (denied) throw new TelegramOperationError('File not found', denied.status)

  let buffer: Buffer
  let contentType: string
  try {
    const downloaded = await downloadServableFileFromStorage(userFile, context.requestId, logger, {
      maxBytes: MAX_TELEGRAM_DOCUMENT_BYTES,
    })
    buffer = downloaded.buffer
    contentType = downloaded.contentType
  } catch (error) {
    if (isPayloadSizeLimitError(error)) {
      const sizeMB = ((error.observedBytes ?? userFile.size) / (1024 * 1024)).toFixed(2)
      throw new TelegramOperationError(
        `The following files exceed Telegram's 50MB limit: ${userFile.name} (${sizeMB}MB)`,
        400
      )
    }
    throw error
  }
  context.signal?.throwIfAborted()
  if (buffer.length > MAX_TELEGRAM_DOCUMENT_BYTES) {
    const sizeMB = (buffer.length / (1024 * 1024)).toFixed(2)
    throw new TelegramOperationError(
      `The following files exceed Telegram's 50MB limit: ${userFile.name} (${sizeMB}MB)`,
      400
    )
  }

  const mimeType = contentType || userFile.type || 'application/octet-stream'
  const form = new FormData()
  form.append('chat_id', input.chatId)
  form.append('document', new Blob([new Uint8Array(buffer)], { type: mimeType }), userFile.name)
  if (input.caption) {
    form.append('caption', convertMarkdownToHTML(input.caption))
    form.append('parse_mode', 'HTML')
  }

  const response = await fetch(
    `https://api.telegram.org/bot${encodeURIComponent(input.botToken)}/sendDocument`,
    { method: 'POST', body: form, signal: context.signal }
  )
  const data = await readResponseJsonWithLimit<TelegramApiResponse>(response, {
    maxBytes: MAX_TELEGRAM_RESPONSE_BYTES,
    label: 'Telegram send document response',
    signal: context.signal,
  }).catch((error) => {
    context.signal?.throwIfAborted()
    throw new TelegramOperationError(
      getErrorMessage(error, 'Failed to read Telegram response'),
      response.status || 500
    )
  })
  if (!data.ok) {
    throw new TelegramOperationError(
      data.description || 'Failed to send document to Telegram',
      response.status
    )
  }

  return {
    success: true,
    output: {
      message: 'Document sent successfully',
      data: data.result,
      files: [
        {
          name: userFile.name,
          mimeType,
          data: buffer.toString('base64'),
          size: buffer.length,
        },
      ],
    },
  }
}
