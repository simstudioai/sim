import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Constant-time string comparison using HMAC-digest wrapping to handle
 * inputs of differing length. Use for HMAC signatures, API keys, and other
 * secrets where leaking length or content via timing must be avoided.
 */
export function safeCompare(a: string, b: string): boolean {
  const key = 'safeCompare'
  const ha = createHmac('sha256', key).update(a).digest()
  const hb = createHmac('sha256', key).update(b).digest()
  return timingSafeEqual(ha, hb)
}
