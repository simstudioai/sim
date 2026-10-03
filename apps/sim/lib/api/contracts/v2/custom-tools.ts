import { z } from 'zod'
import { noInputSchema, nonEmptyIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import {
  customToolFunctionParametersSchema,
  customToolSchemaSchema,
} from '@/lib/api/contracts/tools/custom'
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

const customToolExtensionSchema = z
  .unknown()
  .describe('Caller-defined extension value preserved by the public API.')

const v2CustomToolFunctionParametersSchema = customToolFunctionParametersSchema
  .extend({
    type: customToolFunctionParametersSchema.shape.type.describe(
      'JSON Schema type for the arguments, usually `object`.'
    ),
    properties: z
      .record(z.string(), z.unknown().describe('Caller-defined JSON Schema for one tool argument.'))
      .describe('Caller-defined argument schemas keyed by argument name.'),
    required: customToolFunctionParametersSchema.shape.required.describe(
      'Names of required arguments.'
    ),
  })
  .catchall(customToolExtensionSchema)
  .describe('JSON Schema describing the arguments accepted by the tool.')

const v2CustomToolDeclarationSchema = customToolSchemaSchema
  .extend({
    type: customToolSchemaSchema.shape.type.describe('Function declaration discriminator.'),
    function: customToolSchemaSchema.shape.function
      .extend({
        name: customToolSchemaSchema.shape.function.shape.name.describe(
          'Function name presented to the model.'
        ),
        description: customToolSchemaSchema.shape.function.shape.description.describe(
          'Optional explanation of what the function does.'
        ),
        parameters: v2CustomToolFunctionParametersSchema,
      })
      .catchall(customToolExtensionSchema)
      .describe('OpenAI-style function definition.'),
  })
  .catchall(customToolExtensionSchema)
  .describe('OpenAI-style function declaration describing the callable tool surface.')

export const v2CustomToolSchema = z
  .object({
    id: z.string().describe('Unique custom tool identifier.'),
    title: z.string().describe('Display title, unique within the workspace.'),
    /** OpenAI-style function declaration describing the tool's callable surface. */
    schema: v2CustomToolDeclarationSchema,
    /** The tool's implementation body, executed in Sim's sandboxed function runtime. */
    code: z.string().describe('Tool implementation executed in the sandboxed function runtime.'),
    createdAt: v2TimestampSchema.describe('ISO 8601 timestamp when the tool was created.'),
    updatedAt: v2TimestampSchema.describe('ISO 8601 timestamp when the tool was last updated.'),
  })
  .meta({
    id: 'V2CustomTool',
    title: 'Custom tool',
    description: 'A workspace custom tool and its callable function declaration.',
  })
export type V2CustomTool = z.output<typeof v2CustomToolSchema>

export const v2CustomToolDeleteDataSchema = z
  .object({
    id: z.string().describe('Identifier of the deleted custom tool.'),
    deleted: z.literal(true).describe('Whether the custom tool was deleted.'),
  })
  .meta({
    id: 'V2CustomToolDeleteData',
    title: 'Delete custom tool data',
    description: 'Custom tool deletion acknowledgement.',
  })
export type V2CustomToolDeleteData = z.output<typeof v2CustomToolDeleteDataSchema>

export const v2CustomToolParamsSchema = z.object({
  customToolId: nonEmptyIdSchema.describe('Unique custom tool identifier.'),
})
export type V2CustomToolParams = z.output<typeof v2CustomToolParamsSchema>

export const v2CustomToolWorkspaceQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the custom tool.'),
  })
  .strict()
export type V2CustomToolWorkspaceQuery = z.output<typeof v2CustomToolWorkspaceQuerySchema>

/** A custom tool's natural name field is `title`, so that is what `search` matches. */
export const v2CustomToolSortFields = ['title', 'createdAt', 'updatedAt'] as const

export type V2CustomToolSortBy = (typeof v2CustomToolSortFields)[number]

export const v2ListCustomToolsQuerySchema = v2CustomToolWorkspaceQuerySchema
  .extend({
    search: v2SearchSchema.describe('Case-insensitive substring match against the tool title.'),
    ...v2SortFields(v2CustomToolSortFields, { sortBy: 'createdAt', sortOrder: 'desc' }),
    ...v2PaginationFields({ description: 'Maximum custom tools to return per page.' }),
  })
  .strict()

export type V2ListCustomToolsQuery = z.output<typeof v2ListCustomToolsQuerySchema>

export const v2CreateCustomToolBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace in which to create the custom tool.'),
    title: customToolTitleSchema.describe('Display title, unique within the workspace.'),
    schema: v2CustomToolDeclarationSchema,
    code: customToolCodeSchema.describe(
      'Tool implementation executed in the sandboxed function runtime.'
    ),
  })
  .strict()
export type V2CreateCustomToolBody = z.input<typeof v2CreateCustomToolBodySchema>

/** Update body. Omitted fields keep their stored values. */
export const v2UpdateCustomToolBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the custom tool.'),
    title: customToolTitleSchema.optional().describe('New display title for the tool.'),
    schema: v2CustomToolDeclarationSchema.optional().describe('Replacement function declaration.'),
    code: customToolCodeSchema.optional().describe('Replacement tool implementation.'),
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
 * Custom tool list, keyset-paginated over the active sort. Nothing capped the
 * per-workspace set, and each row carries its full `code` and `schema`, so the
 * response grew without bound before pagination.
 */
export const v2ListCustomToolsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/custom-tools',
  query: v2ListCustomToolsQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2CustomToolSchema),
  },
})

export const v2CreateCustomToolContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/custom-tools',
  query: noInputSchema,
  body: v2CreateCustomToolBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2CustomToolSchema),
    status: 201,
  },
})

export const v2GetCustomToolContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/custom-tools/[customToolId]',
  params: v2CustomToolParamsSchema,
  query: v2CustomToolWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2CustomToolSchema),
  },
})

export const v2UpdateCustomToolContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/custom-tools/[customToolId]',
  query: noInputSchema,
  params: v2CustomToolParamsSchema,
  body: v2UpdateCustomToolBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2CustomToolSchema),
  },
})

export const v2DeleteCustomToolContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/custom-tools/[customToolId]',
  params: v2CustomToolParamsSchema,
  query: v2CustomToolWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2CustomToolDeleteDataSchema),
  },
})
