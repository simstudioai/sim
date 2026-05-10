import { z } from 'zod'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'

export const byokProviderIdSchema = z.enum([
  'openai',
  'anthropic',
  'google',
  'mistral',
  'fireworks',
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
])

export const byokKeySchema = z.object({
  id: z.string(),
  providerId: byokProviderIdSchema,
  maskedKey: z.string(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type BYOKKey = z.output<typeof byokKeySchema>

export const byokKeyMutationSchema = z.object({
  id: z.string(),
  providerId: byokProviderIdSchema,
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
})

export const deleteByokKeyBodySchema = z.object({
  providerId: byokProviderIdSchema,
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
