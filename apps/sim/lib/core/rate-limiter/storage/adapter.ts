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
  consumeTokens(key: string, tokens: number, config: TokenBucketConfig): Promise<ConsumeResult>
  getTokenStatus(key: string, config: TokenBucketConfig): Promise<TokenStatus>
  resetBucket(key: string): Promise<void>
}
