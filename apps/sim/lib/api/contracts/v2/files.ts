import { z } from 'zod'
import {
  isCanonicalBase64,
  workspaceFileIdSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { shareAuthTypeSchema, shareRecordSchema } from '@/lib/api/contracts/public-shares'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2CreateFolderBodySchema,
  v2CursorListResponse,
  v2DataResponse,
  v2DeleteFolderQuerySchema,
  v2FolderPathSchema,
  v2FolderSchema,
  v2ListFoldersQuerySchema,
  v2RelocateFolderBodySchema,
  v2SearchSchema,
  v2SortFields,
} from '@/lib/api/contracts/v2/shared'
import {
  v2CompleteUploadBodySchema,
  v2PartUrlsBodySchema,
  v2PartUrlsDataSchema,
  v2UploadStatusSchema,
  v2UploadTokenHeadersSchema,
  v2UploadTransferSchema,
} from '@/lib/api/contracts/v2/uploads'
import { MAX_WORKSPACE_FILE_SIZE } from '@/lib/uploads/shared/types'

/**
 * v2 files contracts. v2 drops the v1 `{ success, data, limits }` envelope in
 * favor of the canonical v2 shapes (`{ data }` / `{ data, nextCursor }`) and
 * adds cursor pagination to the list. List and item routes carry the workspace
 * as a query parameter; upload-session creation carries it in the JSON body.
 *
 * Folder placement is represented only by canonical paths. Database folder ids
 * remain an internal storage detail.
 *
 * Uploads use a signed stateless control token. The storage provider owns the
 * multipart part state; completion atomically registers the workspace file.
 */

/** A workspace file as exposed by the v2 surface. */
export const v2FileSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number().nonnegative(),
  type: z.string(),
  key: z.string(),
  /** Canonical containing-folder path; `/` means the workspace root. */
  folderPath: v2FolderPathSchema,
  uploadedBy: z.string(),
  /** ISO-8601 timestamp. */
  uploadedAt: z.string(),
  /** ISO-8601 timestamp; advances on content and metadata writes alike. */
  updatedAt: z.string(),
})

export type V2File = z.output<typeof v2FileSchema>

export const v2FileUploadParamsSchema = z.object({ uploadId: z.string().min(1) })
export type V2FileUploadParams = z.output<typeof v2FileUploadParamsSchema>

export const v2CreateFileUploadBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    name: z.string().trim().min(1, 'name is required').max(255, 'name is too long'),
    contentType: z.string().trim().min(1, 'contentType is required').max(255),
    size: z.number().int().nonnegative().max(MAX_WORKSPACE_FILE_SIZE),
    folderPath: v2FolderPathSchema.optional(),
  })
  .strict()
export type V2CreateFileUploadBody = z.input<typeof v2CreateFileUploadBodySchema>

export const v2FileUploadWorkspaceQuerySchema = z.object({ workspaceId: workspaceIdSchema })
export type V2FileUploadWorkspaceQuery = z.output<typeof v2FileUploadWorkspaceQuerySchema>

export const v2FileUploadSchema = z.object({
  id: z.string(),
  status: v2UploadStatusSchema,
  name: z.string(),
  contentType: z.string(),
  size: z.number().int().nonnegative(),
  expiresAt: z.string().datetime(),
  error: z.string().nullable(),
  file: v2FileSchema.nullable(),
})
export type V2FileUpload = z.output<typeof v2FileUploadSchema>

export const v2CreateFileUploadDataSchema = z
  .object({
    session: v2FileUploadSchema,
    uploadToken: z.string().min(1),
    transfer: v2UploadTransferSchema,
  })
  .strict()
export type V2CreateFileUploadData = z.output<typeof v2CreateFileUploadDataSchema>

export const v2DeleteFileResultSchema = z.object({
  id: z.string(),
  deleted: z.literal(true),
})

export type V2DeleteFileResult = z.output<typeof v2DeleteFileResultSchema>

export const v2FileParamsSchema = z.object({
  fileId: workspaceFileIdSchema,
})

export type V2FileParams = z.output<typeof v2FileParamsSchema>

/**
 * A file-folder name becomes a path segment, so path separators and dot
 * segments are rejected rather than normalized. Mirrors
 * `normalizeWorkspaceFileItemName`, which enforces the same rule in the manager.
 */
const v2FileItemNameSchema = z
  .string()
  .trim()
  .min(1, 'name is required')
  .max(255, 'name is too long')
  .refine(
    (name) => name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\'),
    'name cannot contain path separators or dot segments'
  )

