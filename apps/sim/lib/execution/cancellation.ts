import { getRedisClient } from '@/lib/core/config/redis'

const KEY_PREFIX = 'execution:cancel:'
const TTL_SECONDS = 300
const TTL_MS = TTL_SECONDS * 1000

const memoryStore = new Map<string, number>()

export async function requestCancellation(executionId: string): Promise<boolean> {
  const redis = getRedisClient()
  if (redis) {
    try {
      await redis.set(`${KEY_PREFIX}${executionId}`, '1', 'EX', TTL_SECONDS)
      return true
    } catch {
      return false
    }
  }
  memoryStore.set(executionId, Date.now() + TTL_MS)
  return true
}

export async function isCancellationRequested(executionId: string): Promise<boolean> {
  const redis = getRedisClient()
  if (redis) {
    try {
      return (await redis.exists(`${KEY_PREFIX}${executionId}`)) === 1
    } catch {
      return false
    }
  }
  const expiry = memoryStore.get(executionId)
  if (!expiry) return false
  if (Date.now() > expiry) {
    memoryStore.delete(executionId)
    return false
  }
  return true
}

export async function clearCancellation(executionId: string): Promise<void> {
  const redis = getRedisClient()
  if (redis) {
    try {
      await redis.del(`${KEY_PREFIX}${executionId}`)
    } catch {}
    return
  }
  memoryStore.delete(executionId)
}
