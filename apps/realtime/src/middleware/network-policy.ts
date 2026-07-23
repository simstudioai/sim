import { getIp } from '@better-auth/core/utils/ip'
import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { member, organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import {
  buildIpResolutionOptions,
  type CompiledAllowlist,
  compileAllowlist,
  isAddressAllowed,
  parseTrustedProxies,
} from '@sim/platform-authz/network'
import { eq } from 'drizzle-orm'

const logger = createLogger('SocketNetworkPolicy')

/** How long a resolved org network policy is served from process memory. */
const POLICY_CACHE_TTL_MS = 60 * 1000

interface CacheEntry {
  allowlist: CompiledAllowlist | null
  fetchedAt: number
}

const policyCache = new Map<string, CacheEntry>()
const membershipCache = new Map<string, { organizationId: string | null; fetchedAt: number }>()

const IP_RESOLUTION_OPTIONS = buildIpResolutionOptions(
  parseTrustedProxies(process.env.AUTH_TRUSTED_PROXIES)
)

/**
 * Non-member results converge fast (matching the app-side membership cache)
 * so a user who just joined an org through any path cannot dodge the policy
 * for the full positive TTL.
 */
const NEGATIVE_MEMBERSHIP_CACHE_TTL_MS = 15 * 1000

async function getMemberOrganizationId(userId: string): Promise<string | null> {
  const cached = membershipCache.get(userId)
  if (cached) {
    const ttl = cached.organizationId ? POLICY_CACHE_TTL_MS : NEGATIVE_MEMBERSHIP_CACHE_TTL_MS
    if (Date.now() - cached.fetchedAt < ttl) return cached.organizationId
  }
  const [row] = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .limit(1)
  const organizationId = row?.organizationId ?? null
  membershipCache.set(userId, { organizationId, fetchedAt: Date.now() })
  return organizationId
}

async function getOrgAllowlist(organizationId: string): Promise<CompiledAllowlist | null> {
  const cached = policyCache.get(organizationId)
  if (cached && Date.now() - cached.fetchedAt < POLICY_CACHE_TTL_MS) {
    return cached.allowlist
  }
  const [row] = await db
    .select({ settings: organization.networkPolicySettings })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1)
  const ipAllowlist = row?.settings?.ipAllowlist
  const allowlist =
    ipAllowlist?.enabled && ipAllowlist.cidrs.length > 0
      ? compileAllowlist(ipAllowlist.cidrs)
      : null
  policyCache.set(organizationId, { allowlist, fetchedAt: Date.now() })
  return allowlist
}

interface HandshakeLike {
  headers: Record<string, string | string[] | undefined>
}

/**
 * Per-member throttle for socket-denial audit events (this is a separate
 * process from the app, so it keeps its own map) — one event per member per
 * window is enough to show who is blocked without a reconnect loop flooding
 * the log.
 */
const DENIAL_AUDIT_WINDOW_MS = 5 * 60 * 1000
const lastDenialAuditAt = new Map<string, number>()

function recordSocketDenial(userId: string, organizationId: string, clientIp: string | null): void {
  const last = lastDenialAuditAt.get(userId)
  if (last && Date.now() - last < DENIAL_AUDIT_WINDOW_MS) return
  lastDenialAuditAt.set(userId, Date.now())
  recordAudit({
    workspaceId: null,
    actorId: userId,
    action: AuditAction.ORG_IP_ACCESS_DENIED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: organizationId,
    description: clientIp
      ? `Denied realtime connection from ${clientIp} by the IP allowlist`
      : 'Denied realtime connection by the IP allowlist (client IP unresolvable)',
    metadata: { clientIp, surface: 'realtime' },
  })
}

/**
 * Socket-handshake counterpart of the app's org IP-allowlist enforcement.
 * Resolves the client IP with Better Auth's trusted-proxy resolver from the
 * handshake headers, then checks the member org's allowlist. Shares the
 * app's posture: fail-closed on an unresolvable client IP (active policy +
 * no derivable trusted IP → deny), fail-open on an unexpected/DB error.
 *
 * Plan gating is intentionally absent here — `apps/realtime` cannot import
 * billing code. A downgraded org's stored-but-enabled policy therefore keeps
 * gating sockets until the org disables it (the app is the sole writer of
 * the settings), which is the safe direction for a security control.
 */
export async function isSocketAllowedByNetworkPolicy(
  userId: string,
  handshake: HandshakeLike
): Promise<boolean> {
  // Read at call time so the break-glass works without a realtime restart.
  if (process.env.DISABLE_ORG_IP_ALLOWLIST === 'true') return true

  try {
    const organizationId = await getMemberOrganizationId(userId)
    if (!organizationId) return true

    const allowlist = await getOrgAllowlist(organizationId)
    if (!allowlist) return true

    const headers = new Headers()
    for (const [key, value] of Object.entries(handshake.headers)) {
      if (typeof value === 'string') headers.set(key, value)
      else if (Array.isArray(value)) headers.set(key, value.join(', '))
    }
    // Trust only the trusted-proxy-resolved address — the same resolution the
    // app uses. No fallback to the raw socket peer: matching the app's
    // fail-closed-on-unresolvable-IP behavior is more important than salvaging
    // a direct-connect address the app-side check would never have accepted.
    const clientIp = getIp(
      new Request('http://socket.internal/', { headers }),
      IP_RESOLUTION_OPTIONS
    )

    if (!clientIp) {
      logger.warn('Denying socket: network policy active but client IP unresolvable', {
        userId,
        organizationId,
      })
      recordSocketDenial(userId, organizationId, null)
      return false
    }
    if (!isAddressAllowed(clientIp, allowlist)) {
      recordSocketDenial(userId, organizationId, clientIp)
      return false
    }
    return true
  } catch (error) {
    // Fail OPEN on an unexpected/DB error, matching the app-side network-policy
    // loader — a transient blip must not lock members out of collaboration.
    // The primary boundary (policy loaded, IP not allowed) stays fail-closed.
    logger.error('Network policy check failed; allowing socket', { userId, error })
    return true
  }
}
