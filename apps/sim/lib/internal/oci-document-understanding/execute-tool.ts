import { createLogger } from '@sim/logger'
import { isPlainRecord } from '@sim/utils/object'
import { normalizeDocumentError } from '@/lib/internal/oci-document-understanding/errors'
import { executeDocumentOperation } from '@/lib/internal/oci-document-understanding/operations'
import {
  DOCUMENT_OPERATIONS,
  documentInputSchema,
} from '@/lib/internal/oci-document-understanding/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'
import {
  DOCUMENT_INPUT_BYTES,
  DOCUMENT_OUTPUT_BYTES,
  isDocumentJsonWithinLimit,
} from '@/tools/oci_document_understanding/shared'

const logger = createLogger('OciDocumentExecution')
const PREFIX = 'oci_document_understanding_'

export const executeOciDocumentTool: InternalToolOperationHandler = async (request) => {
  let dispatched = false
  let retryToken: string | undefined
  try {
    request.signal?.throwIfAborted()
    const operation = request.toolId.startsWith(PREFIX) ? request.toolId.slice(PREFIX.length) : ''
    if (
      !DOCUMENT_OPERATIONS.some((value) => value === operation) ||
      !isPlainRecord(request.input) ||
      'operation' in request.input
    ) {
      return Response.json(
        { success: false, error: 'Invalid Document Understanding operation', retryable: false },
        { status: 400 }
      )
    }
    if (!isDocumentJsonWithinLimit(request.input, DOCUMENT_INPUT_BYTES)) {
      return Response.json(
        { success: false, error: 'Document input exceeds 1 MiB', retryable: false },
        { status: 413 }
      )
    }
    const parsed = documentInputSchema.safeParse({ ...request.input, operation })
    if (!parsed.success)
      return Response.json(
        {
          success: false,
          error:
            'Invalid Document Understanding parameters: check the selected operation’s fields and limits',
          retryable: false,
        },
        { status: 400 }
      )
    if (!request.context.workspaceId)
      return Response.json(
        { success: false, error: 'Workspace context is required', retryable: false },
        { status: 403 }
      )
    const result = await executeDocumentOperation(parsed.data, {
      ...request,
      onMutationDispatch: (token) => {
        dispatched = true
        retryToken = token
      },
    })
    if (!isDocumentJsonWithinLimit(result, DOCUMENT_OUTPUT_BYTES)) {
      throw new Error('Document output exceeded its envelope budget')
    }
    return Response.json(result)
  } catch (error) {
    const normalized = normalizeDocumentError(error)
    logger.warn('Document Understanding operation failed', {
      requestId: request.requestId,
      toolId: request.toolId,
      status: normalized.status,
      dispatched,
    })
    return Response.json(
      {
        success: false,
        error: normalized.message,
        ...('opcRequestId' in normalized ? { opcRequestId: normalized.opcRequestId } : {}),
        ...(dispatched
          ? {
              retryable: false,
              outcomeMayHaveOccurred: true,
              ...(retryToken ? { retryToken } : {}),
            }
          : {}),
      },
      { status: normalized.status }
    )
  }
}
