import { getRedisClient } from '@/lib/core/config/redis'
import { DESKTOP_PRESENCE_TTL_SECONDS } from '@/lib/desktop/executor/constants'

/**
 * A device is present while one of its inbox streams is open. Each stream writes its own
 * connection id, so a stream that closes after its replacement opened cannot erase the newer
 * stream's presence.
 */
const RELEASE_OWN_PRESENCE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`

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
  await redis.set(presenceKey(deviceId), connectionId, 'EX', DESKTOP_PRESENCE_TTL_SECONDS)
}

/** Clears presence only when this connection is still the one recorded. */
export async function releaseDesktopPresence(
  deviceId: string,
  connectionId: string
): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return
  await redis.eval(RELEASE_OWN_PRESENCE, 1, presenceKey(deviceId), connectionId)
}

/** A device with no open inbox stream cannot pick up a call; a missing Redis reads as absent. */
export async function isDesktopPresent(deviceId: string): Promise<boolean> {
  const redis = getRedisClient()
  if (!redis) return false
  return (await redis.exists(presenceKey(deviceId))) === 1
}
