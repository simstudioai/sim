import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { member, organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import {
  CLEANUP_CONFIG,
  type OrganizationRetentionSettings,
} from '@/lib/billing/cleanup-dispatcher'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('DataRetentionAPI')

const MIN_HOURS = 24
const MAX_HOURS = 43800

const updateRetentionSchema = z.object({
  logRetentionHours: z.number().int().min(MIN_HOURS).max(MAX_HOURS).nullable().optional(),
  softDeleteRetentionHours: z.number().int().min(MIN_HOURS).max(MAX_HOURS).nullable().optional(),
  taskCleanupHours: z.number().int().min(MIN_HOURS).max(MAX_HOURS).nullable().optional(),
})

function enterpriseDefaults(): OrganizationRetentionSettings {
  return {
    logRetentionHours: CLEANUP_CONFIG['cleanup-logs'].defaults.enterprise,
    softDeleteRetentionHours: CLEANUP_CONFIG['cleanup-soft-deletes'].defaults.enterprise,
    taskCleanupHours: CLEANUP_CONFIG['cleanup-tasks'].defaults.enterprise,
  }
}

function normalizeConfigured(
  settings: Partial<OrganizationRetentionSettings> | null | undefined
): OrganizationRetentionSettings {
  return {
    logRetentionHours: settings?.logRetentionHours ?? null,
    softDeleteRetentionHours: settings?.softDeleteRetentionHours ?? null,
    taskCleanupHours: settings?.taskCleanupHours ?? null,
  }
}

/**
 * GET /api/organizations/[id]/data-retention
 * Returns the organization's data retention settings.
 * Accessible by any member of the organization.
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
      .select({ dataRetentionSettings: organization.dataRetentionSettings })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    const isEnterprise = !isBillingEnabled || (await isOrganizationOnEnterprisePlan(organizationId))
    const configured = normalizeConfigured(org.dataRetentionSettings)
    const defaults = enterpriseDefaults()

    return NextResponse.json({
      success: true,
      data: {
        isEnterprise,
        defaults,
        configured,
        effective: isEnterprise ? configured : defaults,
      },
    })
  }
)

/**
 * PUT /api/organizations/[id]/data-retention
 * Updates the organization's data retention settings.
 * Requires enterprise plan and owner/admin role.
 */
export const PUT = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: organizationId } = await params

    const body = await request.json()
    const parsed = updateRetentionSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.errors[0]?.message ?? 'Invalid request body' },
        { status: 400 }
      )
    }

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
        { error: 'Forbidden - Only organization owners and admins can update data retention' },
        { status: 403 }
      )
    }

    if (isBillingEnabled) {
      const hasEnterprise = await isOrganizationOnEnterprisePlan(organizationId)
      if (!hasEnterprise) {
        return NextResponse.json(
          { error: 'Data Retention is available on Enterprise plans only' },
          { status: 403 }
        )
      }
    }

    const [currentOrg] = await db
      .select({
        name: organization.name,
        dataRetentionSettings: organization.dataRetentionSettings,
      })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    if (!currentOrg) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    const current = normalizeConfigured(currentOrg.dataRetentionSettings)
    const merged: OrganizationRetentionSettings = { ...current }
    if (parsed.data.logRetentionHours !== undefined) {
      merged.logRetentionHours = parsed.data.logRetentionHours
    }
    if (parsed.data.softDeleteRetentionHours !== undefined) {
      merged.softDeleteRetentionHours = parsed.data.softDeleteRetentionHours
    }
    if (parsed.data.taskCleanupHours !== undefined) {
      merged.taskCleanupHours = parsed.data.taskCleanupHours
    }

    const [updated] = await db
      .update(organization)
      .set({ dataRetentionSettings: merged, updatedAt: new Date() })
      .where(eq(organization.id, organizationId))
      .returning({ dataRetentionSettings: organization.dataRetentionSettings })

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
      description: 'Updated data retention settings',
      metadata: { changes: parsed.data },
      request,
    })

    const configured = normalizeConfigured(updated.dataRetentionSettings)
    const defaults = enterpriseDefaults()

    return NextResponse.json({
      success: true,
      data: {
        isEnterprise: true,
        defaults,
        configured,
        effective: configured,
      },
    })
  }
)
