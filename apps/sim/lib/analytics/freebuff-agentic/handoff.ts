import { sha256Hex } from '@sim/security/hash'
import { getRedisClient } from '@/lib/core/config/redis'

/** The browser receives only the existing pairing handle, never the conversion token. */
function key(requestId: string, challenge: string): string {
  return `freebuff:handoff:${sha256Hex(`${requestId}:${challenge}`)}`
}

export async function storeFreebuffHandoff(
  requestId: string,
  challenge: string,
  sealed: string
): Promise<void> {
  const redis = getRedisClient()
  if (!redis) throw new Error('Attribution handoff unavailable')
  const result = await redis.set(key(requestId, challenge), sealed, 'EX', 900, 'NX')
  if (result !== 'OK') throw new Error('Attribution handoff already registered')
}

export async function readFreebuffHandoff(
  requestId: string,
  challenge: string
): Promise<string | undefined> {
  return (await getRedisClient()?.getdel(key(requestId, challenge))) ?? undefined
}
