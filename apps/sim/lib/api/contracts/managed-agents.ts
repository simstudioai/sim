import { z } from 'zod'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'

/**
 * Contract for the Managed Agent block-editor dropdowns. The `list` route
 * resolves agents / environments / vaults / memory stores against a selected
 * Claude Platform credential, decrypting its API key server-side — the key
 * never crosses the client boundary.
 */

/** A dropdown option resolved from the linked Claude Platform workspace. */
export const managedAgentOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** Environment execution model — only set for the `environments` resource, used to filter by mode. */
  type: z.enum(['cloud', 'self_hosted']).optional(),
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
  credentialId: z.string().min(1, 'A Claude Platform credential is required'),
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
