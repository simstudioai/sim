import { z } from 'zod'
import { knowledgeBaseDataSchema } from '@/lib/api/contracts/knowledge/base'
import { documentDataSchema } from '@/lib/api/contracts/knowledge/documents'
import {
  knowledgeBaseParamsSchema,
  knowledgeDocumentParamsSchema,
  nullableWireDateSchema,
} from '@/lib/api/contracts/knowledge/shared'
import { workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v1CreateKnowledgeBaseBodySchema,
  v1KnowledgeSearchBodySchema,
  v1KnowledgeWorkspaceQuerySchema,
  v1ListKnowledgeDocumentsQuerySchema,
} from '@/lib/api/contracts/v1/knowledge'
import {
  v2CreateFolderBodySchema,
  v2CursorListResponse,
  v2DataResponse,
  v2DeleteFolderQuerySchema,
  v2FolderPathInputSchema,
  v2FolderPathSchema,
  v2FolderSchema,
  v2ListFoldersQuerySchema,
  v2RelocateFolderBodySchema,
  v2SearchSchema,
  v2SortFields,
} from '@/lib/api/contracts/v2/shared'
import {
  v2PartUrlsBodySchema,
  v2PartUrlsDataSchema,
  v2UploadStatusSchema,
  v2UploadTokenHeadersSchema,
  v2UploadTransferSchema,
} from '@/lib/api/contracts/v2/uploads'
import { MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE } from '@/lib/uploads/shared/types'

/**
 * v2 knowledge contracts.
 *
 * Request shapes (params/query/body) are reused verbatim from the v1 public
 * contract (`@/lib/api/contracts/v1/knowledge`) — the public request surface is
 * unchanged. Only the response envelope is upgraded to the canonical v2 shapes
 * (`{ data }` for single/mutation, `{ data, pagination }` for the offset-paginated
 * document list), and the success `message` strings v1 inlined are dropped.
 *
 * The concrete `data` item schemas reuse the first-party knowledge data schemas
 * as their source of truth: the knowledge-base item is a `.pick()` of
 * {@link knowledgeBaseDataSchema} matching `formatKnowledgeBase`'s projection,
 * and the document items reuse the core fields of {@link documentDataSchema}. The
 * v2 (and v1-public) document projection renames `uploadedAt` to `createdAt` and
 * omits `fileUrl`/tag slots, so that rename is layered on via `.extend()`.
 */

/**
 * Knowledge-base item — the exact subset `formatKnowledgeBase` projects from a
 * {@link KnowledgeBaseWithCounts}. `userId`, `workspaceId`, and `deletedAt` are
 * intentionally not exposed on the public surface.
 */
