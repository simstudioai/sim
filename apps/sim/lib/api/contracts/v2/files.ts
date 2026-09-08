import { z } from 'zod'
import {
  isCanonicalBase64,
  noInputSchema,
  workspaceFileIdSchema,
  workspaceFileNameSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import {
  shareAuthTypeSchema,
  sharePasswordSchema,
  shareRecordSchema,
} from '@/lib/api/contracts/public-shares'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  V2_FALSE_VALUES,
  V2_FOLDER_FILTER_MISS,
  V2_TRUE_VALUES,
  v2CreateFolderBodySchema,
  v2CursorListResponse,
  v2DataResponse,
  v2DeleteFolderQuerySchema,
  v2FolderPathInputSchema,
  v2FolderPathSchema,
  v2FolderSchema,
  v2ListFoldersQuerySchema,
  v2NonRootFolderPathInputSchema,
  v2PaginationFields,
  v2RelocateFolderBodySchema,
  v2ResourceWebUrlSchema,
  v2SearchSchema,
  v2SortFields,
  v2TimestampSchema,
} from '@/lib/api/contracts/v2/shared'
import {
  v2PartUrlsBodySchema,
  v2PartUrlsDataSchema,
  v2UploadStatusSchema,
  v2UploadTokenHeadersSchema,
  v2UploadTransferSchema,
} from '@/lib/api/contracts/v2/uploads'
import { MAX_FOLDER_PATH_SEGMENTS } from '@/lib/folders/paths'
import { MAX_WORKSPACE_FILE_SIZE } from '@/lib/uploads/shared/types'
import { MAX_TEXT_EXTRACTION_BYTES } from '@/lib/uploads/utils/file-utils'
import { MAX_ZIP_DOWNLOAD_FILES } from '@/lib/workspace-files/limits'
import {
  FILE_SEARCH_DEFAULT_MAX_RESULTS,
  FILE_SEARCH_MAX_QUERY_LENGTH,
  FILE_SEARCH_MAX_RESULTS,
  FILE_SEARCH_MIN_QUERY_LENGTH,
} from '@/lib/workspace-files/search/constants'
import { FILE_SEARCH_MODES } from '@/lib/workspace-files/search/pattern'

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
export const v2FileSchema = z
  .object({
    id: z
      .string()
      .describe('Unique file identifier.')
      .meta({ examples: ['wf_V1StGXR8z5jdHi6BmyT91'] }),
    webUrl: v2ResourceWebUrlSchema,
    name: z
      .string()
      .describe('Original file name.')
      .meta({ examples: ['data.csv'] }),
    size: z
      .number()
      .nonnegative()
      .describe(
        'Size in bytes of the stored file. For a generated document (docx, pptx, pdf, xlsx) this is the generation source, not the rendered document, so it does not predict how many bytes downloading the file returns.'
      )
      .meta({ examples: [1024] }),
    type: z
      .string()
      .describe(
        'MIME type of the stored file. For a generated document (docx, pptx, pdf, xlsx) this is the generation source type, not the rendered document type a download serves.'
      )
      .meta({ examples: ['text/csv'] }),
    key: z
      .string()
      .describe('Storage key for the file.')
      .meta({ examples: ['workspace/example/data.csv'] }),
    /** Canonical containing-folder path; `/` means the workspace root. */
    folderPath: v2FolderPathSchema.describe(
      'Canonical containing-folder path. `/` is the workspace root.'
    ),
    uploadedByEmail: z
      .email({ pattern: z.regexes.html5Email })
      .describe('Current email address of the uploader.')
      .meta({ examples: ['jane@example.com'] }),
    /** ISO-8601 timestamp. */
    uploadedAt: z
      .string()
      .describe('ISO 8601 timestamp when the file was uploaded.')
      .meta({ format: 'date-time', examples: ['2026-01-15T10:30:00Z'] }),
    /** ISO-8601 timestamp; advances on content and metadata writes alike. */
    updatedAt: z
      .string()
      .describe('ISO 8601 timestamp of the last content or metadata write.')
      .meta({ format: 'date-time', examples: ['2026-01-15T10:30:00Z'] }),
    /** Non-null only for a file `DELETE` archived; see `scope` on the list. */
    deletedAt: z
      .string()
      .nullable()
      .describe(
        'ISO 8601 timestamp when the file was archived by deleting it, or null while the file is active. Only an archived-scope file list returns files with a non-null value.'
      )
      .meta({ format: 'date-time', examples: ['2026-01-16T09:00:00Z'] }),
  })
  .meta({
    id: 'V2File',
    title: 'Workspace file',
    description: 'A workspace file exposed by the public v2 API.',
  })

export type V2File = z.output<typeof v2FileSchema>

/**
 * Public share state. Reuses the internal {@link shareRecordSchema}, which is
 * already public-safe — `hasPassword` is a boolean and neither the ciphertext
 * nor the storage key is carried — with `url` tightened to a real URL.
 */
export const v2FileShareSchema = shareRecordSchema
  .extend({
    url: z
      .string()
      .url()
      .describe('Public share URL.')
      .meta({ examples: ['https://www.sim.ai/f/share-token-example'] }),
  })
  .meta({
    id: 'V2FileShare',
    title: 'File share',
    description: 'Public-safe share configuration for a workspace file.',
  })

export type V2FileShare = z.output<typeof v2FileShareSchema>

/** File metadata enriched with its current public-share configuration. */
export const v2FileMetadataSchema = v2FileSchema
  .extend({
    share: v2FileShareSchema
      .nullable()
      .describe('Current public-share state, or null when the file has never been shared.'),
  })
  .meta({
    id: 'V2FileMetadata',
    title: 'File metadata',
    description: 'Workspace file metadata and current public-share configuration.',
  })

