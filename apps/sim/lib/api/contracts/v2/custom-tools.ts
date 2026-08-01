import { z } from 'zod'
import { nonEmptyIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { customToolSchemaSchema } from '@/lib/api/contracts/tools/custom'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2CursorListResponse, v2DataResponse } from '@/lib/api/contracts/v2/shared'

/**
 * v2 custom tool contracts.
 *
 * The internal `/api/tools/custom` surface is a bulk upsert with no per-id
 * update, and it tolerates legacy *personal* tools (`workspaceId: null`, owned
 * by one user) alongside workspace ones. v2 splits create from update and is
 * workspace-scoped in every direction — a workspace key never reaches another
 * user's personal tool.
 *
 * The JSON-Schema `schema` field is reused verbatim from the internal contract:
 * it is an OpenAI-style function declaration whose `parameters.properties` are
 * caller-defined, so the shape is deliberately open below the function level.
 */

const customToolTitleSchema = z
  .string({ error: 'title is required' })
  .min(1, 'title is required')
  .max(200, 'title must be at most 200 characters')

const customToolCodeSchema = z
  .string({ error: 'code is required' })
  .max(100_000, 'code must be at most 100000 characters')

export const v2CustomToolSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** OpenAI-style function declaration describing the tool's callable surface. */
  schema: customToolSchemaSchema,
  /** The tool's implementation body, executed in Sim's sandboxed function runtime. */
  code: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type V2CustomTool = z.output<typeof v2CustomToolSchema>

/** `{ customTool }` payload for single-tool reads and mutations. */
export const v2CustomToolDataSchema = z.object({ customTool: v2CustomToolSchema })
export type V2CustomToolData = z.output<typeof v2CustomToolDataSchema>

export const v2CustomToolDeleteDataSchema = z.object({
  id: z.string(),
  deleted: z.literal(true),
})
export type V2CustomToolDeleteData = z.output<typeof v2CustomToolDeleteDataSchema>

export const v2CustomToolParamsSchema = z.object({
  id: nonEmptyIdSchema,
})
export type V2CustomToolParams = z.output<typeof v2CustomToolParamsSchema>

export const v2CustomToolWorkspaceQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
})
export type V2CustomToolWorkspaceQuery = z.output<typeof v2CustomToolWorkspaceQuerySchema>

export const v2CreateCustomToolBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    title: customToolTitleSchema,
    schema: customToolSchemaSchema,
    code: customToolCodeSchema,
  })
  .strict()
export type V2CreateCustomToolBody = z.input<typeof v2CreateCustomToolBodySchema>

/** Update body. Omitted fields keep their stored values. */
export const v2UpdateCustomToolBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    title: customToolTitleSchema.optional(),
    schema: customToolSchemaSchema.optional(),
    code: customToolCodeSchema.optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.title === undefined && body.schema === undefined && body.code === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['title'],
        message: 'At least one of title, schema, or code is required',
      })
    }
  })
export type V2UpdateCustomToolBody = z.input<typeof v2UpdateCustomToolBodySchema>

/**
 * Custom tool list. The per-workspace set is small and bounded, so the full set
 * is returned as a single page (`nextCursor` is always `null`); the canonical
 * cursor envelope keeps the v2 list surface uniform.
 */
export const v2ListCustomToolsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/custom-tools',
  query: v2CustomToolWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2CustomToolSchema),
  },
})

export const v2CreateCustomToolContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/custom-tools',
  body: v2CreateCustomToolBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2CustomToolDataSchema),
  },
})

export const v2GetCustomToolContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/custom-tools/[id]',
  params: v2CustomToolParamsSchema,
  query: v2CustomToolWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2CustomToolDataSchema),
  },
})

export const v2UpdateCustomToolContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/custom-tools/[id]',
  params: v2CustomToolParamsSchema,
  body: v2UpdateCustomToolBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2CustomToolDataSchema),
  },
})

export const v2DeleteCustomToolContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/custom-tools/[id]',
  params: v2CustomToolParamsSchema,
  query: v2CustomToolWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2CustomToolDeleteDataSchema),
  },
})
