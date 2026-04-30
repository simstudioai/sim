import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { workflow, workspaceNotificationSubscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { createNotificationServerContract } from '@/lib/api/contracts/notifications'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { encryptSecret } from '@/lib/core/security/encryption'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import { MAX_NOTIFICATIONS_PER_TYPE } from './constants'

const logger = createLogger('WorkspaceNotificationsAPI')

async function checkWorkspaceWriteAccess(
  userId: string,
  workspaceId: string
): Promise<{ hasAccess: boolean; permission: string | null }> {
  const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
  const hasAccess = permission === 'write' || permission === 'admin'
  return { hasAccess, permission }
}

export const GET = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const { id: workspaceId } = await params
      const permission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)

      if (!permission) {
        return NextResponse.json({ error: 'Workspace not found' }, { status: 404 })
      }

      const subscriptions = await db
        .select({
          id: workspaceNotificationSubscription.id,
          notificationType: workspaceNotificationSubscription.notificationType,
          workflowIds: workspaceNotificationSubscription.workflowIds,
          allWorkflows: workspaceNotificationSubscription.allWorkflows,
          levelFilter: workspaceNotificationSubscription.levelFilter,
          triggerFilter: workspaceNotificationSubscription.triggerFilter,
          includeFinalOutput: workspaceNotificationSubscription.includeFinalOutput,
          includeTraceSpans: workspaceNotificationSubscription.includeTraceSpans,
          includeRateLimits: workspaceNotificationSubscription.includeRateLimits,
          includeUsageData: workspaceNotificationSubscription.includeUsageData,
          webhookConfig: workspaceNotificationSubscription.webhookConfig,
          emailRecipients: workspaceNotificationSubscription.emailRecipients,
          slackConfig: workspaceNotificationSubscription.slackConfig,
          alertConfig: workspaceNotificationSubscription.alertConfig,
          active: workspaceNotificationSubscription.active,
          createdAt: workspaceNotificationSubscription.createdAt,
          updatedAt: workspaceNotificationSubscription.updatedAt,
        })
        .from(workspaceNotificationSubscription)
        .where(eq(workspaceNotificationSubscription.workspaceId, workspaceId))
        .orderBy(workspaceNotificationSubscription.createdAt)

      return NextResponse.json({ data: subscriptions })
    } catch (error) {
      logger.error('Error fetching notifications', { error })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

export const POST = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    try {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const { id: workspaceId } = await context.params
      const { hasAccess } = await checkWorkspaceWriteAccess(session.user.id, workspaceId)

      if (!hasAccess) {
        return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
      }

      const parsed = await parseRequest(createNotificationServerContract, request, context, {
        validationErrorResponse: (error) => validationErrorResponse(error, 'Invalid request'),
      })
      if (!parsed.success) return parsed.response
      const data = parsed.data.body

      const existingCount = await db
        .select({ id: workspaceNotificationSubscription.id })
        .from(workspaceNotificationSubscription)
        .where(
          and(
            eq(workspaceNotificationSubscription.workspaceId, workspaceId),
            eq(workspaceNotificationSubscription.notificationType, data.notificationType)
          )
        )

      if (existingCount.length >= MAX_NOTIFICATIONS_PER_TYPE) {
        return NextResponse.json(
          {
            error: `Maximum ${MAX_NOTIFICATIONS_PER_TYPE} ${data.notificationType} notifications per workspace`,
          },
          { status: 400 }
        )
      }

      if (!data.allWorkflows && data.workflowIds.length > 0) {
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

      let webhookConfig = data.webhookConfig || null
      if (webhookConfig?.secret) {
        const { encrypted } = await encryptSecret(webhookConfig.secret)
        webhookConfig = { ...webhookConfig, secret: encrypted }
      }

      const [subscription] = await db
        .insert(workspaceNotificationSubscription)
        .values({
          id: generateId(),
          workspaceId,
          notificationType: data.notificationType,
          workflowIds: data.workflowIds,
          allWorkflows: data.allWorkflows,
          levelFilter: data.levelFilter,
          triggerFilter: data.triggerFilter,
          includeFinalOutput: data.includeFinalOutput,
          includeTraceSpans: data.includeTraceSpans,
          includeRateLimits: data.includeRateLimits,
          includeUsageData: data.includeUsageData,
          alertConfig: data.alertConfig || null,
          webhookConfig,
          emailRecipients: data.emailRecipients || null,
          slackConfig: data.slackConfig || null,
          createdBy: session.user.id,
        })
        .returning()

      logger.info('Created notification subscription', {
        workspaceId,
        subscriptionId: subscription.id,
        type: data.notificationType,
      })

      captureServerEvent(
        session.user.id,
        'notification_channel_created',
        {
          workspace_id: workspaceId,
          notification_type: data.notificationType,
          alert_rule: data.alertConfig?.rule ?? null,
        },
        { groups: { workspace: workspaceId } }
      )

      recordAudit({
        workspaceId,
        actorId: session.user.id,
        action: AuditAction.NOTIFICATION_CREATED,
        resourceType: AuditResourceType.NOTIFICATION,
        resourceId: subscription.id,
        resourceName: data.notificationType,
        actorName: session.user.name ?? undefined,
        actorEmail: session.user.email ?? undefined,
        description: `Created ${data.notificationType} notification subscription`,
        metadata: {
          notificationType: data.notificationType,
          allWorkflows: data.allWorkflows,
          workflowCount: data.workflowIds.length,
          levelFilter: data.levelFilter,
          alertRule: data.alertConfig?.rule ?? null,
          ...(data.notificationType === 'email' && {
            recipientCount: data.emailRecipients?.length ?? 0,
          }),
          ...(data.notificationType === 'slack' && { channelName: data.slackConfig?.channelName }),
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
      logger.error('Error creating notification', { error })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
