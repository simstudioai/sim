import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { member, ssoDomain, ssoProvider } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { removeOrganizationDomainContract } from '@/lib/api/contracts/organization'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('OrgDomainDeleteAPI')

/**
 * DELETE /api/organizations/[id]/domains/[domainId]
 * Removes a claimed/verified domain. Requires owner/admin role. Removing a
 * verified domain drops the ownership proof, so SSO can no longer be configured
 * for it until it is re-verified, and any provider already on that domain loses
 * its `domainVerified` trust in the same transaction. The provider itself is not
 * un-registered — that flows through the SSO provider — but it can no longer
 * auto-link sign-ins to existing accounts.
 */
export const DELETE = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string; domainId: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(removeOrganizationDomainContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: organizationId, domainId } = parsed.data.params

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
        { error: 'Forbidden - Only organization owners and admins can remove domains' },
        { status: 403 }
      )
    }
    // Enterprise-gate removal like add/verify so all domain mutations require the
    // same entitlement (the UI already hides removal from non-Enterprise orgs).
    if (isBillingEnabled && !(await isOrganizationOnEnterprisePlan(organizationId))) {
      return NextResponse.json(
        { error: 'Domain verification is available on Enterprise plans only' },
        { status: 403 }
      )
    }

    // Removing the proof withdraws the trust it granted, in the same transaction
    // so a domain can never be gone while its provider still claims verification.
    const removed = await db.transaction(async (tx) => {
      const [deleted] = await tx
        .delete(ssoDomain)
        .where(and(eq(ssoDomain.id, domainId), eq(ssoDomain.organizationId, organizationId)))
        .returning({ domain: ssoDomain.domain })

      if (!deleted) return null

      // Normalize as migration 0268 did when grandfathering these rows (lower,
      // trimmed, leading `*.` stripped), so `*.acme.com` matches proof `acme.com`.
      await tx
        .update(ssoProvider)
        .set({ domainVerified: false })
        .where(
          and(
            eq(ssoProvider.organizationId, organizationId),
            sql`lower(regexp_replace(btrim(${ssoProvider.domain}), '^\\*\\.', '')) = ${deleted.domain}`
          )
        )

      return deleted
    })

    if (!removed) {
      return NextResponse.json({ error: 'Domain not found' }, { status: 404 })
    }

    logger.info('Domain removed', { organizationId, domain: removed.domain })
    recordAudit({
      workspaceId: null,
      actorId: session.user.id,
      action: AuditAction.ORGANIZATION_DOMAIN_REMOVED,
      resourceType: AuditResourceType.ORGANIZATION,
      resourceId: organizationId,
      actorName: session.user.name ?? undefined,
      actorEmail: session.user.email ?? undefined,
      description: `Removed domain ${removed.domain}`,
      metadata: { domain: removed.domain },
      request,
    })

    return NextResponse.json({ success: true })
  }
)
