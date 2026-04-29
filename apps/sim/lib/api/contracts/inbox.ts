import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const inboxWorkspaceParamsSchema = z.object({
  id: z.string().min(1),
})

export const inboxTaskStatusSchema = z.enum([
  'all',
  'received',
  'processing',
  'completed',
  'failed',
  'rejected',
])

export const inboxConfigSchema = z.object({
  enabled: z.boolean(),
  address: z.string().nullable(),
  taskStats: z.object({
    total: z.number(),
    completed: z.number(),
    processing: z.number(),
    failed: z.number(),
  }),
})

export type InboxConfig = z.output<typeof inboxConfigSchema>
export type InboxTaskStatus = z.output<typeof inboxTaskStatusSchema>

export const updateInboxConfigBodySchema = z.object({
  enabled: z.boolean().optional(),
  username: z.string().min(1).max(64).optional(),
})

export const updateInboxConfigResponseSchema = z.object({
  enabled: z.boolean(),
  address: z.string().nullable(),
  providerId: z.string().nullable().optional(),
})

export const inboxSenderSchema = z.object({
  id: z.string(),
  email: z.string(),
  label: z.string().nullable(),
  createdAt: z.string(),
})

export type InboxSender = z.output<typeof inboxSenderSchema>

export const inboxMemberSchema = z.object({
  email: z.string(),
  name: z.string().nullable(),
  isAutoAllowed: z.boolean(),
})

export type InboxMember = z.output<typeof inboxMemberSchema>

export const inboxSendersResponseSchema = z.object({
  senders: z.array(inboxSenderSchema),
  workspaceMembers: z.array(inboxMemberSchema),
})

export type InboxSendersResponseBody = z.output<typeof inboxSendersResponseSchema>

export const createInboxSenderBodySchema = z.object({
  email: z.string().email('Invalid email address'),
  label: z.string().max(100).optional(),
})

export const deleteInboxSenderBodySchema = z.object({
  senderId: z.string().min(1),
})

export const inboxTasksQuerySchema = z.object({
  status: inboxTaskStatusSchema.optional(),
  cursor: z.string().optional(),
  limit: z.preprocess(
    (value) => (value === undefined || value === '' ? undefined : value),
    z.coerce
      .number()
      .optional()
      .transform((value) => (value === undefined ? undefined : Math.min(value, 50)))
  ),
})

export const inboxTaskSchema = z.object({
  id: z.string(),
  fromEmail: z.string(),
  fromName: z.string().nullable(),
  subject: z.string(),
  bodyPreview: z.string().nullable(),
  status: inboxTaskStatusSchema.exclude(['all']),
  hasAttachments: z.boolean(),
  resultSummary: z.string().nullable(),
  errorMessage: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  chatId: z.string().nullable(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
})

export type InboxTask = z.output<typeof inboxTaskSchema>

export const inboxTasksResponseSchema = z.object({
  tasks: z.array(inboxTaskSchema),
  pagination: z.object({
    limit: z.number(),
    hasMore: z.boolean(),
    nextCursor: z.string().nullable(),
  }),
})

export type InboxTasksResponseBody = z.output<typeof inboxTasksResponseSchema>

export const getInboxConfigContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/inbox',
  params: inboxWorkspaceParamsSchema,
  response: {
    mode: 'json',
    schema: inboxConfigSchema,
  },
})

export const updateInboxConfigContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/workspaces/[id]/inbox',
  params: inboxWorkspaceParamsSchema,
  body: updateInboxConfigBodySchema,
  response: {
    mode: 'json',
    schema: updateInboxConfigResponseSchema,
  },
})

export const listInboxSendersContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/inbox/senders',
  params: inboxWorkspaceParamsSchema,
  response: {
    mode: 'json',
    schema: inboxSendersResponseSchema,
  },
})

export const addInboxSenderContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/inbox/senders',
  params: inboxWorkspaceParamsSchema,
  body: createInboxSenderBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      sender: inboxSenderSchema.extend({
        workspaceId: z.string().optional(),
        addedBy: z.string().optional(),
      }),
    }),
  },
})

export const removeInboxSenderContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/workspaces/[id]/inbox/senders',
  params: inboxWorkspaceParamsSchema,
  body: deleteInboxSenderBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      ok: z.literal(true),
    }),
  },
})

export const listInboxTasksContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/inbox/tasks',
  params: inboxWorkspaceParamsSchema,
  query: inboxTasksQuerySchema,
  response: {
    mode: 'json',
    schema: inboxTasksResponseSchema,
  },
})
