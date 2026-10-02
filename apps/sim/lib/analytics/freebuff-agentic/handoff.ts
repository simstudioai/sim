import { sha256Hex } from '@sim/security/hash'
import { bindFreebuffAttribution } from '@/lib/analytics/freebuff-agentic/service'
import { getRedisClient } from '@/lib/core/config/redis'

/** The browser receives only the existing pairing handle, never the conversion token. */
function key(requestId: string, challenge: string): string {
  return `freebuff:handoff:{${sha256Hex(`${requestId}:${challenge}`)}}`
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

/** Claims only at authenticated approval; failures retain the token for the same account to retry. */
export async function bindFreebuffHandoff(
  userId: string,
  requestId: string,
  challenge: string
): Promise<void> {
  const redis = getRedisClient()
  if (!redis) return
  const tokenKey = key(requestId, challenge)
  const sealed = await redis.eval(
    `local token = redis.call('GET', KEYS[1])
     if not token then return nil end
     local owner = redis.call('GET', KEYS[2])
     if owner and owner ~= ARGV[1] then return nil end
     redis.call('SET', KEYS[2], ARGV[1], 'EX', 900, 'NX')
     return token`,
    2,
    tokenKey,
    `${tokenKey}:owner`,
    userId
  )
  if (typeof sealed !== 'string') return
  await bindFreebuffAttribution(userId, sealed)
  await redis.del(tokenKey)
}
