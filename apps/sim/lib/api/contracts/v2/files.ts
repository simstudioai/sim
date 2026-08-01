import { z } from 'zod'
import { workspaceFileIdSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { shareAuthTypeSchema, shareRecordSchema } from '@/lib/api/contracts/public-shares'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { v2CursorListResponse, v2DataResponse } from '@/lib/api/contracts/v2/shared'

/**
 * v2 files contracts. v2 drops the v1 `{ success, data, limits }` envelope in
 * favor of the canonical v2 shapes (`{ data }` / `{ data, nextCursor }`) and
 * adds cursor pagination to the list. The workspace is always carried as a query
 * param — including on upload — so the route can authorize before reading the
 * multipart body.
 *
 * File folders are NOT served by the generic `/api/v2/folders` surface: every
 * file-folder mutation runs behind the `workspace_file_folders:${workspaceId}`
 * advisory lock that makes its cycle and name checks atomic, and a file-folder
 * name becomes a path segment so `/`, `\`, `.` and `..` are forbidden. Neither
 * holds for the generic folder engine, so file folders get their own routes
 * under `/api/v2/files/folders/**`.
 *
 * Presigned upload is deliberately absent. Presign only performs an advisory
 * quota pre-check; the storage debit happens in the separate register step, so
 * a caller that presigns, PUTs bytes, and never registers leaves unaccounted
 * bytes in the bucket. The buffered multipart upload debits inside
 * `uploadWorkspaceFile`'s own transaction, so it is the only public path.
 */

/** A workspace file as exposed by the v2 surface. */
export const v2FileSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number().nonnegative(),
  type: z.string(),
  key: z.string(),
  /** Containing file folder, or `null` when the file sits at the workspace root. */
  folderId: z.string().nullable(),
  /** Slash-joined folder names for {@link v2FileSchema.folderId}; `null` at the root. */
  folderPath: z.string().nullable(),
  uploadedBy: z.string(),
  /** ISO-8601 timestamp. */
  uploadedAt: z.string(),
  /** ISO-8601 timestamp; advances on content and metadata writes alike. */
  updatedAt: z.string(),
})

export type V2File = z.output<typeof v2FileSchema>

/**
 * A file folder as exposed by the v2 surface. `workspaceId` (already known to
 * the caller, who supplied it) and `userId` (the creator) are internal scoping
 * columns and are not exposed, matching the v2 folders projection.
 */
export const v2FileFolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  /** Slash-joined names from the workspace root down to and including this folder. */
  path: z.string(),
  sortOrder: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Set when the folder is archived (in Recently Deleted) rather than live. */
  deletedAt: z.string().nullable(),
})

export type V2FileFolder = z.output<typeof v2FileFolderSchema>

/** Acknowledgement returned by a successful archive (soft delete). */
export const v2DeleteFileResultSchema = z.object({
  id: z.string(),
  deleted: z.literal(true),
})

export type V2DeleteFileResult = z.output<typeof v2DeleteFileResultSchema>

/** Counts of what a cascading archive or restore touched. */
export const v2FileItemCountsSchema = z.object({
  files: z.number().int(),
  folders: z.number().int(),
})

export type V2FileItemCounts = z.output<typeof v2FileItemCountsSchema>

export const v2FileParamsSchema = z.object({
  fileId: workspaceFileIdSchema,
})

export type V2FileParams = z.output<typeof v2FileParamsSchema>

export const v2FileFolderParamsSchema = z.object({
  folderId: z.string().min(1, 'Folder ID is required'),
})

export type V2FileFolderParams = z.output<typeof v2FileFolderParamsSchema>

/** `active` lists live items; `archived` lists Recently Deleted. */
export const v2FileScopeSchema = z.enum(['active', 'archived'])

export type V2FileScope = z.output<typeof v2FileScopeSchema>

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

/**
 * List query: workspace scope plus opaque keyset cursor pagination keyed on
 * `(uploadedAt, id)`. `limit` clamps to `[1, 1000]` (default 100) to bound the
 * response. The cursor is the base64-JSON codec shared across the v2 surface.
 */
export const v2ListFilesQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
  scope: v2FileScopeSchema.default('active'),
  limit: z.coerce
    .number()
    .optional()
    .default(100)
    .transform((v) => Math.min(Math.max(1, Math.trunc(v)), 1000)),
  cursor: z.string().min(1).optional(),
})

export type V2ListFilesQuery = z.output<typeof v2ListFilesQuerySchema>

/**
 * Upload carries the workspace as a query param so auth runs before buffering.
 * `folderId` is a query param for the same reason — the multipart body is never
 * read until the caller is authorized.
 */
export const v2UploadFileQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
  /** Target file folder. Omit to upload to the workspace root. */
  folderId: z.string().min(1, 'folderId cannot be empty').optional(),
})

export type V2UploadFileQuery = z.output<typeof v2UploadFileQuerySchema>

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

export const v2WorkspaceScopedBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
  })
  .strict()

