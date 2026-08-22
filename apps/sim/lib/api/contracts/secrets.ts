import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

const SECRET_USAGE_DEFAULT_LIMIT = 100
const SECRET_USAGE_MAX_LIMIT = 500

export const secretUsageScopeSchema = z.enum(['workspace', 'personal'])

export const secretUsageQuerySchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  name: z.string().min(1, 'Secret name is required'),
  scope: secretUsageScopeSchema,
  limit: z.coerce
    .number()
    .int()
    .min(1, 'limit must be at least 1')
    .max(SECRET_USAGE_MAX_LIMIT, `limit cannot exceed ${SECRET_USAGE_MAX_LIMIT}`)
    .default(SECRET_USAGE_DEFAULT_LIMIT),
})

export const secretUsageEntrySchema = z.object({
  id: z.string(),
  useCount: z.number().int().nonnegative(),
  lastUsedAt: z.string(),
  source: z.enum(['workflow', 'copilot', 'mcp']),
  workflowName: z.string().nullable(),
  actorName: z.string().nullable(),
  lastExecutionId: z.string().nullable(),
  /** False once that run's log has aged out of the workspace's retention window. */
  lastExecutionAvailable: z.boolean(),
  lastTrigger: z.string().nullable(),
})

export const getSecretUsageContract = defineRouteContract({
  method: 'GET',
  path: '/api/secrets/usage',
  query: secretUsageQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      entries: z.array(secretUsageEntrySchema),
    }),
  },
})

/**
 * Ceilings on one scan's payload. These match the caps `lib/secrets/references/scan.ts` stops
 * at — in particular `resources` is capped on EMITTED entries there, not on rows read, because
 * one MCP server expands to an entry per matching header. Raising a bound here without raising
 * the scanner's cap is harmless; lowering one below it makes the route reject its own response.
 */
const SECRET_REFERENCE_MAX_WORKFLOWS = 2000
const SECRET_REFERENCE_MAX_BLOCKS = 2000
const SECRET_REFERENCE_MAX_RESOURCES = 400

/**
 * No `scope`, unlike the usage query. A `{{KEY}}` reference names a key and not a scope, so the
 * scan is name-based and the use case authorizes against what the name resolves to. A scope here
 * would be a caller-controlled assertion that nothing narrows by — a bypass, not an input.
 */
export const secretReferencesQuerySchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  name: z.string().min(1, 'Secret name is required'),
})

export const secretReferenceBlockSchema = z.object({
  blockId: z.string().min(1, 'blockId cannot be empty'),
  blockName: z.string(),
  blockType: z.string().min(1, 'blockType cannot be empty'),
  /** A sub-block key carrying the reference — one per block, not necessarily the only one. */
  field: z.string().min(1, 'field cannot be empty'),
})

export const secretReferenceWorkflowSchema = z.object({
  workflowId: z.string().min(1, 'workflowId cannot be empty'),
  workflowName: z.string(),
  blocks: z
    .array(secretReferenceBlockSchema)
    .min(1, 'A referencing workflow must name at least one block')
    .max(SECRET_REFERENCE_MAX_BLOCKS),
})

export const secretReferenceResourceSchema = z.object({
  id: z.string().min(1, 'resource id cannot be empty'),
  kind: z.enum(['custom-tool', 'mcp-server']),
  name: z.string(),
  /** Where inside the resource the reference lives — `code`, `url`, or `header: X`. */
  field: z.string().min(1, 'field cannot be empty'),
})

export const getSecretReferencesContract = defineRouteContract({
  method: 'GET',
  path: '/api/secrets/references',
  query: secretReferencesQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      workflows: z.array(secretReferenceWorkflowSchema).max(SECRET_REFERENCE_MAX_WORKFLOWS),
      resources: z.array(secretReferenceResourceSchema).max(SECRET_REFERENCE_MAX_RESOURCES),
      /** True when a scan cap was hit, so the lists are a prefix rather than the whole set. */
      truncated: z.boolean(),
    }),
  },
})

export type SecretUsageScope = z.output<typeof secretUsageScopeSchema>
export type SecretUsageQuery = z.input<typeof secretUsageQuerySchema>
export type SecretUsageEntryPayload = z.output<typeof secretUsageEntrySchema>
export type SecretReferencesQuery = z.input<typeof secretReferencesQuerySchema>
export type SecretReferenceWorkflowPayload = z.output<typeof secretReferenceWorkflowSchema>
export type SecretReferenceBlockPayload = z.output<typeof secretReferenceBlockSchema>
export type SecretReferenceResourcePayload = z.output<typeof secretReferenceResourceSchema>
