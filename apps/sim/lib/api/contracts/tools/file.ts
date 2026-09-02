import { z } from 'zod'
import { privateSecretProvenanceBundleSchema } from '@/lib/api/contracts/primitives'
import { shareAuthTypeSchema } from '@/lib/api/contracts/public-shares'
import { toolJsonResponseSchema } from '@/lib/api/contracts/tools/media/shared'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2FolderPathInputSchema,
  v2NonRootFolderPathInputSchema,
} from '@/lib/api/contracts/v2/shared'
import { PRIVATE_SECRET_PROVENANCE_FIELD } from '@/lib/execution/private-tool-metadata'
import { MAX_FOLDER_PATH_SEGMENTS } from '@/lib/folders/paths'
import { MAX_WORKSPACE_FILE_BULK_REQUEST_IDS } from '@/lib/workspace-files/limits'

export const fileManageQuerySchema = z.object({
  userId: z.string().min(1).nullable().optional(),
  workspaceId: z.string().min(1).nullable().optional(),
})

const fileIdSelectionSchema = z.union([
  z.string().min(1),
  z.array(z.string().min(1)).min(1).max(MAX_WORKSPACE_FILE_BULK_REQUEST_IDS, 'Too many file IDs'),
])
const fileFolderPathsSchema = z
  .array(v2FolderPathInputSchema)
  .min(1, 'At least one folder is required')
  .max(64, 'Too many folders')

function validateFolderTarget(
  data: { folderPath?: string; folderPaths?: string[] },
  context: z.RefinementCtx
): void {
  if (data.folderPath !== undefined && data.folderPaths !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['folderPaths'],
      message: 'Provide folderPath or folderPaths, not both',
    })
  }
}

export const fileManageWriteBodySchema = z
  .object({
    operation: z.literal('write'),
    workspaceId: z.string().min(1).optional(),
    fileName: z.string().min(1).optional(),
    folderPath: v2FolderPathInputSchema.optional(),
    content: z.string().optional(),
    /**
     * An existing file object to store as-is, for content that is not text —
     * a rendered PDF, a transcoded video, an image from an earlier tool.
     */
    fileInput: z.unknown().optional(),
    contentType: z.string().optional(),
    overwrite: z.boolean().optional(),
    [PRIVATE_SECRET_PROVENANCE_FIELD]: privateSecretProvenanceBundleSchema.optional(),
  })
  .superRefine((body, context) => {
    const hasContent = body.content !== undefined
    const hasFileInput = body.fileInput !== undefined && body.fileInput !== null
    if (hasContent === hasFileInput) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message:
          'Provide exactly one of content (text to write) or fileInput (an existing file to store).',
      })
    }
    // A file object carries its own name, so fileName is the optional override
    // there but the only source of a name when writing text.
    if (hasContent && !body.fileName?.trim()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fileName'],
        message: 'fileName is required when writing text content.',
      })
    }
  })

export const fileManageAppendBodySchema = z
  .object({
    operation: z.literal('append'),
    workspaceId: z.string().min(1).optional(),
    fileName: z.string({ error: 'fileName is required for append operation' }).min(1),
    /** Folder(s) the name is resolved inside, singular retained for existing callers. */
    folderPath: v2FolderPathInputSchema.optional(),
    folderPaths: fileFolderPathsSchema.optional(),
    includeSubfolders: z.boolean().optional(),
    content: z.string({ error: 'content is required for append operation' }),
    [PRIVATE_SECRET_PROVENANCE_FIELD]: privateSecretProvenanceBundleSchema.optional(),
  })
  .superRefine(validateFolderTarget)

export const fileManageGetBodySchema = z
  .object({
    operation: z.literal('get'),
    workspaceId: z.string().min(1).optional(),
    fileId: z.string().min(1).optional(),
    fileInput: z.unknown().optional(),
  })
  .refine((data) => data.fileId !== undefined || data.fileInput !== undefined, {
    message: 'Either fileId or fileInput is required for get operation',
  })

export const fileManageMoveBodySchema = z.object({
  operation: z.literal('move'),
  workspaceId: z.string().min(1).optional(),
  fileId: z.string().min(1, 'fileId is required for move operation'),
  /**
   * Canonical percent-encoded destination folder, and the form every other
   * folder field uses. Takes precedence over {@link targetFolder}.
   */
  folderPath: v2FolderPathInputSchema.optional(),
  /**
   * Destination as decoded segments joined by `/`. Retained for callers that
   * predate `folderPath`, but it cannot express a folder whose own name
   * contains a slash, so new callers send `folderPath`.
   */
  targetFolder: z.string().optional().default(''),
})

export type FileManageMoveBody = z.input<typeof fileManageMoveBodySchema>

export const fileManageSharingBodySchema = z
  .object({
    operation: z.literal('manage_sharing'),
    workspaceId: z.string().min(1).optional(),
    fileId: z.string().min(1).optional(),
    fileInput: z.unknown().optional(),
    isActive: z.boolean({ error: 'isActive is required for manage_sharing operation' }),
    authType: shareAuthTypeSchema.optional(),
    password: z.string().min(1).max(1024).optional(),
    allowedEmails: z.array(z.string().min(1)).max(200).optional(),
  })
  .refine((data) => data.fileId !== undefined || data.fileInput !== undefined, {
    message: 'Either fileId or fileInput is required for manage_sharing operation',
  })

