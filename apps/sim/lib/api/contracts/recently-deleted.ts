import { z } from 'zod'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

/** Every kind of row Recently Deleted lists. */
export const RECENTLY_DELETED_ITEM_TYPES = [
  'workflow',
  'folder',
  'table',
  'table_folder',
  'knowledge',
  'knowledge_folder',
  'file',
  'workspace_folder',
  'chat',
] as const

/**
 * The view's tabs, after the default `all`, in the sidebar's top-down order so they read the
 * way the user already reads these resources. A foldered resource's tab also lists its own
 * folders (Tables lists table folders); `folder` is the workflow folder tree.
 */
export const RECENTLY_DELETED_FILTERS = [
  'all',
  'chat',
  'table',
  'file',
  'knowledge',
  'workflow',
  'folder',
] as const

export const RECENTLY_DELETED_SORT_COLUMNS = ['deleted', 'name', 'type'] as const

const RECENTLY_DELETED_PAGE_SIZE = 50

const recentlyDeletedItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(RECENTLY_DELETED_ITEM_TYPES),
  deletedAt: z.string(),
  /** Parent folder id for folder rows; `null` for every other type. */
  parentId: z.string().nullable(),
})

export type RecentlyDeletedItem = z.output<typeof recentlyDeletedItemSchema>

const listRecentlyDeletedQuerySchema = z.object({
  type: z.enum(RECENTLY_DELETED_FILTERS).default('all'),
  search: z
    .string()
    .trim()
    .max(200, 'search must be at most 200 characters')
    .optional()
    .transform((value) => value || undefined),
  sortBy: z.enum(RECENTLY_DELETED_SORT_COLUMNS).default('deleted'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  limit: z.coerce.number().int().min(1).max(100).default(RECENTLY_DELETED_PAGE_SIZE),
  cursor: z.string().min(1, 'cursor must be a non-empty token').max(2048).optional(),
})

export type RecentlyDeletedFilter = z.output<typeof listRecentlyDeletedQuerySchema>['type']
export type RecentlyDeletedSortColumn = z.output<typeof listRecentlyDeletedQuerySchema>['sortBy']

/** The item types each tab lists. */
export const RECENTLY_DELETED_TYPES_BY_FILTER: Record<
  RecentlyDeletedFilter,
  readonly RecentlyDeletedItem['type'][]
> = {
  all: RECENTLY_DELETED_ITEM_TYPES,
  chat: ['chat'],
  table: ['table', 'table_folder'],
  file: ['file', 'workspace_folder'],
  knowledge: ['knowledge', 'knowledge_folder'],
  workflow: ['workflow'],
  folder: ['folder'],
}

export const listRecentlyDeletedContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/recently-deleted',
  params: z.object({ id: workspaceIdSchema }),
  query: listRecentlyDeletedQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      items: z.array(recentlyDeletedItemSchema).max(100),
      nextCursor: z.string().nullable(),
    }),
  },
})
