import { z } from 'zod'
import { genericToolResponseSchema } from '@/lib/api/contracts/tools/shared'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

const a2aBaseBodySchema = z.object({
  agentUrl: z.string().url('Agent URL must be a valid URL').max(2048),
  apiKey: z.string().optional(),
})

export const a2aSendMessageBodySchema = a2aBaseBodySchema.extend({
  message: z.string().min(1, 'Message is required'),
  data: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  files: z.array(RawFileInputSchema).max(20).optional(),
  taskId: z.string().optional(),
  contextId: z.string().optional(),
})

export const a2aGetTaskBodySchema = a2aBaseBodySchema.extend({
  taskId: z.string().min(1, 'Task ID is required'),
  historyLength: z
    .number()
    .int()
    .positive()
    .max(1000, 'History length cannot exceed 1000')
    .optional(),
})

export const a2aCancelTaskBodySchema = a2aBaseBodySchema.extend({
  taskId: z.string().min(1, 'Task ID is required'),
})

export const a2aGetAgentCardContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/a2a/get-agent-card',
  body: a2aBaseBodySchema,
  response: { mode: 'json', schema: genericToolResponseSchema },
})

export const a2aSendMessageContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/a2a/send-message',
  body: a2aSendMessageBodySchema,
  response: { mode: 'json', schema: genericToolResponseSchema },
})

export const a2aGetTaskContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/a2a/get-task',
  body: a2aGetTaskBodySchema,
  response: { mode: 'json', schema: genericToolResponseSchema },
})

export const a2aCancelTaskContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/a2a/cancel-task',
  body: a2aCancelTaskBodySchema,
  response: { mode: 'json', schema: genericToolResponseSchema },
})
