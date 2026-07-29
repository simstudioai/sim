import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import type { SessionPolicySettings } from '@sim/db/schema'
import { member, organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { updateOrganizationSessionPolicyContract } from '@/lib/api/contracts/organization'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { invalidateSecurityPolicyVersionCache } from '@/lib/auth/security-policy'
import { eagerClampOrgSessions, invalidateSessionPolicyCache } from '@/lib/auth/session-policy'
import { isOrganizationFeatureEntitled } from '@/lib/billing/core/subscription'
import { isBillingEnabled, isSessionPoliciesEnabled } from '@/lib/core/config/env-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('SessionPolicyAPI')

function normalizeConfigured(settings: SessionPolicySettings | null | undefined) {
  return {
    maxSessionHours: settings?.maxSessionHours ?? null,
    idleTimeoutHours: settings?.idleTimeoutHours ?? null,
  }
}

/**
 * GET /api/organizations/[id]/session-policy
 * Returns the organization's session policy. Accessible by any member.
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
      .select({ sessionPolicySettings: organization.sessionPolicySettings })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    const isEnterprise = await isOrganizationFeatureEntitled(
      organizationId,
      isSessionPoliciesEnabled
    )

    return NextResponse.json({
      success: true,
      data: {
        isEnterprise,
        configured: normalizeConfigured(org.sessionPolicySettings),
      },
    })
  }
)

/**
 * PUT /api/organizations/[id]/session-policy
 * Updates the organization's session policy and bumps the security-policy
 * version so existing cached session cookies re-validate against the new
 * policy. Requires enterprise plan and owner/admin role.
 */
export const PUT = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(updateOrganizationSessionPolicyContract, request, context, {
      validationErrorResponse: (err) => validationErrorResponse(err, 'Invalid request body'),
    })
    if (!parsed.success) return parsed.response

    const { id: organizationId } = parsed.data.params
    const body = parsed.data.body

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
        { error: 'Forbidden - Only organization owners and admins can update the session policy' },
        { status: 403 }
      )
    }

    const entitled = await isOrganizationFeatureEntitled(organizationId, isSessionPoliciesEnabled)
    if (!entitled) {
      return NextResponse.json(
        {
          error: isBillingEnabled
            ? 'Session policies are available on Enterprise plans only'
            : 'Session policies are disabled. Set ENTERPRISE_ENABLED or SESSION_POLICIES_ENABLED to enable them.',
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

    const merged = {
      maxSessionHours: body.maxSessionHours,
      idleTimeoutHours: body.idleTimeoutHours,
    }

    // Settings write (with the version bump riding the same row) and the
    // eager clamp of existing sessions commit atomically — a stored policy is
    // never left unenforced by a partial failure.
    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(organization)
        .set({
          sessionPolicySettings: merged,
          securityPolicyVersion: sql`${organization.securityPolicyVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(organization.id, organizationId))
        .returning({ id: organization.id })
      if (!row) return null
      await eagerClampOrgSessions(organizationId, merged, tx)
      return row
    })

    if (!updated) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    invalidateSessionPolicyCache(organizationId)
    invalidateSecurityPolicyVersionCache(organizationId)

    logger.info('Updated organization session policy', { organizationId })

    recordAudit({
      workspaceId: null,
      actorId: session.user.id,
      action: AuditAction.ORGANIZATION_SESSION_POLICY_UPDATED,
      resourceType: AuditResourceType.ORGANIZATION,
      resourceId: organizationId,
      actorName: session.user.name ?? undefined,
      actorEmail: session.user.email ?? undefined,
      resourceName: currentOrg.name,
      description: 'Updated session policy',
      metadata: { changes: body },
      request,
    })

    return NextResponse.json({
      success: true,
      data: {
        isEnterprise: true,
        configured: normalizeConfigured(merged),
      },
    })
  }
)