export type V2FileMetadata = z.output<typeof v2FileMetadataSchema>

export const v2FileUploadParamsSchema = z.object({
  uploadId: z.string().min(1).describe('Upload session identifier.'),
})
export type V2FileUploadParams = z.output<typeof v2FileUploadParamsSchema>

export const v2CreateFileUploadBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace in which the file will be registered.'),
    name: workspaceFileNameSchema.describe('File name, including its extension.'),
    contentType: z
      .string()
      .trim()
      .min(1, 'contentType is required')
      .max(255)
      .describe('MIME type of the uploaded file.'),
    size: z
      .number()
      .int()
      .nonnegative()
      .max(MAX_WORKSPACE_FILE_SIZE)
      .describe('Exact file size in bytes.'),
    folderPath: v2FolderPathInputSchema
      .optional()
      .describe('Canonical destination folder path. Omit for the workspace root.'),
  })
  .strict()
export type V2CreateFileUploadBody = z.input<typeof v2CreateFileUploadBodySchema>

export const v2FileUploadWorkspaceQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the upload session.'),
  })
  .strict()
export type V2FileUploadWorkspaceQuery = z.output<typeof v2FileUploadWorkspaceQuerySchema>

export const v2FileUploadSchema = z
  .object({
    id: z.string().describe('Upload session identifier.'),
    status: v2UploadStatusSchema.describe('Current upload session status.'),
    name: z.string().describe('File name supplied when the session was created.'),
    contentType: z.string().describe('MIME type supplied when the session was created.'),
    size: z.number().int().nonnegative().describe('Expected file size in bytes.'),
    expiresAt: v2TimestampSchema.describe('ISO 8601 time when the upload session expires.'),
    error: z.string().nullable().describe('Failure message, or null when no failure has occurred.'),
    file: v2FileSchema
      .nullable()
      .describe('Registered file after finalization, or null before finalization completes.'),
  })
  .meta({
    id: 'V2FileUpload',
    title: 'File upload session',
    description: 'Current state of a resumable workspace-file upload session.',
  })
export type V2FileUpload = z.output<typeof v2FileUploadSchema>

export const v2CreateFileUploadDataSchema = z
  .object({
    session: v2FileUploadSchema.describe('New upload session.'),
    uploadToken: z
      .string()
      .min(1)
      .describe('Signed control token required by later upload-session requests.'),
    transfer: v2UploadTransferSchema.describe('Instructions for transferring the file bytes.'),
  })
  .strict()
  .meta({
    id: 'V2CreateFileUploadData',
    title: 'Create file upload data',
    description: 'A new file upload session, its control token, and byte-transfer instructions.',
  })
export type V2CreateFileUploadData = z.output<typeof v2CreateFileUploadDataSchema>

export const v2DeleteFileResultSchema = z
  .object({
    id: z.string().describe('Identifier of the deleted file.'),
    deleted: z.literal(true).describe('Confirms that the file was deleted.'),
  })
  .meta({
    id: 'V2DeleteFileResult',
    title: 'Delete file result',
    description: 'File deletion acknowledgement.',
  })

export type V2DeleteFileResult = z.output<typeof v2DeleteFileResultSchema>

export const v2FileParamsSchema = z.object({
  fileId: workspaceFileIdSchema.describe('File identifier.'),
})

export type V2FileParams = z.output<typeof v2FileParamsSchema>

export const v2CreateFileBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace in which to create the file.'),
    name: workspaceFileNameSchema.describe(
      'File name, including its extension. Path separators and dot segments are rejected.'
    ),
    contentType: z
      .string()
      .trim()
      .min(1, 'contentType cannot be empty')
      .max(255, 'contentType is too long')
      .describe('MIME type. When omitted, it is inferred from the file extension.')
      .optional(),
    folderPath: v2FolderPathInputSchema
      .optional()
      .describe('Canonical containing-folder path. Omit for the workspace root.'),
    content: z
      .string()
      .max(70_000_000, 'content is too large')
      .default('')
      .describe(
        'Initial file content. Omit or send an empty string for a zero-byte file. The 70,000,000-character bound guards the JSON envelope; the decoded bytes must be at most 50 MiB, and a longer base64 payload is rejected with `413`. Use an upload session for anything larger.'
      ),
    encoding: z
      .enum(['utf-8', 'base64'])
      .default('utf-8')
      .describe('Encoding of the content field.'),
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
 * Listing scopes, matching the internal surface. `all` is deliberately absent
 * on both: it drops the `deleted_at` predicate, so it cannot use the partial
 * index that serves the other two and degrades to a full workspace scan.
 */
export const v2FileScopeSchema = z.enum(['active', 'archived'])

