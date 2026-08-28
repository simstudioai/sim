import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { z } from 'zod'
import { getValidationErrorMessage } from '@/lib/api/server'
import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import {
  executeSftpDelete,
  executeSftpDownload,
  executeSftpList,
  executeSftpMkdir,
  executeSftpUpload,
  type SftpOperationContext,
} from '@/lib/internal/sftp/operations'
import {
  sftpDeleteInputSchema,
  sftpDownloadInputSchema,
  sftpListInputSchema,
  sftpMkdirInputSchema,
  sftpUploadInputSchema,
} from '@/lib/internal/sftp/schema'
import type {
  InternalToolOperationCall,
  InternalToolOperationHandler,
} from '@/lib/internal/tool-operations/types'

const logger = createLogger('SftpToolExecution')

async function executeParsed<S extends z.ZodType>(
  request: InternalToolOperationCall,
  schema: S,
  execute: (input: z.output<S>, context: SftpOperationContext) => Promise<Response>
): Promise<Response> {
  const parsed = schema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json(
      {
        error: getValidationErrorMessage(parsed.error, 'Invalid request data'),
        details: parsed.error.issues,
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

export const executeSftpTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  let serializedInput: string
  try {
    serializedInput = JSON.stringify(request.input) ?? ''
  } catch {
    return Response.json({ error: 'Invalid request data' }, { status: 400 })
  }
  if (Buffer.byteLength(serializedInput, 'utf8') > DEFAULT_MAX_JSON_BODY_BYTES) {
    return Response.json(
      {
        error: `Request body exceeds the maximum allowed size of ${DEFAULT_MAX_JSON_BODY_BYTES} bytes`,
      },
      { status: 413 }
    )
  }

  try {
    switch (request.toolId) {
      case 'sftp_delete':
        return executeParsed(request, sftpDeleteInputSchema, executeSftpDelete)
      case 'sftp_download':
        return executeParsed(request, sftpDownloadInputSchema, executeSftpDownload)
      case 'sftp_list':
        return executeParsed(request, sftpListInputSchema, executeSftpList)
      case 'sftp_mkdir':
        return executeParsed(request, sftpMkdirInputSchema, executeSftpMkdir)
      case 'sftp_upload':
        return executeParsed(request, sftpUploadInputSchema, executeSftpUpload)
      default:
        return Response.json(
          { success: false, error: `Unsupported SFTP tool: ${request.toolId}` },
          { status: 500 }
        )
    }
  } catch (error) {
    request.signal?.throwIfAborted()
    const message = getErrorMessage(error, 'Unknown error')
    logger.error('SFTP operation dispatch failed', {
      error: message,
      requestId: request.requestId,
      toolId: request.toolId,
    })
    return Response.json({ success: false, error: message }, { status: 500 })
  }
}
