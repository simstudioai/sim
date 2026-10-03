import { OciClientError } from '@/lib/internal/oci/errors'

export class OciVisionOperationError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message)
    this.name = 'OciVisionOperationError'
  }
}

export function normalizeOciVisionError(error: unknown) {
  if (error instanceof OciVisionOperationError) {
    return { message: error.message, status: error.status }
  }
  if (error instanceof OciClientError) {
    return {
      message: error.message,
      status: error.status ?? (error.code === 'credential_unavailable' ? 403 : 502),
      code: error.code,
      opcRequestId: error.opcRequestId,
    }
  }
  return { message: 'OCI Vision operation failed', status: 500 }
}
