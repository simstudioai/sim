export interface RetryOptions {
  maxAttempts?: number
  initialDelayMs?: number
  maxDelayMs?: number
  backoffMultiplier?: number
  jitterRatio?: number
  isRetryable?: (error: unknown) => boolean
  onRetry?: (args: { attempt: number; error: unknown; delayMs: number }) => void
  sleepFn?: (ms: number) => Promise<void>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 5,
    initialDelayMs = 100,
    maxDelayMs = 10_000,
    backoffMultiplier = 2,
    jitterRatio = 0.1,
    isRetryable = () => true,
    onRetry,
    sleepFn = sleep,
  } = options

  if (maxAttempts < 1) {
    throw new Error('maxAttempts must be >= 1')
  }

  let delayMs = Math.max(0, initialDelayMs)

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation()
    } catch (error) {
      const isLastAttempt = attempt >= maxAttempts
      if (isLastAttempt) {
        throw error
      }
      if (!isRetryable(error)) {
        throw error
      }

      const jitter = jitterRatio > 0 ? (Math.random() * 2 - 1) * jitterRatio * delayMs : 0
      const nextDelayMs = Math.max(0, delayMs + jitter)
      const cappedDelayMs = Math.min(nextDelayMs, maxDelayMs)

      onRetry?.({ attempt, error, delayMs: cappedDelayMs })

      if (cappedDelayMs > 0) {
        await sleepFn(cappedDelayMs)
      }

      delayMs = Math.min(delayMs * Math.max(1, backoffMultiplier), maxDelayMs)
    }
  }

  throw new Error('Retry operation failed unexpectedly')
}
