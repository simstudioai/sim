import { isRecordLike } from '@sim/utils/object'
import { MAX_JSON_API_RESPONSE_BYTES } from '@/lib/core/security/input-validation.server'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { ResendOperationError } from '@/lib/internal/resend/errors'

const MAX_RESEND_ERROR_BYTES = 64 * 1024

function record(value: unknown): Record<string, unknown> {
  return isRecordLike(value) ? value : {}
}

function message(value: unknown): string {
  const data = record(value)
  return typeof data.message === 'string' ? data.message : 'Unknown error'
}

export async function sendResendEmail(
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<Record<string, unknown>> {
  signal?.throwIfAborted()
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  })
  signal?.throwIfAborted()

  if (!response.ok) {
    const error = await readResponseJsonWithLimit(response, {
      maxBytes: MAX_RESEND_ERROR_BYTES,
      label: 'Resend error response',
      signal,
    }).catch(() => {
      signal?.throwIfAborted()
      return {}
    })
    signal?.throwIfAborted()
    const errorMessage = `Failed to send email: ${message(error)}`
    throw new ResendOperationError(errorMessage, 500, {
      success: false,
      message: errorMessage,
    })
  }

  const result = await readResponseJsonWithLimit(response, {
    maxBytes: MAX_JSON_API_RESPONSE_BYTES,
    label: 'Resend send response',
    signal,
  })
  signal?.throwIfAborted()
  return record(result)
}
