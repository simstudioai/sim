import { z } from 'zod'
import { idNameSchema, optionalString } from '@/lib/api/contracts/selectors/shared'
import type { ContractBody, ContractJsonResponse, ContractQuery } from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { RawFileInputArraySchema } from '@/lib/uploads/utils/file-schemas'

const jiraIssueSectionSchema = z
  .object({
    issues: z.array(
      z
        .object({
          id: z.string().optional(),
          key: z.string().optional(),
          summary: z.string().optional(),
        })
        .passthrough()
    ),
  })
  .passthrough()

export const jiraProjectsQuerySchema = z.object({
  domain: z.string().trim().min(1, 'Domain is required'),
  accessToken: z.string().min(1, 'Access token is required'),
  cloudId: optionalString,
  query: optionalString,
})

export const jiraProjectBodySchema = z.object({
  domain: z.string().min(1, 'Domain is required'),
  accessToken: z.string().min(1, 'Access token is required'),
  cloudId: optionalString,
  projectId: z.string().min(1, 'Project ID is required'),
})

/**
 * GET `/api/tools/jira/issues` query.
 */
export const jiraIssuesQuerySchema = z.object({
  domain: z.string().trim().min(1, 'Domain is required'),
  accessToken: z.string().min(1, 'Access token is required'),
  cloudId: optionalString,
  projectId: optionalString,
  manualProjectId: optionalString,
  query: optionalString,
  all: z
    .preprocess(
      (value) => (typeof value === 'string' ? value.toLowerCase() === 'true' : value),
      z.boolean()
    )
    .default(false),
  limit: z
    .preprocess((value) => {
      const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : value
      return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0 ? parsed : 0
    }, z.number())
    .default(0),
})

export const jiraIssuesBodySchema = z.object({
  domain: z.string().min(1, 'Domain is required'),
  accessToken: z.string().min(1, 'Access token is required'),
  cloudId: optionalString,
  issueKeys: z.array(z.string().min(1)).default([]),
})

export const jiraParentReferenceSchema = z.union([
  z.string().min(1),
  z.object({ key: z.string().min(1) }).passthrough(),
  z.object({ id: z.string().min(1) }).passthrough(),
])
export type JiraParentReference = z.input<typeof jiraParentReferenceSchema>

export const jiraWriteBodySchema = z.object({
  domain: z.string({ error: 'Domain is required' }).min(1, 'Domain is required'),
  accessToken: z.string({ error: 'Access token is required' }).min(1, 'Access token is required'),
  projectId: z.string({ error: 'Project ID is required' }).min(1, 'Project ID is required'),
  summary: z.string({ error: 'Summary is required' }).min(1, 'Summary is required'),
  description: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  priority: z.string().optional(),
  assignee: z.string().optional(),
  cloudId: z.string().optional(),
  issueType: z.string().optional(),
  parent: jiraParentReferenceSchema.optional(),
  labels: z.array(z.string()).optional(),
  duedate: z.string().optional(),
  reporter: z.string().optional(),
  environment: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  customFieldId: z.string().optional(),
  customFieldValue: z.string().optional(),
  components: z.array(z.string()).optional(),
  fixVersions: z.array(z.string()).optional(),
})

export const jiraUpdateBodySchema = z.object({
  domain: z.string().min(1, 'Domain is required'),
  accessToken: z.string().min(1, 'Access token is required'),
  issueKey: z.string().min(1, 'Issue key is required'),
  summary: z.string().optional(),
  title: z.string().optional(),
  description: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  priority: z.string().optional(),
  assignee: z.string().optional(),
  labels: z.array(z.string()).optional(),
  components: z.array(z.string()).optional(),
  duedate: z.string().optional(),
  fixVersions: z.array(z.string()).optional(),
  environment: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  customFieldId: z.string().optional(),
  customFieldValue: z.string().optional(),
  notifyUsers: z.boolean().optional(),
  cloudId: z.string().optional(),
})

export const jiraAddAttachmentBodySchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  domain: z.string().min(1, 'Domain is required'),
  issueKey: z.string().min(1, 'Issue key is required'),
  files: RawFileInputArraySchema,
  cloudId: z.string().optional().nullable(),
})

