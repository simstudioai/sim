import { interruptibleSleep } from '@sim/utils/helpers'
import { backoffWithJitter, parseRetryAfter } from '@sim/utils/retry'
import { stringifyBoundedJson } from '@/lib/core/utils/bounded-json'
import { consumeOrCancelBody, readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { PROVIDER_HEADERS_TIMEOUT_MS, PROVIDER_MAX_RETRIES } from '@/providers/transport'
import type { buildJevBody } from '@/providers/typesafe/schema'

const MAX_EVALUATION_RESPONSE_BYTES = 10 * 1024 * 1024
export const MAX_EVALUATION_REQUEST_BYTES = 10 * 1024 * 1024

class TypeSafeHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs: number | null
  ) {
    super(`TypeSafe evaluation failed (HTTP ${status})`)
    this.name = 'TypeSafeHttpError'
  }
}

export async function requestJevEvaluation(
  body: ReturnType<typeof buildJevBody>,
  apiKey: string,
  abortSignal?: AbortSignal
): Promise<unknown> {
  const payload = stringifyBoundedJson(body, MAX_EVALUATION_REQUEST_BYTES)
  if (payload === undefined) {
    throw new Error('TypeSafe evaluation request exceeds the size or JSON complexity limit')
  }
  for (let attempt = 0; ; attempt++) {
    abortSignal?.throwIfAborted()
    const timeout = AbortSignal.timeout(PROVIDER_HEADERS_TIMEOUT_MS)
    const signal = abortSignal ? AbortSignal.any([abortSignal, timeout]) : timeout
    let response: Response | undefined
    try {
      signal.throwIfAborted()
      response = await fetch('https://api.typesafe.ai/v1/systemone', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: payload,
        signal,
        redirect: 'error',
      })
      if (!response.ok) {
        await consumeOrCancelBody(response)
        throw new TypeSafeHttpError(
          response.status,
          parseRetryAfter(response.headers.get('retry-after'))
        )
      }
      return await readResponseJsonWithLimit(response, {
        maxBytes: MAX_EVALUATION_RESPONSE_BYTES,
        label: 'TypeSafe evaluation response',
        signal,
      })
    } catch (error) {
      abortSignal?.throwIfAborted()
      const retryable =
        error instanceof TypeSafeHttpError
          ? error.status === 408 || error.status === 429 || error.status >= 500
          : !response || timeout.aborted || error instanceof TypeError
      if (!retryable || attempt >= PROVIDER_MAX_RETRIES) throw error
      const retryAfterMs = error instanceof TypeSafeHttpError ? error.retryAfterMs : null
      await interruptibleSleep(backoffWithJitter(attempt + 1, retryAfterMs), abortSignal)
    }
  }
}
