import { createHash } from 'node:crypto'
import { safeCompare } from '@sim/security/compare'
import { hmacSha256Hex } from '@sim/security/hmac'
import { compareStrings } from '@sim/utils/string'

export const SHOPIFY_INSTALL_TTL_MS = 15 * 60 * 1000
export const SHOPIFY_INSTALL_COOKIE_PREFIX = 'shopify_install_'

/** Per-attempt browser proof keeps simultaneous Shopify installations independent. */
export function shopifyInstallCookieName(attemptId: string): string {
  if (!/^[a-f0-9-]{36}$/.test(attemptId)) throw new Error('Invalid Shopify installation ID')
  return `${SHOPIFY_INSTALL_COOKIE_PREFIX}${attemptId}`
}

/** Hashes the browser capability; only its digest is persisted with the handoff. */
export function hashShopifyBrowserProof(proof: string): string {
  if (proof.length < 16 || proof.length > 128) throw new Error('Invalid Shopify browser proof')
  return createHash('sha256').update(proof).digest('hex')
}

/** Validates the complete signed query, rejecting ambiguous duplicate parameters. */
export function validateShopifyQueryHmac(query: URLSearchParams, secret: string): boolean {
  if (query.toString().length > 8192) return false
  const entries = [...query.entries()]
  if (new Set(entries.map(([key]) => key)).size !== entries.length) return false
  const hmac = query.get('hmac')
  if (!hmac || !/^[a-f0-9]{64}$/.test(hmac)) return false
  const message = entries
    .filter(([key]) => key !== 'hmac')
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')
  return safeCompare(hmac, hmacSha256Hex(message, secret))
}

/** Signs the random attempt ID and canonical shop without introducing a Sim user dependency. */
export function createShopifyInstallState(
  attemptId: string,
  shopDomain: string,
  secret: string
): string {
  return `install.${attemptId}.${hmacSha256Hex(`${attemptId}:${shopDomain}`, secret)}`
}

/** Verifies the installation branch before any token acquisition or database lookup. */
export function parseShopifyInstallState(
  state: string,
  shopDomain: string,
  secret: string
): string {
  const [kind, attemptId, signature, extra] = state.split('.')
  if (kind !== 'install' || !attemptId || !signature || extra !== undefined)
    throw new Error('Invalid Shopify installation state')
  shopifyInstallCookieName(attemptId)
  if (!safeCompare(signature, hmacSha256Hex(`${attemptId}:${shopDomain}`, secret)))
    throw new Error('Invalid Shopify installation state')
  return attemptId
}
