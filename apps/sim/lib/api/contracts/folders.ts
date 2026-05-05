import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const folderScopeSchema = z.enum(['active', 'archived'])

export const folderSchema = z.object({
  id: z.string(),
  name: z.string(),
  userId: z.string(),
  workspaceId: z.string(),
  parentId: z.string().nullable(),
  color: z.string().nullable(),
  isExpanded: z.boolean(),
  locked: z.boolean(),
  sortOrder: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
})

export type FolderApi = z.output<typeof folderSchema>

export const listFoldersQuerySchema = z.object({
  workspaceId: z.string({ error: 'Workspace ID is required' }).min(1, 'Workspace ID is required'),
  scope: folderScopeSchema.default('active'),
})

export const createFolderBodySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, 'Name is required'),
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  /** Mirrors `updateFolderBodySchema.parentId` so explicit `null` (root folder) is accepted on create. */
  parentId: z.string().nullable().optional(),
  color: z.string().optional(),
  sortOrder: z.number().int().optional(),
})

export const folderIdParamsSchema = z.object({
  id: z.string().min(1),
})

export const updateFolderBodySchema = z.object({
  name: z.string().optional(),
  color: z.string().optional(),
  isExpanded: z.boolean().optional(),
  locked: z.boolean().optional(),
  parentId: z.string().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
})

export const restoreFolderBodySchema = z.object({
  workspaceId: z.string({ error: 'Workspace ID is required' }).min(1, 'Workspace ID is required'),
})

export const duplicateFolderBodySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  workspaceId: z.string().optional(),
  parentId: z.string().nullable().optional(),
  color: z.string().optional(),
  newId: z.string().uuid().optional(),
})

export const reorderFoldersBodySchema = z.object({
  workspaceId: z.string(),
  updates: z.array(
    z.object({
      id: z.string(),
      sortOrder: z.number().int().min(0),
      parentId: z.string().nullable().optional(),
    })
  ),
})

export const listFoldersContract = defineRouteContract({
  method: 'GET',
  path: '/api/folders',
  query: listFoldersQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      folders: z.array(folderSchema),
    }),
  },
})

export const createFolderContract = defineRouteContract({
  method: 'POST',
  path: '/api/folders',
  body: createFolderBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      folder: folderSchema,
    }),
  },
})

export const updateFolderContract = defineRouteContract({
  method: 'PUT',
  path: '/api/folders/[id]',
  params: folderIdParamsSchema,
  body: updateFolderBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      folder: folderSchema,
    }),
  },
})

export const deleteFolderContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/folders/[id]',
  params: folderIdParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      deletedItems: z.unknown(),
    }),
  },
})

export const restoreFolderContract = defineRouteContract({
  method: 'POST',
  path: '/api/folders/[id]/restore',
  params: folderIdParamsSchema,
  body: restoreFolderBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      restoredItems: z.unknown(),
    }),
  },
})

export const duplicateFolderContract = defineRouteContract({
  method: 'POST',
  path: '/api/folders/[id]/duplicate',
  params: folderIdParamsSchema,
  body: duplicateFolderBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      folder: folderSchema,
    }),
  },
})

export const reorderFoldersContract = defineRouteContract({
  method: 'PUT',
  path: '/api/folders/reorder',
  body: reorderFoldersBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      updated: z.number().int(),
    }),
  },
})
