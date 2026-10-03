import { z } from 'zod'
import {
  noInputSchema,
  nonEmptyIdSchema,
  withMissingFieldMessage,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import {
  skillContentSchema,
  skillDescriptionSchema,
  skillNameSchema,
} from '@/lib/api/contracts/skills'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2CursorListResponse,
  v2DataResponse,
  v2PaginationFields,
  v2SearchSchema,
  v2SortFields,
  v2TimestampSchema,
} from '@/lib/api/contracts/v2/shared'

/**
 * v2 skills contracts.
 *
 * Two departures from the internal `/api/skills` shape:
 *
 * 1. **Single-resource writes.** The internal `POST` takes an array, conflates
 *    create and update, and answers with the whole workspace skill list. v2
 *    splits it into `POST /v2/skills` (201) and `PATCH /v2/skills/[skillId]`, each
 *    answering with the one skill that changed.
 * 2. **`content` is detail-only.** A skill body is up to 50 000 characters, so
 *    the list returns summaries and the full body is fetched per skill from
 *    `GET /v2/skills/[skillId]`.
 *
 * Field validation lives in `lib/skills/orchestration`, so these schemas and the
 * lib enforce the same limits — the schemas reuse the shared field primitives
 * rather than restating them.
 */

/** List item — everything but the skill body. */
export const v2SkillSummarySchema = z
  .object({
    id: z
      .string()
      .describe(
        'Unique skill identifier. A built-in skill is `builtin-` followed by its name, for example `builtin-research`.'
      ),
    name: z.string().describe('Kebab-case name that agents use to reference the skill.'),
    description: z.string().describe('One-line summary of when the skill applies.'),
    /** True for built-in template skills, which ship with Sim and cannot be written to. */
    readOnly: z
      .boolean()
      .describe('Whether this is a built-in skill that cannot be modified or deleted.'),
    createdAt: v2TimestampSchema.describe(
      'ISO 8601 timestamp when the skill was created. Built-in skills report the Unix epoch.'
    ),
    updatedAt: v2TimestampSchema.describe(
      'ISO 8601 timestamp when the skill was last updated. Built-in skills report the Unix epoch.'
    ),
  })
  .meta({
    id: 'V2SkillSummary',
    title: 'Skill summary',
    description: 'Public summary metadata for a workspace or built-in skill.',
  })
export type V2SkillSummary = z.output<typeof v2SkillSummarySchema>

/** Detail — the summary plus the skill body. */
export const v2SkillSchema = v2SkillSummarySchema
  .extend({
    content: z.string().describe('Skill body containing the instructions given to the agent.'),
  })
  .meta({
    id: 'V2Skill',
    title: 'Skill',
    description: 'A workspace or built-in skill including its instruction body.',
  })
export type V2Skill = z.output<typeof v2SkillSchema>

export const v2SkillDeleteDataSchema = z
  .object({
    id: z.string().describe('Identifier of the deleted skill.'),
    deleted: z.literal(true).describe('Whether the skill was deleted.'),
  })
  .meta({
    id: 'V2SkillDeleteData',
    title: 'Delete skill data',
    description: 'Skill deletion acknowledgement.',
  })
export type V2SkillDeleteData = z.output<typeof v2SkillDeleteDataSchema>

export const v2SkillEditorSchema = z
  .object({
    email: z.string().email().describe('Email address of the skill editor.'),
    name: z.string().nullable().describe('Display name of the skill editor.'),
    image: z.string().nullable().describe('Profile image URL of the skill editor.'),
    isWorkspaceAdmin: z
      .boolean()
      .describe('Whether editor access is derived from workspace administration.'),
  })
  .meta({
    id: 'V2SkillEditor',
    title: 'Skill editor',
    description: 'Public identity fields for a user who can edit a skill.',
  })
export type V2SkillEditor = z.output<typeof v2SkillEditorSchema>

export const v2SkillEditorDeleteDataSchema = z
  .object({
    email: z.string().email().describe('Email address whose explicit editor grant was revoked.'),
    revoked: z.literal(true).describe('Whether the explicit editor grant was revoked.'),
  })
  .meta({
    id: 'V2SkillEditorDeleteData',
    title: 'Revoke skill editor data',
    description: 'Skill editor revocation acknowledgement.',
  })
export type V2SkillEditorDeleteData = z.output<typeof v2SkillEditorDeleteDataSchema>

export const v2SkillParamsSchema = z.object({
  skillId: nonEmptyIdSchema.describe(
    'Unique skill identifier. A built-in skill is `builtin-` followed by its name, for example `builtin-research`.'
  ),
})
export type V2SkillParams = z.output<typeof v2SkillParamsSchema>

export const v2SkillWorkspaceQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the skill.'),
  })
  .strict()
export type V2SkillWorkspaceQuery = z.output<typeof v2SkillWorkspaceQuerySchema>

export const v2SkillSortFields = ['name', 'createdAt', 'updatedAt'] as const

export type V2SkillSortBy = (typeof v2SkillSortFields)[number]

