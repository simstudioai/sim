import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { member, organization, session as sessionTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { and, eq, inArray, isNull, ne } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { revokeOrganizationSessionsContract } from '@/lib/api/contracts/organization'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { bumpSecurityPolicyVersion } from '@/lib/auth/security-policy'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('OrgSessionsRevokeAPI')

/**
 * POST /api/organizations/[id]/sessions/revoke
 * Deletes every member session in the organization except the caller's
 * current one, then bumps the security-policy version so cached session
 * cookies invalidate on their next request. Requires enterprise plan and
 * owner/admin role. Impersonation sessions are platform tooling and spared.
 */
export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(revokeOrganizationSessionsContract, request, context)
    if (!parsed.success) return parsed.response
    const { id: organizationId } = parsed.data.params

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
        { error: 'Forbidden - Only organization owners and admins can revoke sessions' },
        { status: 403 }
      )
    }

    if (isBillingEnabled) {
      const hasEnterprise = await isOrganizationOnEnterprisePlan(organizationId)
      if (!hasEnterprise) {
        return NextResponse.json(
          { error: 'Session management is available on Enterprise plans only' },
          { status: 403 }
        )
      }
    }

    const [org] = await db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    const revoked = await db
      .delete(sessionTable)
      .where(
        and(
          inArray(
            sessionTable.userId,
            db
              .select({ userId: member.userId })
              .from(member)
              .where(eq(member.organizationId, organizationId))
          ),
          isNull(sessionTable.impersonatedBy),
          ne(sessionTable.token, session.session.token)
        )
      )
      .returning({ id: sessionTable.id })

    // Cached session cookies outlive the DB rows for up to 24h — the version
    // bump forces every cached cookie in the org to re-validate against the
    // DB (and fail) on its next request.
    await bumpSecurityPolicyVersion(organizationId)

    logger.info('Revoked organization sessions', {
      organizationId,
      revokedSessions: revoked.length,
    })

    recordAudit({
      workspaceId: null,
      actorId: session.user.id,
      action: AuditAction.ORGANIZATION_SESSIONS_REVOKED,
      resourceType: AuditResourceType.ORGANIZATION,
      resourceId: organizationId,
      actorName: session.user.name ?? undefined,
      actorEmail: session.user.email ?? undefined,
      resourceName: org.name,
      description: `Revoked ${revoked.length} member session${revoked.length === 1 ? '' : 's'}`,
      metadata: { revokedSessions: revoked.length },
      request,
    })

    return NextResponse.json({
      success: true,
      data: { revokedSessions: revoked.length },
    })
  }
)
