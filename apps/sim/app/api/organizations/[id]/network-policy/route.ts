import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import type { NetworkPolicySettings } from '@sim/db/schema'
import { member, organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { compileAllowlist, isAddressAllowed } from '@sim/platform-authz/network'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { updateOrganizationNetworkPolicyContract } from '@/lib/api/contracts/organization'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { getTrustedClientIp, invalidateNetworkPolicyCache } from '@/lib/auth/network-policy'
import { invalidateSecurityPolicyVersionCache } from '@/lib/auth/security-policy'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('NetworkPolicyAPI')

function normalizeConfigured(settings: NetworkPolicySettings | null | undefined) {
  return {
    enabled: settings?.ipAllowlist?.enabled ?? false,
    cidrs: settings?.ipAllowlist?.cidrs ?? [],
  }
}

/**
 * GET /api/organizations/[id]/network-policy
 * Returns the organization's network policy and the caller's trusted client
 * IP (surfaced by the settings UI for the lockout guard). Accessible by any
 * member.
 */
export const GET = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: organizationId } = await params

    const [memberEntry] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, session.user.id)))
      .limit(1)

    if (!memberEntry) {
      return NextResponse.json(
        { error: 'Forbidden - Not a member of this organization' },
        { status: 403 }
      )
    }

    const [org] = await db
      .select({ networkPolicySettings: organization.networkPolicySettings })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    const isEnterprise = !isBillingEnabled || (await isOrganizationOnEnterprisePlan(organizationId))

    return NextResponse.json({
      success: true,
      data: {
        isEnterprise,
        configured: normalizeConfigured(org.networkPolicySettings),
        callerIp: getTrustedClientIp(request),
      },
    })
  }
)

/**
 * PUT /api/organizations/[id]/network-policy
 * Updates the organization's IP allowlist. Requires enterprise plan and
 * owner/admin role. Lockout guard: enabling a policy that would exclude the
 * caller's own current IP is rejected — an admin must not be able to lock
 * the whole org (including themselves) out in one save.
 */
export const PUT = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(updateOrganizationNetworkPolicyContract, request, context, {
      validationErrorResponse: (err) => validationErrorResponse(err, 'Invalid request body'),
    })
    if (!parsed.success) return parsed.response

    const { id: organizationId } = parsed.data.params
    const { ipAllowlist } = parsed.data.body

    const [memberEntry] = await db
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, session.user.id)))
      .limit(1)

    if (!memberEntry) {
      return NextResponse.json(
        { error: 'Forbidden - Not a member of this organization' },
        { status: 403 }
      )
    }

    if (!isOrgAdminRole(memberEntry.role)) {
      return NextResponse.json(
        { error: 'Forbidden - Only organization owners and admins can update the network policy' },
        { status: 403 }
      )
    }

    if (isBillingEnabled) {
      const hasEnterprise = await isOrganizationOnEnterprisePlan(organizationId)
      if (!hasEnterprise) {
        return NextResponse.json(
          { error: 'IP access restrictions are available on Enterprise plans only' },
          { status: 403 }
        )
      }
    }

    const callerIp = getTrustedClientIp(request)
    if (ipAllowlist.enabled && ipAllowlist.cidrs.length > 0) {
      if (!callerIp) {
        return NextResponse.json(
          {
            error:
              'Cannot enable the IP allowlist: your client IP could not be determined. Check the AUTH_TRUSTED_PROXIES configuration.',
          },
          { status: 400 }
        )
      }
      if (!isAddressAllowed(callerIp, compileAllowlist(ipAllowlist.cidrs))) {
        return NextResponse.json(
          {
            error: `Your current IP (${callerIp}) is not in the allowlist — saving would lock you out. Add it and try again.`,
          },
          { status: 400 }
        )
      }
    }

    const [currentOrg] = await db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    if (!currentOrg) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    const merged: NetworkPolicySettings = {
      ipAllowlist: { enabled: ipAllowlist.enabled, cidrs: ipAllowlist.cidrs },
    }

    // The version bump rides the settings UPDATE (same row, one round trip)
    // so members' cached session cookies re-validate against the new policy.
    const [updated] = await db
      .update(organization)
      .set({
        networkPolicySettings: merged,
        securityPolicyVersion: sql`${organization.securityPolicyVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(organization.id, organizationId))
      .returning({ id: organization.id })

    if (!updated) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    invalidateNetworkPolicyCache(organizationId)
    invalidateSecurityPolicyVersionCache(organizationId)

    logger.info('Updated organization network policy', {
      organizationId,
      enabled: ipAllowlist.enabled,
      entries: ipAllowlist.cidrs.length,
    })

    recordAudit({
      workspaceId: null,
      actorId: session.user.id,
      action: AuditAction.ORGANIZATION_NETWORK_POLICY_UPDATED,
      resourceType: AuditResourceType.ORGANIZATION,
      resourceId: organizationId,
      actorName: session.user.name ?? undefined,
      actorEmail: session.user.email ?? undefined,
      resourceName: currentOrg.name,
      description: ipAllowlist.enabled
        ? `Enabled IP allowlist with ${ipAllowlist.cidrs.length} entr${ipAllowlist.cidrs.length === 1 ? 'y' : 'ies'}`
        : 'Disabled IP allowlist',
      metadata: { enabled: ipAllowlist.enabled, entries: ipAllowlist.cidrs.length },
      request,
    })

    return NextResponse.json({
      success: true,
      data: {
        isEnterprise: true,
        configured: normalizeConfigured(merged),
        callerIp,
      },
    })
  }
)
