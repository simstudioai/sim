import { z } from 'zod'
import { organizationIdSchema } from '@/lib/api/contracts/primitives'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'

export const byokProviderIdSchema = z.enum([
  'openai',
  'anthropic',
  'google',
  'mistral',
  'zai',
  'kimi',
  'xai',
  'fireworks',
  'together',
  'baseten',
  'ollama-cloud',
  'falai',
  'firecrawl',
  'exa',
  'context_dev',
  'serper',
  'linkup',
  'perplexity',
  'jina',
  'google_cloud',
  'parallel_ai',
  'brandfetch',
  'cohere',
  'hunter',
  'peopledatalabs',
  'findymail',
  'prospeo',
  'wiza',
  'zerobounce',
  'neverbounce',
  'millionverifier',
  'datagma',
  'dropcontact',
  'leadmagic',
  'icypeas',
  'enrow',
])

export type BYOKProviderId = z.output<typeof byokProviderIdSchema>

/** Maximum number of BYOK keys a single workspace or organization may store per provider. */
export const MAX_BYOK_KEYS_PER_PROVIDER = 10

export const byokKeySchema = z.object({
  id: z.string(),
  providerId: byokProviderIdSchema,
  name: z.string().nullable(),
  maskedKey: z.string(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type BYOKKey = z.output<typeof byokKeySchema>

export const byokKeyMutationSchema = z.object({
  id: z.string(),
  providerId: byokProviderIdSchema,
  name: z.string().nullable(),
  maskedKey: z.string(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
})

export const byokWorkspaceParamsSchema = z.object({
  id: z.string().min(1),
})

export const byokOrganizationParamsSchema = z.object({
  id: organizationIdSchema,
})

export const upsertByokKeyBodySchema = z.object({
  providerId: byokProviderIdSchema,
  apiKey: z.string().min(1, 'API key is required'),
  /** When set, updates that specific key; otherwise a new key is added for the provider. */
  keyId: z.string().min(1, 'keyId cannot be empty').optional(),
  /** Display label for the key. An empty string clears the label. */
  name: z.string().trim().max(120, 'Name must be 120 characters or fewer').optional(),
})

export const deleteByokKeyBodySchema = z.object({
  providerId: byokProviderIdSchema,
  /** When set, deletes only that key; otherwise every key for the provider is removed. */
  keyId: z.string().min(1, 'keyId cannot be empty').optional(),
})

export const listByokKeysContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/byok-keys',
  params: byokWorkspaceParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      keys: z.array(byokKeySchema),
    }),
  },
})

export const upsertByokKeyContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/byok-keys',
  params: byokWorkspaceParamsSchema,
  body: upsertByokKeyBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      key: byokKeyMutationSchema,
    }),
  },
})

export const deleteByokKeyContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/workspaces/[id]/byok-keys',
  params: byokWorkspaceParamsSchema,
  body: deleteByokKeyBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
    }),
  },
})

export const listOrganizationByokKeysContract = defineRouteContract({
  method: 'GET',
  path: '/api/organizations/[id]/byok-keys',
  params: byokOrganizationParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      keys: z.array(byokKeySchema),
      entitled: z.boolean(),
    }),
  },
})

export const upsertOrganizationByokKeyContract = defineRouteContract({
  method: 'POST',
  path: '/api/organizations/[id]/byok-keys',
  params: byokOrganizationParamsSchema,
  body: upsertByokKeyBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      key: byokKeyMutationSchema,
    }),
  },
})

export const deleteOrganizationByokKeyContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/organizations/[id]/byok-keys',
  params: byokOrganizationParamsSchema,
  body: deleteByokKeyBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
    }),
  },
})

export const getInheritedByokStatusContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/byok-keys/inherited-status',
  params: byokWorkspaceParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      inheritedProviderIds: z.array(byokProviderIdSchema).max(byokProviderIdSchema.options.length),
    }),
  },
})

export type BYOKKeysResponse = ContractJsonResponse<typeof listByokKeysContract>
export type OrganizationBYOKKeysResponse = ContractJsonResponse<
  typeof listOrganizationByokKeysContract
>
export type InheritedBYOKStatusResponse = ContractJsonResponse<
  typeof getInheritedByokStatusContract
>