export const v2CreateFileBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    name: v2FileItemNameSchema,
    contentType: z
      .string()
      .trim()
      .min(1, 'contentType cannot be empty')
      .max(255, 'contentType is too long')
      .optional(),
    folderPath: v2FolderPathSchema.optional(),
    content: z.string().max(70_000_000, 'content is too large').default(''),
    encoding: z.enum(['utf-8', 'base64']).default('utf-8'),
  })
  .superRefine(({ content, encoding }, ctx) => {
    if (encoding === 'base64' && !isCanonicalBase64(content)) {
      ctx.addIssue({
        code: 'custom',
        path: ['content'],
        message: 'content must be valid base64',
      })
    }
  })
  .strict()

export type V2CreateFileBody = z.input<typeof v2CreateFileBodySchema>

/** Sortable file fields. `name` is the uploaded file name, not the storage key. */
export const v2FileSortFields = ['name', 'size', 'uploadedAt', 'updatedAt'] as const

export type V2FileSortBy = (typeof v2FileSortFields)[number]

/**
 * List query: workspace scope, the v2 search/sort convention, an optional
 * folder filter, and opaque keyset cursor pagination. `limit` clamps to
 * `[1, 1000]` (default 100) to bound the response.
 *
 * The keyset is `(<sortBy>, id)`, so the cursor is stamped with the sort it was
 * minted under and rejected if the request's sort has since changed. Filtering,
 * ordering, and the page slice all happen in the query.
 */
export const v2ListFilesQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    /** Restrict to one file folder. Omit to list the whole workspace. */
    folderPath: v2FolderPathSchema.optional(),
    search: v2SearchSchema,
    ...v2SortFields(v2FileSortFields, { sortBy: 'uploadedAt', sortOrder: 'asc' }),
    limit: z.coerce
      .number()
      .optional()
      .default(100)
      .transform((v) => Math.min(Math.max(1, Math.trunc(v)), 1000)),
    cursor: z.string().min(1).optional(),
  })
  .strict()

export type V2ListFilesQuery = z.output<typeof v2ListFilesQuerySchema>

/** Download/delete both target a single file within a workspace-scoped query. */
export const v2FileWorkspaceQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
})

export type V2FileWorkspaceQuery = z.output<typeof v2FileWorkspaceQuerySchema>

export const v2RenameFileBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    name: v2FileItemNameSchema,
  })
  .strict()

export type V2RenameFileBody = z.input<typeof v2RenameFileBodySchema>

const fileSelectionSchema = {
  fileIds: z.array(z.string().min(1, 'fileIds entries cannot be empty')).min(1).max(1000),
}

export const v2MoveFileItemsBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    ...fileSelectionSchema,
    /** Omission moves the files to the workspace root. */
    targetFolderPath: v2FolderPathSchema.optional(),
  })
  .strict()

export type V2MoveFileItemsBody = z.input<typeof v2MoveFileItemsBodySchema>

export const v2MoveFileItemsResultSchema = z.object({
  movedItems: z.object({ files: z.number().int() }),
})

export type V2MoveFileItemsResult = z.output<typeof v2MoveFileItemsResultSchema>

export const v2BulkDeleteFilesBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    ...fileSelectionSchema,
  })
  .strict()

export type V2BulkDeleteFilesBody = z.input<typeof v2BulkDeleteFilesBodySchema>

export const v2BulkDeleteFilesResultSchema = z.object({
  deletedItems: z.object({ files: z.number().int() }),
})

export type V2BulkDeleteFilesResult = z.output<typeof v2BulkDeleteFilesResultSchema>

export const v2FileFolderDataSchema = z.object({ folder: v2FolderSchema })

export const v2DeleteFileFolderDataSchema = z.object({
  path: v2FolderPathSchema,
  deleted: z.literal(true),
  deletedItems: z.object({ folders: z.number().int(), files: z.number().int() }),
})

export const v2ListFileFoldersContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/files/folders',
  query: v2ListFoldersQuerySchema,
  response: { mode: 'json', schema: v2CursorListResponse(v2FolderSchema) },
})

export const v2CreateFileFolderContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/files/folders',
  body: v2CreateFolderBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2FileFolderDataSchema) },
})

export const v2RelocateFileFolderContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/files/folders',
  body: v2RelocateFolderBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2FileFolderDataSchema) },
})

export const v2DeleteFileFolderContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/files/folders',
  query: v2DeleteFolderQuerySchema,
  response: { mode: 'json', schema: v2DataResponse(v2DeleteFileFolderDataSchema) },
})

/**
 * Public share state. Reuses the internal {@link shareRecordSchema}, which is
 * already public-safe — `hasPassword` is a boolean and neither the ciphertext
 * nor the storage key is carried — with `url` tightened to a real URL.
 */
export const v2FileShareSchema = shareRecordSchema.extend({
  url: z.string().url(),
})

export type V2FileShare = z.output<typeof v2FileShareSchema>

export const v2GetFileShareResultSchema = z.object({
  share: v2FileShareSchema.nullable(),
})

