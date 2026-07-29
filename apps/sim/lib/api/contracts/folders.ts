import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

/** Mirrors `folderResourceTypeEnum` in `packages/db/schema.ts`. */
export const folderResourceTypeSchema = z.enum(['workflow', 'file', 'knowledge_base', 'table'])
export type FolderResourceType = z.output<typeof folderResourceTypeSchema>

/**
 * The resource types the generic folder engine serves. Identical to
 * {@link folderResourceTypeSchema} now that every type is backed by the `folder` table;
 * kept as a separate schema so a future resource type can be added to the enum (and the
 * DB) ahead of the routes that serve it.
 */
export const servedFolderResourceTypeSchema = z
  .enum(['workflow', 'file', 'knowledge_base', 'table'])
  .default('workflow')

export type ServedFolderResourceType = z.output<typeof servedFolderResourceTypeSchema>

export const folderScopeSchema = z.enum(['active', 'archived'])

export const folderSchema = z.object({
  id: z.string(),
  resourceType: folderResourceTypeSchema,
  name: z.string(),
  userId: z.string(),
  workspaceId: z.string(),
  parentId: z.string().nullable(),
  /**
   * Workflow-folder locking, carried over verbatim from `workflow_folder`. Always
   * `false` for the other resource types — locking is not extended to them.
   */
  locked: z.boolean(),
  sortOrder: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
})

export type FolderApi = z.output<typeof folderSchema>

export const listFoldersQuerySchema = z.object({
  workspaceId: z.string({ error: 'Workspace ID is required' }).min(1, 'Workspace ID is required'),
  resourceType: servedFolderResourceTypeSchema,
  scope: folderScopeSchema.default('active'),
})

/**
 * Addresses which resource's folder tree an id-keyed route operates on. Required even
 * though folder ids are UUIDs: without it, a caller holding a knowledge-base folder id
 * could drive it through the workflow surface.
 */
export const folderResourceTypeQuerySchema = z.object({
  resourceType: servedFolderResourceTypeSchema,
})

export const createFolderBodySchema = z.object({
  id: z.string().uuid().optional(),
  resourceType: servedFolderResourceTypeSchema,
  name: z.string().trim().min(1, 'Name is required').max(255, 'Name is too long'),
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  /** Mirrors `updateFolderBodySchema.parentId` so explicit `null` (root folder) is accepted on create. */
  parentId: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
})

export const folderIdParamsSchema = z.object({
  id: z.string().min(1),
})

export const updateFolderBodySchema = z.object({
  /**
   * `.trim()` runs before the bound: the write path trims too, so validating the raw
   * string would let a whitespace-only rename through and persist an empty name.
   */
  name: z.string().trim().min(1, 'Name cannot be empty').max(255, 'Name is too long').optional(),
  /** Only meaningful for `workflow` folders; see `folderSchema.locked`. */
  locked: z.boolean().optional(),
  parentId: z.string().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
})

export const restoreFolderBodySchema = z.object({
  workspaceId: z.string({ error: 'Workspace ID is required' }).min(1, 'Workspace ID is required'),
  resourceType: servedFolderResourceTypeSchema,
})

export const duplicateFolderBodySchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(255, 'Name is too long'),
  workspaceId: z.string().optional(),
  parentId: z.string().nullable().optional(),
  newId: z.string().uuid().optional(),
})

export const reorderFoldersBodySchema = z.object({
  workspaceId: z.string(),
  resourceType: servedFolderResourceTypeSchema,
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

/** Per-resourceType cascade counts from a folder delete/restore; only the relevant key is populated. */
export const folderCascadeCountsSchema = z.object({
  folders: z.number().int(),
  workflows: z.number().int().optional(),
  files: z.number().int().optional(),
  knowledgeBases: z.number().int().optional(),
  tables: z.number().int().optional(),
})

export type FolderCascadeCountsApi = z.output<typeof folderCascadeCountsSchema>

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
  query: folderResourceTypeQuerySchema,
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
  query: folderResourceTypeQuerySchema,
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
