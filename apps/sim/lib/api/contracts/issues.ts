import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'
import {
  ISSUE_CLOSE_REASONS,
  ISSUE_RESOURCE_TYPES,
  ISSUE_STATUSES,
  ISSUE_TICKET_PROVIDERS,
} from '@/lib/issues/types'

const workspaceParams = z.object({ id: workspaceIdSchema })
const issueParams = z.object({
  id: workspaceIdSchema,
  key: z.string().min(1).max(32, 'Issue keys look like SIM-152'),
})

const prioritySchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
])
const titleSchema = z.string().trim().min(1, 'An issue needs a title').max(200)

const issueRecordSchema = z.object({
  id: z.string(),
  key: z.string(),
  title: z.string(),
  status: z.enum(ISSUE_STATUSES),
  inboxKind: z.enum(['new', 'review']).nullable(),
  closeReason: z.enum(ISSUE_CLOSE_REASONS).nullable(),
  duplicateOfId: z.string().nullable(),
  priority: prioritySchema,
  owner: z.object({ id: z.string(), name: z.string() }).nullable(),
  workingChat: z
    .object({ id: z.string(), title: z.string().nullable(), running: z.boolean() })
    .nullable(),
  reviewSummary: z.string().nullable(),
  filedBy: z.object({
    kind: z.enum(['user', 'sim', 'workflow']),
    name: z.string().nullable(),
  }),
  bodyFileId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
})

const issueEventSchema = z.object({
  id: z.string(),
  kind: z.string(),
  actor: z
    .object({ kind: z.enum(['user', 'sim', 'workflow']), userId: z.string().nullable() })
    .nullable(),
  // untyped-response: each event kind carries its own small payload (from/to, chat id, summary)
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
})

const issueResourceSchema = z.object({
  type: z.enum(ISSUE_RESOURCE_TYPES),
  id: z.string(),
  createdAt: z.string(),
})

const issueTicketSchema = z.object({
  id: z.string(),
  provider: z.enum(ISSUE_TICKET_PROVIDERS),
  externalKey: z.string(),
  url: z.string(),
  title: z.string().nullable(),
  status: z.string().nullable(),
})

const issueResponseSchema = z.object({ issue: issueRecordSchema })

export const listIssuesContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/issues',
  params: workspaceParams,
  response: { mode: 'json', schema: z.object({ issues: z.array(issueRecordSchema) }) },
})

const createIssueBodySchema = z.object({
  title: titleSchema,
  body: z.string().max(1024 * 1024, 'The issue body is larger than 1 MB'),
  priority: prioritySchema.optional(),
})

export const createIssueContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/issues',
  params: workspaceParams,
  body: createIssueBodySchema,
  response: {
    mode: 'json',
    schema: z.object({ issue: issueRecordSchema, created: z.boolean() }),
  },
})

export const getIssueContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/issues/[key]',
  params: issueParams,
  response: {
    mode: 'json',
    schema: z.object({
      issue: issueRecordSchema,
      events: z.array(issueEventSchema),
      chats: z.array(
        z.object({ id: z.string(), title: z.string().nullable(), updatedAt: z.string() })
      ),
      resources: z.array(issueResourceSchema),
      tickets: z.array(issueTicketSchema),
    }),
  },
})

const updateIssueBodySchema = z
  .object({
    title: titleSchema.optional(),
    priority: prioritySchema.optional(),
    ownerId: z.string().min(1).max(128).nullable().optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: 'Change at least one of title, priority, or owner',
  })

export const updateIssueContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/workspaces/[id]/issues/[key]',
  params: issueParams,
  body: updateIssueBodySchema,
  response: { mode: 'json', schema: issueResponseSchema },
})

export const startIssueContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/issues/[key]/start',
  params: issueParams,
  body: z.object({ chatId: z.string().uuid('chatId must be a UUID') }),
  response: { mode: 'json', schema: issueResponseSchema },
})

