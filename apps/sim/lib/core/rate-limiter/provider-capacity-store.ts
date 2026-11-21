import { getRedisClient } from '@/lib/core/config/redis'
import { PROVIDER_CAPACITY_SCRIPT } from '@/lib/core/rate-limiter/provider-capacity-lua'
import type {
  ProviderCapacityAction,
  ProviderCapacityConfig,
  ProviderCapacityResult,
} from '@/lib/core/rate-limiter/provider-capacity-state'
import { withinDeadline } from '@/lib/core/utils/deadline'

/** One atomic Redis state update, bounded by the caller's deadline and signal. */
export async function mutateProviderCapacity(
  key: string,
  config: ProviderCapacityConfig,
  action: ProviderCapacityAction,
  deadlineAt: number,
  signal?: AbortSignal
): Promise<ProviderCapacityResult> {
  return withinDeadline(
    async (operationSignal) => {
      operationSignal.throwIfAborted()
      const redis = getRedisClient()
      const result = await redis.eval(
        PROVIDER_CAPACITY_SCRIPT,
        1,
        `ratelimit:tb:${key}`,
        JSON.stringify(config),
        JSON.stringify(action),
        String(deadlineAt)
      )
      operationSignal.throwIfAborted()
      const parsed: ProviderCapacityResult = JSON.parse(String(result))
      if (
        typeof parsed.allowed !== 'boolean' ||
        !Number.isFinite(parsed.retryAfterMs) ||
        parsed.retryAfterMs < 0 ||
        (parsed.cooldownRemainingMs !== undefined &&
          (!Number.isFinite(parsed.cooldownRemainingMs) || parsed.cooldownRemainingMs < 0)) ||
        !Number.isFinite(parsed.scale) ||
        parsed.scale <= 0 ||
        parsed.scale > 1 ||
        !Number.isSafeInteger(parsed.inFlight) ||
        parsed.inFlight < 0
      )
        throw new Error('Invalid provider capacity storage response')
      return parsed
    },
    deadlineAt,
    signal
  )
}
