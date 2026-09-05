export interface TokenBucketConfig {
  maxTokens: number
  refillRate: number
  refillIntervalMs: number
}

export interface ConsumeResult {
  allowed: boolean
  tokensRemaining: number
  resetAt: Date
  retryAfterMs?: number
}

export interface TokenStatus {
  tokensAvailable: number
  maxTokens: number
  lastRefillAt: Date
  nextRefillAt: Date
}

export interface RateLimitStorageAdapter {
  consumeTokensAtomically(
    reservations: readonly TokenBucketReservation[],
    options: AtomicAdmissionOptions
  ): Promise<AtomicAdmissionResult>
  getCooldownUntil(key: string): Promise<Date | null>
  setCooldownUntil(key: string, until: Date): Promise<void>
  consumeTokens(key: string, tokens: number, config: TokenBucketConfig): Promise<ConsumeResult>
  getTokenStatus(key: string, config: TokenBucketConfig): Promise<TokenStatus>
  resetBucket(key: string): Promise<void>
}

export interface TokenBucketReservation {
  key: string
  cost: number
  config: TokenBucketConfig
}

export interface AtomicAdmissionOptions {
  cooldownKeys: readonly string[]
  deadlineAt: number
  signal?: AbortSignal
}

export interface AtomicAdmissionResult {
  allowed: boolean
  retryAfterMs: number
}
