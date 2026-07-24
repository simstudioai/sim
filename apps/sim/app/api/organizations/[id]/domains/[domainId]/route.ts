import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { member, ssoDomain } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { removeOrganizationDomainContract } from '@/lib/api/contracts/organization'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('OrgDomainDeleteAPI')

/**
 * DELETE /api/organizations/[id]/domains/[domainId]
 * Removes a claimed/verified domain. Requires owner/admin role. Removing a
 * verified domain drops the ownership proof, so SSO can no longer be configured
 * for it until it is re-verified. It does not retroactively un-register an
 * already-configured SSO provider — that flows through the SSO provider itself.
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

    const [removed] = await db
      .delete(ssoDomain)
      .where(and(eq(ssoDomain.id, domainId), eq(ssoDomain.organizationId, organizationId)))
      .returning({ domain: ssoDomain.domain })

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
