import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { member, organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { updateOrganizationSsoPolicyContract } from '@/lib/api/contracts/organization'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { hasSignInCapableSsoProvider } from '@/lib/auth/sso/verified-provider'
import { invalidateSsoPolicyCache } from '@/lib/auth/sso-policy'
import { isOrganizationFeatureEntitled } from '@/lib/billing/core/subscription'
import { isBillingEnabled, isSsoEnabled } from '@/lib/core/config/env-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('SsoPolicyAPI')

/**
 * GET /api/organizations/[id]/sso-policy
 * Returns whether members must sign in through the organization's identity
 * provider. Readable by any member.
 */
export const GET = withRouteHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
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
      .select({ requireSso: organization.requireSso })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      data: {
        requireSso: org.requireSso,
        hasVerifiedProvider: await hasSignInCapableSsoProvider(organizationId),
      },
    })
  }
)

/**
 * PUT /api/organizations/[id]/sso-policy
 * Turns the single sign-on requirement on or off. The policy is read when a
 * session is created, so a change never ends a session that already exists —
 * signing everyone out stays the separate revoke action. Requires enterprise
 * entitlement and an owner/admin role.
 */
export const PUT = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(updateOrganizationSsoPolicyContract, request, context, {
      validationErrorResponse: (err) => validationErrorResponse(err, 'Invalid request body'),
    })
    if (!parsed.success) return parsed.response

    const { id: organizationId } = parsed.data.params
    const { requireSso } = parsed.data.body

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
        {
          error:
            'Forbidden - Only organization owners and admins can change the single sign-on requirement',
        },
        { status: 403 }
      )
    }

    const entitled = await isOrganizationFeatureEntitled(organizationId, isSsoEnabled)
    if (!entitled) {
      return NextResponse.json(
        {
          error: isBillingEnabled
            ? 'Single Sign-On is available on Enterprise plans only'
            : 'Single Sign-On is disabled. Set ENTERPRISE_ENABLED or SSO_ENABLED to enable it.',
        },
        { status: 403 }
      )
    }

    const [currentOrg] = await db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    if (!currentOrg) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    const verifiedProvider = await hasSignInCapableSsoProvider(organizationId)
    if (requireSso && !verifiedProvider) {
      return NextResponse.json(
        {
          error: 'Add an identity provider on a verified domain before requiring single sign-on',
        },
        { status: 400 }
      )
    }

    const [updated] = await db
      .update(organization)
      .set({ requireSso, updatedAt: new Date() })
      .where(eq(organization.id, organizationId))
      .returning({ id: organization.id })

    if (!updated) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    invalidateSsoPolicyCache(organizationId)

    logger.info('Updated organization single sign-on requirement', { organizationId, requireSso })

    recordAudit({
      workspaceId: null,
      actorId: session.user.id,
      action: AuditAction.ORGANIZATION_SSO_POLICY_UPDATED,
      resourceType: AuditResourceType.ORGANIZATION,
      resourceId: organizationId,
      actorName: session.user.name ?? undefined,
      actorEmail: session.user.email ?? undefined,
      resourceName: currentOrg.name,
      description: requireSso ? 'Required single sign-on' : 'Stopped requiring single sign-on',
      metadata: { requireSso },
      request,
    })

    return NextResponse.json({
      success: true,
      data: { requireSso, hasVerifiedProvider: verifiedProvider },
    })
  }
)
