import { PASTE_LIMITS, utf8ByteLength } from '@sim/utils/paste'
import { z } from 'zod'
import {
  booleanQueryFlagSchema,
  folderIdSchema,
  inlineFileRefQuerySchema,
  isCanonicalBase64,
  workspaceFileNameSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { shareRecordSchema } from '@/lib/api/contracts/public-shares'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { V2_SEARCH_MAX_LENGTH } from '@/lib/api/contracts/v2/shared'
import { LIST_SORT_ORDERS } from '@/lib/api/list-query'

/**
 * Client-reachable listing scopes. `all` is deliberately excluded: it drops the
 * `deleted_at` predicate, so it cannot use the partial index that serves the
 * other two and degrades to a full workspace scan. No client requests it, and
 * server-side callers reach that scope directly rather than over the wire.
 */
export const workspaceFileScopeSchema = z.enum(['active', 'archived'])

export const workspaceFilesParamsSchema = z.object({
  id: workspaceIdSchema,
})

export const workspaceFileParamsSchema = workspaceFilesParamsSchema.extend({
  fileId: z.string({ error: 'File ID is required' }).min(1, 'File ID is required'),
})

/** The fields a paged list sorts by: the v2 list's, which the shared keyset implements. */
const WORKSPACE_FILE_SORT_FIELDS = ['name', 'size', 'uploadedAt', 'updatedAt'] as const

/** The largest page `GET /api/workspaces/[id]/files` serves when paging. */
const MAX_WORKSPACE_FILE_PAGE_SIZE = 500

/** A folder filter in the browser's addressing: `root` for the workspace root, else a folder id. */
const workspaceFileFolderFilterSchema = z
  .union([z.literal('root'), folderIdSchema])
  .transform((value) => (value === 'root' ? null : value))

/**
 * The list's paging parameters. Sending any of them asks for one bounded page (default sort
 * `uploadedAt` ascending, the unpaged order, and 100 files) answered with `nextCursor`; sending
 * none keeps the unpaged response, which returns the whole scope.
 */
export const WORKSPACE_FILE_PAGE_PARAMS = [
  'folderId',
  'sortBy',
  'sortOrder',
  'limit',
  'cursor',
] as const

export const listWorkspaceFilesQuerySchema = z.object({
  scope: workspaceFileScopeSchema.default('active'),
  /** The folder to list directly (not its subfolders); `root` for root files. Omit for every folder. */
  folderId: workspaceFileFolderFilterSchema.optional(),
  sortBy: z.enum(WORKSPACE_FILE_SORT_FIELDS).optional(),
  sortOrder: z.enum(LIST_SORT_ORDERS).optional(),
  limit: z.coerce
    .number({ error: 'limit must be a number' })
    .int('limit must be a whole number')
    .min(1, 'limit must be at least 1')
    .max(MAX_WORKSPACE_FILE_PAGE_SIZE, `limit cannot exceed ${MAX_WORKSPACE_FILE_PAGE_SIZE}`)
    .optional(),
  /** The previous page's `nextCursor`, sent back with the same scope, folder, and sort. */
  cursor: z.string().min(1, 'cursor must be a non-empty token').optional(),
})

/**
 * Binary stream of an image embedded in a workspace markdown document, scoped to the
 * workspace in the path. The route serves the bytes only when the referenced file is a
 * `workspace` file belonging to `[id]` — cross-workspace references do not resolve.
 */
export const getInlineWorkspaceFileContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/files/inline',
  params: workspaceFilesParamsSchema,
  query: inlineFileRefQuerySchema,
  response: {
    mode: 'binary',
  },
})

export const renameWorkspaceFileBodySchema = z.object({
  name: workspaceFileNameSchema,
})

export const renameWorkspaceFileErrorSchema = z.union([
  z.object({ error: z.string() }),
  z.object({ error: z.string(), details: z.array(z.unknown()) }),
  z.object({ success: z.literal(false), error: z.string() }),
])

export const updateWorkspaceFileContentBodySchema = z
  .object({
    content: z.string().max(70_000_000, 'Content is too large'),
    encoding: z.enum(['base64', 'utf-8']).optional(),
    /** The content-version timestamp returned with the bytes this edit was based on. */
    expectedUpdatedAt: z.iso.datetime().optional(),
  })
  .superRefine(({ content, encoding }, ctx) => {
    if (encoding === 'base64' && !isCanonicalBase64(content)) {
      ctx.addIssue({
        code: 'custom',
        path: ['content'],
        message: 'Content must be valid base64',
      })
    }
  })

