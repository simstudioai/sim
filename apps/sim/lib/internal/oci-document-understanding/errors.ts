import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { OciClientError } from '@/lib/internal/oci/errors'

export class DocumentOperationError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message)
    this.name = 'DocumentOperationError'
  }
}

export function normalizeDocumentError(error: unknown) {
  if (error instanceof DocumentOperationError)
    return { status: error.status, message: error.message }
  if (error instanceof OciClientError)
    return {
      status: error.status ?? (error.code === 'credential_unavailable' ? 403 : 502),
      message: error.message,
      opcRequestId: error.opcRequestId,
    }
  if (isPayloadSizeLimitError(error))
    return { status: 413, message: 'Document transfer exceeded its byte limit' }
  return { status: 500, message: 'Document Understanding operation failed' }
}
