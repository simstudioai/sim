import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { type DataRetentionSettings, organization, workspace } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { updateWorkspaceDataRetentionContract } from '@/lib/api/contracts/workspaces'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { CLEANUP_CONFIG } from '@/lib/billing/cleanup-dispatcher'
import { isWorkspaceOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { resolveEffectiveRetentionHours } from '@/lib/billing/retention'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

interface RetentionValues {
  logRetentionHours: number | null
  softDeleteRetentionHours: number | null
  taskCleanupHours: number | null
}

function enterpriseDefaults(): RetentionValues {
  return {
    logRetentionHours: CLEANUP_CONFIG['cleanup-logs'].defaults.enterprise,
    softDeleteRetentionHours: CLEANUP_CONFIG['cleanup-soft-deletes'].defaults.enterprise,
    taskCleanupHours: CLEANUP_CONFIG['cleanup-tasks'].defaults.enterprise,
  }
}

function normalize(settings: DataRetentionSettings | null | undefined): RetentionValues {
  return {
    logRetentionHours: settings?.logRetentionHours ?? null,
    softDeleteRetentionHours: settings?.softDeleteRetentionHours ?? null,
    taskCleanupHours: settings?.taskCleanupHours ?? null,
  }
}

function resolveEffective(
  workspaceSettings: DataRetentionSettings | null,
  orgSettings: DataRetentionSettings | null
): RetentionValues {
  return {
    logRetentionHours: resolveEffectiveRetentionHours({
      workspaceSettings,
      orgSettings,
      key: 'logRetentionHours',
      fallback: CLEANUP_CONFIG['cleanup-logs'].defaults.enterprise,
    }),
    softDeleteRetentionHours: resolveEffectiveRetentionHours({
      workspaceSettings,
      orgSettings,
      key: 'softDeleteRetentionHours',
      fallback: CLEANUP_CONFIG['cleanup-soft-deletes'].defaults.enterprise,
    }),
    taskCleanupHours: resolveEffectiveRetentionHours({
      workspaceSettings,
      orgSettings,
      key: 'taskCleanupHours',
      fallback: CLEANUP_CONFIG['cleanup-tasks'].defaults.enterprise,
    }),
  }
}

async function loadWorkspaceSettings(workspaceId: string) {
  const [row] = await db
    .select({
      name: workspace.name,
      workspaceSettings: workspace.dataRetentionSettings,
      orgSettings: organization.dataRetentionSettings,
    })
    .from(workspace)
    .leftJoin(organization, eq(organization.id, workspace.organizationId))
    .where(eq(workspace.id, workspaceId))
    .limit(1)
  return row
}

/**
 * GET /api/workspaces/[id]/data-retention
 * Returns the workspace's effective retention settings, the org default it
 * inherits from, and its own override. Accessible to any workspace member.
 */
export const GET = withRouteHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: workspaceId } = await params

    const permission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
    if (!permission) {
      return NextResponse.json({ error: 'Workspace not found or access denied' }, { status: 404 })
    }

    const row = await loadWorkspaceSettings(workspaceId)
    if (!row) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    const isEnterprise = !isBillingEnabled || (await isWorkspaceOnEnterprisePlan(workspaceId))
    const orgConfigured = normalize(row.orgSettings)
    const workspaceConfigured = normalize(row.workspaceSettings)
    const effective = isEnterprise
      ? resolveEffective(row.workspaceSettings, row.orgSettings)
      : enterpriseDefaults()

    return NextResponse.json({
      success: true,
      data: {
        isEnterprise,
        defaults: enterpriseDefaults(),
        orgConfigured,
        workspaceConfigured,
        effective,
      },
    })
  }
)

/**
 * PUT /api/workspaces/[id]/data-retention
 * Updates the workspace's retention override. Requires workspace admin and an
 * enterprise plan. Omitted keys defer to the org default at resolution time.
 */
export const PUT = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(updateWorkspaceDataRetentionContract, request, context, {
      validationErrorResponse: (err) => validationErrorResponse(err, 'Invalid request body'),
    })
    if (!parsed.success) return parsed.response

    const workspaceId = parsed.data.params.id
    const body = parsed.data.body

    const permission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
    if (permission !== 'admin') {
      return NextResponse.json(
        { error: 'Forbidden - Only workspace admins can update data retention' },
        { status: 403 }
      )
    }

    if (isBillingEnabled && !(await isWorkspaceOnEnterprisePlan(workspaceId))) {
      return NextResponse.json(
        { error: 'Data Retention is available on Enterprise plans only' },
        { status: 403 }
      )
    }

    const row = await loadWorkspaceSettings(workspaceId)
    if (!row) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    const current = normalize(row.workspaceSettings)
    const merged: DataRetentionSettings = { ...current }
    if (body.logRetentionHours !== undefined) merged.logRetentionHours = body.logRetentionHours
    if (body.softDeleteRetentionHours !== undefined) {
      merged.softDeleteRetentionHours = body.softDeleteRetentionHours
    }
    if (body.taskCleanupHours !== undefined) merged.taskCleanupHours = body.taskCleanupHours

    await db
      .update(workspace)
      .set({ dataRetentionSettings: merged, updatedAt: new Date() })
      .where(eq(workspace.id, workspaceId))

    recordAudit({
      workspaceId,
      actorId: session.user.id,
      action: AuditAction.WORKSPACE_UPDATED,
      resourceType: AuditResourceType.WORKSPACE,
      resourceId: workspaceId,
      actorName: session.user.name ?? undefined,
      actorEmail: session.user.email ?? undefined,
      resourceName: row.name,
      description: 'Updated workspace data retention settings',
      metadata: { changes: body },
      request,
    })

    return NextResponse.json({
      success: true,
      data: {
        isEnterprise: true,
        defaults: enterpriseDefaults(),
        orgConfigured: normalize(row.orgSettings),
        workspaceConfigured: normalize(merged),
        effective: resolveEffective(merged, row.orgSettings),
      },
    })
  }
)
