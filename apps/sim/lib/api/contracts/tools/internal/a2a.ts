import { z } from 'zod'
import { internalToolResponseSchema } from '@/lib/api/contracts/tools/internal/shared'
import { defineRouteContract } from '@/lib/api/contracts/types'

const a2aBaseBodySchema = z.object({
  agentUrl: z.string().min(1, 'Agent URL is required'),
  apiKey: z.string().optional(),
})

const a2aTaskBodySchema = a2aBaseBodySchema.extend({
  taskId: z.string().min(1, 'Task ID is required'),
})

export const a2aGetAgentCardBodySchema = a2aBaseBodySchema

export const a2aSendMessageFileSchema = z.object({
  type: z.enum(['file', 'url']),
  data: z.string(),
  name: z.string(),
  mime: z.string().optional(),
})

export const a2aSendMessageBodySchema = a2aBaseBodySchema.extend({
  message: z.string().min(1, 'Message is required'),
  taskId: z.string().optional(),
  contextId: z.string().optional(),
  data: z.string().optional(),
  files: z.array(a2aSendMessageFileSchema).optional(),
})

export const a2aGetTaskBodySchema = a2aTaskBodySchema.extend({
  historyLength: z.number().optional(),
})

export const a2aCancelTaskBodySchema = a2aTaskBodySchema

export const a2aResubscribeBodySchema = a2aTaskBodySchema

export const a2aSetPushNotificationBodySchema = a2aTaskBodySchema.extend({
  webhookUrl: z.string().min(1, 'Webhook URL is required'),
  token: z.string().optional(),
})

export const a2aGetPushNotificationBodySchema = a2aTaskBodySchema

export const a2aDeletePushNotificationBodySchema = a2aTaskBodySchema.extend({
  pushNotificationConfigId: z.string().optional(),
})

export const a2aGetAgentCardContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/a2a/get-agent-card',
  body: a2aGetAgentCardBodySchema,
  response: {
    mode: 'json',
    schema: internalToolResponseSchema,
  },
})

export const a2aSendMessageContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/a2a/send-message',
  body: a2aSendMessageBodySchema,
  response: {
    mode: 'json',
    schema: internalToolResponseSchema,
  },
})

export const a2aGetTaskContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/a2a/get-task',
  body: a2aGetTaskBodySchema,
  response: {
    mode: 'json',
    schema: internalToolResponseSchema,
  },
})

export const a2aCancelTaskContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/a2a/cancel-task',
  body: a2aCancelTaskBodySchema,
  response: {
    mode: 'json',
    schema: internalToolResponseSchema,
  },
})

export const a2aResubscribeContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/a2a/resubscribe',
  body: a2aResubscribeBodySchema,
  response: {
    mode: 'json',
    schema: internalToolResponseSchema,
  },
})

export const a2aSetPushNotificationContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/a2a/set-push-notification',
  body: a2aSetPushNotificationBodySchema,
  response: {
    mode: 'json',
    schema: internalToolResponseSchema,
  },
})

export const a2aGetPushNotificationContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/a2a/get-push-notification',
  body: a2aGetPushNotificationBodySchema,
  response: {
    mode: 'json',
    schema: internalToolResponseSchema,
  },
})

export const a2aDeletePushNotificationContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/a2a/delete-push-notification',
  body: a2aDeletePushNotificationBodySchema,
  response: {
    mode: 'json',
    schema: internalToolResponseSchema,
  },
})