export const v2KnowledgeBaseSchema = knowledgeBaseDataSchema
  .pick({
    id: true,
    name: true,
    description: true,
    tokenCount: true,
    embeddingModel: true,
    embeddingDimension: true,
    chunkingConfig: true,
    docCount: true,
    connectorTypes: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({ folderPath: v2FolderPathSchema })
export type V2KnowledgeBase = z.output<typeof v2KnowledgeBaseSchema>

/** `{ knowledgeBase }` payload for single-KB reads and mutations. */
export const v2KnowledgeBaseDataSchema = z.object({ knowledgeBase: v2KnowledgeBaseSchema })
export type V2KnowledgeBaseData = z.output<typeof v2KnowledgeBaseDataSchema>

/** Delete acknowledgement — the id of the resource that was deleted. */
export const v2KnowledgeDeleteDataSchema = z.object({
  id: z.string(),
  deleted: z.literal(true),
})
export type V2KnowledgeDeleteData = z.output<typeof v2KnowledgeDeleteDataSchema>

/**
 * Document core fields shared by the list item and the detail payload, reused
 * from the first-party {@link documentDataSchema}.
 */
const v2KnowledgeDocumentCoreSchema = documentDataSchema.pick({
  id: true,
  knowledgeBaseId: true,
  filename: true,
  fileSize: true,
  mimeType: true,
  processingStatus: true,
  chunkCount: true,
  tokenCount: true,
  characterCount: true,
  enabled: true,
})

/**
 * Document list item / upload acknowledgement. `createdAt` is the public rename
 * of the underlying `uploadedAt` column.
 */
export const v2KnowledgeDocumentSummarySchema = v2KnowledgeDocumentCoreSchema.extend({
  createdAt: nullableWireDateSchema,
})
export type V2KnowledgeDocumentSummary = z.output<typeof v2KnowledgeDocumentSummarySchema>

/**
 * Document detail — the summary plus processing state and connector provenance.
 * Every field is always present (nullable), mirroring the v1 detail projection.
 */
export const v2KnowledgeDocumentSchema = v2KnowledgeDocumentSummarySchema.extend({
  processingError: z.string().nullable(),
  processingStartedAt: nullableWireDateSchema,
  processingCompletedAt: nullableWireDateSchema,
  connectorId: z.string().nullable(),
  connectorType: z.string().nullable(),
  sourceUrl: z.string().nullable(),
})
export type V2KnowledgeDocument = z.output<typeof v2KnowledgeDocumentSchema>

/** `{ document }` payload for the upload acknowledgement (summary shape). */
export const v2KnowledgeDocumentSummaryDataSchema = z.object({
  document: v2KnowledgeDocumentSummarySchema,
})
export type V2KnowledgeDocumentSummaryData = z.output<typeof v2KnowledgeDocumentSummaryDataSchema>

/** `{ document }` payload for the document detail read. */
export const v2KnowledgeDocumentDataSchema = z.object({ document: v2KnowledgeDocumentSchema })
export type V2KnowledgeDocumentData = z.output<typeof v2KnowledgeDocumentDataSchema>

/**
 * A single vector/tag search hit. `metadata` is the document's display-named tag
 * map; values are user-defined and of mixed type (string/number/boolean/date),
 * so they are carried as `unknown` and serialized as-is.
 */
export const v2KnowledgeSearchResultSchema = z.object({
  documentId: z.string(),
  documentName: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  content: z.string(),
  chunkIndex: z.number(),
  metadata: z.record(z.string(), z.unknown()),
  similarity: z.number(),
})
export type V2KnowledgeSearchResult = z.output<typeof v2KnowledgeSearchResultSchema>

/** Search response payload — mirrors the v1 `data` object. */
export const v2KnowledgeSearchDataSchema = z.object({
  results: z.array(v2KnowledgeSearchResultSchema),
  query: z.string(),
  knowledgeBaseIds: z.array(z.string()),
  topK: z.number(),
  totalResults: z.number(),
})
export type V2KnowledgeSearchData = z.output<typeof v2KnowledgeSearchDataSchema>

/** Upload carries the workspace as a query param so auth runs before the multipart body is buffered. */
export const v2UploadKnowledgeDocumentQuerySchema = z.object({ workspaceId: workspaceIdSchema })
export type V2UploadKnowledgeDocumentQuery = z.output<typeof v2UploadKnowledgeDocumentQuerySchema>

export const v2KnowledgeDocumentUploadParamsSchema = knowledgeBaseParamsSchema.extend({
  uploadId: z.string().min(1, 'uploadId is required'),
})
export type V2KnowledgeDocumentUploadParams = z.output<typeof v2KnowledgeDocumentUploadParamsSchema>

const knowledgeDocumentUploadTagSchema = z
  .string()
  .max(1000, 'Knowledge document tag values cannot exceed 1000 characters')
  .optional()

export const v2KnowledgeDocumentUploadMetadataSchema = z
  .object({
    tag1: knowledgeDocumentUploadTagSchema,
    tag2: knowledgeDocumentUploadTagSchema,
    tag3: knowledgeDocumentUploadTagSchema,
    tag4: knowledgeDocumentUploadTagSchema,
    tag5: knowledgeDocumentUploadTagSchema,
    tag6: knowledgeDocumentUploadTagSchema,
    tag7: knowledgeDocumentUploadTagSchema,
    processingOptions: z
      .object({
        recipe: z.string().max(255, 'recipe cannot exceed 255 characters').optional(),
        lang: z.string().max(35, 'lang cannot exceed 35 characters').optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
export type V2KnowledgeDocumentUploadMetadata = z.output<
  typeof v2KnowledgeDocumentUploadMetadataSchema
>

export const v2CreateKnowledgeDocumentUploadBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    name: z.string().trim().min(1, 'name is required').max(255, 'name is too long'),
    contentType: z.string().trim().min(1, 'contentType is required').max(255),
    size: z.number().int().min(1).max(MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE),
    ...v2KnowledgeDocumentUploadMetadataSchema.shape,
  })
  .strict()
export type V2CreateKnowledgeDocumentUploadBody = z.input<
  typeof v2CreateKnowledgeDocumentUploadBodySchema
>

export const v2KnowledgeDocumentUploadSchema = z.object({
  id: z.string(),
  knowledgeBaseId: z.string(),
  status: v2UploadStatusSchema,
  name: z.string(),
  contentType: z.string(),
  size: z.number().int().positive(),
  expiresAt: z.string().datetime(),
  error: z.string().nullable(),
  document: v2KnowledgeDocumentSummarySchema.nullable(),
})
export type V2KnowledgeDocumentUpload = z.output<typeof v2KnowledgeDocumentUploadSchema>

export const v2CreateKnowledgeDocumentUploadDataSchema = z
  .object({
    session: v2KnowledgeDocumentUploadSchema,
    uploadToken: z.string().min(1),
    transfer: v2UploadTransferSchema,
  })
  .strict()
export type V2CreateKnowledgeDocumentUploadData = z.output<
  typeof v2CreateKnowledgeDocumentUploadDataSchema
>

export const v2KnowledgeBaseSortFields = ['name', 'createdAt', 'updatedAt'] as const

export type V2KnowledgeBaseSortBy = (typeof v2KnowledgeBaseSortFields)[number]

/**
 * KB list query: v1's workspace scope plus the v2 search/sort convention and a
 * folder filter. v1's own list query stays untouched — it does not implement
 * these, and advertising a param a route ignores is worse than not having it.
 */
export const v2ListKnowledgeBasesQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    folderPath: v2FolderPathInputSchema.optional(),
    search: v2SearchSchema,
    ...v2SortFields(v2KnowledgeBaseSortFields, { sortBy: 'createdAt', sortOrder: 'asc' }),
  })
  .strict()

export type V2ListKnowledgeBasesQuery = z.output<typeof v2ListKnowledgeBasesQuerySchema>

export const v2CreateKnowledgeBaseBodySchema = v1CreateKnowledgeBaseBodySchema
  .extend({ folderPath: v2FolderPathInputSchema.optional() })
  .strict()

export const v2UpdateKnowledgeBaseBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    name: v1CreateKnowledgeBaseBodySchema.shape.name.optional(),
    description: v1CreateKnowledgeBaseBodySchema.shape.description,
    chunkingConfig: v1CreateKnowledgeBaseBodySchema.shape.chunkingConfig.optional(),
    folderPath: v2FolderPathInputSchema.optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (
      body.name === undefined &&
      body.description === undefined &&
      body.chunkingConfig === undefined &&
      body.folderPath === undefined
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['name'],
        message: 'At least one of name, description, chunkingConfig, or folderPath is required',
      })
    }
  })

