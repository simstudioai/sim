import { z } from 'zod'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'

export const byokProviderIdSchema = z.enum([
  'openai',
  'anthropic',
  'google',
  'mistral',
  'zai',
  'fireworks',
  'together',
  'baseten',
  'ollama-cloud',
  'falai',
  'firecrawl',
  'exa',
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

/** Maximum number of keys a workspace may store per provider. */
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

export type BYOKKeysResponse = ContractJsonResponse<typeof listByokKeysContract>
