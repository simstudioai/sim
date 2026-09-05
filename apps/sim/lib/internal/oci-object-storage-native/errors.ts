import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { OciClientError } from '@/lib/internal/oci/errors'

export class OciNativeOperationError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message)
    this.name = 'OciNativeOperationError'
  }
}

/** Keep credential material, provider response bodies, and storage errors out of tool failures. */
export function normalizeOciNativeError(error: unknown): { status: number; message: string } {
  if (error instanceof OciNativeOperationError)
    return { status: error.status, message: error.message }
  if (isPayloadSizeLimitError(error))
    return { status: 413, message: 'File exceeds the 100 MiB transfer limit' }
  if (error instanceof OciClientError) {
    return {
      status:
        error.status ??
        (error.code === 'response_too_large'
          ? 413
          : error.code === 'deadline_exceeded'
            ? 504
            : 502),
      message: error.message,
    }
  }
  return { status: 500, message: 'OCI Object Storage operation failed' }
}