/**
 * KB list. `getKnowledgeBases` returns the full workspace set (a small, bounded
 * per-workspace list), so today the cursor list is a single full page
 * (`nextCursor` always `null`). The canonical cursor envelope keeps the v2 list
 * surface uniform; real pagination can be added later behind the opaque cursor.
 * Search, folder filter, and sort all run in that query, not over its result.
 */
export const v2ListKnowledgeBasesContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/knowledge',
  query: v2ListKnowledgeBasesQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2KnowledgeBaseSchema),
  },
})

export const v2CreateKnowledgeBaseContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/knowledge',
  body: v2CreateKnowledgeBaseBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2KnowledgeBaseDataSchema),
  },
})

export const v2GetKnowledgeBaseContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/knowledge/[id]',
  params: knowledgeBaseParamsSchema,
  query: v1KnowledgeWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2KnowledgeBaseDataSchema),
  },
})

export const v2UpdateKnowledgeBaseContract = defineRouteContract({
  method: 'PUT',
  path: '/api/v2/knowledge/[id]',
  params: knowledgeBaseParamsSchema,
  body: v2UpdateKnowledgeBaseBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2KnowledgeBaseDataSchema),
  },
})

export const v2DeleteKnowledgeBaseContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/knowledge/[id]',
  params: knowledgeBaseParamsSchema,
  query: v1KnowledgeWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2KnowledgeDeleteDataSchema),
  },
})