export type V2FileScope = z.output<typeof v2FileScopeSchema>

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
    workspaceId: workspaceIdSchema.describe('Workspace whose files should be listed.'),
    /** Restrict to one file folder. Omit to list the whole workspace. */
    folderPath: v2FolderPathInputSchema
      .optional()
      .describe(
        `Restrict files to this folder, including subfolders when \`recursive\` is true. ${V2_FOLDER_FILTER_MISS}`
      ),
    /**
     * Descend into subfolders. Meaningful only alongside `folderPath`: with no folder filter
     * the listing already spans the workspace.
     *
     * Defaults to `true` when `search` is set and `false` otherwise, so the two verbs this
     * endpoint serves each get the scope they imply — listing a folder shows that folder,
     * searching one looks through everything in it. Send it explicitly to force either.
     *
     * `z.stringbool({ case: 'sensitive' })` rather than `z.coerce.boolean()`, which is
     * `Boolean(input)` over a query string and so reads `recursive=false` as `true` — see
     * `booleanQueryFlagSchema` in `contracts/primitives.ts`. Matches the sibling `recursive`
     * on folder delete: the accepted spellings are closed, published as an enum, and
     * case-sensitive, so an unpublished spelling is a `400` rather than a silent default.
     */
    recursive: z
      .stringbool({ case: 'sensitive' })
      .optional()
      .describe(
        'Include subfolders in the folder filter. Defaults to true when searching and false otherwise. Ignored without a folder filter.'
      )
      .meta({ enum: [...V2_TRUE_VALUES, ...V2_FALSE_VALUES] }),
    scope: v2FileScopeSchema
      .default('active')
      .describe(
        'Which lifecycle set to list: `active` (default) for live files, `archived` for files a delete soft-deleted. `folderPath` resolves against active folders only, so pairing it with `scope=archived` returns an empty page when the containing folder was archived too.'
      ),
    search: v2SearchSchema.describe('Case-insensitive substring match against the file name.'),
    ...v2SortFields(v2FileSortFields, { sortBy: 'uploadedAt', sortOrder: 'asc' }),
    ...v2PaginationFields({
      max: 1000,
      fallback: 100,
      outOfRange: 'clamp',
      description: 'Maximum files per page.',
    }),
  })
  .strict()

export type V2ListFilesQuery = z.output<typeof v2ListFilesQuerySchema>

/**
 * Resolves the `recursive` default the schema above promises: true alongside a search, false
 * otherwise, and whatever the caller sent when they sent one.
 *
 * Lives beside the `.describe()` that publishes the rule to every SDK and CLI rather than in
 * the route that applies it. The promise and the implementation were two modules apart with
 * nothing binding them, which is how a documented default drifts from the served one.
 */
export function listsSubfolders(query: { recursive?: boolean; search?: string }): boolean {
  return query.recursive ?? query.search !== undefined
}

/** Download/delete both target a single file within a workspace-scoped query. */
export const v2FileWorkspaceQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the file.'),
  })
  .strict()

export type V2FileWorkspaceQuery = z.output<typeof v2FileWorkspaceQuerySchema>

/**
 * Metadata read: the workspace scope plus the same `scope` lifecycle selector the
 * list endpoint uses, so a caller that found a file under `GET /files?scope=archived`
 * can read it back with the identical spelling.
 *
 * The default stays `active`, which keeps the read on the live set and continues to
 * answer `404` for a soft-deleted file. `scope` only relaxes the `deleted_at` predicate
 * on the row lookup — the workspace the file belongs to, the asserted-workspace check,
 * and the operation's authorization are unchanged, so it cannot widen who may read.
 */
export const v2GetFileMetadataQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the file.'),
    scope: v2FileScopeSchema
      .default('active')
      .describe(
        'Which lifecycle set to read from: `active` (default) resolves live files only and returns `404` for a file a delete soft-deleted; `archived` also resolves soft-deleted files, so metadata stays readable before the file is restored. Authorization is identical for both.'
      ),
  })
  .strict()

export type V2GetFileMetadataQuery = z.output<typeof v2GetFileMetadataQuerySchema>

export const v2RenameFileBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the file.'),
    name: workspaceFileNameSchema.describe('New file name, including its extension.'),
  })
  .strict()

export const v2RestoreFileBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the archived file.'),
  })
  .strict()

export type V2RestoreFileBody = z.input<typeof v2RestoreFileBodySchema>

export type V2RenameFileBody = z.input<typeof v2RenameFileBodySchema>

const fileSelectionSchema = {
  fileIds: z
    .array(z.string().min(1, 'fileIds entries cannot be empty'))
    .min(1)
    .max(1000)
    .describe('File identifiers to update.'),
}

export const v2MoveFileItemsBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace containing the files.'),
    ...fileSelectionSchema,
    /** Omission moves the files to the workspace root. */
    targetFolderPath: v2FolderPathInputSchema
      .optional()
      .describe('Destination folder path. Omit to move files to the workspace root.'),
  })
  .strict()

export type V2MoveFileItemsBody = z.input<typeof v2MoveFileItemsBodySchema>

export const v2MoveFileItemsResultSchema = z
  .object({
    movedItems: z
      .object({
        files: z.number().int().describe('Number of files moved.'),
      })
      .describe('Counts of file items moved by the request.'),
  })
  .meta({
    id: 'V2MoveFileItemsResult',
    title: 'Move file items result',
    description: 'Counts of workspace file items moved by the request.',
  })

export type V2MoveFileItemsResult = z.output<typeof v2MoveFileItemsResultSchema>

export const v2BulkDeleteFilesBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace containing the files.'),
    ...fileSelectionSchema,
  })
  .strict()

export type V2BulkDeleteFilesBody = z.input<typeof v2BulkDeleteFilesBodySchema>

export const v2BulkDeleteFilesResultSchema = z
  .object({
    deletedItems: z
      .object({
        files: z.number().int().describe('Number of files deleted.'),
      })
      .describe('Counts of file items deleted by the request.'),
  })
  .meta({
    id: 'V2BulkDeleteFilesResult',
    title: 'Bulk delete files result',
    description: 'Counts of workspace files deleted by the request.',
  })

export type V2BulkDeleteFilesResult = z.output<typeof v2BulkDeleteFilesResultSchema>

