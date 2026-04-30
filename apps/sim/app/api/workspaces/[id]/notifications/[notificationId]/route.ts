import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { workflow, workspaceNotificationSubscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { updateNotificationServerContract } from '@/lib/api/contracts/notifications'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { encryptSecret } from '@/lib/core/security/encryption'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

const logger = createLogger('WorkspaceNotificationAPI')

type RouteParams = { params: Promise<{ id: string; notificationId: string }> }

async function checkWorkspaceWriteAccess(
  userId: string,
  workspaceId: string
): Promise<{ hasAccess: boolean; permission: string | null }> {
  const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
  const hasAccess = permission === 'write' || permission === 'admin'
  return { hasAccess, permission }
}

async function getSubscription(notificationId: string, workspaceId: string) {
  const [subscription] = await db
    .select()
    .from(workspaceNotificationSubscription)
    .where(
      and(
        eq(workspaceNotificationSubscription.id, notificationId),
        eq(workspaceNotificationSubscription.workspaceId, workspaceId)
      )
    )
    .limit(1)
  return subscription
}

export const GET = withRouteHandler(async (request: NextRequest, { params }: RouteParams) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: workspaceId, notificationId } = await params
    const permission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)

    if (!permission) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
    }

    const subscription = await getSubscription(notificationId, workspaceId)

    if (!subscription) {
      return NextResponse.json({ error: 'Notification not found' }, { status: 404 })
    }

    return NextResponse.json({
      data: {
        id: subscription.id,
        notificationType: subscription.notificationType,
        workflowIds: subscription.workflowIds,
        allWorkflows: subscription.allWorkflows,
        levelFilter: subscription.levelFilter,
        triggerFilter: subscription.triggerFilter,
        includeFinalOutput: subscription.includeFinalOutput,
        includeTraceSpans: subscription.includeTraceSpans,
        includeRateLimits: subscription.includeRateLimits,
        includeUsageData: subscription.includeUsageData,
        webhookConfig: subscription.webhookConfig,
        emailRecipients: subscription.emailRecipients,
        slackConfig: subscription.slackConfig,
        alertConfig: subscription.alertConfig,
        active: subscription.active,
        createdAt: subscription.createdAt,
        updatedAt: subscription.updatedAt,
      },
    })
  } catch (error) {
    logger.error('Error fetching notification', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

export const PUT = withRouteHandler(async (request: NextRequest, context: RouteParams) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: workspaceId, notificationId } = await context.params
    const { hasAccess } = await checkWorkspaceWriteAccess(session.user.id, workspaceId)

    if (!hasAccess) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const existingSubscription = await getSubscription(notificationId, workspaceId)

    if (!existingSubscription) {
      return NextResponse.json({ error: 'Notification not found' }, { status: 404 })
    }

    const parsed = await parseRequest(updateNotificationServerContract, request, context, {
      validationErrorResponse: (error) => validationErrorResponse(error, 'Invalid request'),
    })
    if (!parsed.success) return parsed.response
    const data = parsed.data.body

    if (data.workflowIds && data.workflowIds.length > 0) {
      const workflowsInWorkspace = await db
        .select({ id: workflow.id })
        .from(workflow)
        .where(and(eq(workflow.workspaceId, workspaceId), inArray(workflow.id, data.workflowIds)))

      const validIds = new Set(workflowsInWorkspace.map((w) => w.id))
      const invalidIds = data.workflowIds.filter((id) => !validIds.has(id))

      if (invalidIds.length > 0) {
        return NextResponse.json(
          { error: 'Some workflow IDs do not belong to this workspace', invalidIds },
          { status: 400 }
        )
      }
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() }

    if (data.workflowIds !== undefined) updateData.workflowIds = data.workflowIds
    if (data.allWorkflows !== undefined) updateData.allWorkflows = data.allWorkflows
    if (data.levelFilter !== undefined) updateData.levelFilter = data.levelFilter
    if (data.triggerFilter !== undefined) updateData.triggerFilter = data.triggerFilter
    if (data.includeFinalOutput !== undefined)
      updateData.includeFinalOutput = data.includeFinalOutput
    if (data.includeTraceSpans !== undefined) updateData.includeTraceSpans = data.includeTraceSpans
    if (data.includeRateLimits !== undefined) updateData.includeRateLimits = data.includeRateLimits
    if (data.includeUsageData !== undefined) updateData.includeUsageData = data.includeUsageData
    if (data.alertConfig !== undefined) updateData.alertConfig = data.alertConfig
    if (data.emailRecipients !== undefined) updateData.emailRecipients = data.emailRecipients
    if (data.slackConfig !== undefined) updateData.slackConfig = data.slackConfig
    if (data.active !== undefined) updateData.active = data.active

    // Handle webhookConfig with secret encryption
    if (data.webhookConfig !== undefined) {
      let webhookConfig = data.webhookConfig
      if (webhookConfig?.secret) {
        const { encrypted } = await encryptSecret(webhookConfig.secret)
        webhookConfig = { ...webhookConfig, secret: encrypted }
      }
      updateData.webhookConfig = webhookConfig
    }

    const [subscription] = await db
      .update(workspaceNotificationSubscription)
      .set(updateData)
      .where(eq(workspaceNotificationSubscription.id, notificationId))
      .returning()

    logger.info('Updated notification subscription', {
      workspaceId,
      subscriptionId: subscription.id,
    })

    recordAudit({
      workspaceId,
      actorId: session.user.id,
      action: AuditAction.NOTIFICATION_UPDATED,
      resourceType: AuditResourceType.NOTIFICATION,
      resourceId: notificationId,
      resourceName: subscription.notificationType,
      actorName: session.user.name ?? undefined,
      actorEmail: session.user.email ?? undefined,
      description: `Updated ${subscription.notificationType} notification subscription`,
      metadata: {
        notificationType: subscription.notificationType,
        updatedFields: Object.keys(data).filter(
          (k) => (data as Record<string, unknown>)[k] !== undefined
        ),
        ...(data.active !== undefined && { active: data.active }),
        ...(data.alertConfig !== undefined && { alertRule: data.alertConfig?.rule ?? null }),
      },
      request,
    })

    return NextResponse.json({
      data: {
        id: subscription.id,
        notificationType: subscription.notificationType,
        workflowIds: subscription.workflowIds,
        allWorkflows: subscription.allWorkflows,
        levelFilter: subscription.levelFilter,
        triggerFilter: subscription.triggerFilter,
        includeFinalOutput: subscription.includeFinalOutput,
        includeTraceSpans: subscription.includeTraceSpans,
        includeRateLimits: subscription.includeRateLimits,
        includeUsageData: subscription.includeUsageData,
        webhookConfig: subscription.webhookConfig,
        emailRecipients: subscription.emailRecipients,
        slackConfig: subscription.slackConfig,
        alertConfig: subscription.alertConfig,
        active: subscription.active,
        createdAt: subscription.createdAt,
        updatedAt: subscription.updatedAt,
      },
    })
  } catch (error) {
    logger.error('Error updating notification', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

export const DELETE = withRouteHandler(async (request: NextRequest, { params }: RouteParams) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: workspaceId, notificationId } = await params
    const { hasAccess } = await checkWorkspaceWriteAccess(session.user.id, workspaceId)

    if (!hasAccess) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const deleted = await db
      .delete(workspaceNotificationSubscription)
      .where(
        and(
          eq(workspaceNotificationSubscription.id, notificationId),
          eq(workspaceNotificationSubscription.workspaceId, workspaceId)
        )
      )
      .returning({
        id: workspaceNotificationSubscription.id,
        notificationType: workspaceNotificationSubscription.notificationType,
      })

    if (deleted.length === 0) {
      return NextResponse.json({ error: 'Notification not found' }, { status: 404 })
    }

    const deletedSubscription = deleted[0]

    logger.info('Deleted notification subscription', {
      workspaceId,
      subscriptionId: notificationId,
    })

    recordAudit({
      workspaceId,
      actorId: session.user.id,
      action: AuditAction.NOTIFICATION_DELETED,
      resourceType: AuditResourceType.NOTIFICATION,
      resourceId: notificationId,
      actorName: session.user.name ?? undefined,
      actorEmail: session.user.email ?? undefined,
      resourceName: deletedSubscription.notificationType,
      description: `Deleted ${deletedSubscription.notificationType} notification subscription`,
      metadata: {
        notificationType: deletedSubscription.notificationType,
      },
      request,
    })

    captureServerEvent(
      session.user.id,
      'notification_channel_deleted',
      {
        notification_id: notificationId,
        notification_type: deletedSubscription.notificationType,
        workspace_id: workspaceId,
      },
      { groups: { workspace: workspaceId } }
    )

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error deleting notification', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
