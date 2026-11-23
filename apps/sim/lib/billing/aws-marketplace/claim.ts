import { sha256Hex } from '@sim/security/hash'
import { generateShortId } from '@sim/utils/id'

/** Holds the buyer's one-time claim between the AWS redirect and linking an organization. */
export const AWS_MARKETPLACE_CLAIM_COOKIE = 'sim_aws_marketplace_claim'

/** Matches how long AWS keeps a registration token valid. */
export const AWS_MARKETPLACE_CLAIM_TTL_MS = 4 * 60 * 60 * 1000

/** ~190 random bits; only its hash is stored. */
export function issueClaimToken(): { token: string; hash: string } {
  const token = generateShortId(32)
  return { token, hash: hashClaimToken(token) }
}

export function hashClaimToken(token: string): string {
  return sha256Hex(token)
}

/**
 * The `Set-Cookie` value carrying a claim token, or clearing it when `token` is null. Lax is the
 * strictest policy that lets the first read work: with Strict, the page AWS's cross-site POST
 * redirects to would not send the cookie. Lax also keeps it off cross-site POSTs to the claim routes.
 */
export function serializeClaimCookie(token: string | null): string {
  const maxAge = token === null ? 0 : Math.floor(AWS_MARKETPLACE_CLAIM_TTL_MS / 1000)
  return `${AWS_MARKETPLACE_CLAIM_COOKIE}=${token ?? ''}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`
}