export const v2DeleteFileFolderDataSchema = z
  .object({
    path: v2FolderPathSchema.describe('Deleted folder path.'),
    deleted: z.literal(true).describe('Confirms that the folder was deleted.'),
    deletedItems: z
      .object({
        folders: z.number().int().describe('Number of folders deleted.'),
        files: z.number().int().describe('Number of files deleted.'),
      })
      .describe('Counts of folders and files deleted by the request.'),
  })
  .meta({
    id: 'V2DeleteFileFolderData',
    title: 'Delete file folder data',
    description: 'File-folder deletion acknowledgement and deletion counts.',
  })

/**
 * Extends the shared folder query with a lifecycle selector.
 *
 * Only workspace files have an archived folder set — tables, workflows, and
 * knowledge folders do not — so `scope` is added here rather than to the shared
 * schema, which would give three other surfaces a parameter they ignore.
 */
export const v2ListFileFoldersQuerySchema = v2ListFoldersQuerySchema
  .extend({
    scope: v2FileScopeSchema
      .default('active')
      .describe(
        'Which lifecycle set to list: `active` (default) returns live folders only; `archived` returns folders a recursive delete soft-deleted, which is how a caller finds a path to hand to the folder restore. Authorization is identical for both.'
      ),
    recursive: z
      .stringbool({ case: 'sensitive' })
      .optional()
      .describe('Whether parentPath includes every descendant instead of direct children only.')
      .meta({ enum: [...V2_TRUE_VALUES, ...V2_FALSE_VALUES] }),
    depth: z.coerce
      .number()
      .int()
      .min(1)
      .max(MAX_FOLDER_PATH_SEGMENTS)
      .optional()
      .describe('Deepest level below parentPath to include when recursive is true.'),
  })
  .superRefine((query, context) => {
    if (query.depth !== undefined && query.recursive !== true) {
      context.addIssue({
        code: 'custom',
        path: ['depth'],
        message: 'depth requires recursive=true',
      })
    }
  })
export type V2ListFileFoldersQuery = z.output<typeof v2ListFileFoldersQuerySchema>

export const v2ListFileFoldersContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/files/folders',
  query: v2ListFileFoldersQuerySchema,
  response: { mode: 'json', schema: v2CursorListResponse(v2FolderSchema, { paged: false }) },
})

export const v2RestoreFileFolderBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the archived folder.'),
    path: v2NonRootFolderPathInputSchema.describe(
      'Path of the archived folder to restore, as reported by an archived-scope folder list.'
    ),
  })
  .strict()
export type V2RestoreFileFolderBody = z.input<typeof v2RestoreFileFolderBodySchema>

export const v2RestoreFileFolderDataSchema = z
  .object({
    folder: v2FolderSchema.describe('The restored folder.'),
    restoredItems: z
      .object({
        files: z.number().int().nonnegative().describe('Files restored inside the folder tree.'),
        folders: z
          .number()
          .int()
          .nonnegative()
          .describe('Folders restored, including the one addressed.'),
      })
      .strict()
      .describe('What the restore brought back.'),
  })
  .strict()
  .meta({
    id: 'V2FileFolderRestore',
    title: 'Folder restore result',
    description: 'The restored folder and the counts of items it brought back.',
  })
export type V2FileFolderRestore = z.output<typeof v2RestoreFileFolderDataSchema>

/**
 * Restores a soft-deleted folder tree.
 *
 * `DELETE /api/v2/files/folders` archives recursively, so without this the
 * archived children were visible through `GET /api/v2/files?scope=archived`
 * but the folder structure itself was unrecoverable over the API.
 */
export const v2RestoreFileFolderContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/files/folders/restore',
  query: noInputSchema,
  body: v2RestoreFileFolderBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2RestoreFileFolderDataSchema),
  },
})

export const v2CreateFileFolderContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/files/folders',
  query: noInputSchema,
  body: v2CreateFolderBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2FolderSchema), status: 201 },
})

export const v2RelocateFileFolderContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/files/folders',
  query: noInputSchema,
  body: v2RelocateFolderBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2FolderSchema) },
})

export const v2DeleteFileFolderContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/files/folders',
  query: v2DeleteFolderQuerySchema,
  response: { mode: 'json', schema: v2DataResponse(v2DeleteFileFolderDataSchema) },
})

/**
 * The share resource as the read endpoint returns it: `null` when the file has
 * never been shared.
 */
export const v2NullableFileShareSchema = v2FileShareSchema.nullable()

export type V2NullableFileShare = z.output<typeof v2NullableFileShareSchema>

/**
 * Share upsert body. The internal surface accepts a caller-supplied `token` so
 * the UI can show a link before saving; v2 drops it. Over an API key it would
 * let a caller mint predictable public URLs, and a token collision surfaces as
 * an unhandled unique-index violation. v2 tokens are always server-generated.
 */
export const v2UpsertFileShareBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the file.'),
    isActive: z
      .boolean()
      .describe(
        'Whether the share should resolve. Disabling preserves the token and the whole access configuration, so re-enabling restores the share as it was; enabling rewrites the credentials the resulting mode does not use.'
      ),
    authType: shareAuthTypeSchema
      .optional()
      .describe(
        'How access to the share is gated. The stored mode is kept when omitted. Enabling `public` clears the stored password and empties `allowedEmails`; `password` empties `allowedEmails`; `email` and `sso` clear the stored password.'
      ),
    password: sharePasswordSchema
      .optional()
      .describe(
        'Password for a password-gated share. Kept when omitted; enabling `password` with neither a supplied nor a stored password is a 400.'
      ),
    allowedEmails: z
      .array(z.string().min(1, 'allowedEmails entries cannot be empty').max(320))
      .max(200, 'Too many allowed emails')
      .optional()
      .describe(
        'Allowed addresses or `@domain` patterns for email and SSO shares. Kept when omitted; enabling `email` or `sso` with an empty resulting list is a 400.'
      ),
  })
  .strict()

