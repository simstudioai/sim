/** RFC 2606 §2 reserved TLD — permanently unregistrable and unroutable. */
const SYNTHETIC_EMAIL_DOMAIN = 'connectors.sim.invalid'

/** Longest local-part segment kept, so the address stays under the 64-char RFC 5321 limit. */
const MAX_SEGMENT_LENGTH = 30

/**
 * Reduce an arbitrary upstream identifier to characters that are unambiguously
 * legal in an unquoted email local part.
 */
function sanitizeLocalPart(value: string): string {
  return (
    value
      .replace(/[^a-zA-Z0-9._-]/g, '')
      .slice(0, MAX_SEGMENT_LENGTH)
      // RFC 5321 `dot-string` is `Atom *("." Atom)`, so a run of separators is not
      // a legal local part — and stripping illegal characters readily creates one.
      .replace(/[._-]{2,}/g, '-')
      .replace(/^[._-]+|[._-]+$/g, '')
  )
}

/**
 * Synthetic placeholder email for an OAuth connector identity.
 *
 * Many connector providers either never expose an email (X, Slack bot tokens,
 * TikTok, Reddit, Webflow) or expose one only when an optional scope was
 * granted. Better Auth still demands one: in `better-auth@1.6.23`,
 * `dist/plugins/generic-oauth/routes.mjs` hard-rejects a falsy `email` returned
 * from `getUserInfo` by throwing a redirect to `?error=email_is_missing`. There
 * is no option to disable that guard, so every `getUserInfo` must return a
 * truthy address or the connect flow dies at the callback.
 *
 * The value is never persisted. Sim's connectors go through the session-bound
 * `oauth2.link` path, the `account` table has no email column, and
 * `updateUserInfoOnLink` is unset — so Better Auth reads the address, satisfies
 * its own guard, and discards it. It is never shown to a user, never mailed to,
 * and never matched against a real account.
 *
 * The domain is `.invalid`, reserved by RFC 2606 §2 precisely so that it can
 * never be registered or routed. Earlier code synthesized addresses on live
 * third-party domains (`@x.com`, `@salesforce.com`, `@atlassian.com`, …), which
 * are owned by other companies and could in principle resolve to a real
 * mailbox.
 *
 * Delete this helper and return the upstream email directly once Better Auth
 * relaxes the guard (tracked in better-auth issue #9124, slated for v2).
 *
 * @param providerId - Connector provider id, e.g. `'attio'`. Namespaces the
 *   address so two providers reporting the same external id do not collide.
 * @param stableId - Stable external identifier for the connected identity
 *   (workspace member id, account id, username, …). Falsy or fully-unsupported
 *   values degrade to `unknown`; uniqueness is best-effort because the address
 *   is discarded either way.
 * @returns An RFC 5321-shaped address on a permanently unroutable domain.
 */
export function syntheticConnectorEmail(providerId: string, stableId?: string | number): string {
  const provider = sanitizeLocalPart(providerId) || 'connector'
  const identity = sanitizeLocalPart(stableId == null ? '' : String(stableId)) || 'unknown'
  return `${provider}-${identity}@${SYNTHETIC_EMAIL_DOMAIN}`
}
