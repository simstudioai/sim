import { getRedisClient } from '@/lib/core/config/redis'
import { DESKTOP_PRESENCE_TTL_SECONDS } from '@/lib/desktop/executor/constants'

/**
 * A device is present while one of its inbox streams is open. Each stream holds its own entry in
 * the device's set, scored by when that entry expires, so streams that overlap during a reconnect
 * or rotation never erase each other's presence. The key itself expires with its newest entry.
 */
function presenceKey(deviceId: string): string {
  return `desktop:presence:${deviceId}`
}

/** Whether presence can be tracked at all; without Redis the executor stays off. */
export function isDesktopPresenceAvailable(): boolean {
  return getRedisClient() !== null
}

/** Records that this stream connection is serving the device, for the presence TTL. */
export async function markDesktopPresent(deviceId: string, connectionId: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) throw new Error('Desktop presence requires Redis')
  const key = presenceKey(deviceId)
  await redis
    .multi()
    .zremrangebyscore(key, '-inf', Date.now())
    .zadd(key, Date.now() + DESKTOP_PRESENCE_TTL_SECONDS * 1000, connectionId)
    .expire(key, DESKTOP_PRESENCE_TTL_SECONDS)
    .exec()
}

/** Removes only this connection's entry; any other open stream keeps the device present. */
export async function releaseDesktopPresence(
  deviceId: string,
  connectionId: string
): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return
  await redis.zrem(presenceKey(deviceId), connectionId)
}

/** A device with no unexpired stream entry cannot pick up a call; a missing Redis reads as absent. */
export async function isDesktopPresent(deviceId: string): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false
  return (await redis.zcount(presenceKey(deviceId), Date.now(), '+inf')) > 0
}