export const requestIssueReviewContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/issues/[key]/request-review',
  params: issueParams,
  body: z.object({ summary: z.string().trim().min(1, 'Say what changed').max(500) }),
  response: { mode: 'json', schema: issueResponseSchema },
})

export const approveIssueContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/issues/[key]/approve',
  params: issueParams,
  response: { mode: 'json', schema: issueResponseSchema },
})

export const requestIssueChangesContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/issues/[key]/request-changes',
  params: issueParams,
  body: z.object({ note: z.string().trim().max(2000).optional() }),
  response: { mode: 'json', schema: issueResponseSchema },
})

const closeIssueBodySchema = z
  .object({
    reason: z.enum(ISSUE_CLOSE_REASONS),
    duplicateOfKey: z.string().min(1).max(32).optional(),
  })
  .superRefine((body, ctx) => {
    if (body.reason === 'duplicate' && !body.duplicateOfKey)
      ctx.addIssue({
        code: 'custom',
        path: ['duplicateOfKey'],
        message: 'Name the issue this one duplicates',
      })
  })

export const closeIssueContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/issues/[key]/close',
  params: issueParams,
  body: closeIssueBodySchema,
  response: { mode: 'json', schema: issueResponseSchema },
})

export const reopenIssueContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/issues/[key]/reopen',
  params: issueParams,
  response: { mode: 'json', schema: issueResponseSchema },
})

const issueEventsResponseSchema = z.object({ events: z.array(issueEventSchema) })

export const addIssueCommentContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/issues/[key]/comments',
  params: issueParams,
  body: z.object({
    body: z
      .string()
      .trim()
      .min(1, 'A comment cannot be empty')
      .max(10_000, 'Comments are at most 10,000 characters'),
  }),
  response: { mode: 'json', schema: issueEventsResponseSchema },
})

export const deleteIssueCommentContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/workspaces/[id]/issues/[key]/comments/[commentId]',
  params: issueParams.extend({ commentId: z.string().min(1).max(128) }),
  response: { mode: 'json', schema: issueEventsResponseSchema },
})

const issueResourceBodySchema = z.object({
  type: z.enum(ISSUE_RESOURCE_TYPES),
  resourceId: z.string().min(1).max(128),
})
const issueResourcesResponseSchema = z.object({ resources: z.array(issueResourceSchema) })

export const addIssueResourceContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/issues/[key]/resources',
  params: issueParams,
  body: issueResourceBodySchema,
  response: { mode: 'json', schema: issueResourcesResponseSchema },
})

export const removeIssueResourceContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/workspaces/[id]/issues/[key]/resources',
  params: issueParams,
  body: issueResourceBodySchema,
  response: { mode: 'json', schema: issueResourcesResponseSchema },
})

const issueTicketsResponseSchema = z.object({ tickets: z.array(issueTicketSchema) })

const linkIssueTicketBodySchema = z.object({
  provider: z.enum(ISSUE_TICKET_PROVIDERS),
  externalId: z.string().min(1).max(256),
  externalKey: z.string().min(1).max(64),
  url: z.string().url().max(2048),
  title: z.string().max(500).nullable().optional(),
  status: z.string().max(100).nullable().optional(),
})

export const linkIssueTicketContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/issues/[key]/tickets',
  params: issueParams,
  body: linkIssueTicketBodySchema,
  response: { mode: 'json', schema: issueTicketsResponseSchema },
})

export const unlinkIssueTicketContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/workspaces/[id]/issues/[key]/tickets/[ticketId]',
  params: issueParams.extend({ ticketId: z.string().min(1).max(128) }),
  response: { mode: 'json', schema: issueTicketsResponseSchema },
})

export type IssueRecord = z.output<typeof issueRecordSchema>
export type IssueDetail = ContractJsonResponse<typeof getIssueContract>
export type IssueEvent = IssueDetail['events'][number]
export type CreateIssueBody = z.input<typeof createIssueBodySchema>
export type UpdateIssueBody = z.input<typeof updateIssueBodySchema>
export type CloseIssueBody = z.input<typeof closeIssueBodySchema>
