import { getErrorMessage } from '@sim/utils/errors'
import { z } from 'zod'
import { TelegramOperationError } from '@/lib/internal/telegram/errors'
import { sendTelegramDocument } from '@/lib/internal/telegram/operations'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import { RawFileInputArraySchema } from '@/lib/uploads/utils/file-schemas'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'

const inputSchema = z.object({
  botToken: z.string().min(1, 'Bot token is required'),
  chatId: z.string().min(1, 'Chat ID is required'),
  files: RawFileInputArraySchema.optional().nullable(),
  caption: z.string().optional().nullable(),
})

export const executeTelegramTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (request.toolId !== 'telegram_send_document') {
    return Response.json(
      { success: false, error: `Unsupported Telegram tool: ${request.toolId}` },
      { status: 500 }
    )
  }
  const userId = request.context.userId
  if (!userId) {
    return Response.json({ success: false, error: 'Authentication required' }, { status: 401 })
  }
  const parsed = inputSchema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json({ success: false, error: 'Invalid request data' }, { status: 400 })
  }
  try {
    return Response.json(
      await sendTelegramDocument(parsed.data, {
        userId,
        requestId: request.requestId,
        signal: request.signal,
      })
    )
  } catch (error) {
    request.signal?.throwIfAborted()
    const notReady = docNotReadyResponse(error)
    if (notReady) return notReady
    const status = error instanceof TelegramOperationError ? error.status : 500
    return Response.json(
      { success: false, error: getErrorMessage(error, 'Unknown error occurred') },
      { status }
    )
  }
}
