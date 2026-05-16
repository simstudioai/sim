import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const workspaceFileFolderScopeSchema = z.enum(['active', 'archived', 'all'])

export const workspaceFileFoldersParamsSchema = z.object({
  id: z.string({ error: 'Workspace ID is required' }).min(1, 'Workspace ID is required'),
})

export const workspaceFileFolderParamsSchema = workspaceFileFoldersParamsSchema.extend({
  folderId: z.string({ error: 'Folder ID is required' }).min(1, 'Folder ID is required'),
})

export const listWorkspaceFileFoldersQuerySchema = z.object({
  scope: workspaceFileFolderScopeSchema.default('active'),
})

export const workspaceFileFolderSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  userId: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  path: z.string(),
  sortOrder: z.number(),
  deletedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
})

export type WorkspaceFileFolderApi = z.output<typeof workspaceFileFolderSchema>

const workspaceFileFoldersSuccessSchema = z.object({
  success: z.boolean(),
})

const workspaceFileFolderNameSchema = z
  .string({ error: 'Name is required' })
  .trim()
  .min(1, 'Name is required')
  .refine(
    (name) => name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\'),
    'Name cannot contain path separators or dot segments'
  )

export const createWorkspaceFileFolderBodySchema = z.object({
  name: workspaceFileFolderNameSchema,
  parentId: z.string().nullable().optional(),
})

export const updateWorkspaceFileFolderBodySchema = z.object({
  name: workspaceFileFolderNameSchema.optional(),
  parentId: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
})

export const moveWorkspaceFileItemsBodySchema = z
  .object({
    fileIds: z.array(z.string()).default([]),
    folderIds: z.array(z.string()).default([]),
    targetFolderId: z.string().nullable().optional(),
  })
  .refine((body) => body.fileIds.length > 0 || body.folderIds.length > 0, {
    message: 'At least one file or folder must be selected',
  })

export const bulkArchiveWorkspaceFileItemsBodySchema = z
  .object({
    fileIds: z.array(z.string()).default([]),
    folderIds: z.array(z.string()).default([]),
  })
  .refine((body) => body.fileIds.length > 0 || body.folderIds.length > 0, {
    message: 'At least one file or folder must be selected',
  })

const queryIdListSchema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) => {
    if (!value) return []
    const values = Array.isArray(value) ? value : [value]
    return values
      .flatMap((entry) => entry.split(','))
      .map((entry) => entry.trim())
      .filter(Boolean)
  })

export const downloadWorkspaceFileItemsQuerySchema = z.object({
  fileIds: queryIdListSchema,
  folderIds: queryIdListSchema,
})

export const listWorkspaceFileFoldersContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/files/folders',
  params: workspaceFileFoldersParamsSchema,
  query: listWorkspaceFileFoldersQuerySchema,
  response: {
    mode: 'json',
    schema: workspaceFileFoldersSuccessSchema.extend({
      folders: z.array(workspaceFileFolderSchema),
    }),
  },
})

export const createWorkspaceFileFolderContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/files/folders',
  params: workspaceFileFoldersParamsSchema,
  body: createWorkspaceFileFolderBodySchema,
  response: {
    mode: 'json',
    schema: workspaceFileFoldersSuccessSchema.extend({
      folder: workspaceFileFolderSchema,
    }),
  },
})

export const updateWorkspaceFileFolderContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/workspaces/[id]/files/folders/[folderId]',
  params: workspaceFileFolderParamsSchema,
  body: updateWorkspaceFileFolderBodySchema,
  response: {
    mode: 'json',
    schema: workspaceFileFoldersSuccessSchema.extend({
      folder: workspaceFileFolderSchema,
    }),
  },
})

export const deleteWorkspaceFileFolderContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/workspaces/[id]/files/folders/[folderId]',
  params: workspaceFileFolderParamsSchema,
  response: {
    mode: 'json',
    schema: workspaceFileFoldersSuccessSchema.extend({
      deletedItems: z.object({
        folders: z.number().int(),
        files: z.number().int(),
      }),
    }),
  },
})

export const moveWorkspaceFileItemsContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/files/move',
  params: workspaceFileFoldersParamsSchema,
  body: moveWorkspaceFileItemsBodySchema,
  response: {
    mode: 'json',
    schema: workspaceFileFoldersSuccessSchema.extend({
      movedItems: z.object({
        files: z.number().int(),
        folders: z.number().int(),
      }),
    }),
  },
})

export const bulkArchiveWorkspaceFileItemsContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/files/bulk-archive',
  params: workspaceFileFoldersParamsSchema,
  body: bulkArchiveWorkspaceFileItemsBodySchema,
  response: {
    mode: 'json',
    schema: workspaceFileFoldersSuccessSchema.extend({
      deletedItems: z.object({
        folders: z.number().int(),
        files: z.number().int(),
      }),
    }),
  },
})

export const downloadWorkspaceFileItemsContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/files/download',
  params: workspaceFileFoldersParamsSchema,
  query: downloadWorkspaceFileItemsQuerySchema,
  response: {
    mode: 'binary',
  },
})

export const restoreWorkspaceFileFolderContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/files/folders/[folderId]/restore',
  params: workspaceFileFolderParamsSchema,
  response: {
    mode: 'json',
    schema: workspaceFileFoldersSuccessSchema.extend({
      folder: workspaceFileFolderSchema,
      restoredItems: z.object({
        folders: z.number().int(),
        files: z.number().int(),
      }),
    }),
  },
})
