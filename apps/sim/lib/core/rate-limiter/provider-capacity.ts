import { createLogger } from '@sim/logger'
import { interruptibleSleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { ProviderCapacityDeferredError } from '@/lib/core/rate-limiter/provider-capacity-error'
import type {
  ProviderCapacityConfig,
  ProviderCapacityQuota,
  ProviderCapacityResult,
} from '@/lib/core/rate-limiter/provider-capacity-state'
import { mutateProviderCapacity } from '@/lib/core/rate-limiter/provider-capacity-store'

const logger = createLogger('ProviderCapacity')
const STORAGE_TIMEOUT_MS = 5000
const MAX_ADMISSION_WAIT_MS = 5000

export interface ProviderCapacityInput {
  providerId: string
  /** A hash of a credential or an explicitly configured provider quota group; never a secret. */
  scope: string
  pages: number
  config: ProviderCapacityConfig
  deadlineAt: number
  /** Interactive callers may wait longer; background ingestion defaults to durable deferral. */
  maxWaitMs?: number
  signal?: AbortSignal
}

export interface ProviderCapacityLease {
  /** Releases only this request's lease and applies feedback atomically with that release. */
  settle(
    outcome: 'success' | 'rate_limit' | 'failure',
    retryAfterMs?: number,
    requestQuota?: ProviderCapacityQuota
  ): Promise<number>
}

/** Validated operating budgets have fixed upper bounds so state and atomic work stay small. */
function assertConfig(config: ProviderCapacityConfig, pages: number): void {
  if (
    !Number.isSafeInteger(pages) ||
    pages < 1 ||
    pages > 1000 ||
    !Number.isFinite(config.requestsPerMinute) ||
    config.requestsPerMinute <= 0 ||
    !Number.isFinite(config.pagesPerMinute) ||
    config.pagesPerMinute < pages ||
    !Number.isFinite(config.initialPageTokens) ||
    config.initialPageTokens < 1 ||
    !Number.isSafeInteger(config.maxConcurrent) ||
    config.maxConcurrent < 1 ||
    config.maxConcurrent > 64 ||
    !Number.isFinite(config.minimumScale) ||
    config.minimumScale <= 0 ||
    config.minimumScale > 1 ||
    !Number.isFinite(config.recoveryIntervalMs) ||
    config.recoveryIntervalMs < 1000 ||
    (config.maximumQuotaPacingMs !== undefined &&
      (!Number.isFinite(config.maximumQuotaPacingMs) ||
        config.maximumQuotaPacingMs < 1000 ||
        config.maximumQuotaPacingMs > 120_000)) ||
    (config.rateLimitBackoffMs !== undefined &&
      (!Number.isFinite(config.rateLimitBackoffMs) ||
        config.rateLimitBackoffMs < 1000 ||
        config.rateLimitBackoffMs > 3_600_000))
  )
    throw new Error(
      'Invalid provider capacity budget or OCR request exceeds its configured page budget'
    )
}

/**
 * Smooths requests, accounts for pages, and leases concurrent work across processes. A short
 * admission wait hands prolonged pressure back to the durable document scheduler.
 */
export async function acquireProviderCapacity(
  input: ProviderCapacityInput
): Promise<ProviderCapacityLease> {
  assertConfig(input.config, input.pages)
  if (
    !Number.isFinite(input.deadlineAt) ||
    (input.maxWaitMs !== undefined &&
      (!Number.isFinite(input.maxWaitMs) || input.maxWaitMs < 1 || input.maxWaitMs > 120_000))
  )
    throw new Error('Invalid provider capacity deadline or admission wait')
  input.signal?.throwIfAborted()
  const key = `provider:ocr:${input.providerId}:${input.scope}:capacity:v1`
  const leaseId = generateId()
  const admissionDeadline = Math.min(
    input.deadlineAt,
    Date.now() + (input.maxWaitMs ?? MAX_ADMISSION_WAIT_MS)
  )
  for (;;) {
    input.signal?.throwIfAborted()
    if (Date.now() >= admissionDeadline) {
      throw new ProviderCapacityDeferredError('admission_timeout', {
        providerId: input.providerId,
        retryAfterMs: 1000,
      })
    }
    let result: ProviderCapacityResult
    try {
      result = await mutateProviderCapacity(
        key,
        input.config,
        {
          kind: 'acquire',
          leaseId,
          pages: input.pages,
          leaseDurationMs: Math.max(1, input.deadlineAt - Date.now()) + STORAGE_TIMEOUT_MS + 1000,
        },
        Math.min(admissionDeadline, Date.now() + STORAGE_TIMEOUT_MS),
        input.signal
      )
    } catch (cause) {
      input.signal?.throwIfAborted()
      throw new ProviderCapacityDeferredError('admission_unavailable', {
        providerId: input.providerId,
        retryAfterMs: 5000,
        cause,
      })
    }
    if (result.allowed) break
    const waitMs = Math.max(1, result.retryAfterMs)
    if ((result.cooldownRemainingMs ?? 0) > 0 || Date.now() + waitMs >= admissionDeadline) {
      logger.info('Provider work deferred at shared admission', {
        providerId: input.providerId,
        pages: input.pages,
        retryAfterMs: waitMs,
        scale: result.scale,
        inFlight: result.inFlight,
      })
      throw new ProviderCapacityDeferredError(
        result.cooldownRemainingMs ? 'rate_limit' : 'admission_timeout',
        {
          providerId: input.providerId,
          retryAfterMs: waitMs,
        }
      )
    }
    await interruptibleSleep(waitMs, input.signal)
  }

  let settling: Promise<number> | undefined
  const lease: ProviderCapacityLease = {
    async settle(outcome, retryAfterMs, requestQuota) {
      if (
        requestQuota &&
        (!Number.isSafeInteger(requestQuota.remaining) ||
          requestQuota.remaining < 0 ||
          !Number.isSafeInteger(requestQuota.resetAt) ||
          requestQuota.resetAt <= 0)
      ) {
        throw new Error('Invalid provider request quota feedback')
      }
      if (!settling) {
        settling = mutateProviderCapacity(
          key,
          input.config,
          {
            kind: 'settle',
            leaseId,
            outcome,
            ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
            ...(requestQuota === undefined ? {} : { requestQuota }),
          },
          Date.now() + STORAGE_TIMEOUT_MS
        )
          .then((result) => {
            if (outcome === 'rate_limit')
              logger.warn('Provider capacity reduced after throttling', {
                providerId: input.providerId,
                scale: result.scale,
                retryAfterMs: result.retryAfterMs,
                inFlight: result.inFlight,
              })
            return result.retryAfterMs
          })
          .catch((error) => {
            settling = undefined
            throw error
          })
      }
      return settling
    },
  }
  if (input.signal?.aborted || Date.now() >= input.deadlineAt) {
    await lease.settle('failure').catch(() => undefined)
    input.signal?.throwIfAborted()
    throw new ProviderCapacityDeferredError('admission_timeout', { providerId: input.providerId })
  }
  return lease
}
