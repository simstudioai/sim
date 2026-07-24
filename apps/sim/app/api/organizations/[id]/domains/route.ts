import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { member, ssoDomain } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { getPostgresErrorCode } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, asc, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  addOrganizationDomainContract,
  MAX_ORGANIZATION_DOMAINS,
} from '@/lib/api/contracts/organization'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { normalizeSSODomain } from '@/lib/auth/sso/domain'
import { generateVerificationToken, toDomainResponse } from '@/lib/auth/sso/domain-verification'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('OrgDomainsAPI')

/**
 * GET /api/organizations/[id]/domains
 * Lists the organization's claimed domains and their verification state.
 * Accessible by any member.
 */
export const GET = withRouteHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: organizationId } = await params

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

    const isEnterprise = !isBillingEnabled || (await isOrganizationOnEnterprisePlan(organizationId))
    // Domain management is Enterprise-only, so a non-Enterprise org has no
    // domains to return — surface only the entitlement flag (which drives the
    // upgrade prompt) and never the list/tokens.
    if (!isEnterprise) {
      return NextResponse.json({ success: true, data: { isEnterprise: false, domains: [] } })
    }

    const rows = await db
      .select()
      .from(ssoDomain)
      .where(eq(ssoDomain.organizationId, organizationId))
      .orderBy(asc(ssoDomain.createdAt))

    // The pending TXT token is a management secret; only owner/admins (who can
    // add/verify/remove) may read it. Members see the list and status without it.
    const includeToken = isOrgAdminRole(memberEntry.role)
    return NextResponse.json({
      success: true,
      data: {
        isEnterprise: true,
        domains: rows.map((row) => toDomainResponse(row, { includeToken })),
      },
    })
  }
)

/**
 * POST /api/organizations/[id]/domains
 * Claims a domain and mints a DNS TXT verification token. Requires enterprise
 * plan and owner/admin role. The domain starts `pending`; the org proves
 * ownership by publishing the token and calling the verify endpoint.
 */
export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(addOrganizationDomainContract, request, context, {
      validationErrorResponse: (err) => validationErrorResponse(err, 'Invalid request body'),
    })
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
        { error: 'Forbidden - Only organization owners and admins can manage domains' },
        { status: 403 }
      )
    }
    if (isBillingEnabled && !(await isOrganizationOnEnterprisePlan(organizationId))) {
      return NextResponse.json(
        { error: 'Domain verification is available on Enterprise plans only' },
        { status: 403 }
      )
    }

    const domain = normalizeSSODomain(parsed.data.body.domain)
    if (!domain) {
      return NextResponse.json(
        { error: 'Enter a valid domain, for example acme.com' },
        { status: 400 }
      )
    }

    // A domain already verified by ANOTHER org cannot be claimed here; the
    // partial unique index enforces this at write time, but check first for a
    // clear error. Pending claims by others are allowed to coexist.
    const [verifiedElsewhere] = await db
      .select({ organizationId: ssoDomain.organizationId })
      .from(ssoDomain)
      .where(and(eq(ssoDomain.domain, domain), eq(ssoDomain.status, 'verified')))
      .limit(1)
    if (verifiedElsewhere && verifiedElsewhere.organizationId !== organizationId) {
      return NextResponse.json(
        { error: 'This domain is already verified by another organization' },
        { status: 409 }
      )
    }

    // One bounded read (an org holds at most MAX_ORGANIZATION_DOMAINS rows)
    // serves both the idempotent re-add check and the per-org cap.
    const orgDomains = await db
      .select()
      .from(ssoDomain)
      .where(eq(ssoDomain.organizationId, organizationId))

    const existing = orgDomains.find((d) => d.domain === domain)
    if (existing) {
      // Idempotent: re-adding a domain the org already has returns the existing
      // row unchanged. We deliberately do NOT rotate the token — the pending
      // token is always shown in the UI (so it is never "lost"), rotating would
      // invalidate a TXT record the admin may have already published, and under
      // concurrent re-adds a rotation could hand back a token that a racing
      // write has already superseded.
      return NextResponse.json({ success: true, data: { domain: toDomainResponse(existing) } })
    }

    if (orgDomains.length >= MAX_ORGANIZATION_DOMAINS) {
      return NextResponse.json(
        { error: `An organization can claim at most ${MAX_ORGANIZATION_DOMAINS} domains` },
        { status: 400 }
      )
    }

    let created: (typeof orgDomains)[number]
    try {
      ;[created] = await db
        .insert(ssoDomain)
        .values({
          id: generateId(),
          organizationId,
          domain,
          status: 'pending',
          verificationToken: generateVerificationToken(),
          createdBy: session.user.id,
        })
        .returning()
    } catch (error) {
      // A concurrent request for the same (org, domain) won the race and the
      // sso_domain_org_domain_unique index rejected this insert. Stay
      // idempotent: return the row that landed instead of surfacing a 500.
      if (getPostgresErrorCode(error) === '23505') {
        const [winner] = await db
          .select()
          .from(ssoDomain)
          .where(and(eq(ssoDomain.organizationId, organizationId), eq(ssoDomain.domain, domain)))
          .limit(1)
        if (winner) {
          return NextResponse.json({ success: true, data: { domain: toDomainResponse(winner) } })
        }
      }
      throw error
    }

    logger.info('Domain claimed for verification', { organizationId, domain })
    recordAudit({
      workspaceId: null,
      actorId: session.user.id,
      action: AuditAction.ORGANIZATION_DOMAIN_ADDED,
      resourceType: AuditResourceType.ORGANIZATION,
      resourceId: organizationId,
      actorName: session.user.name ?? undefined,
      actorEmail: session.user.email ?? undefined,
      description: `Claimed domain ${domain} for verification`,
      metadata: { domain },
      request,
    })

    return NextResponse.json({ success: true, data: { domain: toDomainResponse(created) } })
  }
)
