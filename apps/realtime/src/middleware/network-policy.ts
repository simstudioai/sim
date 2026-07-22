import { getIp } from '@better-auth/core/utils/ip'
import { db } from '@sim/db'
import { member, organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import {
  type CompiledAllowlist,
  compileAllowlist,
  isAddressAllowed,
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

const trustedProxies = (process.env.AUTH_TRUSTED_PROXIES ?? '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean)

const IP_RESOLUTION_OPTIONS = {
  advanced: {
    ipAddress: trustedProxies.length > 0 ? { trustedProxies } : {},
  },
}

const enforcementDisabled = process.env.DISABLE_ORG_IP_ALLOWLIST === 'true'

async function getMemberOrganizationId(userId: string): Promise<string | null> {
  const cached = membershipCache.get(userId)
  if (cached && Date.now() - cached.fetchedAt < POLICY_CACHE_TTL_MS) {
    return cached.organizationId
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
  address: string
}

/**
 * Socket-handshake counterpart of the app's org IP-allowlist enforcement.
 * Resolves the client IP with Better Auth's trusted-proxy resolver from the
 * handshake headers (falling back to the socket peer address when no
 * forwarding headers are present), then checks the member org's allowlist.
 * Fail-closed like the app side: an active policy with an unresolvable
 * client IP denies the connection.
 *
 * Plan gating is intentionally absent here — `apps/realtime` cannot import
 * billing code. A downgraded org's stale policy denies sockets for at most
 * the policy-cache TTL beyond the app-side gate, and the app is the sole
 * writer of the settings.
 */
export async function isSocketAllowedByNetworkPolicy(
  userId: string,
  handshake: HandshakeLike
): Promise<boolean> {
  if (enforcementDisabled) return true

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
    const clientIp =
      getIp(new Request('http://socket.internal/', { headers }), IP_RESOLUTION_OPTIONS) ??
      (handshake.address || null)

    if (!clientIp) {
      logger.warn('Denying socket: network policy active but client IP unresolvable', {
        userId,
        organizationId,
      })
      return false
    }
    return isAddressAllowed(clientIp, allowlist)
  } catch (error) {
    logger.error('Network policy check failed; denying socket', { userId, error })
    return false
  }
}
