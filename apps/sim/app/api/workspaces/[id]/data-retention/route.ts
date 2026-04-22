import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { CLEANUP_CONFIG } from '@/lib/billing/cleanup-dispatcher'
import { getHighestPrioritySubscription } from '@/lib/billing/core/plan'
import { isEnterprisePlan } from '@/lib/billing/core/subscription'
import { getPlanType, type PlanCategory } from '@/lib/billing/plan-helpers'
import { isBillingEnabled } from '@/lib/core/config/feature-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import { getWorkspaceBilledAccountUserId } from '@/lib/workspaces/utils'

const logger = createLogger('DataRetentionAPI')

const MIN_HOURS = 24
const MAX_HOURS = 43800 // 5 years

interface RetentionValues {
  logRetentionHours: number | null
  softDeleteRetentionHours: number | null
  taskCleanupHours: number | null
}

function getPlanDefaults(plan: PlanCategory): RetentionValues {
  return {
    logRetentionHours: CLEANUP_CONFIG['cleanup-logs'].defaults[plan],
    softDeleteRetentionHours: CLEANUP_CONFIG['cleanup-soft-deletes'].defaults[plan],
    taskCleanupHours: CLEANUP_CONFIG['cleanup-tasks'].defaults[plan],
  }
}

async function resolveWorkspacePlan(billedAccountUserId: string): Promise<PlanCategory> {
  const sub = await getHighestPrioritySubscription(billedAccountUserId)
  return getPlanType(sub?.plan)
}

const updateRetentionSchema = z.object({
  logRetentionHours: z.number().int().min(MIN_HOURS).max(MAX_HOURS).nullable().optional(),
  softDeleteRetentionHours: z.number().int().min(MIN_HOURS).max(MAX_HOURS).nullable().optional(),
  taskCleanupHours: z.number().int().min(MIN_HOURS).max(MAX_HOURS).nullable().optional(),
})

/**
 * GET /api/workspaces/[id]/data-retention
 * Returns the workspace's data retention config including plan defaults and
 * whether the workspace is on an enterprise plan.
 */
export const GET = withRouteHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const { id: workspaceId } = await params

      const permission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
      if (!permission) {
        return NextResponse.json({ error: 'Workspace not found or access denied' }, { status: 404 })
      }

      const [ws] = await db
        .select({
          logRetentionHours: workspace.logRetentionHours,
          softDeleteRetentionHours: workspace.softDeleteRetentionHours,
          taskCleanupHours: workspace.taskCleanupHours,
          billedAccountUserId: workspace.billedAccountUserId,
        })
        .from(workspace)
        .where(eq(workspace.id, workspaceId))
        .limit(1)

      if (!ws) {
        return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
      }

      const plan = await resolveWorkspacePlan(ws.billedAccountUserId)
      const defaults = getPlanDefaults(plan)
      const isEnterpriseWorkspace = !isBillingEnabled || plan === 'enterprise'

      return NextResponse.json({
        success: true,
        data: {
          plan,
          isEnterprise: isEnterpriseWorkspace,
          defaults,
          configured: {
            logRetentionHours: ws.logRetentionHours,
            softDeleteRetentionHours: ws.softDeleteRetentionHours,
            taskCleanupHours: ws.taskCleanupHours,
          },
          effective: isEnterpriseWorkspace
            ? {
                logRetentionHours: ws.logRetentionHours,
                softDeleteRetentionHours: ws.softDeleteRetentionHours,
                taskCleanupHours: ws.taskCleanupHours,
              }
            : {
                logRetentionHours: defaults.logRetentionHours,
                softDeleteRetentionHours: defaults.softDeleteRetentionHours,
                taskCleanupHours: defaults.taskCleanupHours,
              },
        },
      })
    } catch (error) {
      logger.error('Failed to get data retention settings', { error })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

/**
 * PUT /api/workspaces/[id]/data-retention
 * Updates the workspace's data retention settings.
 * Requires admin permission and enterprise plan.
 */
export const PUT = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const { id: workspaceId } = await params

      const permission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
      if (permission !== 'admin') {
        return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
      }

      const billedAccountUserId = await getWorkspaceBilledAccountUserId(workspaceId)
      if (!billedAccountUserId) {
        return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
      }

      if (isBillingEnabled) {
        const hasEnterprise = await isEnterprisePlan(billedAccountUserId)
        if (!hasEnterprise) {
          return NextResponse.json(
            { error: 'Data Retention configuration is available on Enterprise plans only' },
            { status: 403 }
          )
        }
      }

      const body = await request.json()
      const parsed = updateRetentionSchema.safeParse(body)
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.errors[0]?.message ?? 'Invalid request body' },
          { status: 400 }
        )
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date() }

      if (parsed.data.logRetentionHours !== undefined) {
        updateData.logRetentionHours = parsed.data.logRetentionHours
      }
      if (parsed.data.softDeleteRetentionHours !== undefined) {
        updateData.softDeleteRetentionHours = parsed.data.softDeleteRetentionHours
      }
      if (parsed.data.taskCleanupHours !== undefined) {
        updateData.taskCleanupHours = parsed.data.taskCleanupHours
      }

      const [updated] = await db
        .update(workspace)
        .set(updateData)
        .where(eq(workspace.id, workspaceId))
        .returning({
          logRetentionHours: workspace.logRetentionHours,
          softDeleteRetentionHours: workspace.softDeleteRetentionHours,
          taskCleanupHours: workspace.taskCleanupHours,
        })

      if (!updated) {
        return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
      }

      recordAudit({
        workspaceId,
        actorId: session.user.id,
        action: AuditAction.ORGANIZATION_UPDATED,
        resourceType: AuditResourceType.WORKSPACE,
        resourceId: workspaceId,
        actorName: session.user.name ?? undefined,
        actorEmail: session.user.email ?? undefined,
        description: 'Updated data retention settings',
        metadata: { changes: parsed.data },
        request,
      })

      const defaults = getPlanDefaults('enterprise')

      return NextResponse.json({
        success: true,
        data: {
          plan: 'enterprise' as const,
          isEnterprise: true,
          defaults,
          configured: {
            logRetentionHours: updated.logRetentionHours,
            softDeleteRetentionHours: updated.softDeleteRetentionHours,
            taskCleanupHours: updated.taskCleanupHours,
          },
          effective: {
            logRetentionHours: updated.logRetentionHours,
            softDeleteRetentionHours: updated.softDeleteRetentionHours,
            taskCleanupHours: updated.taskCleanupHours,
          },
        },
      })
    } catch (error) {
      logger.error('Failed to update data retention settings', { error })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
