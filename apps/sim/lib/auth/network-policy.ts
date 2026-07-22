import { getIp } from '@better-auth/core/utils/ip'
import { db } from '@sim/db'
import type { NetworkPolicySettings } from '@sim/db/schema'
import { organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import {
  type CompiledAllowlist,
  compileAllowlist,
  isAddressAllowed,
} from '@sim/platform-authz/network'
import { eq } from 'drizzle-orm'
import { getMemberOrganizationId } from '@/lib/auth/security-policy'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { env } from '@/lib/core/config/env'
import { isBillingEnabled } from '@/lib/core/config/env-flags'

const logger = createLogger('NetworkPolicy')

/** How long a compiled org network policy is served from process memory. */
export const NETWORK_POLICY_CACHE_TTL_MS = 60 * 1000

interface ResolvedNetworkPolicy {
  /** Compiled allowlist, or null when no restriction applies. */
  allowlist: CompiledAllowlist | null
}

interface PolicyCacheEntry {
  policy: ResolvedNetworkPolicy
  fetchedAt: number
}

const policyCache = new Map<string, PolicyCacheEntry>()

const NO_POLICY: ResolvedNetworkPolicy = { allowlist: null }

const trustedProxies = (env.AUTH_TRUSTED_PROXIES ?? '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean)

const IP_RESOLUTION_OPTIONS = {
  advanced: {
    ipAddress: trustedProxies.length > 0 ? { trustedProxies } : {},
  },
}

/**
 * Resolves the trusted client IP for a request using Better Auth's hardened
 * resolver and the same `AUTH_TRUSTED_PROXIES` configuration the auth server
 * uses — one resolution semantics platform-wide. Returns null when no
 * trustworthy address can be derived (multi-hop chain without configured
 * proxies).
 */
export function getTrustedClientIp(request: Request): string | null {
  return getIp(request, IP_RESOLUTION_OPTIONS)
}

/**
 * Resolves the EFFECTIVE network policy for an organization, served from a
 * short TTL cache. Mirrors the session policy's plan gating: hosted orgs no
 * longer on Enterprise stop enforcing automatically.
 */
export async function getNetworkPolicy(
  organizationId: string | null | undefined
): Promise<ResolvedNetworkPolicy> {
  if (!organizationId) return NO_POLICY

  const cached = policyCache.get(organizationId)
  if (cached && Date.now() - cached.fetchedAt < NETWORK_POLICY_CACHE_TTL_MS) {
    return cached.policy
  }

  try {
    const [row] = await db
      .select({ settings: organization.networkPolicySettings })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    const settings: NetworkPolicySettings = row?.settings ?? {}
    const allowlistSettings = settings.ipAllowlist
    const configured = Boolean(allowlistSettings?.enabled && allowlistSettings.cidrs.length > 0)
    const isEntitled =
      !configured || !isBillingEnabled || (await isOrganizationOnEnterprisePlan(organizationId))

    const policy: ResolvedNetworkPolicy =
      configured && isEntitled
        ? { allowlist: compileAllowlist(allowlistSettings!.cidrs) }
        : NO_POLICY
    policyCache.set(organizationId, { policy, fetchedAt: Date.now() })
    return policy
  } catch (error) {
    logger.error('Failed to resolve network policy; applying no policy', {
      organizationId,
      error,
    })
    return NO_POLICY
  }
}

/** Drops the cached policy for an org so the next read is fresh. */
export function invalidateNetworkPolicyCache(organizationId: string): void {
  policyCache.delete(organizationId)
}

export interface NetworkPolicyDecision {
  allowed: boolean
  /** Set on denials — safe to surface to the caller. */
  reason?: string
}

/**
 * Enforces the member org's IP allowlist for a user. `clientIp` is the
 * trusted-proxy-resolved address ({@link getTrustedClientIp} for requests,
 * Better Auth's `session.ipAddress` at session creation).
 *
 * Fail-closed by design: when a policy is active and no trustworthy client
 * IP can be derived, access is denied — a spoofable or absent address must
 * not bypass a network restriction. `DISABLE_ORG_IP_ALLOWLIST` is the
 * break-glass for misconfigured proxy topologies. Non-members and orgs
 * without an active policy are always allowed.
 */
export async function enforceOrgNetworkPolicy(
  userId: string | null | undefined,
  clientIp: string | null | undefined
): Promise<NetworkPolicyDecision> {
  if (env.DISABLE_ORG_IP_ALLOWLIST) return { allowed: true }

  const organizationId = await getMemberOrganizationId(userId)
  if (!organizationId) return { allowed: true }

  const policy = await getNetworkPolicy(organizationId)
  if (!policy.allowlist) return { allowed: true }

  if (!clientIp) {
    logger.warn('Denying request: network policy active but client IP unresolvable', {
      userId,
      organizationId,
    })
    return {
      allowed: false,
      reason: 'Access restricted by your organization network policy. Contact your administrator.',
    }
  }

  if (!isAddressAllowed(clientIp, policy.allowlist)) {
    return {
      allowed: false,
      reason: 'Access restricted by your organization network policy. Contact your administrator.',
    }
  }

  return { allowed: true }
}
