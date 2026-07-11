import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

/**
 * Mirrors `pinnedItem.resourceType` in `packages/db/schema.ts`, which is deliberately
 * plain `text` on that table (not a `pgEnum` like `folder.resourceType`) — pinning
 * accepts `'folder'` itself in addition to the four folder-bearing resource types.
 */
export const pinnedResourceTypeSchema = z.enum([
  'folder',
  'workflow',
  'file',
  'knowledge_base',
  'table',
])
export type PinnedResourceType = z.output<typeof pinnedResourceTypeSchema>

export const pinnedItemSchema = z.object({
  id: z.string(),
  userId: z.string(),
  workspaceId: z.string(),
  resourceType: pinnedResourceTypeSchema,
  resourceId: z.string(),
  pinnedAt: z.string(),
})

export type PinnedItemApi = z.output<typeof pinnedItemSchema>

export const listPinnedItemsQuerySchema = z.object({
  workspaceId: z.string({ error: 'Workspace ID is required' }).min(1, 'Workspace ID is required'),
  resourceType: pinnedResourceTypeSchema.optional(),
})

export const createPinnedItemBodySchema = z.object({
  workspaceId: z.string({ error: 'Workspace ID is required' }).min(1, 'Workspace ID is required'),
  resourceType: pinnedResourceTypeSchema,
  resourceId: z.string().min(1, 'Resource ID is required'),
})

export const pinnedItemResourceParamsSchema = z.object({
  resourceType: pinnedResourceTypeSchema,
  resourceId: z.string().min(1),
})

export const listPinnedItemsContract = defineRouteContract({
  method: 'GET',
  path: '/api/pinned-items',
  query: listPinnedItemsQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      pinnedItems: z.array(pinnedItemSchema),
    }),
  },
})

export const createPinnedItemContract = defineRouteContract({
  method: 'POST',
  path: '/api/pinned-items',
  body: createPinnedItemBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      pinnedItem: pinnedItemSchema,
    }),
  },
})

export const deletePinnedItemContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/pinned-items/[resourceType]/[resourceId]',
  params: pinnedItemResourceParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
    }),
  },
})
