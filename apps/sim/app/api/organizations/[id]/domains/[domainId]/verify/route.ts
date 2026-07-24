import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { member, ssoDomain } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { getPostgresErrorCode } from '@sim/utils/errors'
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

    // Friendly early return for the common case where another org already owns
    // the domain (the partial unique index is the actual enforcer, below).
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

    // Flip to verified only if the row is still the exact pending challenge we
    // checked. If it was deleted, re-tokenized, or already verified while the
    // DNS lookup was in flight, this matches zero rows — we then ask for a retry
    // instead of mapping an undefined row or trusting a superseded challenge. A
    // concurrent cross-org verification trips the partial unique index; surface
    // that as a 409 rather than an unhandled 500.
    let updated: (typeof row)[]
    try {
      updated = await db
        .update(ssoDomain)
        .set({ status: 'verified', verifiedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(ssoDomain.id, domainId),
            eq(ssoDomain.verificationToken, row.verificationToken),
            eq(ssoDomain.status, 'pending')
          )
        )
        .returning()
    } catch (error) {
      if (getPostgresErrorCode(error) === '23505') {
        return NextResponse.json(
          { error: 'This domain was verified by another organization' },
          { status: 409 }
        )
      }
      throw error
    }

    if (updated.length === 0) {
      // The conditional update matched nothing. If a concurrent request for this
      // same org already flipped the row to verified, treat this as an idempotent
      // success; otherwise the challenge is genuinely stale (row deleted or
      // re-tokenized mid-lookup) and we ask the caller to retry.
      const [current] = await db
        .select()
        .from(ssoDomain)
        .where(and(eq(ssoDomain.id, domainId), eq(ssoDomain.organizationId, organizationId)))
        .limit(1)
      if (current?.status === 'verified') {
        return NextResponse.json({ success: true, data: { domain: toDomainResponse(current) } })
      }
      return NextResponse.json(
        { error: 'The domain changed during verification. Refresh and try again.' },
        { status: 409 }
      )
    }

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

    return NextResponse.json({ success: true, data: { domain: toDomainResponse(updated[0]) } })
  }
)
