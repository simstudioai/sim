export interface ProviderCapacityConfig {
  requestsPerMinute: number
  pagesPerMinute: number
  /** Cold starts begin with this allowance; idle refill is capped at one minute of pages. */
  initialPageTokens: number
  maxConcurrent: number
  /** Recovery is deliberately slower than a throttle response. */
  recoveryIntervalMs: number
  minimumScale: number
  /** Minimum adaptive throttle cooldown; providers may require a longer floor than OCR. */
  rateLimitBackoffMs?: number
  /** Resume at quota reset when ordinary pacing cannot fit a useful request within this budget. */
  maximumQuotaPacingMs?: number
}

export interface ProviderCapacityQuota {
  remaining: number
  resetAt: number
}

export interface ProviderCapacityState {
  version: 1
  scale: number
  nextRequestAt: number
  pageTokens: number
  refilledAt: number
  cooldownUntil: number
  recoveryAt: number
  leases: Array<{ id: string; expiresAt: number }>
  /** At most 61 one-second buckets; optional when reading state written before rolling accounting. */
  pageWindow?: Array<{ at: number; pages: number }>
  /** Optional provider-reported request allowance, shared until its reset. */
  requestQuota?: ProviderCapacityQuota
}

export type ProviderCapacityAction =
  | { kind: 'acquire'; leaseId: string; pages: number; leaseDurationMs: number }
  | {
      kind: 'settle'
      leaseId: string
      outcome: 'success' | 'rate_limit' | 'failure'
      retryAfterMs?: number
      requestQuota?: ProviderCapacityQuota
    }

export interface ProviderCapacityResult {
  allowed: boolean
  retryAfterMs: number
  /** Positive provider throttle feedback must defer immediately, independently of ordinary pacing. */
  cooldownRemainingMs?: number
  scale: number
  inFlight: number
}

export interface ProviderCapacityUpdate {
  state: ProviderCapacityState
  result: ProviderCapacityResult
}

