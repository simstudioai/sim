import type { Principal } from '@sim/auth/principal'

/**
 * The surface a semantic audit row attributes a change to.
 *
 * Derived from the authenticated principal rather than hardcoded, because an
 * operation's principal policy can widen: a `source` literal written when a use
 * case had exactly one caller becomes a false audit row the moment a second one
 * is admitted, and a false row is worse than no row.
 *
 * A delegated principal names its service (`copilot`, `executor`) — "which agent
 * did this" is the distinction a reviewer reads the row for. Every other kind
 * names its own credential class, which is already what `actor` records.
 */
export function principalAuditSource(principal: Principal): string {
  return principal.kind === 'delegated' ? principal.serviceId : principal.kind
}