export const createWorkspaceFileBodySchema = z
  .object({
    name: workspaceFileNameSchema,
    contentType: z
      .string()
      .trim()
      .min(1, 'Content type cannot be empty')
      .max(255, 'Content type is too long')
      .optional(),
    folderId: folderIdSchema.optional(),
    content: z.string().max(70_000_000, 'Content is too large').default(''),
    encoding: z.enum(['utf-8', 'base64']).default('utf-8'),
  })
  .superRefine(({ content, encoding }, ctx) => {
    if (encoding === 'base64' && !isCanonicalBase64(content)) {
      ctx.addIssue({
        code: 'custom',
        path: ['content'],
        message: 'Content must be valid base64',
      })
    }
  })
  .strict()

export type CreateWorkspaceFileBody = z.input<typeof createWorkspaceFileBodySchema>

export type UpdateWorkspaceFileContentBody = z.input<typeof updateWorkspaceFileContentBodySchema>

export const exportWorkspaceFileSnapshotBodySchema = z.object({
  content: z
    .string()
    .max(PASTE_LIMITS.RICH_MARKDOWN_BYTES, 'Markdown snapshot is too large')
    .refine(
      (content) =>
        utf8ByteLength(content, PASTE_LIMITS.RICH_MARKDOWN_BYTES) <=
        PASTE_LIMITS.RICH_MARKDOWN_BYTES,
      'Markdown snapshot is too large'
    ),
})

export type ExportWorkspaceFileSnapshotBody = z.input<typeof exportWorkspaceFileSnapshotBodySchema>

export const exportWorkspaceFileSnapshotContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/files/[fileId]/export',
  params: workspaceFileParamsSchema,
  body: exportWorkspaceFileSnapshotBodySchema,
  response: { mode: 'binary' },
})

/** No real image approaches this; the bound rejects absurd or hostile values on the backfill path. */
const IMAGE_DIMENSION_MAX = 100_000

export const updateWorkspaceFileDimensionsBodySchema = z.object({
  /**
   * The storage key the client measured. The write commits only if the row still has this key — a
   * content-version guard: the key changes on every content replacement, so a stale in-flight write for
   * superseded bytes is rejected rather than persisting the old aspect ratio.
   */
  key: z.string().min(1, 'key is required'),
  width: z.number().int().positive().max(IMAGE_DIMENSION_MAX),
  height: z.number().int().positive().max(IMAGE_DIMENSION_MAX),
})

export type UpdateWorkspaceFileDimensionsBody = z.input<
  typeof updateWorkspaceFileDimensionsBodySchema
>

export const workspaceFileRecordSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  key: z.string(),
  path: z.string(),
  url: z.string().optional(),
  size: z.number(),
  type: z.string(),
  /** Intrinsic image dimensions (px), populated lazily; null for non-images/un-backfilled rows. */
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  uploadedBy: z.string(),
  folderId: z.string().nullable(),
  folderPath: z.string().nullable().optional(),
  deletedAt: z.coerce.date().nullable().optional(),
  uploadedAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  /** Advances only when file bytes change; metadata edits do not invalidate text drafts. */
  contentUpdatedAt: z.coerce.date().nullable().optional(),
  revision: z.string().optional(),
  storageContext: z.enum(['workspace', 'mothership']).optional(),
  vfsNamespace: z.enum(['uploads', 'tests', 'changelog']).optional(),
  share: shareRecordSchema.nullable().optional(),
})

const workspaceFileSuccessSchema = z.object({
  success: z.boolean(),
})

const listWorkspaceFilesResponseSchema = workspaceFileSuccessSchema.extend({
  files: z.array(workspaceFileRecordSchema),
  /** Present only on a paged request: the next page's cursor, `null` on the last page. */
  nextCursor: z.string().nullable().optional(),
})

export type ListWorkspaceFilesResponse = z.output<typeof listWorkspaceFilesResponseSchema>

export const extractWorkspaceFileResponseSchema = workspaceFileSuccessSchema.extend({
  folderName: z.string(),
  extractedCount: z.number().int().nonnegative(),
  skippedCount: z.number().int().nonnegative(),
})

