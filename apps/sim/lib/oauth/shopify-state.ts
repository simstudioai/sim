import { safeCompare } from '@sim/security/compare'
import { hmacSha256Hex } from '@sim/security/hmac'
import { generateId } from '@sim/utils/id'
import { CREDENTIAL_DRAFT_TTL_MS } from '@/lib/credentials/draft-constants'

const SHOPIFY_OAUTH_STATE_VERSION = 1

interface ShopifyOAuthStatePayload {
  v: typeof SHOPIFY_OAUTH_STATE_VERSION
  nonce: string
  userId: string
  shopDomain: string
  draftId?: string
  returnUrl?: string
  issuedAt: number
}

interface CreateShopifyOAuthStateParams {
  userId: string
  shopDomain: string
  draftId?: string
  returnUrl?: string
  clientSecret: string
}

interface ParseShopifyOAuthStateParams {
  state: string
  userId: string
  shopDomain: string
  clientSecret: string
  now?: Date
}

function isShopifyOAuthStatePayload(value: unknown): value is ShopifyOAuthStatePayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Record<string, unknown>
  return (
    payload.v === SHOPIFY_OAUTH_STATE_VERSION &&
    typeof payload.nonce === 'string' &&
    payload.nonce.length > 0 &&
    typeof payload.userId === 'string' &&
    payload.userId.length > 0 &&
    typeof payload.shopDomain === 'string' &&
    payload.shopDomain.length > 0 &&
    (payload.draftId === undefined ||
      (typeof payload.draftId === 'string' && payload.draftId.length > 0)) &&
    (payload.returnUrl === undefined ||
      (typeof payload.returnUrl === 'string' && payload.returnUrl.length > 0)) &&
    typeof payload.issuedAt === 'number' &&
    Number.isSafeInteger(payload.issuedAt)
  )
}

/** Creates a signed, user-bound Shopify state token carrying the exact credential draft. */
export function createShopifyOAuthState(params: CreateShopifyOAuthStateParams): string {
  const payload: ShopifyOAuthStatePayload = {
    v: SHOPIFY_OAUTH_STATE_VERSION,
    nonce: generateId(),
    userId: params.userId,
    shopDomain: params.shopDomain,
    ...(params.draftId ? { draftId: params.draftId } : {}),
    ...(params.returnUrl ? { returnUrl: params.returnUrl } : {}),
    issuedAt: Date.now(),
  }
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const signature = hmacSha256Hex(encoded, params.clientSecret)
  return `${encoded}.${signature}`
}

/** Verifies Shopify state integrity, expiry, user ownership, and shop binding. */
export function parseShopifyOAuthState(params: ParseShopifyOAuthStateParams): {
  draftId?: string
  returnUrl?: string
} {
  const [encoded, signature, extra] = params.state.split('.')
  if (!encoded || !signature || extra !== undefined) {
    throw new Error('Shopify OAuth state is malformed')
  }

  const expectedSignature = hmacSha256Hex(encoded, params.clientSecret)
  if (!safeCompare(signature, expectedSignature)) {
    throw new Error('Shopify OAuth state signature is invalid')
  }

  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    throw new Error('Shopify OAuth state payload is invalid')
  }
  if (!isShopifyOAuthStatePayload(decoded)) {
    throw new Error('Shopify OAuth state payload is invalid')
  }

  if (decoded.userId !== params.userId) {
    throw new Error('Shopify OAuth state belongs to a different user')
  }
  if (decoded.shopDomain !== params.shopDomain) {
    throw new Error('Shopify OAuth state belongs to a different shop')
  }

  const now = params.now?.getTime() ?? Date.now()
  if (decoded.issuedAt > now || now - decoded.issuedAt > CREDENTIAL_DRAFT_TTL_MS) {
    throw new Error('Shopify OAuth state is expired')
  }

  return {
    ...(decoded.draftId ? { draftId: decoded.draftId } : {}),
    ...(decoded.returnUrl ? { returnUrl: decoded.returnUrl } : {}),
  }
}