/** Pure state transition, serialized by the shared backend for every provider request. */
export function updateProviderCapacity(
  stored: ProviderCapacityState | null,
  config: ProviderCapacityConfig,
  action: ProviderCapacityAction,
  backendNow: number
): ProviderCapacityUpdate {
  /** Clock corrections must not shorten request spacing, cooldowns, or existing lease deadlines. */
  const now = Math.max(backendNow, stored?.refilledAt ?? backendNow)
  const state: ProviderCapacityState = stored
    ? { ...stored, leases: stored.leases.filter((lease) => lease.expiresAt > now) }
    : {
        version: 1,
        scale: 1,
        nextRequestAt: 0,
        pageTokens: Math.min(config.initialPageTokens, config.pagesPerMinute),
        refilledAt: now,
        cooldownUntil: 0,
        recoveryAt: now + Math.ceil(config.recoveryIntervalMs),
        leases: [],
      }
  /** Keep each second until its final admission is at least 60 seconds old. */
  const pageWindow = (stored?.pageWindow ?? []).filter((bucket) => bucket.at + 61_000 > now)
  state.pageWindow = pageWindow
  state.scale = Math.max(config.minimumScale, Math.min(1, state.scale))
  state.pageTokens = Math.min(
    config.pagesPerMinute,
    state.pageTokens +
      (Math.max(0, now - state.refilledAt) * config.pagesPerMinute * state.scale) / 60_000
  )
  state.refilledAt = Math.max(now, state.refilledAt)
  if (state.requestQuota && state.requestQuota.resetAt <= now) state.requestQuota = undefined
  let retryAfterMs = 0
  let allowed = false

  if (action.kind === 'settle') {
    const held = state.leases.some((lease) => lease.id === action.leaseId)
    state.leases = state.leases.filter((lease) => lease.id !== action.leaseId)
    if (held && action.requestQuota && action.requestQuota.resetAt > now) {
      const previous = state.requestQuota
      if (!previous || action.requestQuota.resetAt >= previous.resetAt) {
        state.requestQuota = {
          resetAt: action.requestQuota.resetAt,
          remaining:
            previous?.resetAt === action.requestQuota.resetAt
              ? Math.min(previous.remaining, action.requestQuota.remaining)
              : action.requestQuota.remaining,
        }
        state.nextRequestAt = Math.max(state.nextRequestAt, now + quotaRequestInterval(state, now))
      }
    }
    if (held && action.outcome === 'rate_limit') {
      /** Concurrent rejections from one burst reduce the budget once, not once per worker. */
      if (now >= state.cooldownUntil) state.scale = Math.max(config.minimumScale, state.scale / 2)
      const delay = Math.max(
        action.retryAfterMs ?? 0,
        (config.rateLimitBackoffMs ?? 1000) / state.scale
      )
      state.cooldownUntil = Math.max(state.cooldownUntil, now + Math.ceil(delay))
      state.nextRequestAt = Math.max(state.nextRequestAt, state.cooldownUntil)
      state.pageTokens = 0
      state.recoveryAt = state.cooldownUntil + Math.ceil(config.recoveryIntervalMs)
      retryAfterMs = state.cooldownUntil - now
    } else if (
      held &&
      action.outcome === 'success' &&
      now >= state.recoveryAt &&
      now >= state.cooldownUntil
    ) {
      state.scale = Math.min(1, state.scale + 0.05)
      state.recoveryAt = now + Math.ceil(config.recoveryIntervalMs)
    }
    allowed = held
  } else {
    /** An uncertain storage response can be retried without reserving the same work twice. */
    if (state.leases.some((lease) => lease.id === action.leaseId)) {
      return {
        state,
        result: {
          allowed: true,
          retryAfterMs: 0,
          scale: state.scale,
          inFlight: state.leases.length,
        },
      }
    }
    retryAfterMs = Math.max(0, state.cooldownUntil - now, state.nextRequestAt - now)
    if (state.requestQuota?.remaining === 0) {
      retryAfterMs = Math.max(retryAfterMs, state.requestQuota.resetAt - now)
    }
    if (
      state.requestQuota &&
      config.maximumQuotaPacingMs !== undefined &&
      quotaRequestInterval(state, now) > config.maximumQuotaPacingMs
    ) {
      retryAfterMs = Math.max(retryAfterMs, state.requestQuota.resetAt - now)
    }
    if (state.pageTokens < action.pages) {
      retryAfterMs = Math.max(
        retryAfterMs,
        ((action.pages - state.pageTokens) * 60_000) / (config.pagesPerMinute * state.scale)
      )
    }
    let pagesInWindow = pageWindow.reduce((total, bucket) => total + bucket.pages, 0)
    if (pagesInWindow + action.pages > config.pagesPerMinute) {
      for (const bucket of pageWindow) {
        pagesInWindow -= bucket.pages
        if (pagesInWindow + action.pages <= config.pagesPerMinute) {
          retryAfterMs = Math.max(retryAfterMs, bucket.at + 61_000 - now)
          break
        }
      }
    }
    if (state.leases.length >= config.maxConcurrent) {
      /** Short bounded polling notices released leases without waiting their entire crash TTL. */
      retryAfterMs = Math.max(retryAfterMs, 1000)
    }
    if (retryAfterMs === 0 && action.leaseDurationMs > 0) {
      state.pageTokens -= action.pages
      /** Whole milliseconds avoid JSON precision loss and never round a pacing interval downward. */
      state.nextRequestAt =
        now +
        Math.ceil(
          Math.max(
            60_000 / (config.requestsPerMinute * state.scale),
            quotaRequestInterval(state, now)
          )
        )
      if (state.requestQuota)
        state.requestQuota = { ...state.requestQuota, remaining: state.requestQuota.remaining - 1 }
      state.leases.push({ id: action.leaseId, expiresAt: now + Math.ceil(action.leaseDurationMs) })
      const at = Math.floor(now / 1000) * 1000
      const last = pageWindow.at(-1)
      if (last?.at === at) {
        pageWindow[pageWindow.length - 1] = { at, pages: last.pages + action.pages }
      } else {
        pageWindow.push({ at, pages: action.pages })
      }
      allowed = true
    }
  }
  return {
    state,
    result: {
      allowed,
      retryAfterMs: Math.ceil(retryAfterMs),
      ...(!allowed && state.cooldownUntil > now
        ? { cooldownRemainingMs: Math.ceil(state.cooldownUntil - now) }
        : {}),
      scale: state.scale,
      inFlight: state.leases.length,
    },
  }
}

/** Spread the remaining hourly allowance with 10% headroom, never beyond its reset. */
function quotaRequestInterval(state: ProviderCapacityState, now: number): number {
  const quota = state.requestQuota
  if (!quota) return 0
  const remainingMs = Math.max(0, quota.resetAt - now)
  return Math.ceil(Math.min(remainingMs, remainingMs / Math.max(1, quota.remaining * 0.9)))
}