export type V2UpsertFileShareBody = z.input<typeof v2UpsertFileShareBodySchema>

/**
 * Content replace body. `content` is the whole new body of the file — this is a
 * replace, not an append. Base64 is the escape hatch for non-UTF-8 bytes.
 */
export const v2UpdateFileContentBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the file.'),
    content: z
      .string()
      .max(70_000_000, 'content is too large')
      .describe(
        'Complete replacement content for the file. The 70,000,000-character bound guards the JSON envelope; the decoded bytes must be at most 50 MiB, and a longer base64 payload is rejected with `413`.'
      ),
    encoding: z
      .enum(['utf-8', 'base64'])
      .default('utf-8')
      .describe('Encoding of the content field.'),
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
  query: noInputSchema,
  body: v2CreateFileBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2FileSchema),
    status: 201,
  },
})

export const v2CreateFileUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/files/uploads',
  query: noInputSchema,
  body: v2CreateFileUploadBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2CreateFileUploadDataSchema), status: 201 },
})

/**
 * Reads an upload session's current state so a caller can resume or abandon a
 * transfer it did not finish. Carries the same signed control token as the
 * other control legs: a session read is re-authorized exactly like a mutation.
 */
export const v2GetFileUploadContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/files/uploads/[uploadId]',
  params: v2FileUploadParamsSchema,
  query: v2FileUploadWorkspaceQuerySchema,
  headers: v2UploadTokenHeadersSchema,
  response: { mode: 'json', schema: v2DataResponse(v2FileUploadSchema) },
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

export const v2ReadFileTextQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the file.'),
    maxBytes: z.coerce
      .number()
      .int()
      .min(1, 'maxBytes must be at least 1')
      .max(MAX_TEXT_EXTRACTION_BYTES, `maxBytes cannot exceed ${MAX_TEXT_EXTRACTION_BYTES}`)
      .optional()
      .describe(
        'Optional ceiling on the source bytes fed to the parser, lowering but never raising the server limit.'
      ),
    offset: z.coerce
      .number()
      .int()
      .min(1, 'offset starts at line 1')
      .optional()
      .describe('First line to return, 1-based. Absent starts at the first line.'),
    limit: z.coerce
      .number()
      .int()
      .min(1, 'limit must be at least 1')
      .optional()
      .describe('How many lines to return from `offset`. Absent reads to the end.'),
  })
  .strict()
export type V2ReadFileTextQuery = z.output<typeof v2ReadFileTextQuerySchema>

export const v2FileTextSchema = z
  .object({
    fileId: workspaceFileIdSchema.describe('File the text was extracted from.'),
    name: z.string().describe('File name, including its extension.'),
    type: z.string().describe('Stored MIME type of the source file.'),
    text: z.string().describe('Extracted text.'),
    truncated: z
      .boolean()
      .describe('True when a parser limit stopped extraction before the input was exhausted.'),
    degraded: z
      .boolean()
      .describe(
        'True when text extraction did not fully succeed and `text` may be incomplete or synthesized from the raw bytes rather than read from the document. Never treat degraded text as authoritative content.'
      ),
    degradedReason: z
      .string()
      .nullable()
      .describe('Why extraction degraded, or null when it did not.'),
    charCount: z.number().int().nonnegative().describe('Length of `text` in characters.'),
    byteCount: z
      .number()
      .int()
      .nonnegative()
      .describe('Source bytes read from storage before extraction.'),
    lineRange: z
      .object({
        offset: z.number().int().min(1).describe('First line returned, 1-based.'),
        lineCount: z.number().int().nonnegative().describe('Lines returned.'),
        totalLines: z.number().int().nonnegative().describe('Lines the whole file holds.'),
        totalLinesExact: z
          .boolean()
          .describe(
            'False when text extraction was truncated, so `totalLines` counts only the extracted prefix and is not the end of the file.'
          ),
      })
      .strict()
      .optional()
      .describe(
        'Present when `offset` or `limit` narrowed the response. `totalLines` is what separates a file that ended from a window that stopped early.'
      ),
  })
  .strict()
  .meta({
    id: 'V2FileText',
    title: 'Extracted file text',
    description: 'Text extracted from a workspace file, with extraction-quality flags.',
  })
export type V2FileText = z.output<typeof v2FileTextSchema>

/**
 * Returns a file's text content, parsed out of the stored bytes.
 *
 * `degraded` is a required, non-optional boolean rather than an optional flag:
 * the legacy `doc` and `ppt` parsers return best-effort or placeholder content
 * instead of throwing, and a client that never checks an omittable field would
 * silently treat guessed text as extracted text.
 */
export const v2ReadFileTextContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/files/[fileId]/text',
  params: v2FileParamsSchema,
  query: v2ReadFileTextQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2FileTextSchema),
  },
})

export const v2GetFileContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/files/[fileId]/metadata',
  params: v2FileParamsSchema,
  query: v2GetFileMetadataQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2FileMetadataSchema),
  },
})

export const v2RenameFileContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/files/[fileId]',
  query: noInputSchema,
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

export const v2UnzipFileBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the archive.'),
  })
  .strict()
