import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const apiKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  key: z.string(),
  displayKey: z.string().optional(),
  lastUsed: z.string().nullable().optional(),
  createdAt: z.string(),
  expiresAt: z.string().nullable().optional(),
  createdBy: z.string().nullable().optional(),
})

export type ApiKey = z.output<typeof apiKeySchema>

export const createApiKeyBodySchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  source: z.enum(['settings', 'deploy_modal']).optional(),
})

export const createPersonalApiKeyBodySchema = createApiKeyBodySchema.pick({ name: true })

export const apiKeyIdParamsSchema = z.object({
  id: z.string({ error: 'API key ID is required' }).min(1, 'API key ID is required'),
})

export const workspaceApiKeyParamsSchema = z.object({
  id: z.string().min(1),
})

export const workspaceApiKeyIdParamsSchema = z.object({
  id: z.string().min(1),
  keyId: z.string().min(1),
})

export const updateWorkspaceApiKeyBodySchema = z.object({
  name: z.string().min(1, 'Name is required'),
})

export const deleteWorkspaceApiKeysBodySchema = z.object({
  keys: z.array(z.string()).min(1),
})

export const listPersonalApiKeysContract = defineRouteContract({
  method: 'GET',
  path: '/api/users/me/api-keys',
  response: {
    mode: 'json',
    schema: z.object({
      keys: z.array(apiKeySchema),
    }),
  },
})

export const createPersonalApiKeyContract = defineRouteContract({
  method: 'POST',
  path: '/api/users/me/api-keys',
  body: createPersonalApiKeyBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      key: apiKeySchema,
    }),
  },
})

export const deletePersonalApiKeyContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/users/me/api-keys/[id]',
  params: apiKeyIdParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
    }),
  },
})

export const listWorkspaceApiKeysContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/api-keys',
  params: workspaceApiKeyParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      keys: z.array(apiKeySchema),
    }),
  },
})

export const createWorkspaceApiKeyContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/api-keys',
  params: workspaceApiKeyParamsSchema,
  body: createApiKeyBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      key: apiKeySchema,
    }),
  },
})

export const deleteWorkspaceApiKeyContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/workspaces/[id]/api-keys/[keyId]',
  params: workspaceApiKeyIdParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
    }),
  },
})

export const updateWorkspaceApiKeyContract = defineRouteContract({
  method: 'PUT',
  path: '/api/workspaces/[id]/api-keys/[keyId]',
  params: workspaceApiKeyIdParamsSchema,
  body: updateWorkspaceApiKeyBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      key: apiKeySchema,
    }),
  },
})

export const deleteWorkspaceApiKeysContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/workspaces/[id]/api-keys',
  params: workspaceApiKeyParamsSchema,
  body: deleteWorkspaceApiKeysBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      deletedCount: z.number(),
    }),
  },
})
