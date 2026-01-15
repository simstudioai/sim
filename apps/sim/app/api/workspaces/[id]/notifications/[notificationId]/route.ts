import { db } from '@sim/db'
import { workflow, workspaceNotificationSubscription } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { encryptSecret } from '@/lib/core/security/encryption'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import { CORE_TRIGGER_TYPES } from '@/stores/logs/filters/types'
import { MAX_EMAIL_RECIPIENTS, MAX_WORKFLOW_IDS } from '../constants'

const logger = createLogger('WorkspaceNotificationAPI')

const levelFilterSchema = z.array(z.enum(['info', 'error']))
const triggerFilterSchema = z.array(z.enum(CORE_TRIGGER_TYPES))

const alertRuleSchema = z.enum([
  'consecutive_failures',
  'failure_rate',
  'latency_threshold',
  'latency_spike',
  'cost_threshold',
  'no_activity',
  'error_count',
])

const alertConfigSchema = z
  .object({
    rule: alertRuleSchema,
    consecutiveFailures: z.number().int().min(1).max(100).optional(),
    failureRatePercent: z.number().int().min(1).max(100).optional(),
    windowHours: z.number().int().min(1).max(168).optional(),
    durationThresholdMs: z.number().int().min(1000).max(3600000).optional(),
    latencySpikePercent: z.number().int().min(10).max(1000).optional(),
    costThresholdDollars: z.number().min(0.01).max(1000).optional(),
    inactivityHours: z.number().int().min(1).max(168).optional(),
    errorCountThreshold: z.number().int().min(1).max(1000).optional(),
  })
  .refine(
    (data) => {
      switch (data.rule) {
        case 'consecutive_failures':
          return data.consecutiveFailures !== undefined
        case 'failure_rate':
          return data.failureRatePercent !== undefined && data.windowHours !== undefined
        case 'latency_threshold':
          return data.durationThresholdMs !== undefined
        case 'latency_spike':
          return data.latencySpikePercent !== undefined && data.windowHours !== undefined
        case 'cost_threshold':
          return data.costThresholdDollars !== undefined
        case 'no_activity':
          return data.inactivityHours !== undefined
        case 'error_count':
          return data.errorCountThreshold !== undefined && data.windowHours !== undefined
        default:
          return false
      }
    },
    { message: 'Missing required fields for alert rule' }
  )
  .nullable()

const webhookConfigSchema = z.object({
  url: z.string().url(),
  secret: z.string().optional(),
})

const slackConfigSchema = z.object({
  channelId: z.string(),
  channelName: z.string(),
  accountId: z.string(),
})

const updateNotificationSchema = z
  .object({
    workflowIds: z.array(z.string()).max(MAX_WORKFLOW_IDS).optional(),
    allWorkflows: z.boolean().optional(),
    levelFilter: levelFilterSchema.optional(),
    triggerFilter: triggerFilterSchema.optional(),
    includeFinalOutput: z.boolean().optional(),
    includeTraceSpans: z.boolean().optional(),
    includeRateLimits: z.boolean().optional(),
    includeUsageData: z.boolean().optional(),
    alertConfig: alertConfigSchema.optional(),
    webhookConfig: webhookConfigSchema.optional(),
    emailRecipients: z.array(z.string().email()).max(MAX_EMAIL_RECIPIENTS).optional(),
    slackConfig: slackConfigSchema.optional(),
    active: z.boolean().optional(),
  })
  .refine((data) => !(data.allWorkflows && data.workflowIds && data.workflowIds.length > 0), {
    message: 'Cannot specify both allWorkflows and workflowIds',
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