export const jiraProjectsSelectorContract = defineRouteContract({
  method: 'GET',
  path: '/api/tools/jira/projects',
  query: jiraProjectsQuerySchema,
  response: {
    mode: 'json',
    schema: z
      .object({ projects: z.array(idNameSchema), cloudId: z.string().optional() })
      .passthrough(),
  },
})

export const jiraProjectSelectorContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/jira/projects',
  body: jiraProjectBodySchema,
  response: {
    mode: 'json',
    schema: z
      .object({ project: idNameSchema.optional(), cloudId: z.string().optional() })
      .passthrough(),
  },
})

export const jiraIssuesSelectorContract = defineRouteContract({
  method: 'GET',
  path: '/api/tools/jira/issues',
  query: jiraIssuesQuerySchema,
  response: {
    mode: 'json',
    schema: z
      .object({
        sections: z.array(jiraIssueSectionSchema).optional(),
        cloudId: z.string().optional(),
      })
      .passthrough(),
  },
})

export const jiraIssueSelectorContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/jira/issues',
  body: jiraIssuesBodySchema,
  response: {
    mode: 'json',
    schema: z
      .object({ issues: z.array(idNameSchema).optional(), cloudId: z.string().optional() })
      .passthrough(),
  },
})

const jiraWriteResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    ts: z.string(),
    id: z.string(),
    issueKey: z.string(),
    self: z.string(),
    summary: z.string(),
    success: z.literal(true),
    url: z.string(),
    assigneeId: z.string().optional(),
  }),
})

const jiraUpdateResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    ts: z.string(),
    issueKey: z.string(),
    summary: z.string(),
    success: z.literal(true),
  }),
})

const jiraAttachmentSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  size: z.number(),
  content: z.string(),
})

const jiraAddAttachmentUserFileSchema = z
  .object({
    id: z.string().optional(),
    name: z.string(),
    url: z.string().optional(),
    size: z.number(),
    type: z.string().optional(),
    key: z.string(),
  })
  .passthrough()

const jiraAddAttachmentResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    ts: z.string(),
    issueKey: z.string(),
    attachments: z.array(jiraAttachmentSchema),
    attachmentIds: z.array(z.string()),
    files: z.array(jiraAddAttachmentUserFileSchema),
  }),
})

export const jiraWriteContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/jira/write',
  body: jiraWriteBodySchema,
  response: { mode: 'json', schema: jiraWriteResponseSchema },
})

export const jiraUpdateContract = defineRouteContract({
  method: 'PUT',
  path: '/api/tools/jira/update',
  body: jiraUpdateBodySchema,
  response: { mode: 'json', schema: jiraUpdateResponseSchema },
})

export const jiraAddAttachmentContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/jira/add-attachment',
  body: jiraAddAttachmentBodySchema,
  response: { mode: 'json', schema: jiraAddAttachmentResponseSchema },
})

export type JiraProjectsQuery = ContractQuery<typeof jiraProjectsSelectorContract>
export type JiraProjectBody = ContractBody<typeof jiraProjectSelectorContract>
export type JiraIssuesQuery = ContractQuery<typeof jiraIssuesSelectorContract>
export type JiraIssuesBody = ContractBody<typeof jiraIssueSelectorContract>
export type JiraWriteBody = ContractBody<typeof jiraWriteContract>
export type JiraUpdateBody = ContractBody<typeof jiraUpdateContract>
export type JiraAddAttachmentBody = ContractBody<typeof jiraAddAttachmentContract>
export type JiraProjectsSelectorResponse = ContractJsonResponse<typeof jiraProjectsSelectorContract>
export type JiraProjectSelectorResponse = ContractJsonResponse<typeof jiraProjectSelectorContract>
export type JiraIssuesSelectorResponse = ContractJsonResponse<typeof jiraIssuesSelectorContract>
export type JiraIssueSelectorResponse = ContractJsonResponse<typeof jiraIssueSelectorContract>
