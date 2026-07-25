import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { sql } from 'drizzle-orm'
import { MIN_IDLE_TIMEOUT_HOURS } from '@/lib/api/contracts/organization'
import {
  getMemberOrganizationId,
  getOrgSecurityRecord,
  invalidateMembershipCache,
} from '@/lib/auth/security-policy'
import { resolveOrganizationEnterprisePlan } from '@/lib/billing/core/subscription'

const logger = createLogger('SessionPolicy')

const HOUR_MS = 60 * 60 * 1000

export interface ResolvedSessionPolicy {
  maxSessionHours: number | null
  idleTimeoutHours: number | null
}

const NO_POLICY: ResolvedSessionPolicy = {
  maxSessionHours: null,
  idleTimeoutHours: null,
}

/**
 * Entitlement is billing state, so it is cached independently of the org
 * security record: a policy save must invalidate the policy, but it says
 * nothing about the plan. The TTL matters because saving a policy or revoking
 * org-wide makes every member session refresh at once — without it, each of
 * those refreshes would re-run the plan check and stampede the billing tables.
 * Staleness is harmless in both directions: a just-downgraded org keeps
 * enforcing for one TTL, and a just-upgraded one starts one TTL late.
 */
const ENTITLEMENT_CACHE_TTL_MS = 60 * 1000
const MAX_ENTITLEMENT_CACHE_ENTRIES = 5_000

const entitlementCache = new Map<string, { entitled: boolean; fetchedAt: number }>()

/**
 * Whether stored session bounds should be enforced for this org. Mirroring
 * data-retention's plan-gated effective settings, a hosted org that leaves the
 * Enterprise plan stops enforcing its stored limits automatically, since the
 * enterprise-gated settings UI can no longer manage them.
 *
 * A FAILED entitlement read enforces instead of skipping: bounds are only
 * writable by an entitled org (the PUT route gates on it), so their presence is
 * the source of truth when the plan check itself is unavailable. Fail-open here
 * would let a transient billing-read blip silently disable a security control —
 * the same reasoning the PII-redaction path documents in
 * `lib/logs/execution/logger.ts`.
 */
async function isPolicyEnforced(organizationId: string, hasBounds: boolean): Promise<boolean> {
  // Orgs with nothing stored are the common case and need no plan check at all.
  if (!hasBounds) return true

  const cached = entitlementCache.get(organizationId)
  if (cached && Date.now() - cached.fetchedAt < ENTITLEMENT_CACHE_TTL_MS) {
    return cached.entitled
  }

  try {
    const entitled = await resolveOrganizationEnterprisePlan(organizationId)
    // Entitled orgs are few, so a wholesale clear at the cap is enough — no
    // eviction policy needed for a set this small and this slow-moving.
    if (entitlementCache.size >= MAX_ENTITLEMENT_CACHE_ENTRIES) entitlementCache.clear()
    entitlementCache.set(organizationId, { entitled, fetchedAt: Date.now() })
    return entitled
  } catch (error) {
    logger.error('Enterprise entitlement check failed; enforcing stored session policy', {
      organizationId,
      error,
    })
    return cached?.entitled ?? true
  }
}

/**
 * Resolves the EFFECTIVE session policy for an organization. Returns a no-op
 * policy for personal (org-less) sessions and for orgs that are no longer
 * entitled.
 *
 * The stored settings come from the shared org security record, so the policy a
 * caller sees is always the one that matches the cookie-cache version it sees.
 * Pass `bypassCache` on paths that must not act on a policy up to one cache TTL
 * old — notably session CREATE, which (unlike a refresh) is not already preceded
 * by a version-mismatch read and would otherwise mint an unclamped session from
 * a stale record.
 */
export async function getSessionPolicy(
  organizationId: string | null | undefined,
  options: { bypassCache?: boolean } = {}
): Promise<ResolvedSessionPolicy> {
  if (!organizationId) return NO_POLICY

  const { sessionPolicySettings } = await getOrgSecurityRecord(organizationId, options)
  const settings = sessionPolicySettings ?? {}
  const hasBounds = Boolean(settings.maxSessionHours || settings.idleTimeoutHours)
  if (!(await isPolicyEnforced(organizationId, hasBounds))) return NO_POLICY

  return {
    maxSessionHours: settings.maxSessionHours ?? null,
    idleTimeoutHours: settings.idleTimeoutHours ?? null,
  }
}

/**
 * Clamps a proposed session `expiresAt` to the org policy:
 * `min(proposed, createdAt + maxSessionHours, now + idleTimeoutHours)`.
 *
 * Better Auth's sliding refresh rewrites `expiresAt` to `now + expiresIn`
 * (30 days) on every refresh, which would silently stretch a shortened
 * session back out — so this clamp must run in BOTH the session create and
 * session update database hooks. The idle floor guards values that bypassed
 * contract validation (legacy rows, direct DB writes).
 */
export function clampSessionExpiry(
  policy: ResolvedSessionPolicy,
  createdAt: Date,
  proposedExpiresAt: Date,
  now: Date = new Date()
): Date {
  let clamped = proposedExpiresAt.getTime()
  if (policy.maxSessionHours) {
    clamped = Math.min(clamped, createdAt.getTime() + policy.maxSessionHours * HOUR_MS)
  }
  if (policy.idleTimeoutHours) {
    const idleHours = Math.max(policy.idleTimeoutHours, MIN_IDLE_TIMEOUT_HOURS)
    clamped = Math.min(clamped, now.getTime() + idleHours * HOUR_MS)
  }
  return new Date(clamped)
}