export type FileManageSharingBody = z.input<typeof fileManageSharingBodySchema>

export const fileManageReadBodySchema = z
  .object({
    operation: z.literal('read'),
    /**
     * Folders whose files are included, expanded to the files they contain when
     * the workflow runs rather than when it is configured — so a folder means
     * whatever is inside it at run time.
     */
    folderPaths: fileFolderPathsSchema.optional(),
    /**
     * Whether folder expansion descends into nested folders. Absent means yes —
     * a folder normally stands for everything under it, and this narrows that
     * to its direct files.
     */
    includeSubfolders: z.boolean().optional(),
    workspaceId: z.string().min(1).optional(),
    fileId: fileIdSelectionSchema.optional(),
    fileInput: z.unknown().optional(),
  })
  .refine(
    (data) =>
      data.fileId !== undefined ||
      data.fileInput !== undefined ||
      (data.folderPaths?.length ?? 0) > 0,
    { message: 'read requires fileId, fileInput, or folderPaths' }
  )

export const fileManageContentBodySchema = z
  .object({
    operation: z.literal('content'),
    /**
     * Folders whose files are included, expanded to the files they contain when
     * the workflow runs rather than when it is configured — so a folder means
     * whatever is inside it at run time.
     */
    folderPaths: fileFolderPathsSchema.optional(),
    /**
     * Whether folder expansion descends into nested folders. Absent means yes —
     * a folder normally stands for everything under it, and this narrows that
     * to its direct files.
     */
    includeSubfolders: z.boolean().optional(),
    workspaceId: z.string().min(1).optional(),
    fileId: fileIdSelectionSchema.optional(),
    fileInput: z.unknown().optional(),
    /**
     * First line to return, 1-based. Applied to each selected file separately,
     * because a selection can be several files and one running offset across
     * them would depend on an ordering the caller cannot see.
     */
    offset: z.number().int().min(1, 'offset starts at line 1').optional(),
    /** How many lines to return from `offset`. Absent reads to the end. */
    limit: z.number().int().min(1, 'limit must be at least 1').optional(),
  })
  .refine(
    (data) =>
      data.fileId !== undefined ||
      data.fileInput !== undefined ||
      (data.folderPaths?.length ?? 0) > 0,
    { message: 'content requires fileId, fileInput, or folderPaths' }
  )

export const fileManageCompressBodySchema = z
  .object({
    operation: z.literal('compress'),
    /**
     * Folders whose files are included, expanded to the files they contain when
     * the workflow runs rather than when it is configured — so a folder means
     * whatever is inside it at run time.
     */
    folderPaths: fileFolderPathsSchema.optional(),
    /**
     * Whether folder expansion descends into nested folders. Absent means yes —
     * a folder normally stands for everything under it, and this narrows that
     * to its direct files.
     */
    includeSubfolders: z.boolean().optional(),
    workspaceId: z.string().min(1).optional(),
    fileId: fileIdSelectionSchema.optional(),
    fileInput: z.unknown().optional(),
    archiveName: z.string().min(1).max(255).optional(),
  })
  .refine(
    (data) =>
      data.fileId !== undefined ||
      data.fileInput !== undefined ||
      (data.folderPaths?.length ?? 0) > 0,
    { message: 'compress requires fileId, fileInput, or folderPaths' }
  )

export const fileManageDecompressBodySchema = z
  .object({
    operation: z.literal('decompress'),
    workspaceId: z.string().min(1).optional(),
    fileId: z.string().min(1).optional(),
    fileInput: z.unknown().optional(),
  })
  .refine((data) => data.fileId !== undefined || data.fileInput !== undefined, {
    message: 'Either fileId or fileInput is required for decompress operation',
  })

const fileFolderDepthSchema = z
  .number()
  .int()
  .min(1, 'depth must be at least 1')
  .max(MAX_FOLDER_PATH_SEGMENTS, `depth cannot exceed ${MAX_FOLDER_PATH_SEGMENTS}`)

/**
 * The listing is capped rather than unbounded: it now includes files, and a
 * workspace can hold far more of those than folders. A cut listing reports
 * `truncated` instead of quietly looking complete.
 */
export const DEFAULT_FILE_LIST_LIMIT = 200
export const MAX_FILE_LIST_LIMIT = 1000

export const fileManageListBodySchema = z.object({
  operation: z.literal('list'),
  workspaceId: z.string().min(1).optional(),
  path: v2FolderPathInputSchema.optional(),
  recursive: z.boolean().optional(),
  depth: fileFolderDepthSchema.optional(),
  search: z.string().min(1).max(200).optional(),
  limit: z
    .number()
    .int()
    .min(1, 'limit must be at least 1')
    .max(MAX_FILE_LIST_LIMIT, `limit cannot exceed ${MAX_FILE_LIST_LIMIT}`)
    .optional(),
})