export type V2UnzipFileBody = z.input<typeof v2UnzipFileBodySchema>

/**
 * Counts plus the destination path, deliberately not the unpacked files.
 *
 * A large archive would otherwise materialize thousands of file objects into
 * one response body — the same unbounded-materialization hazard the list
 * endpoints exist to avoid. The caller pages
 * `GET /api/v2/files?folderPath=...` instead.
 */
export const v2UnzipFileDataSchema = z
  .object({
    folderPath: v2FolderPathSchema.describe(
      'Canonical path of the folder the archive was unpacked into. May differ from the archive name when a sibling folder already claimed it.'
    ),
    extractedFileCount: z
      .number()
      .int()
      .nonnegative()
      .describe('Number of files written into the destination folder.'),
    skippedFileCount: z
      .number()
      .int()
      .nonnegative()
      .describe('Number of archive entries skipped as unsafe, empty, or noise.'),
  })
  .strict()
  .meta({
    id: 'V2FileUnzipResult',
    title: 'Unzip result',
    description: 'Outcome of unzipping a workspace archive into a folder.',
  })
export type V2FileUnzipResult = z.output<typeof v2UnzipFileDataSchema>

/**
 * Unzips an archive into a new folder beside it.
 *
 * Named `unzip` because both other candidates are already taken on this
 * resource. `extract` reads as "extract text", which is what the sibling
 * `GET /api/v2/files/[fileId]/text` does. `unarchive` reads as the inverse of
 * `DELETE` + `POST /api/v2/files/[fileId]/restore`, since a soft-deleted file
 * is an *archived* file here and `GET /api/v2/files?scope=archived` lists them.
 * `unzip` collides with neither, and it is what the implementation calls
 * itself — the format is `.zip` and nothing else.
 */
export const v2UnzipFileContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/files/[fileId]/unzip',
  query: noInputSchema,
  params: v2FileParamsSchema,
  body: v2UnzipFileBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2UnzipFileDataSchema),
  },
})

export const v2RestoreFileContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/files/[fileId]/restore',
  query: noInputSchema,
  params: v2FileParamsSchema,
  body: v2RestoreFileBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2FileSchema),
  },
})

export const v2MoveFileItemsContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/files/move',
  query: noInputSchema,
  body: v2MoveFileItemsBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2MoveFileItemsResultSchema),
  },
})

/**
 * Comma-separated query list, bounded by the same ceiling the resolved
 * selection is held to. A looser cap here was a contract lie: a selection above
 * `MAX_ZIP_DOWNLOAD_FILES` passed validation, resolved, and only then answered
 * `400`, and a thousand comma-joined identifiers is a query string long enough
 * that a proxy answers `414` with a body that never reaches the v2 error
 * envelope.
 *
 * Comma-separated only: v2 rejects a query parameter sent more than once, so a
 * repeated-parameter form would never reach this schema.
 */
function v2QuerySelectionListSchema(field: string) {
  return z
    .string()
    .optional()
    .transform((value) =>
      (value ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
    .pipe(
      z
        .array(z.string().min(1))
        .max(
          MAX_ZIP_DOWNLOAD_FILES,
          `${field} cannot contain more than ${MAX_ZIP_DOWNLOAD_FILES} entries; a bulk download is limited to ${MAX_ZIP_DOWNLOAD_FILES} files.`
        )
    )
}

export const v2BulkDownloadFilesQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace containing the selection.'),
    fileIds: v2QuerySelectionListSchema('fileIds').describe(
      `File identifiers to include, comma-separated. At most ${MAX_ZIP_DOWNLOAD_FILES} entries.`
    ),
    folderPaths: v2QuerySelectionListSchema('folderPaths').describe(
      `Comma-separated folder paths whose contents are included recursively. Up to ${MAX_ZIP_DOWNLOAD_FILES} paths; resolved files share the ${MAX_ZIP_DOWNLOAD_FILES}-file download limit. Unknown paths are rejected.`
    ),
  })
  .strict()
export type V2BulkDownloadFilesQuery = z.output<typeof v2BulkDownloadFilesQuerySchema>

/**
 * Streams a selection of workspace files as one zip.
 *
 * Named `bulk-download` to match the existing `bulk-delete` sibling of the
 * `[fileId]` segment. A static segment here permanently shadows a file whose id
 * equals it, and `workspaceFileIdSchema` does accept `[A-Za-z0-9_-]+`; the
 * hyphenated form is chosen because neither minted id shape — UUID v4 or
 * `wf_<shortId>` — can ever produce it.
 */
export const v2BulkDownloadFilesContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/files/bulk-download',
  query: v2BulkDownloadFilesQuerySchema,
  response: { mode: 'binary' },
})

export const v2BulkDeleteFilesContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/files/bulk-delete',
  query: noInputSchema,
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
    schema: v2DataResponse(v2NullableFileShareSchema),
  },
})

/**
 * PATCH, not PUT: only `isActive` is required, and omitting `authType`,
 * `password`, or `allowedEmails` preserves whatever is already stored rather
 * than resetting it. The resource is not round-trippable either — the share
 * representation reports `hasPassword` and never the password itself, so a
 * client cannot construct a full replacement body from a prior read.
 *
 * Disabling with `{ isActive: false }` keeps the token and the whole access
 * configuration, so a later `{ isActive: true }` restores the share as it was.
 */
export const v2UpsertFileShareContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/files/[fileId]/share',
  query: noInputSchema,
  params: v2FileParamsSchema,
  body: v2UpsertFileShareBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2FileShareSchema),
  },
})

