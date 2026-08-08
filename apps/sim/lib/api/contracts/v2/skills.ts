import { z } from 'zod'
import { nonEmptyIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import {
  skillContentSchema,
  skillDescriptionSchema,
  skillNameSchema,
} from '@/lib/api/contracts/skills'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2CursorListResponse,
  v2DataResponse,
  v2SearchSchema,
  v2SortFields,
} from '@/lib/api/contracts/v2/shared'

/**
 * v2 skills contracts.
 *
 * Two departures from the internal `/api/skills` shape:
 *
 * 1. **Single-resource writes.** The internal `POST` takes an array, conflates
 *    create and update, and answers with the whole workspace skill list. v2
 *    splits it into `POST /v2/skills` (201) and `PATCH /v2/skills/[id]`, each
 *    answering with the one skill that changed.
 * 2. **`content` is detail-only.** A skill body is up to 50 000 characters, so
 *    the list returns summaries and the full body is fetched per skill from
 *    `GET /v2/skills/[id]`.
 *
 * Field validation lives in `lib/skills/orchestration`, so these schemas and the
 * lib enforce the same limits — the schemas reuse the shared field primitives
 * rather than restating them.
 */

/** List item — everything but the skill body. */
export const v2SkillSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  /** True for built-in template skills, which ship with Sim and cannot be written to. */
  readOnly: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type V2SkillSummary = z.output<typeof v2SkillSummarySchema>

/** Detail — the summary plus the skill body. */
export const v2SkillSchema = v2SkillSummarySchema.extend({
  content: z.string(),
})
export type V2Skill = z.output<typeof v2SkillSchema>

/** `{ skill }` payload for single-skill reads and mutations. */
export const v2SkillDataSchema = z.object({ skill: v2SkillSchema })
export type V2SkillData = z.output<typeof v2SkillDataSchema>

export const v2SkillDeleteDataSchema = z.object({
  id: z.string(),
  deleted: z.literal(true),
})
export type V2SkillDeleteData = z.output<typeof v2SkillDeleteDataSchema>

export const v2SkillParamsSchema = z.object({
  id: nonEmptyIdSchema,
})
export type V2SkillParams = z.output<typeof v2SkillParamsSchema>

export const v2SkillWorkspaceQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
})
export type V2SkillWorkspaceQuery = z.output<typeof v2SkillWorkspaceQuerySchema>

export const v2SkillSortFields = ['name', 'createdAt', 'updatedAt'] as const

export type V2SkillSortBy = (typeof v2SkillSortFields)[number]

export const v2ListSkillsQuerySchema = v2SkillWorkspaceQuerySchema.extend({
  search: v2SearchSchema,
  ...v2SortFields(v2SkillSortFields, { sortBy: 'createdAt', sortOrder: 'desc' }),
})

export type V2ListSkillsQuery = z.output<typeof v2ListSkillsQuerySchema>

export const v2CreateSkillBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    name: skillNameSchema,
    description: skillDescriptionSchema,
    content: skillContentSchema,
  })
  .strict()
export type V2CreateSkillBody = z.input<typeof v2CreateSkillBodySchema>

/**
 * Update body. Omitted fields keep their stored values, so a partial edit can
 * never clobber a concurrent change to a field the caller did not send.
 */
export const v2UpdateSkillBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    name: skillNameSchema.optional(),
    description: skillDescriptionSchema.optional(),
    content: skillContentSchema.optional(),
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
 * Skill list. The per-workspace set is small and bounded, so the full set is
 * returned as a single page (`nextCursor` is always `null`); the canonical
 * cursor envelope keeps the v2 list surface uniform.
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
  body: v2CreateSkillBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2SkillDataSchema),
    status: 201,
  },
})

export const v2GetSkillContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/skills/[id]',
  params: v2SkillParamsSchema,
  query: v2SkillWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2SkillDataSchema),
  },
})

export const v2UpdateSkillContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/skills/[id]',
  params: v2SkillParamsSchema,
  body: v2UpdateSkillBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2SkillDataSchema),
  },
})

export const v2DeleteSkillContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/skills/[id]',
  params: v2SkillParamsSchema,
  query: v2SkillWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2SkillDeleteDataSchema),
  },
})
