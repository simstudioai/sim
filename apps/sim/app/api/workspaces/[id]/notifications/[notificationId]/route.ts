import { db } from '@sim/db'
import { workflow, workspaceNotificationSubscription } from '@sim/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/permissions/utils'
import { encryptSecret } from '@/lib/utils'

const logger = createLogger('WorkspaceNotificationAPI')

const levelFilterSchema = z.array(z.enum(['info', 'error']))
const triggerFilterSchema = z.array(z.enum(['api', 'webhook', 'schedule', 'manual', 'chat']))

const alertConfigSchema = z
  .object({
    rule: z.enum(['consecutive_failures', 'failure_rate']),
    consecutiveFailures: z.number().int().min(1).max(100).optional(),
    failureRatePercent: z.number().int().min(1).max(100).optional(),
    windowHours: z.number().int().min(1).max(168).optional(),
  })
  .refine(
    (data) => {
      if (data.rule === 'consecutive_failures') return data.consecutiveFailures !== undefined
      if (data.rule === 'failure_rate') {
        return data.failureRatePercent !== undefined && data.windowHours !== undefined
      }
      return false
    },
    { message: 'Missing required fields for alert rule' }
  )
  .nullable()

const updateNotificationSchema = z.object({
  workflowIds: z.array(z.string()).optional(),
  allWorkflows: z.boolean().optional(),
  levelFilter: levelFilterSchema.optional(),
  triggerFilter: triggerFilterSchema.optional(),
  includeFinalOutput: z.boolean().optional(),
  includeTraceSpans: z.boolean().optional(),
  includeRateLimits: z.boolean().optional(),
  includeUsageData: z.boolean().optional(),
  alertConfig: alertConfigSchema.optional(),
  webhookUrl: z.string().url().optional(),
  webhookSecret: z.string().optional(),
  emailRecipients: z.array(z.string().email()).optional(),
  slackChannelId: z.string().optional(),
  slackAccountId: z.string().optional(),
  active: z.boolean().optional(),
})

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

export async function GET(request: NextRequest, { params }: RouteParams) {
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
        webhookUrl: subscription.webhookUrl,
        emailRecipients: subscription.emailRecipients,
        slackChannelId: subscription.slackChannelId,
        slackAccountId: subscription.slackAccountId,
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
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
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

    const existingSubscription = await getSubscription(notificationId, workspaceId)

    if (!existingSubscription) {
      return NextResponse.json({ error: 'Notification not found' }, { status: 404 })
    }

    const body = await request.json()
    const validationResult = updateNotificationSchema.safeParse(body)

    if (!validationResult.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validationResult.error.errors },
        { status: 400 }
      )
    }

    const data = validationResult.data

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
    if (data.webhookUrl !== undefined) updateData.webhookUrl = data.webhookUrl
    if (data.emailRecipients !== undefined) updateData.emailRecipients = data.emailRecipients
    if (data.slackChannelId !== undefined) updateData.slackChannelId = data.slackChannelId
    if (data.slackAccountId !== undefined) updateData.slackAccountId = data.slackAccountId
    if (data.active !== undefined) updateData.active = data.active

    if (data.webhookSecret !== undefined) {
      if (data.webhookSecret) {
        const { encrypted } = await encryptSecret(data.webhookSecret)
        updateData.webhookSecret = encrypted
      } else {
        updateData.webhookSecret = null
      }
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
        webhookUrl: subscription.webhookUrl,
        emailRecipients: subscription.emailRecipients,
        slackChannelId: subscription.slackChannelId,
        slackAccountId: subscription.slackAccountId,
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
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
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
      .returning({ id: workspaceNotificationSubscription.id })

    if (deleted.length === 0) {
      return NextResponse.json({ error: 'Notification not found' }, { status: 404 })
    }

    logger.info('Deleted notification subscription', {
      workspaceId,
      subscriptionId: notificationId,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error('Error deleting notification', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
