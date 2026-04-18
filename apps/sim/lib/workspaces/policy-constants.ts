/**
 * Shared constants for workspace policy messaging. Separated from
 * `policy.ts` so client components can import them without pulling in
 * server-only dependencies (`@sim/db`, drizzle helpers, etc.).
 */

export const UPGRADE_TO_INVITE_REASON = 'Upgrade to invite more members'
export const CONTACT_OWNER_TO_UPGRADE_REASON = 'Contact workspace owner to upgrade'
