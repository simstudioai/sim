import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

/** Mirrors `folderResourceTypeEnum` in `packages/db/schema.ts`. */
export const folderResourceTypeSchema = z.enum(['workflow', 'file', 'knowledge_base', 'table'])
export type FolderResourceType = z.output<typeof folderResourceTypeSchema>

export const folderScopeSchema = z.enum(['active', 'archived'])

export const folderSchema = z.object({
  id: z.string(),
  resourceType: folderResourceTypeSchema,
  name: z.string(),
  userId: z.string(),
  workspaceId: z.string(),
  parentId: z.string().nullable(),
  locked: z.boolean(),
  sortOrder: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
})

export type FolderApi = z.output<typeof folderSchema>

export const listFoldersQuerySchema = z.object({
  workspaceId: z.string({ error: 'Workspace ID is required' }).min(1, 'Workspace ID is required'),
  resourceType: folderResourceTypeSchema,
  scope: folderScopeSchema.default('active'),
})

export const createFolderBodySchema = z.object({
  id: z.string().uuid().optional(),
  resourceType: folderResourceTypeSchema,
  name: z.string().min(1, 'Name is required'),
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  /** Mirrors `updateFolderBodySchema.parentId` so explicit `null` (root folder) is accepted on create. */
  parentId: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
})

export const folderIdParamsSchema = z.object({
  id: z.string().min(1),
})

export const updateFolderBodySchema = z.object({
  name: z.string().optional(),
  locked: z.boolean().optional(),
  parentId: z.string().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
})

export const restoreFolderBodySchema = z.object({
  workspaceId: z.string({ error: 'Workspace ID is required' }).min(1, 'Workspace ID is required'),
})

/** Per-resourceType cascade counts from a folder delete/restore; only the relevant fields are populated. */
export const folderCascadeCountsSchema = z.object({
  folders: z.number(),
  workflows: z.number().optional(),
  files: z.number().optional(),
  knowledgeBases: z.number().optional(),
  tables: z.number().optional(),
})

export const duplicateFolderBodySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  workspaceId: z.string().optional(),
  parentId: z.string().nullable().optional(),
  newId: z.string().uuid().optional(),
})

export const reorderFoldersBodySchema = z.object({
  workspaceId: z.string(),
  updates: z
    .array(
      z.object({
        id: z.string(),
        sortOrder: z.number().int().min(0),
        parentId: z.string().nullable().optional(),
      })
    )
    .min(1, 'At least one folder must be provided')
    .max(1000, 'At most 1000 folders can be reordered at once'),
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
      deletedItems: folderCascadeCountsSchema.optional(),
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
      restoredItems: folderCascadeCountsSchema.optional(),
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
