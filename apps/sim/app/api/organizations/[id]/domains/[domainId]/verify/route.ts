import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { member, ssoDomain } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { verifyOrganizationDomainContract } from '@/lib/api/contracts/organization'
import { parseRequest } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { checkDomainTxtRecord, toDomainResponse } from '@/lib/auth/sso/domain-verification'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('OrgDomainVerifyAPI')

/**
 * POST /api/organizations/[id]/domains/[domainId]/verify
 * Checks the domain's DNS TXT challenge record; on success flips it to
 * `verified`. Requires enterprise plan and owner/admin role. A domain already
 * verified by another org is refused (the partial unique index also guards it).
 */
export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string; domainId: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(verifyOrganizationDomainContract, request, context)
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
        { error: 'Forbidden - Only organization owners and admins can verify domains' },
        { status: 403 }
      )
    }
    if (isBillingEnabled && !(await isOrganizationOnEnterprisePlan(organizationId))) {
      return NextResponse.json(
        { error: 'Domain verification is available on Enterprise plans only' },
        { status: 403 }
      )
    }

    const [row] = await db
      .select()
      .from(ssoDomain)
      .where(and(eq(ssoDomain.id, domainId), eq(ssoDomain.organizationId, organizationId)))
      .limit(1)
    if (!row) {
      return NextResponse.json({ error: 'Domain not found' }, { status: 404 })
    }
    if (row.status === 'verified') {
      return NextResponse.json({ success: true, data: { domain: toDomainResponse(row) } })
    }

    const recordPresent = await checkDomainTxtRecord(row.domain, row.verificationToken)
    if (!recordPresent) {
      return NextResponse.json(
        {
          error:
            'The verification TXT record was not found yet. DNS changes can take up to 48 hours to propagate — add the record shown and try again.',
        },
        { status: 422 }
      )
    }

    // Guard the race where another org verified the same domain between claim
    // and verify (the partial unique index would also reject the update).
    const [verifiedElsewhere] = await db
      .select({ organizationId: ssoDomain.organizationId })
      .from(ssoDomain)
      .where(and(eq(ssoDomain.domain, row.domain), eq(ssoDomain.status, 'verified')))
      .limit(1)
    if (verifiedElsewhere && verifiedElsewhere.organizationId !== organizationId) {
      return NextResponse.json(
        { error: 'This domain was verified by another organization' },
        { status: 409 }
      )
    }

    const [updated] = await db
      .update(ssoDomain)
      .set({ status: 'verified', verifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(ssoDomain.id, domainId))
      .returning()

    logger.info('Domain verified', { organizationId, domain: row.domain })
    recordAudit({
      workspaceId: null,
      actorId: session.user.id,
      action: AuditAction.ORGANIZATION_DOMAIN_VERIFIED,
      resourceType: AuditResourceType.ORGANIZATION,
      resourceId: organizationId,
      actorName: session.user.name ?? undefined,
      actorEmail: session.user.email ?? undefined,
      description: `Verified domain ${row.domain}`,
      metadata: { domain: row.domain },
      request,
    })

    return NextResponse.json({ success: true, data: { domain: toDomainResponse(updated) } })
  }
)
