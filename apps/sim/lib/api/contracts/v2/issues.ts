import { z } from 'zod'
import { noInputSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2DataResponse } from '@/lib/api/contracts/v2/shared'
import { ISSUE_CLOSE_REASONS, ISSUE_STATUSES } from '@/lib/issues/types'

const issuePrioritySchema = z
  .union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
  .describe('0 is no priority, then low, medium, high, and 4 is urgent.')

const v2IssueSchema = z.object({
  id: z.string().describe('Unique issue identifier.'),
  key: z.string().describe('Workspace-readable key, such as SIM-152.'),
  title: z.string().describe('What is going wrong, in one line.'),
  status: z
    .enum(ISSUE_STATUSES)
    .describe('inbox waits on a person, in_progress has a Sim chat working on it, done is closed.'),
  inboxKind: z
    .enum(['new', 'review'])
    .nullable()
    .describe('For inbox issues: new until Sim works on it, review once Sim hands it back.'),
  closeReason: z
    .enum(ISSUE_CLOSE_REASONS)
    .nullable()
    .describe('Why a done issue closed: completed, dismissed, or duplicate.'),
  priority: issuePrioritySchema,
  ownerId: z.string().nullable().describe('Member who owns the issue; null until work starts.'),
  workingChatId: z.string().nullable().describe('The Sim chat working on the issue, if any.'),
  reviewSummary: z.string().nullable().describe("Sim's one-line result when it asked for review."),
  bodyFileId: z
    .string()
    .describe(
      'File holding the issue document as markdown. Read and replace it with the file content operations.'
    ),
  createdAt: z.string().describe('When the issue was filed (ISO 8601).'),
  updatedAt: z.string().describe('When the issue last changed (ISO 8601).'),
  startedAt: z.string().nullable().describe('When work first started with Sim.'),
  completedAt: z.string().nullable().describe('When the issue was closed.'),
})
export type V2Issue = z.output<typeof v2IssueSchema>

const v2CreateIssueBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace to file the issue in.'),
    title: z
      .string()
      .trim()
      .min(1, 'title cannot be empty')
      .max(200, 'title cannot exceed 200 characters')
      .describe('What is going wrong, in one line.'),
    body: z
      .string()
      .max(1024 * 1024, 'body cannot exceed 1 MB')
      .describe(
        'The issue document as markdown, including any dashboard, diff, or mermaid blocks.'
      ),
    priority: issuePrioritySchema.optional(),
  })
  .strict()

export const v2CreateIssueContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/issues',
  query: noInputSchema,
  body: v2CreateIssueBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2IssueSchema), status: 201 },
})

export const v2GetIssueContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/issues/[issueKey]',
  params: z.object({
    issueKey: z
      .string()
      .min(1)
      .max(32, 'issueKey looks like SIM-152')
      .describe('Issue key, such as SIM-152.'),
  }),
  query: z
    .object({ workspaceId: workspaceIdSchema.describe('Workspace that owns the issue.') })
    .strict(),
  response: { mode: 'json', schema: v2DataResponse(v2IssueSchema) },
})
