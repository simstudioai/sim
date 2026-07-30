import { z } from 'zod'
import {
  organizationIdSchema,
  workflowIdSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

/**
 * A minimal JSON Schema node — the subset the API reference emits for input/output
 * shapes. Recursive via `z.lazy` for nested objects/arrays. This is a real structured
 * schema (not opaque), so it is fully declared rather than left as `z.unknown()`.
 */
export const jsonSchemaNodeSchema: z.ZodType<JsonSchemaNode> = z.lazy(() =>
  z.object({
    type: z.enum(['string', 'number', 'boolean', 'object', 'array', 'null']),
    description: z.string().optional(),
    example: z.unknown().optional(),
    properties: z.record(z.string(), jsonSchemaNodeSchema).optional(),
    required: z.array(z.string()).optional(),
    items: jsonSchemaNodeSchema.optional(),
  })
)
export interface JsonSchemaNode {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null'
  description?: string
  example?: unknown
  properties?: Record<string, JsonSchemaNode>
  required?: string[]
  items?: JsonSchemaNode
}

export const apiReferenceAuthSchema = z.object({
  type: z.enum(['api_key', 'public']),
  header: z.string().nullable(),
  description: z.string(),
})

export const apiReferenceVersionSchema = z.object({
  version: z.number().int(),
  deployedAt: z.string().nullable(),
  breaking: z.boolean(),
  changes: z.array(z.string()),
})

export const apiReferenceExposureSchema = z.object({
  trace: z.enum(['off', 'traceId']),
  blocks: z.boolean(),
})

export const apiReferenceEntrySchema = z.object({
  workflowId: z.string(),
  name: z.string(),
  summary: z.string().nullable(),
  description: z.string().nullable(),
  version: z.number().int().nullable(),
  deployedAt: z.string().nullable(),
  invokeUrl: z.string(),
  auth: apiReferenceAuthSchema,
  input: jsonSchemaNodeSchema,
  output: jsonSchemaNodeSchema,
  exposure: apiReferenceExposureSchema,
  versions: z.array(apiReferenceVersionSchema),
})
export type ApiReferenceEntryApi = z.output<typeof apiReferenceEntrySchema>

export const apiReferenceDocSchema = z.object({
  workspaceId: z.string(),
  name: z.string(),
  generatedAt: z.string(),
  entries: z.array(apiReferenceEntrySchema),
})
export type ApiReferenceDocApi = z.output<typeof apiReferenceDocSchema>

/**
 * A single catalog resource: an API reference entry plus its `resourceType`
 * discriminator. Today the only type is `workflow`; the field is present from the
 * start so a future table-wrapper or other exposed resource type slots in without
 * reshaping the catalog.
 */
export const orgResourceSchema = apiReferenceEntrySchema.extend({
  resourceType: z.enum(['workflow']),
  /** The providing workspace's id - so the catalog can address trace/block operations. */
  workspaceId: z.string(),
})
export type OrgResourceApi = z.output<typeof orgResourceSchema>

/** A service in the org catalog: one workspace and the resources it exposes. */
export const orgServiceSchema = z.object({
  workspaceId: z.string(),
  workspaceName: z.string(),
  resources: z.array(orgResourceSchema),
})
export type OrgServiceApi = z.output<typeof orgServiceSchema>

export const orgResourcesCatalogSchema = z.object({
  organizationId: z.string(),
  generatedAt: z.string(),
  services: z.array(orgServiceSchema),
})
export type OrgResourcesCatalogApi = z.output<typeof orgResourcesCatalogSchema>

export const getOrgResourcesContract = defineRouteContract({
  method: 'GET',
  // The org segment reuses the existing `[id]` slug, so `id` here is the organization id.
  path: '/api/organizations/[id]/api-resources',
  params: z.object({ id: organizationIdSchema }),
  response: { mode: 'json', schema: orgResourcesCatalogSchema },
})

export const redactedBlockSchema = z.object({
  id: z.string(),
  type: z.string(),
  name: z.string(),
  outgoing: z.array(z.string()),
  config: z.record(z.string(), z.unknown()),
})
export type RedactedBlockApi = z.output<typeof redactedBlockSchema>

/** `?format=` render selector for the doc/entry reader routes. */
export const apiReferenceFormatSchema = z.enum(['json', 'markdown', 'openapi']).default('json')
export const apiReferenceFormatQuerySchema = z.object({
  format: apiReferenceFormatSchema,
})

// The workspace segment reuses the existing `[id]` slug (Next.js forbids two param
// names at one position), so `id` here is the workspace id.
const workspaceParamsSchema = z.object({ id: workspaceIdSchema })
const workspaceWorkflowParamsSchema = z.object({
  id: workspaceIdSchema,
  workflowId: workflowIdSchema,
})

export const getWorkspaceApiReferenceContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/api-reference',
  params: workspaceParamsSchema,
  query: apiReferenceFormatQuerySchema,
  response: { mode: 'json', schema: apiReferenceDocSchema },
})

export const getWorkflowApiReferenceContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/api-reference/[workflowId]',
  params: workspaceWorkflowParamsSchema,
  query: apiReferenceFormatQuerySchema,
  response: { mode: 'json', schema: apiReferenceEntrySchema },
})

export const listApiReferenceBlocksContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/api-reference/[workflowId]/blocks',
  params: workspaceWorkflowParamsSchema,
  response: { mode: 'json', schema: z.object({ blocks: z.array(redactedBlockSchema) }) },
})

export const getApiReferenceBlockContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/api-reference/[workflowId]/blocks/[blockId]',
  params: workspaceWorkflowParamsSchema.extend({ blockId: z.string().min(1) }),
  response: { mode: 'json', schema: z.object({ block: redactedBlockSchema }) },
})

export const getApiReferenceTraceContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/api-reference/[workflowId]/executions/[executionId]/trace',
  params: workspaceWorkflowParamsSchema.extend({ executionId: z.string().min(1) }),
  response: {
    mode: 'json',
    schema: z.object({
      executionId: z.string(),
      workflowId: z.string(),
      status: z.string().nullable(),
      startedAt: z.string().nullable(),
      endedAt: z.string().nullable(),
      totalDurationMs: z.number().nullable(),
      // untyped-response: the block-level trace reuses the existing internal execution-log
      // representation (materializeExecutionData / TraceSpan) verbatim; re-declaring that deep
      // recursive shape here would fork it. Passthrough of an already-shaped internal payload.
      trace: z.unknown(),
    }),
  },
})

/**
 * Provider-editable publication settings. Structure (input/output schema) is never
 * here — it is derived from the deployment. Every field defaults to its safe value.
 */
export const publicationSettingsSchema = z.object({
  published: z.boolean(),
  displayName: z.string().max(200).nullable(),
  summary: z.string().max(500).nullable(),
  description: z.string().max(10_000).nullable(),
  fieldOverlay: z
    .array(
      z.object({
        id: z.string().min(1),
        description: z.string().max(2_000).optional(),
        example: z.string().max(2_000).optional(),
        required: z.boolean().optional(),
      })
    )
    .max(200)
    .nullable(),
  exposeTrace: z.enum(['off', 'traceId']),
  exposeBlocks: z.boolean(),
  visibility: z.enum(['org', 'allowlist']),
  allowlistWorkspaceIds: z.array(z.string().min(1)).max(500).nullable(),
})
export type PublicationSettingsApi = z.output<typeof publicationSettingsSchema>

/** PUT accepts a full settings object; every field is optional so partial edits are allowed. */
export const updatePublicationBodySchema = publicationSettingsSchema.partial()
export type UpdatePublicationBody = z.input<typeof updatePublicationBodySchema>

const workflowParamsSchema = z.object({ id: workflowIdSchema })

export const getPublicationContract = defineRouteContract({
  method: 'GET',
  path: '/api/workflows/[id]/publication',
  params: workflowParamsSchema,
  response: { mode: 'json', schema: z.object({ publication: publicationSettingsSchema }) },
})

export const updatePublicationContract = defineRouteContract({
  method: 'PUT',
  path: '/api/workflows/[id]/publication',
  params: workflowParamsSchema,
  body: updatePublicationBodySchema,
  response: { mode: 'json', schema: z.object({ publication: publicationSettingsSchema }) },
})
