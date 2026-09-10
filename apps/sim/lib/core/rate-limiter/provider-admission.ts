import { interruptibleSleep } from '@sim/utils/helpers'
import { env, envNumber } from '@/lib/core/config/env'
import type {
  AtomicAdmissionResult,
  TokenBucketReservation,
} from '@/lib/core/rate-limiter/storage/adapter'
import { createStorageAdapter } from '@/lib/core/rate-limiter/storage/factory'

export interface ProviderIdentity {
  providerId: string
  credentialFingerprint: string
  operation: 'embedding' | 'ocr' | 'rerank'
}

/**
 * Every caller reserves from the credential's aggregate buckets, so the
 * configured budget is never exceeded. The bulk lane also reserves from a
 * bucket capped at {@link BULK_LANE_SHARE} of that budget, which leaves an
 * interactive caller headroom instead of a queue behind a crawl's batches.
 * Cooldown and quota gates stay per identity: a provider pause or an exhausted
 * balance still stops every lane.
 */
export type ProviderAdmissionLane = 'bulk' | 'interactive'

const BULK_LANE_SHARE = 0.9

interface ProviderAdmissionInput extends ProviderIdentity {
  inputTokens?: number
  signal?: AbortSignal
  maxWaitMs: number
  lane?: ProviderAdmissionLane
}

/**
 * Requests admitted in the same instant per embedding credential. The
 * per-minute rate still governs sustained throughput; the burst only decides
 * how many concurrent documents can start a batch together instead of losing a
 * race for a handful of slots while the token budget sits unused.
 */
const EMBEDDING_REQUEST_BURST = 64
const DEFAULT_REQUEST_BURST = 2

/** A local admission wait expired; the document scheduler may retry the work later. */
export class ProviderAdmissionTimeoutError extends Error {
  readonly retryable = false
  readonly status = 429

  constructor(readonly retryAfterMs?: number) {
    super('Provider request admission exceeded the available wait budget')
    this.name = 'ProviderAdmissionTimeoutError'
  }
}

/**
 * Shared per-credential admission for indexing workers and interactive callers.
 * These are deployment operating budgets, not claims about provider quotas.
 * Redis and PostgreSQL use the same durable token buckets; storage errors fail
 * before the provider request. Capacity is spent only when every dimension and
 * the shared provider cooldown permit the request in one atomic operation.
 */
