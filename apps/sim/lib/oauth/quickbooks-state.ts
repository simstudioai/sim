import { safeCompare } from '@sim/security/compare'
import { hmacSha256Hex } from '@sim/security/hmac'
import { generateId } from '@sim/utils/id'
import { env } from '@/lib/core/config/env'
import { CREDENTIAL_DRAFT_TTL_MS } from '@/lib/credentials/draft-constants'

const QUICKBOOKS_OAUTH_STATE_VERSION = 1

interface QuickBooksOAuthStatePayload {
  v: typeof QUICKBOOKS_OAUTH_STATE_VERSION
  nonce: string
  userId: string
  draftId: string
  returnUrl: string
  issuedAt: number
}

function isQuickBooksOAuthStatePayload(value: unknown): value is QuickBooksOAuthStatePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const payload = value as Record<string, unknown>
  return (
    payload.v === QUICKBOOKS_OAUTH_STATE_VERSION &&
    typeof payload.nonce === 'string' &&
    payload.nonce.length > 0 &&
    typeof payload.userId === 'string' &&
    payload.userId.length > 0 &&
    typeof payload.draftId === 'string' &&
    payload.draftId.length > 0 &&
    typeof payload.returnUrl === 'string' &&
    payload.returnUrl.length > 0 &&
    typeof payload.issuedAt === 'number' &&
    Number.isSafeInteger(payload.issuedAt)
  )
}

/** Creates a signed, user-bound state token without exposing OAuth client secrets. */
export function createQuickBooksOAuthState(params: {
  userId: string
  draftId: string
  returnUrl: string
}): string {
  const payload: QuickBooksOAuthStatePayload = {
    v: QUICKBOOKS_OAUTH_STATE_VERSION,
    nonce: generateId(),
    userId: params.userId,
    draftId: params.draftId,
    returnUrl: params.returnUrl,
    issuedAt: Date.now(),
  }
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${encoded}.${hmacSha256Hex(encoded, env.BETTER_AUTH_SECRET)}`
}

/** Verifies state integrity, expiry, and ownership before returning its draft binding. */
export function parseQuickBooksOAuthState(params: { state: string; userId: string; now?: Date }): {
  draftId: string
  returnUrl: string
} {
  const [encoded, signature, extra] = params.state.split('.')
  if (!encoded || !signature || extra !== undefined) {
    throw new Error('QuickBooks OAuth state is malformed')
  }
  if (!safeCompare(signature, hmacSha256Hex(encoded, env.BETTER_AUTH_SECRET))) {
    throw new Error('QuickBooks OAuth state signature is invalid')
  }

  let decoded: unknown
  try {
    decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    throw new Error('QuickBooks OAuth state payload is invalid')
  }
  if (!isQuickBooksOAuthStatePayload(decoded)) {
    throw new Error('QuickBooks OAuth state payload is invalid')
  }
  if (decoded.userId !== params.userId) {
    throw new Error('QuickBooks OAuth state belongs to a different user')
  }
  const now = params.now?.getTime() ?? Date.now()
  if (decoded.issuedAt > now || now - decoded.issuedAt > CREDENTIAL_DRAFT_TTL_MS) {
    throw new Error('QuickBooks OAuth state is expired')
  }
  return { draftId: decoded.draftId, returnUrl: decoded.returnUrl }
}
