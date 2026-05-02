import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { member, organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { updateOrganizationWhitelabelContract } from '@/lib/api/contracts/organization'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import type { OrganizationWhitelabelSettings } from '@/lib/branding/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('WhitelabelAPI')

/**
 * GET /api/organizations/[id]/whitelabel
 * Returns the organization's whitelabel settings.
 * Accessible by any member of the organization.
 */
export const GET = withRouteHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
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
        .select({ whitelabelSettings: organization.whitelabelSettings })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .limit(1)

      if (!org) {
        return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
      }

      return NextResponse.json({
        success: true,
        data: (org.whitelabelSettings ?? {}) as OrganizationWhitelabelSettings,
      })
    } catch (error) {
      logger.error('Failed to get whitelabel settings', { error })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

/**
 * PUT /api/organizations/[id]/whitelabel
 * Updates the organization's whitelabel settings.
 * Requires enterprise plan and owner/admin role.
 */
export const PUT = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      const session = await getSession()

      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const parsed = await parseRequest(updateOrganizationWhitelabelContract, request, context, {
        validationErrorResponse: (err) => validationErrorResponse(err, 'Invalid request body'),
      })
      if (!parsed.success) return parsed.response

      const { id: organizationId } = parsed.data.params
      const incoming = parsed.data.body

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
          {
            error: 'Forbidden - Only organization owners and admins can update whitelabel settings',
          },
          { status: 403 }
        )
      }

      const hasEnterprisePlan = await isOrganizationOnEnterprisePlan(organizationId)

      if (!hasEnterprisePlan) {
        return NextResponse.json(
          { error: 'Whitelabeling is available on Enterprise plans only' },
          { status: 403 }
        )
      }

      const [currentOrg] = await db
        .select({ name: organization.name, whitelabelSettings: organization.whitelabelSettings })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .limit(1)

      if (!currentOrg) {
        return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
      }

      const current: OrganizationWhitelabelSettings = currentOrg.whitelabelSettings ?? {}

      const merged: OrganizationWhitelabelSettings = { ...current }

      for (const key of Object.keys(incoming) as Array<keyof typeof incoming>) {
        const value = incoming[key]
        if (value === null) {
          delete merged[key as keyof OrganizationWhitelabelSettings]
        } else if (value !== undefined) {
          ;(merged as Record<string, unknown>)[key] = value
        }
      }

      const [updated] = await db
        .update(organization)
        .set({ whitelabelSettings: merged, updatedAt: new Date() })
        .where(eq(organization.id, organizationId))
        .returning({ whitelabelSettings: organization.whitelabelSettings })

      if (!updated) {
        return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
      }

      recordAudit({
        workspaceId: null,
        actorId: session.user.id,
        action: AuditAction.ORGANIZATION_UPDATED,
        resourceType: AuditResourceType.ORGANIZATION,
        resourceId: organizationId,
        actorName: session.user.name ?? undefined,
        actorEmail: session.user.email ?? undefined,
        resourceName: currentOrg.name,
        description: 'Updated organization whitelabel settings',
        metadata: { changes: Object.keys(incoming) },
        request,
      })

      return NextResponse.json({
        success: true,
        data: (updated.whitelabelSettings ?? {}) as OrganizationWhitelabelSettings,
      })
    } catch (error) {
      logger.error('Failed to update whitelabel settings', { error })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
