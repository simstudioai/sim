import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import type { SessionPolicySettings } from '@sim/db/schema'
import { member, organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { updateOrganizationSessionPolicyContract } from '@/lib/api/contracts/organization'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { bumpSecurityPolicyVersion } from '@/lib/auth/session-policy'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
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

    const isEnterprise = !isBillingEnabled || (await isOrganizationOnEnterprisePlan(organizationId))

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

    if (memberEntry.role !== 'owner' && memberEntry.role !== 'admin') {
      return NextResponse.json(
        { error: 'Forbidden - Only organization owners and admins can update the session policy' },
        { status: 403 }
      )
    }

    if (isBillingEnabled) {
      const hasEnterprise = await isOrganizationOnEnterprisePlan(organizationId)
      if (!hasEnterprise) {
        return NextResponse.json(
          { error: 'Session policies are available on Enterprise plans only' },
          { status: 403 }
        )
      }
    }

    const [currentOrg] = await db
      .select({
        name: organization.name,
        sessionPolicySettings: organization.sessionPolicySettings,
      })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    if (!currentOrg) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    const current = normalizeConfigured(currentOrg.sessionPolicySettings)
    const merged: SessionPolicySettings = { ...current }
    if (body.maxSessionHours !== undefined) merged.maxSessionHours = body.maxSessionHours
    if (body.idleTimeoutHours !== undefined) merged.idleTimeoutHours = body.idleTimeoutHours

    const [updated] = await db
      .update(organization)
      .set({ sessionPolicySettings: merged, updatedAt: new Date() })
      .where(eq(organization.id, organizationId))
      .returning({ sessionPolicySettings: organization.sessionPolicySettings })

    if (!updated) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    // Eagerly clamp existing member sessions so a tightened policy applies to
    // sessions that never hit a refresh (the lazy hook clamp only runs on
    // refresh, up to 24h away). Loosening never extends: LEAST keeps the
    // current expiry when it is already shorter. Impersonation sessions are
    // platform-admin tooling and exempt.
    const maxMs = merged.maxSessionHours ? merged.maxSessionHours * 60 * 60 * 1000 : null
    const idleMs = merged.idleTimeoutHours
      ? Math.max(merged.idleTimeoutHours, 24) * 60 * 60 * 1000
      : null
    if (maxMs !== null || idleMs !== null) {
      await db.execute(sql`
        UPDATE "session" SET expires_at = LEAST(
          expires_at,
          ${maxMs !== null ? sql`created_at + make_interval(secs => ${maxMs / 1000})` : sql`expires_at`},
          ${idleMs !== null ? sql`now() + make_interval(secs => ${idleMs / 1000})` : sql`expires_at`}
        )
        WHERE impersonated_by IS NULL
          AND user_id IN (
            SELECT user_id FROM member WHERE organization_id = ${organizationId}
          )
      `)
    }

    // Invalidate every member's cached session cookie so the tightened (or
    // loosened) policy re-evaluates on the next request instead of after the
    // 24h cookie-cache lifetime.
    await bumpSecurityPolicyVersion(organizationId)

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
        configured: normalizeConfigured(updated.sessionPolicySettings),
      },
    })
  }
)
