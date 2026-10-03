import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { z } from 'zod'
import { getValidationErrorMessage } from '@/lib/api/server'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import type {
  InternalToolOperationCall,
  InternalToolOperationHandler,
} from '@/lib/internal/tool-operations/types'
import {
  executeWhatsAppGetMedia,
  executeWhatsAppSendMedia,
  executeWhatsAppUploadMedia,
  type WhatsAppOperationContext,
} from '@/lib/internal/whatsapp/operations'
import {
  whatsappGetMediaInputSchema,
  whatsappSendMediaInputSchema,
  whatsappUploadMediaInputSchema,
} from '@/lib/internal/whatsapp/schema'

const logger = createLogger('WhatsAppToolExecution')

async function executeParsed<S extends z.ZodType>(
  request: InternalToolOperationCall,
  schema: S,
  execute: (input: z.output<S>, context: WhatsAppOperationContext) => Promise<Response>
): Promise<Response> {
  const parsed = schema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json(
      {
        success: false,
        error: getValidationErrorMessage(parsed.error, 'Invalid request data'),
      },
      { status: 400 }
    )
  }
  const userId = request.context.userId
  if (!userId) {
    return Response.json({ success: false, error: 'Authentication required' }, { status: 401 })
  }
  return execute(parsed.data, {
    userId,
    requestId: request.requestId,
    workspaceId: request.context.workspaceId,
    workflowId: request.context.workflowId,
    executionId: request.context.executionId,
    signal: request.signal,
  })
}

export const executeWhatsAppTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  let serializedInput: string
  try {
    serializedInput = JSON.stringify(request.input) ?? ''
  } catch {
    return Response.json({ success: false, error: 'Invalid request data' }, { status: 400 })
  }
  if (Buffer.byteLength(serializedInput, 'utf8') > DEFAULT_MAX_JSON_BODY_BYTES) {
    return Response.json(
      {
        success: false,
        error: `Request body exceeds the maximum allowed size of ${DEFAULT_MAX_JSON_BODY_BYTES} bytes`,
      },
      { status: 413 }
    )
  }

  try {
    switch (request.toolId) {
      case 'whatsapp_get_media':
        return executeParsed(request, whatsappGetMediaInputSchema, executeWhatsAppGetMedia)
      case 'whatsapp_send_media':
        return executeParsed(request, whatsappSendMediaInputSchema, executeWhatsAppSendMedia)
      case 'whatsapp_upload_media':
        return executeParsed(request, whatsappUploadMediaInputSchema, executeWhatsAppUploadMedia)
      default:
        return Response.json(
          { success: false, error: `Unsupported WhatsApp tool: ${request.toolId}` },
          { status: 500 }
        )
    }
  } catch (error) {
    request.signal?.throwIfAborted()
    const message = getErrorMessage(error, 'Unknown error')
    logger.error('WhatsApp operation dispatch failed', {
      error: message,
      requestId: request.requestId,
      toolId: request.toolId,
    })
    return Response.json({ success: false, error: message }, { status: 500 })
  }
}