export const listWorkspaceFilesContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/files',
  params: workspaceFilesParamsSchema,
  query: listWorkspaceFilesQuerySchema,
  response: {
    mode: 'json',
    schema: listWorkspaceFilesResponseSchema,
  },
})

const MAX_WORKSPACE_FILE_SEARCH_RESULTS = 50

const searchWorkspaceFilesQuerySchema = z.object({
  q: z.string().trim().min(1, 'q cannot be empty').max(V2_SEARCH_MAX_LENGTH, 'q is too long'),
  /** Confine the search to this folder (`root` for the workspace root). Omit to search everywhere. */
  folderId: workspaceFileFolderFilterSchema.optional(),
  /** Whether the folder's subfolders are searched too. Ignored without `folderId`. */
  recursive: booleanQueryFlagSchema.default(true),
  limit: z.coerce
    .number({ error: 'limit must be a number' })
    .int('limit must be a whole number')
    .min(1, 'limit must be at least 1')
    .max(
      MAX_WORKSPACE_FILE_SEARCH_RESULTS,
      `limit cannot exceed ${MAX_WORKSPACE_FILE_SEARCH_RESULTS}`
    )
    .default(20),
})

const searchWorkspaceFilesResponseSchema = workspaceFileSuccessSchema.extend({
  /** Live files whose name contains `q` (case-insensitive), by name; each carries `folderPath`. */
  files: z.array(workspaceFileRecordSchema),
})

/** GET — case-insensitive file-name search within a workspace, optionally within one folder. */
export const searchWorkspaceFilesContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/files/search',
  params: workspaceFilesParamsSchema,
  query: searchWorkspaceFilesQuerySchema,
  response: { mode: 'json', schema: searchWorkspaceFilesResponseSchema },
})

/** The most entries each of a lookup's `ids`, `keys`, and `references` may carry. */
export const MAX_WORKSPACE_FILE_LOOKUP_ENTRIES = 100

const lookupEntriesSchema = (field: string) =>
  z
    .array(
      z.string().min(1, `${field} entries cannot be empty`).max(1024, `${field} entry is too long`)
    )
    .max(
      MAX_WORKSPACE_FILE_LOOKUP_ENTRIES,
      `${field} cannot exceed ${MAX_WORKSPACE_FILE_LOOKUP_ENTRIES} entries`
    )
    .optional()

const lookupWorkspaceFilesBodySchema = z
  .object({
    ids: lookupEntriesSchema('ids'),
    /** Storage keys (`workspace/<workspaceId>/…`). */
    keys: lookupEntriesSchema('keys'),
    /** Ids, VFS paths (`files/<folder>/<name>`), or bare names, resolved as the agent resolves them. */
    references: lookupEntriesSchema('references'),
  })
  .strict()
  .refine(
    (body) =>
      (body.ids?.length ?? 0) + (body.keys?.length ?? 0) + (body.references?.length ?? 0) > 0,
    { message: 'Provide at least one id, key, or reference' }
  )

const lookupWorkspaceFilesResponseSchema = workspaceFileSuccessSchema.extend({
  /** Every live file any id, key, or reference resolved to, once each. Misses are absent. */
  files: z.array(workspaceFileRecordSchema),
  /** Per requested reference, in request order (deduplicated): the file it resolved to, or `null`. */
  references: z.array(z.object({ reference: z.string(), fileId: z.string().nullable() })),
})

/** POST — resolve a bounded batch of live workspace files by id, storage key, or reference. */
export const lookupWorkspaceFilesContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/files/lookup',
  params: workspaceFilesParamsSchema,
  body: lookupWorkspaceFilesBodySchema,
  response: { mode: 'json', schema: lookupWorkspaceFilesResponseSchema },
})

const workspaceFileFolderStatsQuerySchema = z.object({
  /** The folder whose child folders to report: `root` (default) or a folder id. */
  parentId: workspaceFileFolderFilterSchema.default('root'),
})

const workspaceFileFolderStatsResponseSchema = workspaceFileSuccessSchema.extend({
  /** One entry per direct child folder of `parentId`, totals covering its whole subtree. */
  folders: z.array(
    z.object({
      folderId: z.string(),
      fileCount: z.number().int().nonnegative(),
      sizeBytes: z.number().int().nonnegative(),
    })
  ),
})