/**
 * Partial content edit body.
 *
 * `PUT` on the same path replaces the whole file; this changes part of it,
 * which is what makes correcting one line possible without regenerating
 * everything around it. Discriminated so a client narrows exhaustively.
 */
export const v2EditFileContentBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the file.'),
    edit: z
      .discriminatedUnion('mode', [
        z
          .object({
            mode: z.literal('search_replace').describe('Replace exact text.'),
            search: z
              .string()
              .min(1, 'search cannot be empty')
              .describe(
                'Exact text to replace, matched verbatim. It must appear once unless replaceAll is true.'
              ),
            content: z
              .string()
              .describe('Text to put in its place. An empty string deletes the matched text.'),
            replaceAll: z
              .boolean()
              .optional()
              .describe('Replace every non-overlapping match. Defaults to false.'),
          })
          .strict(),
        z
          .object({
            mode: z
              .literal('replace_between')
              .describe('Replace content between two complete-line anchors.'),
            beforeAnchor: z
              .string()
              .trim()
              .min(1, 'beforeAnchor cannot be empty')
              .describe('Boundary line before the replaced content. This line remains.'),
            afterAnchor: z
              .string()
              .trim()
              .min(1, 'afterAnchor cannot be empty')
              .describe('Boundary line after the replaced content. This line remains.'),
            content: z.string().describe('Replacement text. An empty string clears the interior.'),
            occurrence: z
              .number()
              .int('occurrence must be a whole number')
              .min(1, 'occurrence must be at least 1')
              .optional()
              .describe('Matching anchor occurrence, starting at 1. Defaults to 1.'),
          })
          .strict(),
        z
          .object({
            mode: z
              .literal('insert_after')
              .describe('Insert content after a complete-line anchor.'),
            anchor: z
              .string()
              .trim()
              .min(1, 'anchor cannot be empty')
              .describe('Complete line after which content is inserted.'),
            content: z.string().min(1, 'content cannot be empty').describe('Text to insert.'),
            occurrence: z
              .number()
              .int('occurrence must be a whole number')
              .min(1, 'occurrence must be at least 1')
              .optional()
              .describe('Matching anchor occurrence, starting at 1. Defaults to 1.'),
          })
          .strict(),
        z
          .object({
            mode: z
              .literal('delete_between')
              .describe('Delete from one complete-line anchor to another.'),
            startAnchor: z
              .string()
              .trim()
              .min(1, 'startAnchor cannot be empty')
              .describe('First line to delete. This start anchor is removed.'),
            endAnchor: z
              .string()
              .trim()
              .min(1, 'endAnchor cannot be empty')
              .describe('Ending boundary line. This end anchor remains.'),
            occurrence: z
              .number()
              .int('occurrence must be a whole number')
              .min(1, 'occurrence must be at least 1')
              .optional()
              .describe('Matching anchor occurrence, starting at 1. Defaults to 1.'),
          })
          .strict(),
      ])
      .describe(
        'One exact or anchor-based edit: search_replace, replace_between, insert_after, or delete_between.'
      ),
  })
  .strict()

export type V2EditFileContentBody = z.input<typeof v2EditFileContentBodySchema>

export const v2EditedFileSchema = z
  .object({
    file: v2FileSchema.describe('The file after the edit.'),
    lineCount: z.number().int().nonnegative().describe('Lines the file holds after the edit.'),
  })
  .strict()
  .meta({
    id: 'V2EditedFile',
    title: 'Edited file',
    description: 'A workspace file after an in-place content edit.',
  })

/**
 * Splits a comma-separated folder list, dropping blanks.
 *
 * Exported so the route splits exactly the way the schema validated, rather
 * than each side keeping its own idea of the separator.
 */
export function splitFolderPathList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

/**
 * Splits a comma-separated folder list and normalizes each entry.
 *
 * `v2FolderPathInputSchema` accepts a path with the leading slash omitted and
 * emits the canonical form. Validating with it and keeping the raw string
 * throws that normalization away, so `Reports` passed validation and then
 * reached folder resolution as `Reports`, which matches nothing.
 *
 * Entries are already known valid by the time the route calls this — the
 * schema's `superRefine` rejected the request otherwise — so a parse failure
 * here would be a contract bug, and the raw entry is kept rather than throwing
 * inside a mapper.
 */
export function parseFolderPathList(value: string): string[] {
  return splitFolderPathList(value).map((entry) => {
    const parsed = v2FolderPathInputSchema.safeParse(entry)
    return parsed.success ? parsed.data : entry
  })
}

