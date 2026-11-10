import { z } from 'zod'
import { organizationIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

/** The resource families an `@` mention names, in the picker's group order. */
export const MENTION_FAMILIES = [
  'workspaces',
  'chats',
  'dashboards',
  'tables',
  'files',
  'file_folders',
  'knowledge_bases',
  'workflows',
  'logs',
  'folders',
  'skills',
] as const

export type MentionFamily = (typeof MENTION_FAMILIES)[number]

/** The families a read may list alone, each spanning the organization. */
const MENTION_LIST_FAMILIES = ['workspaces', 'skills'] as const

export type MentionListFamily = (typeof MENTION_LIST_FAMILIES)[number]

/** Rows per family a suggestion read returns, and the most a family list may ask for. */
export const MENTION_SUGGESTION_LIMIT = 20
export const MENTION_BROWSE_LIMIT = 100
const MENTION_QUERY_MAX_LENGTH = 200

const paramsSchema = z.object({ id: organizationIdSchema })

const querySchema = z.object({
  /** What follows the `@`; empty asks for the most recently updated rows. */
  query: z.string().trim().max(MENTION_QUERY_MAX_LENGTH).default(''),
  /** The organization's workspaces, or every skill the viewer can use across them. */
  family: z.enum(MENTION_LIST_FAMILIES).optional(),
  limit: z.coerce.number().int().min(1).max(MENTION_BROWSE_LIMIT).default(MENTION_SUGGESTION_LIMIT),
})

const mentionRowSchema = z.object({
  family: z.enum(MENTION_FAMILIES),
  id: z.string(),
  name: z.string(),
  /** Absent only for a built-in skill, which belongs to no workspace. */
  workspaceId: z.string().optional(),
  workspaceName: z.string().optional(),
  /** A folder row's own family: "Workflow folders", "Table folders" or "Knowledge base folders". */
  folderFamily: z.string().optional(),
  /** A skill's description. */
  detail: z.string().optional(),
  /** A log row's run: its execution id and start time. */
  executionId: z.string().optional(),
  createdAt: z.string().optional(),
  /** A log row's workflow name, or its id when the workflow is gone. */
  workflowLabel: z.string().optional(),
})
export type MentionRow = z.output<typeof mentionRowSchema>

export const searchOrganizationMentionsContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/mentions',
  params: paramsSchema,
  query: querySchema,
  response: {
    mode: 'json',
    schema: z.object({
      rows: z.array(mentionRowSchema),
      /** Workspaces whose access could not be read; their rows are missing and the rest stand. */
      unavailableWorkspaces: z.array(z.object({ id: z.string(), name: z.string() })),
      /** Families whose read failed; every other family's rows stand. */
      unavailableFamilies: z.array(z.enum(MENTION_FAMILIES)),
    }),
  },
})