export const v2ListSkillsQuerySchema = v2SkillWorkspaceQuerySchema
  .extend({
    search: v2SearchSchema.describe('Case-insensitive substring match against the skill name.'),
    ...v2SortFields(v2SkillSortFields, { sortBy: 'createdAt', sortOrder: 'desc' }),
    ...v2PaginationFields({ description: 'Maximum skills to return per page.' }),
  })
  .strict()

export type V2ListSkillsQuery = z.output<typeof v2ListSkillsQuerySchema>

export const v2SkillEditorSortFields = ['email', 'name'] as const
export type V2SkillEditorSortBy = (typeof v2SkillEditorSortFields)[number]

export const v2ListSkillEditorsQuerySchema = v2SkillWorkspaceQuerySchema
  .extend({
    ...v2SortFields(v2SkillEditorSortFields, { sortBy: 'email', sortOrder: 'asc' }),
    ...v2PaginationFields({ description: 'Maximum skill editors to return per page.' }),
  })
  .strict()
export type V2ListSkillEditorsQuery = z.output<typeof v2ListSkillEditorsQuerySchema>

const skillEditorEmailSchema = z
  .string()
  .trim()
  .email('A valid editor email is required')
  .describe('Email address of a current workspace member.')

export const v2GrantSkillEditorBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the skill.'),
    email: skillEditorEmailSchema,
  })
  .strict()
export type V2GrantSkillEditorBody = z.input<typeof v2GrantSkillEditorBodySchema>

export const v2RevokeSkillEditorQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the skill.'),
    email: skillEditorEmailSchema,
  })
  .strict()
export type V2RevokeSkillEditorQuery = z.input<typeof v2RevokeSkillEditorQuerySchema>

/**
 * Create body. Every field is required, so each one carries the missing-value
 * wording the shared field primitives cannot: those are also spelled `.optional()`
 * on the update body, where an omitted field is legal, so the message belongs
 * here rather than on the shared schema.
 */
export const v2CreateSkillBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace in which to create the skill.'),
    name: withMissingFieldMessage(skillNameSchema, 'Skill name is required').describe(
      'Kebab-case name, unique within the workspace and not reserved by a built-in skill.'
    ),
    description: withMissingFieldMessage(
      skillDescriptionSchema,
      'Description is required'
    ).describe('One-line summary of when the skill applies.'),
    content: withMissingFieldMessage(skillContentSchema, 'Content is required').describe(
      'Skill body containing the instructions given to the agent.'
    ),
  })
  .strict()
export type V2CreateSkillBody = z.input<typeof v2CreateSkillBodySchema>

/**
 * Update body. Omitted fields keep their stored values, so a partial edit can
 * never clobber a concurrent change to a field the caller did not send.
 */
export const v2UpdateSkillBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the skill.'),
    name: skillNameSchema.optional().describe('New kebab-case skill name.'),
    description: skillDescriptionSchema
      .optional()
      .describe('New one-line summary of when the skill applies.'),
    content: skillContentSchema.optional().describe('Replacement skill body.'),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.name === undefined && body.description === undefined && body.content === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['name'],
        message: 'At least one of name, description, or content is required',
      })
    }
  })
export type V2UpdateSkillBody = z.input<typeof v2UpdateSkillBodySchema>

/**
 * Skill list, paginated by an opaque offset cursor rather than the keyset the
 * other v2 lists use: the list merges the code-only built-in skills — which
 * have no DB row for a SQL cursor predicate to act on — with the workspace's
 * rows and re-sorts the result in memory, so no keyset over `skill` columns can
 * name a position inside that merged sequence.
 */
export const v2ListSkillsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/skills',
  query: v2ListSkillsQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2SkillSummarySchema),
  },
})

export const v2CreateSkillContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/skills',
  query: noInputSchema,
  body: v2CreateSkillBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2SkillSchema),
    status: 201,
  },
})

export const v2GetSkillContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/skills/[skillId]',
  params: v2SkillParamsSchema,
  query: v2SkillWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2SkillSchema),
  },
})

export const v2UpdateSkillContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/skills/[skillId]',
  query: noInputSchema,
  params: v2SkillParamsSchema,
  body: v2UpdateSkillBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2SkillSchema),
  },
})

export const v2DeleteSkillContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/skills/[skillId]',
  params: v2SkillParamsSchema,
  query: v2SkillWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2SkillDeleteDataSchema),
  },
})

export const v2ListSkillEditorsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/skills/[skillId]/editors',
  params: v2SkillParamsSchema,
  query: v2ListSkillEditorsQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2SkillEditorSchema),
  },
})

export const v2GrantSkillEditorContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/skills/[skillId]/editors',
  params: v2SkillParamsSchema,
  query: noInputSchema,
  body: v2GrantSkillEditorBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2SkillEditorSchema),
    status: [200, 201],
  },
})

export const v2RevokeSkillEditorContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/skills/[skillId]/editors',
  params: v2SkillParamsSchema,
  query: v2RevokeSkillEditorQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2SkillEditorDeleteDataSchema),
  },
})
