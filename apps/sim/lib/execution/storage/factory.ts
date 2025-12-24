import { getRedisClient } from '@/lib/core/config/redis'
import { createLogger } from '@/lib/logs/console/logger'
import type { CancellationStorageAdapter } from './adapter'
import { MemoryCancellationStore } from './memory-store'
import { RedisCancellationStore } from './redis-store'

const logger = createLogger('CancellationStorage')

let cachedAdapter: CancellationStorageAdapter | null = null

export function getCancellationAdapter(): CancellationStorageAdapter {
  if (cachedAdapter) {
    return cachedAdapter
  }

  const redis = getRedisClient()

  if (redis) {
    logger.info('Cancellation storage: Using Redis')
    cachedAdapter = new RedisCancellationStore(redis)
  } else {
    logger.info('Cancellation storage: Using in-memory')
    cachedAdapter = new MemoryCancellationStore()
  }

  return cachedAdapter
}
