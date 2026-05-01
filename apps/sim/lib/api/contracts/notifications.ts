import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const notificationWorkspaceParamsSchema = z.object({
  id: z.string().min(1),
})

export const notificationParamsSchema = z.object({
  id: z.string().min(1),
  notificationId: z.string().min(1),
})

export const notificationTypeSchema = z.enum(['webhook', 'email', 'slack'])
export const notificationLevelSchema = z.enum(['info', 'error'])

export const alertRuleSchema = z.enum([
  'consecutive_failures',
  'failure_rate',
  'latency_threshold',
  'latency_spike',
  'cost_threshold',
  'no_activity',
  'error_count',
])

export const notificationAlertConfigSchema = z.object({
  rule: alertRuleSchema,
  consecutiveFailures: z.number().int().optional(),
  failureRatePercent: z.number().int().optional(),
  windowHours: z.number().int().optional(),
  durationThresholdMs: z.number().int().optional(),
  latencySpikePercent: z.number().int().optional(),
  costThresholdDollars: z.number().optional(),
  inactivityHours: z.number().int().optional(),
  errorCountThreshold: z.number().int().optional(),
})

export const notificationWebhookConfigSchema = z.object({
  url: z.string().url(),
  secret: z.string().optional(),
})

export const notificationSlackConfigSchema = z.object({
  channelId: z.string(),
  channelName: z.string(),
  accountId: z.string(),
})

export type NotificationType = z.output<typeof notificationTypeSchema>
export type NotificationLogLevel = z.output<typeof notificationLevelSchema>
export type NotificationAlertRule = z.output<typeof alertRuleSchema>
export type NotificationAlertConfig = z.output<typeof notificationAlertConfigSchema>
export type NotificationWebhookConfig = z.output<typeof notificationWebhookConfigSchema>
export type NotificationSlackConfig = z.output<typeof notificationSlackConfigSchema>

