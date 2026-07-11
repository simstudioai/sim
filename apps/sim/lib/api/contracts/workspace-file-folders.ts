import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

/**
 * Mixed-item (file + folder) operations that address multiple ids at once.
 * Folder CRUD itself lives in `@/lib/api/contracts/folders` (generic
 * `resourceType`-parameterized `/api/folders/**` routes).
 */
export const workspaceFileFoldersParamsSchema = z.object({
  id: z.string({ error: 'Workspace ID is required' }).min(1, 'Workspace ID is required'),
})

const workspaceFileFoldersSuccessSchema = z.object({
  success: z.boolean(),
})

export const moveWorkspaceFileItemsBodySchema = z
  .object({
    fileIds: z.array(z.string()).max(100, 'At most 100 files can be moved at once').default([]),
    folderIds: z.array(z.string()).max(100, 'At most 100 folders can be moved at once').default([]),
    targetFolderId: z.string().nullable().optional(),
  })
  .refine((body) => body.fileIds.length > 0 || body.folderIds.length > 0, {
    message: 'At least one file or folder must be selected',
  })

export const bulkArchiveWorkspaceFileItemsBodySchema = z
  .object({
    fileIds: z.array(z.string()).max(100, 'At most 100 files can be deleted at once').default([]),
    folderIds: z
      .array(z.string())
      .max(100, 'At most 100 folders can be deleted at once')
      .default([]),
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
