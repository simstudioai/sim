import { z } from 'zod'
import { workflowIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'

/** BYOK provider id under which a workspace stores its Claude Platform API key. */
export const MANAGED_AGENT_BYOK_PROVIDER = 'claude-platform' as const

/**
 * Contracts for the Managed Agent workflow block. Two boundaries:
 *   - `list` backs the block-editor dropdowns (agents / environments /
 *     vaults / memory stores), resolving the workspace Claude Platform BYOK
 *     key server-side.
 *   - `run` is the internal route the block's tool proxies through to run a
 *     session; it is called by the executor, never the browser.
 */

/** A dropdown option resolved from the linked Claude Platform workspace. */
export const managedAgentOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
})
export type ManagedAgentOption = z.output<typeof managedAgentOptionSchema>

export const managedAgentResourceSchema = z.enum([
  'agents',
  'environments',
  'vaults',
  'memory-stores',
])
export type ManagedAgentResource = z.output<typeof managedAgentResourceSchema>

export const listManagedAgentOptionsQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
  resource: managedAgentResourceSchema,
})

export const listManagedAgentOptionsContract = defineRouteContract({
  method: 'GET',
  path: '/api/tools/managed-agent/list',
  query: listManagedAgentOptionsQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({ options: z.array(managedAgentOptionSchema) }),
  },
})
export type ListManagedAgentOptions = ContractJsonResponse<typeof listManagedAgentOptionsContract>

/**
 * Body for `POST /api/tools/managed-agent/run`. The block's tool normalizes
 * its raw subblock values (table rows, comma-lists, json strings) into these
 * clean shapes in `request.body` before dispatch, so the route validates
 * strict types.
 */
export const runManagedAgentBodySchema = z.object({
  agent: z.string().min(1, 'agent is required'),
  environment: z.string().min(1, 'environment is required'),
  userMessage: z.string().min(1, 'userMessage is required'),
  vaults: z.array(z.string().min(1)).max(50).optional(),
  vaultsAck: z.boolean().optional(),
  memoryStoreId: z.string().optional(),
  memoryAccess: z.enum(['read_write', 'read_only']).optional(),
  fileIds: z.array(z.string().min(1)).max(100).optional(),
  sessionParameters: z.record(z.string(), z.string()).optional(),
})
export type RunManagedAgentBody = z.input<typeof runManagedAgentBodySchema>

/** Query params the executor appends to internal-route calls. */
export const runManagedAgentQuerySchema = z.object({
  workflowId: workflowIdSchema.optional(),
  userId: z.string().optional(),
})

export const runManagedAgentContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/managed-agent/run',
  query: runManagedAgentQuerySchema,
  body: runManagedAgentBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      output: z.object({ content: z.string(), sessionId: z.string() }),
    }),
  },
})
export type RunManagedAgent = ContractJsonResponse<typeof runManagedAgentContract>
