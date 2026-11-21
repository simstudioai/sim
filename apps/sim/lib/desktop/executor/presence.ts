import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { getRedisClient } from '@/lib/core/config/redis'
import { DESKTOP_PRESENCE_TTL_SECONDS } from '@/lib/desktop/executor/constants'

const logger = createLogger('DesktopPresence')

/**
 * A device is online while it keeps talking to Sim. Every device request that proves it is awake
 * (an inbox pull, a lease renewal, a stream open) refreshes the key, and only its TTL removes it:
 * a sleeping or disconnected device lapses, while a stream a deploy closes does not read as offline.
 */
function presenceKey(deviceId: string): string {
  return `desktop:presence:${deviceId}`
}

/**
 * Records that the device just made a request. Best effort: presence only decides how fast an
 * unclaimed call fails, so a Redis error must not fail the request that proves the device is awake.
 */
export async function markDesktopPresent(deviceId: string): Promise<void> {
  try {
    const redis = getRedisClient()
    await redis.set(presenceKey(deviceId), '1', 'EX', DESKTOP_PRESENCE_TTL_SECONDS)
  } catch (error) {
    logger.warn('Could not record desktop presence', { deviceId, error: toError(error).message })
  }
}

/** Whether the device made a request within the presence TTL. */
export async function isDesktopPresent(deviceId: string): Promise<boolean> {
  const redis = getRedisClient()
  return (await redis.exists(presenceKey(deviceId))) === 1
}
