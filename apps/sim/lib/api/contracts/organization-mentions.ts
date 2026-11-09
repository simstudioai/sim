import { z } from 'zod'
import { organizationIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
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

/** Rows per family a suggestion read returns, and the most a browse page may ask for. */
export const MENTION_SUGGESTION_LIMIT = 20
export const MENTION_BROWSE_LIMIT = 100
const MENTION_QUERY_MAX_LENGTH = 200

const paramsSchema = z.object({ id: organizationIdSchema })

const querySchema = z
  .object({
    /** What follows the `@`; empty asks for the most recently updated rows. */
    query: z.string().trim().max(MENTION_QUERY_MAX_LENGTH).default(''),
    /**
     * Browse: one workspace's families, or one family's rows with `family`. `skills` alone lists
     * every skill the viewer can use across the organization's workspaces.
     */
    workspaceId: workspaceIdSchema.optional(),
    family: z.enum(MENTION_FAMILIES).optional(),
    /** Browse inside a folder of `family`; only workflows, tables, knowledge bases and files nest. */
    folderId: z.string().min(1).max(128).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(MENTION_BROWSE_LIMIT)
      .default(MENTION_SUGGESTION_LIMIT),
  })
  .refine(
    (query) =>
      !query.family ||
      query.workspaceId ||
      query.family === 'skills' ||
      query.family === 'workspaces',
    {
      message:
        'family requires workspaceId, except skills and workspaces, which span the organization',
      path: ['family'],
    }
  )
  .refine((query) => !query.folderId || query.family, {
    message: 'folderId requires family',
    path: ['folderId'],
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
  /** The query a file is the server's ranked match for. */
  matchedQuery: z.string().optional(),
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
      /** Families with rows in a browsed workspace, when the read names a workspace alone. */
      families: z.array(z.enum(MENTION_FAMILIES)).optional(),
      /** Workspaces whose reads failed; their rows are missing and every other row stands. */
      unavailableWorkspaces: z.array(z.object({ id: z.string(), name: z.string() })),
    }),
  },
})