export async function waitForProviderAdmission(input: ProviderAdmissionInput): Promise<void> {
  input.signal?.throwIfAborted()
  const deadlineAt = Date.now() + input.maxWaitMs
  const key = providerKey(input)
  const requestsPerMinute =
    input.operation === 'embedding'
      ? envNumber(env.KB_CONFIG_EMBEDDING_REQUESTS_PER_MINUTE, 600, { min: 1 })
      : input.operation === 'ocr'
        ? envNumber(env.KB_CONFIG_OCR_REQUESTS_PER_MINUTE, 60, { min: 1 })
        : envNumber(env.KB_CONFIG_RERANK_REQUESTS_PER_MINUTE, 60, { min: 1 })
  const tokenBudget =
    input.operation === 'embedding' && input.inputTokens
      ? {
          cost: input.inputTokens,
          perMinute: envNumber(env.KB_CONFIG_EMBEDDING_TOKENS_PER_MINUTE, 600_000, { min: 1 }),
        }
      : undefined
  if (tokenBudget && tokenBudget.cost > tokenBudget.perMinute) {
    throw new Error('Embedding request exceeds the configured per-credential token budget')
  }
  const requestBurst = Math.min(
    input.operation === 'embedding' ? EMBEDDING_REQUEST_BURST : DEFAULT_REQUEST_BURST,
    requestsPerMinute
  )
  const reservations: TokenBucketReservation[] = []
  /** A lane bucket always holds at least one valid reservation, so a tiny budget cannot lock the lane. */
  const reserveBuckets = (bucketKey: string, share: number) => {
    if (tokenBudget) {
      reservations.push({
        key: `${bucketKey}:tokens`,
        cost: tokenBudget.cost,
        config: {
          maxTokens: Math.max(tokenBudget.cost, Math.floor(tokenBudget.perMinute * share)),
          refillRate: (tokenBudget.perMinute * share) / 60,
          refillIntervalMs: 1000,
        },
      })
    }
    reservations.push({
      key: `${bucketKey}:requests`,
      cost: 1,
      config: {
        maxTokens: Math.max(1, Math.floor(requestBurst * share)),
        refillRate: (requestsPerMinute * share) / 60,
        refillIntervalMs: 1000,
      },
    })
  }
  reserveBuckets(key, 1)
  if (input.lane === 'bulk') reserveBuckets(`${key}:bulk`, BULK_LANE_SHARE)

  /** When the bucket last said capacity returns, so a deadline hit after a sleep reports the wait still left. */
  let capacityAvailableAt: number | undefined
  for (;;) {
    input.signal?.throwIfAborted()
    if (Date.now() >= deadlineAt) {
      const remainingMs =
        capacityAvailableAt === undefined ? undefined : capacityAvailableAt - Date.now()
      throw new ProviderAdmissionTimeoutError(
        remainingMs !== undefined && remainingMs > 0 ? remainingMs : undefined
      )
    }
    if (await isProviderQuotaExhausted(input))
      throw new ProviderQuotaExhaustedError(input.providerId)
    let result: AtomicAdmissionResult
    try {
      result = await createStorageAdapter({
        requireConfiguredBackend: true,
      }).consumeTokensAtomically(reservations, {
        cooldownKeys: [`${key}:cooldown`, `${key}:quota`],
        deadlineAt,
        signal: input.signal,
      })
    } catch (error) {
      input.signal?.throwIfAborted()
      throw new ProviderAdmissionStorageError(error)
    }
    input.signal?.throwIfAborted()
    if (Date.now() >= deadlineAt) {
      throw new ProviderAdmissionTimeoutError(result.allowed ? undefined : result.retryAfterMs)
    }
    if (result.allowed) return
    const waitMs = Math.max(1, result.retryAfterMs)
    if (Number.isFinite(waitMs)) capacityAvailableAt = Date.now() + waitMs
    if (!Number.isFinite(waitMs) || waitMs >= deadlineAt - Date.now()) {
      if (await isProviderQuotaExhausted(input))
        throw new ProviderQuotaExhaustedError(input.providerId)
      throw new ProviderAdmissionTimeoutError(Number.isFinite(waitMs) ? waitMs : undefined)
    }
    await interruptibleSleep(waitMs, input.signal)
  }
}

/** Billing changes can take minutes to propagate; deferred ingestion probes again later. */
export const PROVIDER_QUOTA_COOLDOWN_MS = 5 * 60 * 1000

/** Backend failures must never start another provider attempt through message-based retries. */
export class ProviderAdmissionStorageError extends Error {
  readonly retryable = false
  constructor(cause: unknown) {
    super('Provider admission storage is unavailable', { cause })
    this.name = 'ProviderAdmissionStorageError'
  }
}

export class ProviderQuotaExhaustedError extends Error {
  readonly retryable = false
  readonly status = 429
  readonly quotaExhausted = true

  constructor(readonly providerId: string) {
    super(`The ${providerId} provider has exhausted its available quota`)
    this.name = 'ProviderQuotaExhaustedError'
  }
}

function providerKey(identity: ProviderIdentity): string {
  return `provider:${identity.operation}:${identity.providerId}:${identity.credentialFingerprint}`
}

export async function isProviderQuotaExhausted(identity: ProviderIdentity): Promise<boolean> {
  try {
    const until = await createStorageAdapter({ requireConfiguredBackend: true }).getCooldownUntil(
      `${providerKey(identity)}:quota`
    )
    return (until?.getTime() ?? 0) > Date.now()
  } catch (error) {
    throw new ProviderAdmissionStorageError(error)
  }
}

/** Extends an existing pause without shortening another worker's later reset. */
export async function recordProviderCooldown(
  identity: ProviderIdentity,
  waitMs: number,
  quotaExhausted = false
): Promise<void> {
  if (!Number.isFinite(waitMs) || waitMs <= 0)
    throw new Error('Provider cooldown must be positive and finite')
  try {
    await createStorageAdapter({ requireConfiguredBackend: true }).setCooldownUntil(
      `${providerKey(identity)}:${quotaExhausted ? 'quota' : 'cooldown'}`,
      new Date(Date.now() + waitMs)
    )
  } catch (error) {
    throw new ProviderAdmissionStorageError(error)
  }
}