export type V2GetFileShareResult = z.output<typeof v2GetFileShareResultSchema>

export const v2UpsertFileShareResultSchema = z.object({
  share: v2FileShareSchema,
})

export type V2UpsertFileShareResult = z.output<typeof v2UpsertFileShareResultSchema>

/**
 * Share upsert body. The internal surface accepts a caller-supplied `token` so
 * the UI can show a link before saving; v2 drops it. Over an API key it would
 * let a caller mint predictable public URLs, and a token collision surfaces as
 * an unhandled unique-index violation. v2 tokens are always server-generated.
 */
export const v2UpsertFileShareBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    isActive: z.boolean(),
    authType: shareAuthTypeSchema.optional(),
    password: z
      .string()
      .min(1, 'password cannot be empty')
      .max(1024, 'password is too long')
      .optional(),
    allowedEmails: z
      .array(z.string().min(1, 'allowedEmails entries cannot be empty').max(320))
      .max(200, 'Too many allowed emails')
      .optional(),
  })
  .strict()

export type V2UpsertFileShareBody = z.input<typeof v2UpsertFileShareBodySchema>

/**
 * Content replace body. `content` is the whole new body of the file — this is a
 * replace, not an append. Base64 is the escape hatch for non-UTF-8 bytes.
 */
export const v2UpdateFileContentBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    content: z.string().max(70_000_000, 'content is too large'),
    encoding: z.enum(['utf-8', 'base64']).default('utf-8'),
  })
  .superRefine(({ content, encoding }, ctx) => {
    if (encoding === 'base64' && !isCanonicalBase64(content)) {
      ctx.addIssue({
        code: 'custom',
        path: ['content'],
        message: 'content must be valid base64',
      })
    }
  })
  .strict()

export type V2UpdateFileContentBody = z.input<typeof v2UpdateFileContentBodySchema>

export const v2ListFilesContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/files',
  query: v2ListFilesQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2FileSchema),
  },
})

export const v2CreateFileContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/files',
  body: v2CreateFileBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2FileSchema),
  },
})

export const v2CreateFileUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/files/uploads',
  body: v2CreateFileUploadBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2CreateFileUploadDataSchema) },
})

export const v2AbortFileUploadContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/files/uploads/[uploadId]',
  params: v2FileUploadParamsSchema,
  query: v2FileUploadWorkspaceQuerySchema,
  headers: v2UploadTokenHeadersSchema,
  response: { mode: 'json', schema: v2DataResponse(v2FileUploadSchema) },
})

export const v2CreateFileUploadPartUrlsContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/files/uploads/[uploadId]/parts',
  params: v2FileUploadParamsSchema,
  query: v2FileUploadWorkspaceQuerySchema,
  headers: v2UploadTokenHeadersSchema,
  body: v2PartUrlsBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2PartUrlsDataSchema) },
})

export const v2CompleteFileUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/files/uploads/[uploadId]/complete',
  params: v2FileUploadParamsSchema,
  query: v2FileUploadWorkspaceQuerySchema,
  headers: v2UploadTokenHeadersSchema,
  body: v2CompleteUploadBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2FileUploadSchema) },
})

export const v2DownloadFileContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/files/[fileId]',
  params: v2FileParamsSchema,
  query: v2FileWorkspaceQuerySchema,
  response: {
    mode: 'binary',
  },
})

export const v2GetFileContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/files/[fileId]/metadata',
  params: v2FileParamsSchema,
  query: v2FileWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2FileSchema),
  },
})

export const v2RenameFileContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/files/[fileId]',
  params: v2FileParamsSchema,
  body: v2RenameFileBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2FileSchema),
  },
})

export const v2DeleteFileContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/files/[fileId]',
  params: v2FileParamsSchema,
  query: v2FileWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2DeleteFileResultSchema),
  },
})

export const v2MoveFileItemsContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/files/move',
  body: v2MoveFileItemsBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2MoveFileItemsResultSchema),
  },
})

export const v2BulkDeleteFilesContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/files/bulk-delete',
  body: v2BulkDeleteFilesBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2BulkDeleteFilesResultSchema),
  },
})

export const v2GetFileShareContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/files/[fileId]/share',
  params: v2FileParamsSchema,
  query: v2FileWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2GetFileShareResultSchema),
  },
})

export const v2UpsertFileShareContract = defineRouteContract({
  method: 'PUT',
  path: '/api/v2/files/[fileId]/share',
  params: v2FileParamsSchema,
  body: v2UpsertFileShareBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2UpsertFileShareResultSchema),
  },
})

export const v2UpdateFileContentContract = defineRouteContract({
  method: 'PUT',
  path: '/api/v2/files/[fileId]/content',
  params: v2FileParamsSchema,
  body: v2UpdateFileContentBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2FileSchema),
  },
})
