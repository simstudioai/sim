import { parseRetryAfter } from '@sim/utils/retry'
import {
  isRetryableError,
  readBoundedHttpErrorPayload,
  retryWithExponentialBackoff,
} from '@/lib/knowledge/documents/utils'

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504])
const TOKEN_EXCHANGE_BUDGET_MS = 30_000

interface GoogleTokenExchangeResponse {
  ok: boolean
  status: number
  body: string
}

/** Keeps provider bodies and JWT assertions out of retry diagnostics. */
class TokenExchangeRetryError extends Error {
  readonly status: number
  readonly retryAfterMs?: number

  constructor(response: Response) {
    super(`Google service account token exchange failed (HTTP ${response.status})`)
    this.status = response.status
    this.retryAfterMs =
      parseRetryAfter(response.headers.get('Retry-After'), Number.POSITIVE_INFINITY) ?? undefined
  }
}

/** Bounds token attempts and response consumption without changing final HTTP error classification. */
export async function exchangeGoogleServiceAccountJwt(
  tokenUri: string,
  jwt: string,
  signal?: AbortSignal
): Promise<GoogleTokenExchangeResponse> {
  let lastResponse: GoogleTokenExchangeResponse | undefined
  try {
    return await retryWithExponentialBackoff(
      async (attemptSignal) => {
        lastResponse = undefined
        const response = await fetch(tokenUri, {
          method: 'POST',
          redirect: 'error',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwt,
          }),
          signal: attemptSignal,
        })
        const payload = await readBoundedHttpErrorPayload(response)
        attemptSignal.throwIfAborted()
        if (response.ok && !payload.ok)
          throw new Error('Google service account token response could not be read')
        lastResponse = {
          ok: response.ok,
          status: response.status,
          body: payload.ok ? payload.body : '',
        }
        if (RETRYABLE_STATUSES.has(response.status)) {
          throw new TokenExchangeRetryError(response)
        }
        return lastResponse
      },
      {
        maxRetries: 2,
        initialDelayMs: 1000,
        maxDelayMs: 2000,
        retryBudgetMs: TOKEN_EXCHANGE_BUDGET_MS,
        signal,
        retryCondition: (error) =>
          error instanceof TokenExchangeRetryError || isRetryableError(error),
      }
    )
  } catch (error) {
    if (error instanceof TokenExchangeRetryError && lastResponse) return lastResponse
    throw error
  }
}
