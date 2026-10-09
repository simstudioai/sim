import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'

const releaseIdSchema = z.string().min(1).max(128)
export const changelogRevisionSchema = z.string().min(1).max(32)
export const changelogTitleSchema = z.string().trim().min(1).max(200)
export const changelogBumpReasonSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .describe('Why this release is a major, minor, or patch release, in one line.')
export const changelogVersionSchema = z
  .string()
  .trim()
  .min(5)
  .max(40)
  .describe('A new version label, MAJOR.MINOR.PATCH, like 1.4.0. Must not be in use.')

const changelogChangeInputSchema = z
  .object({
    text: z.string().trim().min(1).max(500).describe('What changed, in one line a user reads.'),
    workflowId: z.string().min(1).max(128).optional().describe('The workflow it changed.'),
    deploymentVersionId: z
      .string()
      .min(1)
      .max(128)
      .optional()
      .describe('The deployment it shipped in; requires workflowId of that workflow.'),
    chatId: z
      .uuid()
      .optional()
      .describe('The chat where the change was made; defaults to the chat publishing it.'),
  })
  .strict()
  .refine((change) => !change.deploymentVersionId || change.workflowId, {
    message: 'deploymentVersionId requires the workflowId it belongs to',
    path: ['workflowId'],
  })
export const changelogChangesInputSchema = z.array(changelogChangeInputSchema).max(50)

const changelogChangeSchema = z.object({
  id: z.string(),
  text: z.string(),
  workflowId: z.string().nullable(),
  workflowName: z.string().nullable(),
  deploymentVersionId: z.string().nullable(),
  deploymentVersion: z.number().int().nullable(),
  chatId: z.string().nullable(),
})

const changelogReleaseSchema = z.object({
  id: z.string(),
  version: z.string(),
  title: z.string(),
  bumpReason: z.string(),
  publishedAt: z.string(),
  updatedAt: z.string(),
  revision: changelogRevisionSchema,
  fileId: z.string(),
  path: z.string(),
  changes: z.array(changelogChangeSchema),
  workflows: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      deploymentVersion: z.number().int().nullable(),
    })
  ),
})

const workspaceParams = z.object({ id: workspaceIdSchema })

/** Newest release first; pass `nextCursor` back as `cursor` for the page after. */
export const listChangelogReleasesContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/changelog',
  params: workspaceParams,
  query: z.object({ cursor: z.string().min(1).max(256).optional() }),
  response: {
    mode: 'json',
    schema: z.object({
      releases: z.array(changelogReleaseSchema),
      nextCursor: z.string().nullable(),
    }),
  },
})

const updateChangelogReleaseBodySchema = z
  .object({
    expectedRevision: changelogRevisionSchema,
    title: changelogTitleSchema.optional(),
    bumpReason: changelogBumpReasonSchema.optional(),
    version: changelogVersionSchema.optional(),
  })
  .strict()

/** Edits a release's own fields; the body is edited as its file. */
export const updateChangelogReleaseContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/workspaces/[id]/changelog/[releaseId]',
  params: workspaceParams.extend({ releaseId: releaseIdSchema }),
  body: updateChangelogReleaseBodySchema,
  response: { mode: 'json', schema: z.object({ release: changelogReleaseSchema }) },
})

export type ChangelogRelease = z.output<typeof changelogReleaseSchema>
export type ChangelogReleaseWorkflow = ChangelogRelease['workflows'][number]
export type UpdateChangelogReleaseBody = z.input<typeof updateChangelogReleaseBodySchema>
