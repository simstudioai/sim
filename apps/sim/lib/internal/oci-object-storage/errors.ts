import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'

export class OciObjectStorageOperationError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'OciObjectStorageOperationError'
  }
}

function providerStatus(error: unknown): number | undefined {
  const metadata = error as { $metadata?: { httpStatusCode?: number } } | null | undefined
  return metadata?.$metadata?.httpStatusCode
}

export function normalizeOciObjectStorageError(error: unknown): OciObjectStorageOperationError {
  if (error instanceof OciObjectStorageOperationError) return error
  if (isPayloadSizeLimitError(error)) {
    if (error.label === 'OCI bucket listing') {
      return new OciObjectStorageOperationError('OCI bucket listing exceeds the Sim limit', 413)
    }
    return new OciObjectStorageOperationError('Object exceeds the 100 MiB transfer limit', 413)
  }

  const status = providerStatus(error)
  switch (status) {
    case 400:
      return new OciObjectStorageOperationError('Oracle Object Storage rejected the request', 400)
    case 401:
    case 403:
      return new OciObjectStorageOperationError(
        'The OCI credential is invalid or lacks permission for this operation',
        status
      )
    case 404:
      return new OciObjectStorageOperationError('The OCI bucket or object was not found', 404)
    case 408:
      return new OciObjectStorageOperationError('Oracle Object Storage timed out', 408)
    case 409:
      return new OciObjectStorageOperationError('Oracle Object Storage reported a conflict', 409)
    case 412:
      return new OciObjectStorageOperationError(
        'Oracle Object Storage rejected a precondition',
        412
      )
    case 429:
      return new OciObjectStorageOperationError('Oracle Object Storage rate limit exceeded', 429)
    default:
      return new OciObjectStorageOperationError(
        'Oracle Object Storage request failed',
        status && status >= 500 && status <= 599 ? 502 : 500
      )
  }
}
