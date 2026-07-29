import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

/**
 * Mirrors `pinnedItem.resourceType` in `packages/db/schema.ts`, which is deliberately
 * plain `text` on that table rather than a `pgEnum` — the set of pinnable kinds is
 * expected to grow, and this schema is the enforcement point.
 *
 * `folder` covers every folder tree at once: folder ids are globally unique, so one pin
 * namespace serves the file, knowledge-base, and table trees. It is separate from the
 * resource's own type, which is why a page listing folders alongside its resources resolves
 * two `usePinnedIds` sets.
 */
export const pinnedResourceTypeSchema = z.enum([
  'workflow',
  'file',
  'knowledge_base',
  'table',
  'folder',
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
  workspaceId: workspaceIdSchema,
  /** Omitted returns every pinned item in the workspace, across all resource types. */
  resourceType: pinnedResourceTypeSchema.optional(),
})

export const createPinnedItemBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  resourceType: pinnedResourceTypeSchema,
  resourceId: z.string().min(1, 'Resource ID is required').max(255, 'Resource ID is too long'),
})

export const pinnedItemResourceParamsSchema = z.object({
  resourceType: pinnedResourceTypeSchema,
  resourceId: z.string().min(1, 'Resource ID is required').max(255, 'Resource ID is too long'),
})

export type ListPinnedItemsQuery = z.input<typeof listPinnedItemsQuerySchema>
export type CreatePinnedItemBody = z.input<typeof createPinnedItemBodySchema>

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