export const v2KnowledgeFolderDataSchema = z.object({ folder: v2FolderSchema })

export const v2DeleteKnowledgeFolderDataSchema = z.object({
  path: v2FolderPathSchema,
  deleted: z.literal(true),
  deletedItems: z.object({ folders: z.number().int(), knowledgeBases: z.number().int() }),
})

export const v2ListKnowledgeFoldersContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/knowledge/folders',
  query: v2ListFoldersQuerySchema,
  response: { mode: 'json', schema: v2CursorListResponse(v2FolderSchema) },
})

export const v2CreateKnowledgeFolderContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/knowledge/folders',
  body: v2CreateFolderBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2KnowledgeFolderDataSchema) },
})

export const v2RelocateKnowledgeFolderContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/knowledge/folders',
  body: v2RelocateFolderBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2KnowledgeFolderDataSchema) },
})

export const v2DeleteKnowledgeFolderContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/knowledge/folders',
  query: v2DeleteFolderQuerySchema,
  response: { mode: 'json', schema: v2DataResponse(v2DeleteKnowledgeFolderDataSchema) },
})

export const v2SearchKnowledgeContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/knowledge/search',
  body: v1KnowledgeSearchBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2KnowledgeSearchDataSchema),
  },
})

/**
 * Document list query: the v1 search/filter/sort/limit shape with `offset`
 * swapped for an opaque `cursor`. Total doc count is available as `docCount` on
 * the knowledge base.
 */
export const v2ListKnowledgeDocumentsQuerySchema = v1ListKnowledgeDocumentsQuerySchema
  .omit({ offset: true })
  .extend({ cursor: z.string().min(1).optional() })
export type V2ListKnowledgeDocumentsQuery = z.output<typeof v2ListKnowledgeDocumentsQuerySchema>

export const v2ListKnowledgeDocumentsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/knowledge/[id]/documents',
  params: knowledgeBaseParamsSchema,
  query: v2ListKnowledgeDocumentsQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2KnowledgeDocumentSummarySchema),
  },
})

export const v2UploadKnowledgeDocumentContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/knowledge/[id]/documents',
  params: knowledgeBaseParamsSchema,
  query: v2UploadKnowledgeDocumentQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2KnowledgeDocumentSummaryDataSchema),
  },
})

export const v2CreateKnowledgeDocumentUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/knowledge/[id]/documents/uploads',
  params: knowledgeBaseParamsSchema,
  body: v2CreateKnowledgeDocumentUploadBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2CreateKnowledgeDocumentUploadDataSchema),
  },
})

export const v2AbortKnowledgeDocumentUploadContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/knowledge/[id]/documents/uploads/[uploadId]',
  params: v2KnowledgeDocumentUploadParamsSchema,
  query: v2UploadKnowledgeDocumentQuerySchema,
  headers: v2UploadTokenHeadersSchema,
  response: { mode: 'json', schema: v2DataResponse(v2KnowledgeDocumentUploadSchema) },
})

export const v2CreateKnowledgeDocumentUploadPartUrlsContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/knowledge/[id]/documents/uploads/[uploadId]/parts',
  params: v2KnowledgeDocumentUploadParamsSchema,
  query: v2UploadKnowledgeDocumentQuerySchema,
  headers: v2UploadTokenHeadersSchema,
  body: v2PartUrlsBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2PartUrlsDataSchema) },
})

export const v2CompleteKnowledgeDocumentUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/knowledge/[id]/documents/uploads/[uploadId]/complete',
  params: v2KnowledgeDocumentUploadParamsSchema,
  query: v2UploadKnowledgeDocumentQuerySchema,
  headers: v2UploadTokenHeadersSchema,
  response: { mode: 'json', schema: v2DataResponse(v2KnowledgeDocumentUploadSchema) },
})

export const v2GetKnowledgeDocumentContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/knowledge/[id]/documents/[documentId]',
  params: knowledgeDocumentParamsSchema,
  query: v1KnowledgeWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2KnowledgeDocumentDataSchema),
  },
})

export const v2DeleteKnowledgeDocumentContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/knowledge/[id]/documents/[documentId]',
  params: knowledgeDocumentParamsSchema,
  query: v1KnowledgeWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2KnowledgeDeleteDataSchema),
  },
})
