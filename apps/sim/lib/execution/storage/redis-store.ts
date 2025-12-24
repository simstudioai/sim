import type Redis from 'ioredis'
import type { CancellationStorageAdapter } from './adapter'

const KEY_PREFIX = 'execution:cancel:'
const TTL_SECONDS = 300

export class RedisCancellationStore implements CancellationStorageAdapter {
  constructor(private redis: Redis) {}

  async requestCancellation(executionId: string): Promise<boolean> {
    try {
      await this.redis.set(`${KEY_PREFIX}${executionId}`, '1', 'EX', TTL_SECONDS)
      return true
    } catch {
      return false
    }
  }

  async isCancellationRequested(executionId: string): Promise<boolean> {
    try {
      const result = await this.redis.exists(`${KEY_PREFIX}${executionId}`)
      return result === 1
    } catch {
      return false
    }
  }

  async clearCancellation(executionId: string): Promise<void> {
    try {
      await this.redis.del(`${KEY_PREFIX}${executionId}`)
    } catch {
      // Ignore cleanup errors
    }
  }

  dispose(): void {
    // Redis client managed externally
  }
}