/**
 * Session shape shared by the Better Auth create/update database hooks —
 * the fields the clamp guards need.
 */
interface ClampableSession {
  userId?: string | null
  impersonatedBy?: string | null
  createdAt?: Date | string | null
  expiresAt?: Date | string | null
}

/**
 * Applies the org session policy to a session's proposed `expiresAt` from a
 * Better Auth database hook. The governing org is the user's MEMBERSHIP —
 * never the session row's `activeOrganizationId`, which goes stale on
 * join/leave/transfer — matching the cookie-cache version resolution, so
 * every member session (including ones created before the user joined or
 * carried across a transfer) is governed consistently. Callers that have
 * JUST resolved the membership themselves (the session create hook) pass it
 * as `freshMembershipOrgId` to skip the duplicate lookup. Returns the
 * original date when no clamp applies: impersonation sessions are
 * platform-admin tooling with their own short expiry, and non-member
 * sessions have no policy.
 */
export async function clampExpiryForSession(
  session: ClampableSession,
  freshMembershipOrgId?: string | null,
  options: { bypassPolicyCache?: boolean } = {}
): Promise<Date | undefined> {
  // Better Auth context values can cross a serialization boundary — normalize
  // date fields in case they arrive as ISO strings rather than Dates.
  const expiresAt = session.expiresAt ? new Date(session.expiresAt) : undefined
  if (!expiresAt || session.impersonatedBy) {
    return expiresAt
  }
  const organizationId =
    freshMembershipOrgId !== undefined
      ? freshMembershipOrgId
      : await getMemberOrganizationId(session.userId)
  if (!organizationId) return expiresAt

  const policy = await getSessionPolicy(organizationId, {
    bypassCache: options.bypassPolicyCache,
  })
  const createdAt = session.createdAt ? new Date(session.createdAt) : new Date()
  return clampSessionExpiry(policy, createdAt, expiresAt)
}

/**
 * Eagerly clamps every existing member session to the given policy in a
 * single SQL statement — the SQL twin of {@link clampSessionExpiry}, kept in
 * this module so the two encodings of the clamp cannot drift. Runs when a
 * policy is saved so tightening applies without waiting for each session's
 * next refresh; `LEAST` never extends an already-shorter expiry, and
 * impersonation sessions are exempt. Targets sessions by org MEMBERSHIP (not
 * `active_organization_id`) — the same scope the hooks govern via the
 * membership fallback. No-ops when the policy sets no bounds.
 */
export async function eagerClampOrgSessions(
  organizationId: string,
  policy: ResolvedSessionPolicy,
  executor: Pick<typeof db, 'execute'> = db
): Promise<void> {
  const bounds = clampBoundsSql(policy)
  if (!bounds) return

  await executor.execute(sql`
    UPDATE "session" SET expires_at = LEAST(${bounds})
    WHERE impersonated_by IS NULL
      AND user_id IN (
        SELECT user_id FROM member WHERE organization_id = ${organizationId}
      )
  `)
}

/**
 * Applies the org's session policy to a user who just JOINED the org:
 * invalidates their cached membership (so the cookie-version and hook-clamp
 * fallbacks see the new org immediately) and clamps their pre-join sessions,
 * which otherwise keep their old expiry until the next sliding refresh.
 * Best-effort by design — a failure here must never fail the join; the
 * update-hook clamp self-heals within one refresh cycle.
 */
export async function applySessionPolicyToNewMember(
  userId: string,
  organizationId: string
): Promise<void> {
  try {
    invalidateMembershipCache(userId)
    // Bypass the cache: a user joining moments after a policy save must be
    // clamped to the policy that was just written, not a pre-save record this
    // process may still be holding.
    const policy = await getSessionPolicy(organizationId, { bypassCache: true })
    const bounds = clampBoundsSql(policy)
    if (!bounds) return

    await db.execute(sql`
      UPDATE "session" SET expires_at = LEAST(${bounds})
      WHERE user_id = ${userId} AND impersonated_by IS NULL
    `)
  } catch (error) {
    logger.error('Failed to apply session policy to new member; next refresh re-clamps', {
      userId,
      organizationId,
      error,
    })
  }
}

/** SQL argument list for the LEAST() clamp, or null when the policy is empty. */
function clampBoundsSql(policy: ResolvedSessionPolicy) {
  const bounds = [sql`expires_at`]
  if (policy.maxSessionHours) {
    const maxSecs = policy.maxSessionHours * 3600
    bounds.push(sql`created_at + make_interval(secs => ${maxSecs})`)
  }
  if (policy.idleTimeoutHours) {
    const idleSecs = Math.max(policy.idleTimeoutHours, MIN_IDLE_TIMEOUT_HOURS) * 3600
    bounds.push(sql`now() + make_interval(secs => ${idleSecs})`)
  }
  if (bounds.length === 1) return null
  return sql.join(bounds, sql`, `)
}
