import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

/** One day in milliseconds: a key's expiry options and its creation bounds are counted in days. */
export const DAY_MS = 24 * 60 * 60 * 1000

export const apiKeyAccessSchema = z.enum(['read', 'write'])
export type ApiKeyAccessLevel = z.output<typeof apiKeyAccessSchema>

const apiKeyMetadataSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Defaulted so a new client tolerates an old server's response during rollout. */
  access: apiKeyAccessSchema.default('write'),
  lastUsed: z.string().nullable().optional(),
  createdAt: z.string(),
  expiresAt: z.string().nullable().optional(),
  createdBy: z.string().nullable().optional(),
})

export const apiKeyListItemSchema = apiKeyMetadataSchema.extend({
  displayKey: z.string(),
})

export const apiKeySchema = apiKeyMetadataSchema.extend({
  key: z.string(),
  displayKey: z.string().optional(),
})

export type ApiKey = z.output<typeof apiKeyListItemSchema>
export type CreatedApiKey = z.output<typeof apiKeySchema>

/**
 * A creation-time expiry, or `null` (and absent) for a key that never expires.
 * The window it must fall in is enforced where the key is created, against the
 * server's clock.
 */
const apiKeyExpiresAtInputSchema = z.iso.datetime({ offset: true }).nullable().optional()

export const createApiKeyBodySchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  source: z.enum(['settings', 'deploy_modal']).optional(),
  access: apiKeyAccessSchema.default('write'),
  expiresAt: apiKeyExpiresAtInputSchema,
})

export const createPersonalApiKeyBodySchema = createApiKeyBodySchema.pick({
  name: true,
  access: true,
  expiresAt: true,
})

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
      keys: z.array(apiKeyListItemSchema),
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
      keys: z.array(apiKeyListItemSchema),
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
      key: apiKeyMetadataSchema.extend({
        updatedAt: z.string(),
      }),
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
