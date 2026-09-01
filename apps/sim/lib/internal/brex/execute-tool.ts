import { getErrorMessage } from '@sim/utils/errors'
import type { z } from 'zod'
import { getValidationErrorMessage } from '@/lib/api/server'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import {
  type BrexReceiptOperationContext,
  executeBrexMatchReceipt,
  executeBrexUploadReceipt,
} from '@/lib/internal/brex/operations'
import {
  brexMatchReceiptInputSchema,
  brexUploadReceiptInputSchema,
} from '@/lib/internal/brex/schema'
import type {
  InternalToolOperationCall,
  InternalToolOperationHandler,
} from '@/lib/internal/tool-operations/types'

async function executeParsed<S extends z.ZodType>(
  request: InternalToolOperationCall,
  schema: S,
  execute: (input: z.output<S>, context: BrexReceiptOperationContext) => Promise<Response>
): Promise<Response> {
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
  const parsed = schema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json(
      { success: false, error: getValidationErrorMessage(parsed.error, 'Invalid request data') },
      { status: 400 }
    )
  }
  const userId = request.context.userId
  if (!userId) {
    return Response.json({ success: false, error: 'Authentication required' }, { status: 401 })
  }
  const response = await execute(parsed.data, {
    userId,
    requestId: request.requestId,
    signal: request.signal,
  })
  request.signal?.throwIfAborted()
  return response
}

export const executeBrexTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (!request.context.userId) {
    return Response.json({ success: false, error: 'Authentication required' }, { status: 401 })
  }
  try {
    switch (request.toolId) {
      case 'brex_match_receipt':
        return await executeParsed(request, brexMatchReceiptInputSchema, executeBrexMatchReceipt)
      case 'brex_upload_receipt':
        return await executeParsed(request, brexUploadReceiptInputSchema, executeBrexUploadReceipt)
      default:
        return Response.json(
          { success: false, error: `Unsupported Brex tool: ${request.toolId}` },
          { status: 500 }
        )
    }
  } catch (error) {
    request.signal?.throwIfAborted()
    return Response.json(
      { success: false, error: getErrorMessage(error, 'Unknown error') },
      { status: 500 }
    )
  }
}