export const fileManageCreateFolderBodySchema = z.object({
  operation: z.literal('create_folder'),
  workspaceId: z.string().min(1).optional(),
  path: v2NonRootFolderPathInputSchema,
})

export const fileManageUpdateFolderBodySchema = z.object({
  operation: z.literal('update_folder'),
  workspaceId: z.string().min(1).optional(),
  path: v2NonRootFolderPathInputSchema,
  destinationPath: v2NonRootFolderPathInputSchema,
})

export const fileManageDeleteFolderBodySchema = z.object({
  operation: z.literal('delete_folder'),
  workspaceId: z.string().min(1).optional(),
  path: v2NonRootFolderPathInputSchema,
  recursive: z.boolean().optional(),
})

export const fileManageRestoreFolderBodySchema = z.object({
  operation: z.literal('restore_folder'),
  workspaceId: z.string().min(1).optional(),
  folderId: z.string().min(1, 'folderId is required for restore_folder operation'),
})

/**
 * The shared half of an in-place edit: which file, resolved the same way a
 * named append resolves one.
 */
const fileEditTargetShape = {
  workspaceId: z.string().min(1).optional(),
  fileName: z.string({ error: 'fileName is required' }).min(1),
  /**
   * Folder scopes the name is resolved inside. A name must be unique across the
   * selected scopes; otherwise the caller has to provide the canonical file ID.
   *
   * It constrains a canonical id too, rather than being ignored for one: an id
   * that does not sit in the named folder is a `404`. Refusing is the safer
   * reading of a contradictory request — silently preferring the id would edit
   * a file outside the folder the caller named.
   */
  folderPath: v2FolderPathInputSchema.optional(),
  folderPaths: fileFolderPathsSchema.optional(),
  includeSubfolders: z.boolean().optional(),
} as const

export const fileManageEditBodySchema = z
  .discriminatedUnion('mode', [
    z.object({
      operation: z.literal('edit'),
      ...fileEditTargetShape,
      mode: z.literal('search_replace'),
      search: z
        .string({ error: 'search is required for search_replace' })
        .min(1, 'search cannot be empty'),
      content: z.string({ error: 'content is required for search_replace' }),
      replaceAll: z.boolean().optional(),
      [PRIVATE_SECRET_PROVENANCE_FIELD]: privateSecretProvenanceBundleSchema.optional(),
    }),
    z.object({
      operation: z.literal('edit'),
      ...fileEditTargetShape,
      mode: z.literal('replace_between'),
      beforeAnchor: z
        .string({ error: 'beforeAnchor is required for replace_between' })
        .trim()
        .min(1, 'beforeAnchor cannot be empty'),
      afterAnchor: z
        .string({ error: 'afterAnchor is required for replace_between' })
        .trim()
        .min(1, 'afterAnchor cannot be empty'),
      content: z.string({ error: 'content is required for replace_between' }),
      occurrence: z.number().int().min(1).optional(),
      [PRIVATE_SECRET_PROVENANCE_FIELD]: privateSecretProvenanceBundleSchema.optional(),
    }),
    z.object({
      operation: z.literal('edit'),
      ...fileEditTargetShape,
      mode: z.literal('insert_after'),
      anchor: z
        .string({ error: 'anchor is required for insert_after' })
        .trim()
        .min(1, 'anchor cannot be empty'),
      content: z
        .string({ error: 'content is required for insert_after' })
        .min(1, 'content cannot be empty for insert_after'),
      occurrence: z.number().int().min(1).optional(),
      [PRIVATE_SECRET_PROVENANCE_FIELD]: privateSecretProvenanceBundleSchema.optional(),
    }),
    z.object({
      operation: z.literal('edit'),
      ...fileEditTargetShape,
      mode: z.literal('delete_between'),
      startAnchor: z
        .string({ error: 'startAnchor is required for delete_between' })
        .trim()
        .min(1, 'startAnchor cannot be empty'),
      endAnchor: z
        .string({ error: 'endAnchor is required for delete_between' })
        .trim()
        .min(1, 'endAnchor cannot be empty'),
      occurrence: z.number().int().min(1).optional(),
      [PRIVATE_SECRET_PROVENANCE_FIELD]: privateSecretProvenanceBundleSchema.optional(),
    }),
  ])
  .superRefine(validateFolderTarget)

export const fileManageBodySchema = z.union([
  fileManageWriteBodySchema,
  fileManageAppendBodySchema,
  fileManageEditBodySchema,
  fileManageGetBodySchema,
  fileManageMoveBodySchema,
  fileManageSharingBodySchema,
  fileManageReadBodySchema,
  fileManageContentBodySchema,
  fileManageCompressBodySchema,
  fileManageDecompressBodySchema,
  fileManageListBodySchema,
  fileManageCreateFolderBodySchema,
  fileManageUpdateFolderBodySchema,
  fileManageDeleteFolderBodySchema,
  fileManageRestoreFolderBodySchema,
])

export const fileManageContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/file/manage',
  query: fileManageQuerySchema,
  body: fileManageBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})
