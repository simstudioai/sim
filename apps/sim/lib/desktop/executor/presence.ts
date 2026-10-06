import { getRedisClient } from '@/lib/core/config/redis'
import { DESKTOP_PRESENCE_TTL_SECONDS } from '@/lib/desktop/executor/constants'

/**
 * A device is online while it keeps talking to Sim. Every device request that proves it is awake
 * (an inbox pull, a lease renewal, a stream open) refreshes the key, and only its TTL removes it:
 * a sleeping or disconnected device lapses, while a stream a deploy closes does not read as offline.
 */
function presenceKey(deviceId: string): string {
  return `desktop:presence:${deviceId}`
}

/** Whether presence can be tracked at all; without Redis the executor stays off. */
export function isDesktopPresenceAvailable(): boolean {
  return getRedisClient() !== null
}

/** Records that the device just made a request. */
export async function markDesktopPresent(deviceId: string): Promise<void> {
  const redis = getRedisClient()
  if (!redis) throw new Error('Desktop presence requires Redis')
  await redis.set(presenceKey(deviceId), '1', 'EX', DESKTOP_PRESENCE_TTL_SECONDS)
}

/** Whether the device made a request within the presence TTL; a missing Redis reads as absent. */
export async function isDesktopPresent(deviceId: string): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false
  return (await redis.exists(presenceKey(deviceId))) === 1
}
