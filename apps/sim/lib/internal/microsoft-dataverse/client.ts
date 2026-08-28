import { isRecordLike } from '@sim/utils/object'
import {
  MAX_JSON_API_RESPONSE_BYTES,
  secureFetchWithValidation,
} from '@/lib/core/security/input-validation.server'
import { consumeOrCancelBody } from '@/lib/core/utils/stream-limits'
import { DataverseOperationError } from '@/lib/internal/microsoft-dataverse/errors'

export async function uploadDataverseFile(
  input: {
    accessToken: string
    fileName: string
    uploadUrl: string
  },
  buffer: Buffer,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted()
  const response = await secureFetchWithValidation(
    input.uploadUrl,
    {
      profile: 'contentFetch',
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/octet-stream',
        'OData-MaxVersion': '4.0',
        'OData-Version': '4.0',
        'x-ms-file-name': input.fileName,
      },
      body: buffer,
      maxResponseBytes: MAX_JSON_API_RESPONSE_BYTES,
      signal,
      stripAuthOnRedirect: true,
    },
    'environmentUrl'
  )
  if (response.ok) {
    await consumeOrCancelBody(response)
    return
  }
  const data = await response.json().catch(() => null)
  const error = isRecordLike(data) && isRecordLike(data.error) ? data.error : null
  const message =
    error && typeof error.message === 'string'
      ? error.message
      : `Dataverse API error: ${response.status} ${response.statusText}`
  throw new DataverseOperationError(message, response.status)
}
