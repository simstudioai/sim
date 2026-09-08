import { createHash } from 'node:crypto'
import { createLogger } from '@sim/logger'
import { acquireProviderCapacity } from '@/lib/core/rate-limiter/provider-capacity'
import { ProviderCapacityDeferredError } from '@/lib/core/rate-limiter/provider-capacity-error'
import type { ProviderCapacityQuota } from '@/lib/core/rate-limiter/provider-capacity-state'
import { readResponseTextWithLimit } from '@/lib/core/utils/stream-limits'
import {
  fetchWithRetry,
  hasRateLimitEvidence,
  type RetryOptions,
  resolveRetryDelayMs,
} from '@/lib/knowledge/documents/utils'

const logger = createLogger('GitHubConnectorRequest')
const REQUEST_BUDGET_MS = 150_000
const ADMISSION_WAIT_MS = 120_000

/** The sync scheduler persists the wait without incrementing the source failure breaker. */
export class GitHubRequestDeferredError extends Error {
  readonly rateLimited = true
  readonly retryable = false

  constructor(
    readonly retryAfterMs: number,
    cause?: unknown
  ) {
    super('GitHub requests are waiting for shared provider capacity', { cause })
    this.name = 'GitHubRequestDeferredError'
  }
}

/** GitHub's response headers include the quota consumed by other clients of the same actor. */
function readRequestQuota(headers: Headers): ProviderCapacityQuota | undefined {
  const remainingHeader = headers.get('x-ratelimit-remaining')
  const resetHeader = headers.get('x-ratelimit-reset')
  if (remainingHeader === null || resetHeader === null) return undefined
  const remaining = Number(remainingHeader)
  const resetAt = Number(resetHeader) * 1000 + 1000
  if (
    !Number.isSafeInteger(remaining) ||
    remaining < 0 ||
    !Number.isSafeInteger(resetAt) ||
    resetAt <= Date.now() ||
    resetAt > Date.now() + 86_400_000
  )
    return undefined
  return { remaining, resetAt }
}

/**
 * Serializes each credential's REST requests across workers and follows the provider's
 * remaining hourly allowance. The token fingerprint is never logged or returned to callers.
 */
export async function fetchGitHubWithRetry(
  url: string,
  options: RequestInit = {},
  retryOptions: RetryOptions = {}
): Promise<Response> {
  const target = new URL(url)
  if (target.origin !== 'https://api.github.com') throw new Error('Invalid GitHub API origin')
  const authorization = new Headers(options.headers).get('authorization') ?? ''
  const scope = createHash('sha256')
    .update(authorization || 'anonymous')
    .digest('hex')
  return fetchWithRetry(url, options, {
    ...retryOptions,
    fetcher: async (input, init) => {
      const signal = init?.signal ?? undefined
      let lease
      try {
        lease = await acquireProviderCapacity({
          providerId: 'github-rest',
          scope,
          pages: 1,
          config: {
            requestsPerMinute: authorization ? 600 : 0.9,
            pagesPerMinute: 600,
            initialPageTokens: 600,
            maxConcurrent: 1,
            recoveryIntervalMs: 60_000,
            minimumScale: 0.05,
            rateLimitBackoffMs: 60_000,
            maximumQuotaPacingMs: ADMISSION_WAIT_MS,
          },
          deadlineAt: Date.now() + (retryOptions.retryBudgetMs ?? REQUEST_BUDGET_MS),
          /** Let sequential repository/tree/content requests progress at low but healthy quota. */
          maxWaitMs: ADMISSION_WAIT_MS,
          signal,
        })
      } catch (error) {
        if (error instanceof ProviderCapacityDeferredError) {
          throw new GitHubRequestDeferredError(error.retryAfterMs ?? 5000, error)
        }
        throw error
      }

      let settled = false
      let quota: ProviderCapacityQuota | undefined
      const settle = async (
        outcome: 'success' | 'failure' | 'rate_limit',
        retryAfterMs?: number
      ) => {
        if (settled) return retryAfterMs ?? 0
        settled = true
        try {
          return await lease.settle(outcome, retryAfterMs, quota)
        } catch (cause) {
          throw new GitHubRequestDeferredError(Math.max(retryAfterMs ?? 0, 5000), cause)
        }
      }

      try {
        const response = await fetch(input, init)
        quota = readRequestQuota(response.headers)
        let secondaryLimit = false
        let forbiddenBody: string | undefined
        if (response.status === 403 && !hasRateLimitEvidence(response.headers)) {
          forbiddenBody = await readResponseTextWithLimit(response, {
            maxBytes: 64 * 1024,
            label: 'GitHub error response',
          }).catch(() => undefined)
          if (forbiddenBody) {
            try {
              const body: unknown = JSON.parse(forbiddenBody)
              secondaryLimit =
                typeof body === 'object' &&
                body !== null &&
                'message' in body &&
                typeof body.message === 'string' &&
                /rate limit|abuse detection/i.test(body.message)
            } catch {
              /** Non-JSON forbidden responses remain authorization failures. */
            }
          }
        }
        if (
          response.status === 429 ||
          (response.status === 403 && (hasRateLimitEvidence(response.headers) || secondaryLimit))
        ) {
          await response.body?.cancel().catch(() => undefined)
          const retryAfterMs = Math.max(
            resolveRetryDelayMs(response.headers) ?? 60_000,
            quota?.remaining === 0 ? quota.resetAt - Date.now() : 0
          )
          throw new GitHubRequestDeferredError(
            Math.max(retryAfterMs, await settle('rate_limit', retryAfterMs))
          )
        }
        if (response.status === 403) {
          await settle('failure')
          return new Response(forbiddenBody ?? null, response)
        }
        if (!response.body) {
          await settle(response.ok ? 'success' : 'failure')
          return response
        }

        const reader = response.body.getReader()
        const outcome = response.ok ? 'success' : 'failure'
        const finish = async () => {
          signal?.removeEventListener('abort', onAbort)
          await settle(outcome)
        }
        const onAbort = () => {
          void reader.cancel(signal?.reason).catch(() => undefined)
          void finish().catch(() =>
            logger.warn('GitHub capacity release deferred after cancellation')
          )
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        if (signal?.aborted) onAbort()
        return new Response(
          new ReadableStream<Uint8Array>({
            async pull(controller) {
              try {
                signal?.throwIfAborted()
                const result = await reader.read()
                if (result.done) {
                  await finish()
                  controller.close()
                } else controller.enqueue(result.value)
              } catch (error) {
                await reader.cancel(error).catch(() => undefined)
                await finish().catch(() => undefined)
                controller.error(error)
              }
            },
            async cancel(reason) {
              await reader.cancel(reason)
              await finish()
            },
          }),
          response
        )
      } catch (error) {
        await settle('failure').catch(() => undefined)
        throw error
      }
    },
  })
}
