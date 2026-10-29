import { z } from 'zod'
import { RawFileInputArraySchema } from '@/lib/uploads/utils/file-schemas'

export const jiraParentReferenceSchema = z.union([
  z.string().min(1),
  z.object({ key: z.string().min(1) }).passthrough(),
  z.object({ id: z.string().min(1) }).passthrough(),
])

export const jiraWriteInputSchema = z.object({
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

export const jiraUpdateInputSchema = z.object({
  domain: z.string().min(1, 'Domain is required'),
  accessToken: z.string().min(1, 'Access token is required'),
  issueKey: z.string().min(1, 'Issue key is required'),
  summary: z.string().optional(),
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

export const jiraAddAttachmentInputSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  domain: z.string().min(1, 'Domain is required'),
  issueKey: z.string().min(1, 'Issue key is required'),
  files: RawFileInputArraySchema,
  cloudId: z.string().optional().nullable(),
})

export type JiraWriteInput = z.output<typeof jiraWriteInputSchema>
export type JiraUpdateInput = z.output<typeof jiraUpdateInputSchema>
export type JiraAddAttachmentInput = z.output<typeof jiraAddAttachmentInputSchema>

export const jiraCreateSprintInputSchema = z
  .object({
    accessToken: z.string().min(1),
    domain: z.string().min(1),
    originBoardId: z.number().int().positive(),
    name: z.string().trim().min(1),
    goal: z.string().optional(),
    startDate: z.iso.datetime({ offset: true }).optional(),
    endDate: z.iso.datetime({ offset: true }).optional(),
  })
  .refine(
    (input) =>
      !input.startDate || !input.endDate || Date.parse(input.endDate) > Date.parse(input.startDate),
    { message: 'End date must be after the start date', path: ['endDate'] }
  )

export const jiraSprintResponseSchema = z.object({
  id: z.number().int(),
  self: z.string(),
  state: z.string(),
  name: z.string(),
  originBoardId: z.number().int(),
  goal: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
})
export type JiraCreateSprintInput = z.output<typeof jiraCreateSprintInputSchema>