export type V2WorkspaceScopedBody = z.input<typeof v2WorkspaceScopedBodySchema>

/** A restore acknowledgement carries no payload beyond the restored id. */
export const v2RestoreFileResultSchema = z.object({
  id: z.string(),
  restored: z.literal(true),
})

export type V2RestoreFileResult = z.output<typeof v2RestoreFileResultSchema>

const fileItemSelectionSchema = {
  fileIds: z.array(z.string().min(1, 'fileIds entries cannot be empty')).max(1000).default([]),
  folderIds: z.array(z.string().min(1, 'folderIds entries cannot be empty')).max(1000).default([]),
}

export const v2MoveFileItemsBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    ...fileItemSelectionSchema,
    /** Explicit `null` moves the selection to the workspace root. */
    targetFolderId: z.string().min(1, 'targetFolderId cannot be empty').nullable().optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.fileIds.length === 0 && body.folderIds.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['fileIds'],
        message: 'At least one of fileIds or folderIds must be non-empty',
      })
    }
  })

export type V2MoveFileItemsBody = z.input<typeof v2MoveFileItemsBodySchema>

export const v2MoveFileItemsResultSchema = z.object({
  movedItems: v2FileItemCountsSchema,
})

export type V2MoveFileItemsResult = z.output<typeof v2MoveFileItemsResultSchema>

export const v2BulkArchiveFileItemsBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    ...fileItemSelectionSchema,
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.fileIds.length === 0 && body.folderIds.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['fileIds'],
        message: 'At least one of fileIds or folderIds must be non-empty',
      })
    }
  })

export type V2BulkArchiveFileItemsBody = z.input<typeof v2BulkArchiveFileItemsBodySchema>

export const v2BulkArchiveFileItemsResultSchema = z.object({
  deletedItems: v2FileItemCountsSchema,
})

export type V2BulkArchiveFileItemsResult = z.output<typeof v2BulkArchiveFileItemsResultSchema>

export const v2ListFileFoldersQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
  scope: v2FileScopeSchema.default('active'),
})

export type V2ListFileFoldersQuery = z.output<typeof v2ListFileFoldersQuerySchema>

export const v2CreateFileFolderBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    name: v2FileItemNameSchema,
    /** Explicit `null` creates the folder at the workspace root. */
    parentId: z.string().min(1, 'parentId cannot be empty').nullable().optional(),
  })
  .strict()

export type V2CreateFileFolderBody = z.input<typeof v2CreateFileFolderBodySchema>

/** Update body. Omitted fields keep their stored values. */
export const v2UpdateFileFolderBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    name: v2FileItemNameSchema.optional(),
    parentId: z.string().min(1, 'parentId cannot be empty').nullable().optional(),
    sortOrder: z.number().int('sortOrder must be an integer').min(0).optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.name === undefined && body.parentId === undefined && body.sortOrder === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['name'],
        message: 'At least one of name, parentId, or sortOrder is required',
      })
    }
  })

export type V2UpdateFileFolderBody = z.input<typeof v2UpdateFileFolderBodySchema>

export const v2DeleteFileFolderResultSchema = z.object({
  id: z.string(),
  deleted: z.literal(true),
  deletedItems: v2FileItemCountsSchema,
})

export type V2DeleteFileFolderResult = z.output<typeof v2DeleteFileFolderResultSchema>

export const v2RestoreFileFolderResultSchema = z.object({
  folder: v2FileFolderSchema,
  restoredItems: v2FileItemCountsSchema,
})

export type V2RestoreFileFolderResult = z.output<typeof v2RestoreFileFolderResultSchema>

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

export const v2UploadFileContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/files',
  query: v2UploadFileQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2FileSchema),
  },
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

export const v2RestoreFileContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/files/[fileId]/restore',
  params: v2FileParamsSchema,
  body: v2WorkspaceScopedBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2RestoreFileResultSchema),
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

export const v2BulkArchiveFileItemsContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/files/bulk-archive',
  body: v2BulkArchiveFileItemsBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2BulkArchiveFileItemsResultSchema),
  },
})

export const v2ListFileFoldersContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/files/folders',
  query: v2ListFileFoldersQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2FileFolderSchema),
  },
})

export const v2CreateFileFolderContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/files/folders',
  body: v2CreateFileFolderBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2FileFolderSchema),
  },
})

export const v2UpdateFileFolderContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/files/folders/[folderId]',
  params: v2FileFolderParamsSchema,
  body: v2UpdateFileFolderBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2FileFolderSchema),
  },
})

export const v2DeleteFileFolderContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/files/folders/[folderId]',
  params: v2FileFolderParamsSchema,
  query: v2FileWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2DeleteFileFolderResultSchema),
  },
})

export const v2RestoreFileFolderContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/files/folders/[folderId]/restore',
  params: v2FileFolderParamsSchema,
  body: v2WorkspaceScopedBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2RestoreFileFolderResultSchema),
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
