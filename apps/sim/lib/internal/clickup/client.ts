import { MAX_JSON_API_RESPONSE_BYTES } from '@/lib/core/security/input-validation.server'
import { isPayloadSizeLimitError, readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { ClickUpOperationError } from '@/lib/internal/clickup/errors'
import {
  CLICKUP_API_BASE_URL,
  clickupAuthorizationHeader,
  extractClickUpErrorMessage,
} from '@/tools/clickup/shared'

export async function uploadClickUpAttachment(
  accessToken: string,
  taskId: string,
  formData: FormData,
  signal?: AbortSignal
): Promise<unknown> {
  signal?.throwIfAborted()
  const response = await fetch(
    `${CLICKUP_API_BASE_URL}/task/${encodeURIComponent(taskId)}/attachment`,
    {
      method: 'POST',
      headers: { Authorization: clickupAuthorizationHeader(accessToken) },
      body: formData,
      signal,
    }
  )
  let data: unknown
  try {
    data = await readResponseJsonWithLimit<unknown>(response, {
      maxBytes: MAX_JSON_API_RESPONSE_BYTES,
      label: 'ClickUp attachment response',
      signal,
    })
  } catch (error) {
    signal?.throwIfAborted()
    if (
      isPayloadSizeLimitError(error) &&
      error.observedBytes !== undefined &&
      error.observedBytes > error.maxBytes
    ) {
      throw new ClickUpOperationError('ClickUp attachment response exceeded the size limit', 413)
    }
    data = null
  }
  if (!response.ok) {
    throw new ClickUpOperationError(
      extractClickUpErrorMessage(response, data, 'Failed to upload ClickUp attachment'),
      response.status
    )
  }
  return data
}