export const v2SearchFileContentQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace to search.'),
    query: z
      .string()
      /*
       * Bounded in code points, not UTF-16 units, because that is how
       * `compileFileSearchPattern` counts. A length bound rejects a valid
       * 512-code-point query built from astral characters as overlong.
       */
      .refine(
        (query) => [...query].length >= FILE_SEARCH_MIN_QUERY_LENGTH,
        `query must be at least ${FILE_SEARCH_MIN_QUERY_LENGTH} characters`
      )
      .refine(
        (query) => [...query].length <= FILE_SEARCH_MAX_QUERY_LENGTH,
        `query cannot exceed ${FILE_SEARCH_MAX_QUERY_LENGTH} characters`
      )
      .refine((query) => !query.includes('\0'), 'query cannot contain NUL characters')
      .describe('Regular expression, or exact text when `mode` is `exact`.')
      /*
       * Published separately because the bounds above are refinements, which
       * emit no JSON-schema length keywords — a generated client would
       * otherwise see an unbounded string and send a query the route rejects.
       * Counted in code points at runtime; these are the same numbers.
       */
      .meta({
        minLength: FILE_SEARCH_MIN_QUERY_LENGTH,
        maxLength: FILE_SEARCH_MAX_QUERY_LENGTH,
      }),
    mode: z.enum(FILE_SEARCH_MODES).default('regex').describe('How `query` is read.'),
    maxResults: z.coerce
      .number()
      .int()
      .min(1)
      .max(FILE_SEARCH_MAX_RESULTS)
      .default(FILE_SEARCH_DEFAULT_MAX_RESULTS)
      .describe('Maximum matching lines to return.'),
    /*
     * Comma-separated, and parsed here rather than declared as an array:
     * this is a GET, so every value arrives as a string, and v2 rejects a
     * query parameter sent more than once — so a repeated-parameter array
     * would be refused before it ever reached a schema. Matches the sibling
     * selection lists on bulk download.
     */
    /*
     * Stays a comma-separated STRING through parsing, and is split by the
     * route. A transform to an array here would validate correctly and then
     * break serialization: the client's `appendQuery` runs over the PARSED
     * value and repeat-appends a scalar array, which v2 rejects as duplicate
     * query parameters — so every multi-folder search would answer 400.
     */
    folderPaths: z
      .string()
      .optional()
      .superRefine((value, ctx) => {
        if (value === undefined) return
        const entries = splitFolderPathList(value)
        if (entries.length === 0) {
          ctx.addIssue({ code: 'custom', message: 'folderPaths cannot be empty' })
          return
        }
        if (entries.length > 64) {
          ctx.addIssue({
            code: 'custom',
            message: 'folderPaths cannot contain more than 64 entries',
          })
          return
        }
        for (const entry of entries) {
          const parsed = v2FolderPathInputSchema.safeParse(entry)
          if (!parsed.success) {
            ctx.addIssue({ code: 'custom', message: `${entry} is not a valid folder path` })
          }
        }
      })
      .describe(
        'Folders the search is confined to, comma-separated. Absent searches the whole workspace. The scope also narrows `indexStatus`, so `complete` describes the folders searched rather than the workspace.'
      ),
    /*
     * `z.stringbool` rather than `z.boolean()`, which rejects every query
     * string, and rather than `z.coerce.boolean()`, which is `Boolean(input)`
     * and reads `includeSubfolders=false` as `true`. Matches the sibling
     * `recursive` on the file listing.
     */
    includeSubfolders: z
      .stringbool({ case: 'sensitive' })
      .optional()
      .describe(
        'Whether the scope descends into nested folders. Absent means yes. The listed spellings are the whole accepted vocabulary and are case-sensitive; any other value is rejected.'
      )
      .meta({ enum: [...V2_TRUE_VALUES, ...V2_FALSE_VALUES] }),
  })
  .strict()
export type V2SearchFileContentQuery = z.output<typeof v2SearchFileContentQuerySchema>

export const v2FileSearchResultsSchema = z
  .object({
    results: z
      .array(
        z
          .object({
            fileId: workspaceFileIdSchema.describe('File the line belongs to.'),
            lineNumber: z.number().int().min(1).describe('1-based line the match sits on.'),
            text: z.string().describe('The matching line.'),
          })
          .strict()
      )
      .describe('Matching lines, one entry per line.'),
    count: z.number().int().nonnegative().describe('Number of results returned.'),
    truncated: z.boolean().describe('True when more matches exist beyond `maxResults`.'),
    complete: z
      .boolean()
      .describe(
        'True when no files in the searched scope have pending or failed indexing. Missing matches remain inconclusive unless this is true and both `indexStatus.skippedFiles` and `indexStatus.partialFiles` are zero.'
      ),
    indexStatus: z
      .object({
        readyFiles: z
          .number()
          .int()
          .nonnegative()
          .describe('Files whose current revision is indexed and searchable.'),
        pendingFiles: z
          .number()
          .int()
          .nonnegative()
          .describe(
            'Files not yet indexed at their current revision. Their content was not searched.'
          ),
        failedFiles: z
          .number()
          .int()
          .nonnegative()
          .describe('Files whose indexing failed. Their content was not searched.'),
        skippedFiles: z
          .number()
          .int()
          .nonnegative()
          .describe(
            'Files deliberately not indexed, such as binaries and files above the size ceiling.'
          ),
        partialFiles: z
          .number()
          .int()
          .nonnegative()
          .describe(
            'Files indexed only in part, so matches beyond the indexed portion are not found.'
          ),
      })
      .strict()
      .describe('Index coverage across the searched scope.'),
  })
  .strict()
  .meta({
    id: 'V2FileSearchResults',
    title: 'File search results',
    description: 'Matching lines from indexed workspace file content, with index coverage.',
  })

/**
 * Searches the indexed text of workspace files.
 *
 * Index-backed, so coverage is reported rather than assumed: `complete` and
 * `indexStatus` are what separate "this is not in the files" from "the index
 * has not caught up yet", and only the first of those is safe to act on.
 */
export const v2SearchFileContentContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/files/search',
  query: v2SearchFileContentQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2FileSearchResultsSchema),
  },
})

export const v2EditFileContentContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/files/[fileId]/content',
  query: noInputSchema,
  params: v2FileParamsSchema,
  body: v2EditFileContentBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2EditedFileSchema),
  },
})

export const v2UpdateFileContentContract = defineRouteContract({
  method: 'PUT',
  path: '/api/v2/files/[fileId]/content',
  query: noInputSchema,
  params: v2FileParamsSchema,
  body: v2UpdateFileContentBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2FileSchema),
  },
})
