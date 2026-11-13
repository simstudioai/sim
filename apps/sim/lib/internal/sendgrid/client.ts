import { toRecord } from '@sim/utils/object'
import { consumeOrCancelBody, readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { SendGridOperationError } from '@/lib/internal/sendgrid/errors'
import { SENDGRID_REGIONS } from '@/tools/sendgrid/utils'

const MAX_SENDGRID_ERROR_BYTES = 64 * 1024

function record(value: unknown): Record<string, unknown> {
  return toRecord(value)
}

function errorMessage(value: unknown): string {
  const root = record(value)
  const errors = Array.isArray(root.errors) ? root.errors : []
  const first = record(errors[0])
  if (typeof first.message === 'string') return first.message
  if (typeof root.message === 'string') return root.message
  return 'Failed to send email'
}

/** Sends one mail with a SendGrid key through the API host of its region (global or eu). */
export async function sendSendGridMail(
  apiKey: string,
  region: string | undefined,
  body: Record<string, unknown>,
  signal?: AbortSignal
): Promise<string | undefined> {
  signal?.throwIfAborted()
  const response = await fetch(`${SENDGRID_REGIONS.apiBase(region)}/mail/send`, {
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
      maxBytes: MAX_SENDGRID_ERROR_BYTES,
      label: 'SendGrid error response',
      signal,
    }).catch(() => {
      signal?.throwIfAborted()
      return {}
    })
    signal?.throwIfAborted()
    throw new SendGridOperationError(errorMessage(error), response.status)
  }
  await consumeOrCancelBody(response)
  signal?.throwIfAborted()
  return response.headers.get('X-Message-Id') || undefined
}
