import { isRecordLike } from '@sim/utils/object'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'

export const FREEBUFF_AGENTIC_COOKIE = '__Host-sim-freebuff-agentic'
export const FREEBUFF_ATTRIBUTION_TTL_SECONDS = 30 * 24 * 60 * 60

interface CapturedAttribution {
  token: string
  capturedAt: number
  expiresAt: number
}

/** The token is opaque: enforce a transport bound without parsing or changing it. */
export async function sealFreebuffAttribution(token: string): Promise<string> {
  if (!token || token.length > 600 || /[\x00-\x20\x7f]/.test(token)) {
    throw new Error('Invalid attribution token')
  }
  const capturedAt = Date.now()
  const { encrypted } = await encryptSecret(
    JSON.stringify({
      purpose: 'freebuff-agentic',
      token,
      capturedAt,
      expiresAt: capturedAt + FREEBUFF_ATTRIBUTION_TTL_SECONDS * 1000,
    })
  )
  return encrypted
}

/** Authenticated encryption protects the cookie against forged timestamps and token substitution. */
export async function readFreebuffAttribution(
  value: string | undefined
): Promise<CapturedAttribution | null> {
  if (!value || value.length > 4096) return null
  try {
    const { decrypted } = await decryptSecret(value, { logFailure: false })
    const data: unknown = JSON.parse(decrypted)
    if (
      !isRecordLike(data) ||
      data.purpose !== 'freebuff-agentic' ||
      typeof data.token !== 'string' ||
      typeof data.capturedAt !== 'number' ||
      typeof data.expiresAt !== 'number' ||
      !Number.isFinite(data.capturedAt) ||
      !Number.isFinite(data.expiresAt) ||
      data.capturedAt > Date.now() ||
      data.expiresAt <= Date.now() ||
      data.expiresAt !== data.capturedAt + FREEBUFF_ATTRIBUTION_TTL_SECONDS * 1000
    )
      return null
    return { token: data.token, capturedAt: data.capturedAt, expiresAt: data.expiresAt }
  } catch {
    return null
  }
}
