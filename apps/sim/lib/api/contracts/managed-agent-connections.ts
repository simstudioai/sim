import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const managedAgentConnectionSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  userId: z.string().nullable(),
  name: z.string(),
  /** First 8 chars + '…' + last 4. Never plaintext. */
  maskedApiKey: z.string(),
  lastVerifiedAt: z.string().nullable(),
  lastVerificationError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type ManagedAgentConnection = z.output<typeof managedAgentConnectionSchema>

export const listManagedAgentConnectionsQuerySchema = z.object({
  workspaceId: z.string().min(1),
})

export const createManagedAgentConnectionBodySchema = z.object({
  workspaceId: z.string().min(1),
  name: z
    .string()
    .trim()
    .min(1, 'Name is required')
    .max(64, 'Name must be 64 characters or fewer'),
  apiKey: z
    .string()
    .trim()
    .min(1, 'API key is required')
    .max(2048, 'API key looks too long — check for stray whitespace'),
})

export const deleteManagedAgentConnectionQuerySchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
})

export const rotateManagedAgentConnectionParamsSchema = z.object({
  id: z.string().min(1),
})
export const rotateManagedAgentConnectionBodySchema = z.object({
  workspaceId: z.string().min(1),
  apiKey: z.string().trim().min(1).max(2048),
})

export const managedAgentProxyParamsSchema = z.object({
  id: z.string().min(1),
})
export const managedAgentProxyQuerySchema = z.object({
  workspaceId: z.string().min(1),
})

export const managedAgentAgentSchema = z.object({
  id: z.string(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  version: z.union([z.string(), z.number()]).nullable().optional(),
})
export type ManagedAgentAgent = z.output<typeof managedAgentAgentSchema>

export const managedAgentEnvironmentSchema = z.object({
  id: z.string(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  envType: z.enum(['cloud', 'self_hosted']),
  scope: z.enum(['organization', 'account']).nullable().optional(),
})
export type ManagedAgentEnvironment = z.output<typeof managedAgentEnvironmentSchema>

export const managedAgentVaultSchema = z.object({
  id: z.string(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
})
export type ManagedAgentVault = z.output<typeof managedAgentVaultSchema>

export const managedAgentMemoryStoreSchema = z.object({
  id: z.string(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  archivedAt: z.string().nullable().optional(),
})
export type ManagedAgentMemoryStore = z.output<typeof managedAgentMemoryStoreSchema>

export const managedAgentEnvironmentDetailParamsSchema = z.object({
  id: z.string().min(1),
  envId: z.string().min(1),
})

export const listManagedAgentConnectionsContract = defineRouteContract({
  method: 'GET',
  path: '/api/managed-agent-connections',
  query: listManagedAgentConnectionsQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      data: z.array(managedAgentConnectionSchema),
    }),
  },
})

export const createManagedAgentConnectionContract = defineRouteContract({
  method: 'POST',
  path: '/api/managed-agent-connections',
  body: createManagedAgentConnectionBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      data: managedAgentConnectionSchema,
    }),
  },
})

export const deleteManagedAgentConnectionContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/managed-agent-connections',
  query: deleteManagedAgentConnectionQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true) }),
  },
})

export const rotateManagedAgentConnectionContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/managed-agent-connections/[id]',
  params: rotateManagedAgentConnectionParamsSchema,
  body: rotateManagedAgentConnectionBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      data: managedAgentConnectionSchema,
    }),
  },
})

export const listManagedAgentAgentsContract = defineRouteContract({
  method: 'GET',
  path: '/api/managed-agent-connections/[id]/agents',
  params: managedAgentProxyParamsSchema,
  query: managedAgentProxyQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      data: z.array(managedAgentAgentSchema),
    }),
  },
})

export const listManagedAgentEnvironmentsContract = defineRouteContract({
  method: 'GET',
  path: '/api/managed-agent-connections/[id]/environments',
  params: managedAgentProxyParamsSchema,
  query: managedAgentProxyQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      data: z.array(managedAgentEnvironmentSchema),
    }),
  },
})

export const getManagedAgentEnvironmentContract = defineRouteContract({
  method: 'GET',
  path: '/api/managed-agent-connections/[id]/environments/[envId]',
  params: managedAgentEnvironmentDetailParamsSchema,
  query: managedAgentProxyQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      data: managedAgentEnvironmentSchema,
    }),
  },
})

export const listManagedAgentVaultsContract = defineRouteContract({
  method: 'GET',
  path: '/api/managed-agent-connections/[id]/vaults',
  params: managedAgentProxyParamsSchema,
  query: managedAgentProxyQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      data: z.array(managedAgentVaultSchema),
    }),
  },
})

export const listManagedAgentMemoryStoresContract = defineRouteContract({
  method: 'GET',
  path: '/api/managed-agent-connections/[id]/memory-stores',
  params: managedAgentProxyParamsSchema,
  query: managedAgentProxyQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      data: z.array(managedAgentMemoryStoreSchema),
    }),
  },
})
