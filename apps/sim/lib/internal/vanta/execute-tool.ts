import { getErrorMessage } from '@sim/utils/errors'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import { VantaOperationError } from '@/lib/internal/vanta/errors'
import {
  vantaDownloadDocumentFileInputSchema,
  vantaUploadDocumentFileInputSchema,
} from '@/lib/internal/vanta/input'
import {
  executeVantaDownloadDocumentFile,
  executeVantaQuery,
  executeVantaUploadDocumentFile,
} from '@/lib/internal/vanta/operations'
import { vantaQueryBodySchema } from '@/lib/internal/vanta/schema'

/** Executes the Vanta tool family without a same-origin HTTP hop. */
export const executeVantaTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  const schema =
    request.toolId === 'vanta_upload_document_file'
      ? vantaUploadDocumentFileInputSchema
      : request.toolId === 'vanta_download_document_file'
        ? vantaDownloadDocumentFileInputSchema
        : vantaQueryBodySchema
  const parsed = schema.safeParse(request.input)
  if (!parsed.success) {
    return Response.json({ success: false, error: 'Validation error' }, { status: 400 })
  }

  try {
    if (
      request.toolId === 'vanta_upload_document_file' ||
      request.toolId === 'vanta_download_document_file'
    ) {
      const userId = request.context.userId
      if (!userId) {
        return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 })
      }
      const context = { requestId: request.requestId, signal: request.signal, userId }
      const result =
        request.toolId === 'vanta_upload_document_file'
          ? await executeVantaUploadDocumentFile(
              vantaUploadDocumentFileInputSchema.parse(parsed.data),
              context
            )
          : await executeVantaDownloadDocumentFile(
              vantaDownloadDocumentFileInputSchema.parse(parsed.data),
              context
            )
      request.signal?.throwIfAborted()
      return Response.json(result)
    }

    const query = vantaQueryBodySchema.parse(parsed.data)
    if (query.operation !== request.toolId) {
      return Response.json(
        {
          success: false,
          error: `Vanta operation ${query.operation} does not match ${request.toolId}`,
        },
        { status: 400 }
      )
    }
    const result = await executeVantaQuery(query, request.signal)
    request.signal?.throwIfAborted()
    return result.success
      ? Response.json({ success: true, output: result.output })
      : Response.json({ success: false, error: result.error }, { status: result.status })
  } catch (error) {
    request.signal?.throwIfAborted()
    if (error instanceof VantaOperationError) {
      return Response.json(error.body, { status: error.status })
    }
    return Response.json(
      { success: false, error: getErrorMessage(error, 'Vanta request failed') },
      { status: 500 }
    )
  }
}
