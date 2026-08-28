import { getErrorMessage } from '@sim/utils/errors'
import type { z } from 'zod'
import { getValidationErrorMessage } from '@/lib/api/server'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import {
  executeSharePointDownloadFile,
  executeSharePointUploadFile,
  type SharePointOperationContext,
} from '@/lib/internal/sharepoint/operations'
import {
  sharePointDownloadFileInputSchema,
  sharePointUploadFileInputSchema,
} from '@/lib/internal/sharepoint/schema'
import type {
  InternalToolOperationCall,
  InternalToolOperationHandler,
} from '@/lib/internal/tool-operations/types'

async function executeParsed<S extends z.ZodType>(
  request: InternalToolOperationCall,
  schema: S,
  execute: (input: z.output<S>, context: SharePointOperationContext) => Promise<Response>
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
    signal: request.signal,
  })
}

export const executeSharePointTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (!request.context.userId) {
    return Response.json({ success: false, error: 'Authentication required' }, { status: 401 })
  }
  try {
    switch (request.toolId) {
      case 'sharepoint_download_file':
        return executeParsed(
          request,
          sharePointDownloadFileInputSchema,
          executeSharePointDownloadFile
        )
      case 'sharepoint_upload_file':
        return executeParsed(request, sharePointUploadFileInputSchema, executeSharePointUploadFile)
      default:
        return Response.json(
          { success: false, error: `Unsupported SharePoint tool: ${request.toolId}` },
          { status: 500 }
        )
    }
  } catch (error) {
    request.signal?.throwIfAborted()
    return Response.json(
      { success: false, error: getErrorMessage(error, 'Unknown error occurred') },
      { status: 500 }
    )
  }
}