/** GET — live file count and bytes under each child folder of `parentId`, subtrees rolled up. */
export const workspaceFileFolderStatsContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/files/folder-stats',
  params: workspaceFilesParamsSchema,
  query: workspaceFileFolderStatsQuerySchema,
  response: { mode: 'json', schema: workspaceFileFolderStatsResponseSchema },
})

export const createWorkspaceFileContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/files',
  params: workspaceFilesParamsSchema,
  body: createWorkspaceFileBodySchema,
  response: {
    mode: 'json',
    schema: workspaceFileSuccessSchema.extend({
      file: workspaceFileRecordSchema,
    }),
    status: 201,
  },
})

/** Authorized file-by-id reads also admit chat attachments without listing or write access. */
export const readWorkspaceFileContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/files/[fileId]',
  params: workspaceFileParamsSchema,
  response: {
    mode: 'json',
    schema: workspaceFileSuccessSchema.extend({ file: workspaceFileRecordSchema }),
  },
})

export const renameWorkspaceFileContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/workspaces/[id]/files/[fileId]',
  params: workspaceFileParamsSchema,
  body: renameWorkspaceFileBodySchema,
  response: {
    mode: 'json',
    schema: workspaceFileSuccessSchema.extend({
      file: workspaceFileRecordSchema,
    }),
  },
  error: renameWorkspaceFileErrorSchema,
})

export const extractWorkspaceFileContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/files/[fileId]/extract',
  params: workspaceFileParamsSchema,
  response: {
    mode: 'json',
    schema: extractWorkspaceFileResponseSchema,
  },
})

export const updateWorkspaceFileDimensionsContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/workspaces/[id]/files/[fileId]/dimensions',
  params: workspaceFileParamsSchema,
  body: updateWorkspaceFileDimensionsBodySchema,
  response: {
    mode: 'json',
    // `success` reflects whether the row was actually written: false when the content-version guard
    // rejected the write (the storage key changed since the client measured), not just on error.
    schema: z.object({ success: z.boolean() }),
  },
})

export const deleteWorkspaceFileContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/workspaces/[id]/files/[fileId]',
  params: workspaceFileParamsSchema,
  response: {
    mode: 'json',
    schema: workspaceFileSuccessSchema,
  },
})

export const restoreWorkspaceFileContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/files/[fileId]/restore',
  params: workspaceFileParamsSchema,
  response: {
    mode: 'json',
    schema: workspaceFileSuccessSchema,
  },
})

export const updateWorkspaceFileContentContract = defineRouteContract({
  method: 'PUT',
  path: '/api/workspaces/[id]/files/[fileId]/content',
  params: workspaceFileParamsSchema,
  body: updateWorkspaceFileContentBodySchema,
  response: {
    mode: 'json',
    schema: workspaceFileSuccessSchema.extend({
      file: workspaceFileRecordSchema,
    }),
  },
})

export const downloadWorkspaceFileUrlContract = defineRouteContract({
  method: 'POST',
  path: '/api/workspaces/[id]/files/[fileId]/download',
  params: workspaceFileParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      downloadUrl: z.string().min(1),
      viewerUrl: z.string().min(1),
      fileName: z.string().min(1),
      expiresIn: z.null(),
    }),
  },
})

const documentStyleSummarySchema = z
  .object({
    format: z.enum(['docx', 'pptx', 'pdf']),
    // OOXML theme — present for pptx, present for docx when theme1.xml exists, absent for pdf
    theme: z
      .object({
        colors: z.record(z.string(), z.string()),
        fonts: z.object({ major: z.string(), minor: z.string() }),
      })
      .optional(),
    // docx only
    styles: z.array(z.object({}).passthrough()).optional(),
    defaults: z.object({ fontSize: z.number().optional(), font: z.string().optional() }).optional(),
    // pdf only
    pageSize: z
      .object({
        preset: z.enum(['A4', 'letter', 'custom']),
        widthPt: z.number().optional(),
        heightPt: z.number().optional(),
      })
      .optional(),
    fonts: z.array(z.string()).optional(),
    // pptx only
    slideCount: z.number().optional(),
    aspectRatio: z.enum(['16:9', '4:3', 'custom']).optional(),
    background: z.string().optional(),
  })
  .passthrough()

export const workspaceFileStyleContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/files/[fileId]/style',
  params: workspaceFileParamsSchema,
  response: {
    mode: 'json',
    schema: documentStyleSummarySchema,
  },
})
