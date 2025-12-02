import { db } from '@sim/db'
import { workflow, workspaceNotificationSubscription } from '@sim/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { encryptSecret } from '@/lib/core/security/encryption'
import { createLogger } from '@/lib/logs/console/logger'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import { MAX_EMAIL_RECIPIENTS, MAX_NOTIFICATIONS_PER_TYPE, MAX_WORKFLOW_IDS } from './constants'

const logger = createLogger('WorkspaceNotificationsAPI')

const notificationTypeSchema = z.enum(['webhook', 'email', 'slack'])
const levelFilterSchema = z.array(z.enum(['info', 'error']))
const triggerFilterSchema = z.array(z.enum(['api', 'webhook', 'schedule', 'manual', 'chat']))

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

const createNotificationSchema = z
  .object({
    notificationType: notificationTypeSchema,
    workflowIds: z.array(z.string()).max(MAX_WORKFLOW_IDS).default([]),
    allWorkflows: z.boolean().default(false),
    levelFilter: levelFilterSchema.default(['info', 'error']),
    triggerFilter: triggerFilterSchema.default(['api', 'webhook', 'schedule', 'manual', 'chat']),
    includeFinalOutput: z.boolean().default(false),
    includeTraceSpans: z.boolean().default(false),
    includeRateLimits: z.boolean().default(false),
    includeUsageData: z.boolean().default(false),
    alertConfig: alertConfigSchema.optional(),
    webhookUrl: z.string().url().optional(),
    webhookSecret: z.string().optional(),
    emailRecipients: z.array(z.string().email()).max(MAX_EMAIL_RECIPIENTS).optional(),
    slackChannelId: z.string().optional(),
    slackAccountId: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.notificationType === 'webhook') return !!data.webhookUrl
      if (data.notificationType === 'email')
        return !!data.emailRecipients && data.emailRecipients.length > 0
      if (data.notificationType === 'slack') return !!data.slackChannelId && !!data.slackAccountId
      return false
    },
    { message: 'Missing required fields for notification type' }
  )
  .refine((data) => !(data.allWorkflows && data.workflowIds.length > 0), {
    message: 'Cannot specify both allWorkflows and workflowIds',
  })

async function checkWorkspaceWriteAccess(
  userId: string,
  workspaceId: string
): Promise<{ hasAccess: boolean; permission: string | null }> {
  const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
  const hasAccess = permission === 'write' || permission === 'admin'
  return { hasAccess, permission }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
        webhookUrl: workspaceNotificationSubscription.webhookUrl,
        emailRecipients: workspaceNotificationSubscription.emailRecipients,
        slackChannelId: workspaceNotificationSubscription.slackChannelId,
        slackAccountId: workspaceNotificationSubscription.slackAccountId,
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

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: workspaceId } = await params
    const { hasAccess } = await checkWorkspaceWriteAccess(session.user.id, workspaceId)

    if (!hasAccess) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const body = await request.json()
    const validationResult = createNotificationSchema.safeParse(body)

    if (!validationResult.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validationResult.error.errors },
        { status: 400 }
      )
    }

    const data = validationResult.data

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

    let encryptedSecret: string | null = null
    if (data.webhookSecret) {
      const { encrypted } = await encryptSecret(data.webhookSecret)
      encryptedSecret = encrypted
    }

    const [subscription] = await db
      .insert(workspaceNotificationSubscription)
      .values({
        id: uuidv4(),
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
        webhookUrl: data.webhookUrl || null,
        webhookSecret: encryptedSecret,
        emailRecipients: data.emailRecipients || null,
        slackChannelId: data.slackChannelId || null,
        slackAccountId: data.slackAccountId || null,
        createdBy: session.user.id,
      })
      .returning()

    logger.info('Created notification subscription', {
      workspaceId,
      subscriptionId: subscription.id,
      type: data.notificationType,
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
    logger.error('Error creating notification', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