export const notificationSubscriptionSchema = z.object({
  id: z.string(),
  notificationType: notificationTypeSchema,
  workflowIds: z.array(z.string()),
  allWorkflows: z.boolean(),
  levelFilter: z.array(notificationLevelSchema),
  triggerFilter: z.array(z.string()),
  includeFinalOutput: z.boolean(),
  includeTraceSpans: z.boolean(),
  includeRateLimits: z.boolean(),
  includeUsageData: z.boolean(),
  webhookConfig: notificationWebhookConfigSchema.nullish(),
  emailRecipients: z.array(z.string()).nullish(),
  slackConfig: notificationSlackConfigSchema.nullish(),
  alertConfig: notificationAlertConfigSchema.nullish(),
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type NotificationSubscription = z.output<typeof notificationSubscriptionSchema>

export const createNotificationBodySchema = z.object({
  notificationType: notificationTypeSchema,
  workflowIds: z.array(z.string()),
  allWorkflows: z.boolean(),
  levelFilter: z.array(notificationLevelSchema),
  triggerFilter: z.array(z.string()),
  includeFinalOutput: z.boolean(),
  includeTraceSpans: z.boolean(),
  includeRateLimits: z.boolean(),
  includeUsageData: z.boolean(),
  alertConfig: notificationAlertConfigSchema.nullish(),
  webhookConfig: notificationWebhookConfigSchema.optional(),
  emailRecipients: z.array(z.string().email()).optional(),
  slackConfig: notificationSlackConfigSchema.optional(),
})

export const updateNotificationBodySchema = createNotificationBodySchema
  .omit({ notificationType: true })
  .partial()
  .extend({
    active: z.boolean().optional(),
  })

/**
 * Server-side validation schemas with rule-specific refinements and bounded
 * limits. These are stricter than the wire schemas above and are used by the
 * `POST` and `PUT` notification routes to validate inbound payloads before
 * persisting them.
 */
const serverAlertConfigSchema = z
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

export interface NotificationServerLimits {
  maxEmailRecipients: number
  maxWorkflowIds: number
}

export const NOTIFICATION_SERVER_LIMITS: NotificationServerLimits = {
  maxEmailRecipients: 10,
  maxWorkflowIds: 1000,
}

export function buildServerCreateNotificationSchema(limits: NotificationServerLimits) {
  return z
    .object({
      notificationType: notificationTypeSchema,
      workflowIds: z.array(z.string()).max(limits.maxWorkflowIds).default([]),
      allWorkflows: z.boolean().default(false),
      levelFilter: z.array(notificationLevelSchema).default(['info', 'error']),
      triggerFilter: z.array(z.string().min(1)).default([]),
      includeFinalOutput: z.boolean().default(false),
      includeTraceSpans: z.boolean().default(false),
      includeRateLimits: z.boolean().default(false),
      includeUsageData: z.boolean().default(false),
      alertConfig: serverAlertConfigSchema.optional(),
      webhookConfig: notificationWebhookConfigSchema.optional(),
      emailRecipients: z.array(z.string().email()).max(limits.maxEmailRecipients).optional(),
      slackConfig: notificationSlackConfigSchema.optional(),
    })
    .refine(
      (data) => {
        if (data.notificationType === 'webhook') return !!data.webhookConfig?.url
        if (data.notificationType === 'email')
          return !!data.emailRecipients && data.emailRecipients.length > 0
        if (data.notificationType === 'slack')
          return !!data.slackConfig?.channelId && !!data.slackConfig?.accountId
        return false
      },
      { message: 'Missing required fields for notification type' }
    )
    .refine((data) => !(data.allWorkflows && data.workflowIds.length > 0), {
      message: 'Cannot specify both allWorkflows and workflowIds',
    })
}

export function buildServerUpdateNotificationSchema(limits: NotificationServerLimits) {
  return z
    .object({
      workflowIds: z.array(z.string()).max(limits.maxWorkflowIds).optional(),
      allWorkflows: z.boolean().optional(),
      levelFilter: z.array(notificationLevelSchema).optional(),
      triggerFilter: z.array(z.string().min(1)).optional(),
      includeFinalOutput: z.boolean().optional(),
      includeTraceSpans: z.boolean().optional(),
      includeRateLimits: z.boolean().optional(),
      includeUsageData: z.boolean().optional(),
      alertConfig: serverAlertConfigSchema.optional(),
      webhookConfig: notificationWebhookConfigSchema.optional(),
      emailRecipients: z.array(z.string().email()).max(limits.maxEmailRecipients).optional(),
      slackConfig: notificationSlackConfigSchema.optional(),
      active: z.boolean().optional(),
    })
    .refine((data) => !(data.allWorkflows && data.workflowIds && data.workflowIds.length > 0), {
      message: 'Cannot specify both allWorkflows and workflowIds',
    })
}

export const listNotificationsContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/notifications',
  params: notificationWorkspaceParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      data: z.array(notificationSubscriptionSchema),
    }),
  },
})

export const createNotificationContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/notifications',
  params: notificationWorkspaceParamsSchema,
  body: createNotificationBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      data: notificationSubscriptionSchema,
    }),
  },
})

export const createNotificationServerContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/notifications',
  params: notificationWorkspaceParamsSchema,
  body: buildServerCreateNotificationSchema(NOTIFICATION_SERVER_LIMITS),
  response: {
    mode: 'json',
    schema: z.object({
      data: notificationSubscriptionSchema,
    }),
  },
})

export const updateNotificationContract = defineRouteContract({
  method: 'PUT',
  path: '/api/workspaces/[id]/notifications/[notificationId]',
  params: notificationParamsSchema,
  body: updateNotificationBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      data: notificationSubscriptionSchema,
    }),
  },
})

export const updateNotificationServerContract = defineRouteContract({
  method: 'PUT',
  path: '/api/workspaces/[id]/notifications/[notificationId]',
  params: notificationParamsSchema,
  body: buildServerUpdateNotificationSchema(NOTIFICATION_SERVER_LIMITS),
  response: {
    mode: 'json',
    schema: z.object({
      data: notificationSubscriptionSchema,
    }),
  },
})

export const deleteNotificationContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/workspaces/[id]/notifications/[notificationId]',
  params: notificationParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
    }),
  },
})

export const testNotificationContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/notifications/[notificationId]/test',
  params: notificationParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      data: z.object({
        success: z.boolean(),
        error: z.string().optional(),
        channel: z.string().optional(),
        timestamp: z.string().optional(),
      }),
    }),
  },
})
