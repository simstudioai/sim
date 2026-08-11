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
  v1ChunkingConfigSchema,
  v1CreateKnowledgeBaseBodySchema,
  v1KnowledgeSearchBodySchema,
  v1KnowledgeWorkspaceQuerySchema,
  v1ListKnowledgeDocumentsQuerySchema,
  v1SearchTagFilterSchema,
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
  v2TimestampSchema,
} from '@/lib/api/contracts/v2/shared'
import {
  v2PartUrlsBodySchema,
  v2PartUrlsDataSchema,
  v2UploadStatusSchema,
  v2UploadTokenHeadersSchema,
  v2UploadTransferSchema,
} from '@/lib/api/contracts/v2/uploads'
import { DEFAULT_CHUNKING_CONFIG } from '@/lib/knowledge/constants'
import { knowledgeDocumentUploadMetadataSchema } from '@/lib/knowledge/upload-metadata'
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
 * {@link KnowledgeBaseWithCounts}. The raw `userId`, `workspaceId`, and
 * `deletedAt` fields are not exposed; owner attribution is resolved to
 * `ownerEmail`.
 */
const v2KnowledgeChunkingConfigSchema = knowledgeBaseDataSchema.shape.chunkingConfig
  .extend({
    maxSize: knowledgeBaseDataSchema.shape.chunkingConfig.shape.maxSize
      .describe('Maximum chunk size in tokens.')
      .meta({ examples: [1024] }),
    minSize: knowledgeBaseDataSchema.shape.chunkingConfig.shape.minSize
      .describe('Minimum chunk size in characters.')
      .meta({ examples: [100] }),
    overlap: knowledgeBaseDataSchema.shape.chunkingConfig.shape.overlap
      .describe('Number of overlapping characters between adjacent chunks.')
      .meta({ examples: [200] }),
    strategy: knowledgeBaseDataSchema.shape.chunkingConfig.shape.strategy.describe(
      'Chunking strategy applied during document processing.'
    ),
    strategyOptions: knowledgeBaseDataSchema.shape.chunkingConfig.shape.strategyOptions.describe(
      'Strategy-specific tuning options.'
    ),
  })
  .catchall(z.unknown().describe('Additional forward-compatible chunking configuration property.'))
  .meta({
    id: 'V2KnowledgeChunkingConfig',
    title: 'Knowledge chunking configuration',
    description: 'How documents in a knowledge base are split into chunks before embedding.',
  })

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
  .extend({
    id: knowledgeBaseDataSchema.shape.id
      .describe('Unique knowledge base identifier.')
      .meta({ examples: ['7c9e6679-7425-40de-944b-e07fc1f90ae7'] }),
    name: knowledgeBaseDataSchema.shape.name
      .describe('Human-readable knowledge base name.')
      .meta({ examples: ['Product Documentation'] }),
    description: knowledgeBaseDataSchema.shape.description
      .describe('Knowledge base description, or null when none is set.')
      .meta({ examples: ['All product documentation and guides'] }),
    tokenCount: knowledgeBaseDataSchema.shape.tokenCount
      .describe('Total tokens across indexed documents.')
      .meta({ examples: [48213] }),
    embeddingModel: knowledgeBaseDataSchema.shape.embeddingModel
      .describe('Embedding model used to index documents.')
      .meta({ examples: ['text-embedding-3-small'] }),
    embeddingDimension: knowledgeBaseDataSchema.shape.embeddingDimension
      .describe('Dimensionality of the embedding vectors.')
      .meta({ examples: [1536] }),
    chunkingConfig: v2KnowledgeChunkingConfigSchema,
    docCount: knowledgeBaseDataSchema.shape.docCount
      .describe('Number of documents in the knowledge base.')
      .meta({ examples: [12] }),
    connectorTypes: knowledgeBaseDataSchema.shape.connectorTypes
      .describe('External connector types that have synced documents into the knowledge base.')
      .meta({ examples: [['notion', 'google_drive']] }),
    createdAt: knowledgeBaseDataSchema.shape.createdAt
      .describe('ISO 8601 timestamp when the knowledge base was created.')
      .meta({ format: 'date-time', examples: ['2025-01-10T09:00:00Z'] }),
    updatedAt: knowledgeBaseDataSchema.shape.updatedAt
      .describe('ISO 8601 timestamp when the knowledge base was last modified.')
      .meta({ format: 'date-time', examples: ['2025-06-18T16:45:00Z'] }),
    ownerEmail: z
      .email()
      .describe('Current email address of the knowledge base owner.')
      .meta({ examples: ['owner@example.com'] }),
    folderPath: v2FolderPathSchema
      .describe('Canonical containing-folder path; `/` is the workspace root.')
      .meta({ examples: ['/Product'] }),
  })
  .strict()
  .meta({
    id: 'V2KnowledgeBase',
    title: 'Knowledge base',
    description: 'A collection of documents indexed for vector and tag search.',
  })
export type V2KnowledgeBase = z.output<typeof v2KnowledgeBaseSchema>

/** Delete acknowledgement — the id of the resource that was deleted. */
export const v2KnowledgeDeleteDataSchema = z
  .object({
    id: z
      .string()
      .describe('Identifier of the deleted resource.')
      .meta({ examples: ['7c9e6679-7425-40de-944b-e07fc1f90ae7'] }),
    deleted: z.literal(true).describe('Confirms that the resource was deleted.'),
  })
  .meta({
    id: 'V2KnowledgeDeleteData',
    title: 'Knowledge deletion data',
    description: 'Acknowledgement for a deleted knowledge base or document.',
  })
export type V2KnowledgeDeleteData = z.output<typeof v2KnowledgeDeleteDataSchema>

/**
 * Document core fields shared by the list item and the detail payload, reused
 * from the first-party {@link documentDataSchema}.
 */
const v2KnowledgeDocumentCoreSchema = z
  .object({
    id: documentDataSchema.shape.id
      .describe('Unique document identifier.')
      .meta({ examples: ['b2d4f8a0-1c3e-4a5b-9d7c-2e6f0a8b4c12'] }),
    knowledgeBaseId: documentDataSchema.shape.knowledgeBaseId
      .describe('Knowledge base to which the document belongs.')
      .meta({ examples: ['7c9e6679-7425-40de-944b-e07fc1f90ae7'] }),
    filename: documentDataSchema.shape.filename
      .describe('Original filename of the uploaded document.')
      .meta({ examples: ['getting-started.pdf'] }),
    fileSize: documentDataSchema.shape.fileSize
      .describe('File size in bytes.')
      .meta({ examples: [248913] }),
    mimeType: documentDataSchema.shape.mimeType
      .describe('MIME type of the document file.')
      .meta({ examples: ['application/pdf'] }),
    processingStatus: documentDataSchema.shape.processingStatus
      .describe('Current document processing state.')
      .meta({ examples: ['completed'] }),
    chunkCount: documentDataSchema.shape.chunkCount
      .describe('Number of indexed chunks; zero until processing completes.')
      .meta({ examples: [24] }),
    tokenCount: documentDataSchema.shape.tokenCount
      .describe('Total tokens extracted from the document.')
      .meta({ examples: [8123] }),
    characterCount: documentDataSchema.shape.characterCount
      .describe('Total characters extracted from the document.')
      .meta({ examples: [41205] }),
    enabled: documentDataSchema.shape.enabled
      .describe('Whether the document is enabled for search.')
      .meta({ examples: [true] }),
  })
  .strict()

/**
 * Document list item / upload acknowledgement. `createdAt` is the public rename
 * of the underlying `uploadedAt` column.
 */
export const v2KnowledgeDocumentSummarySchema = v2KnowledgeDocumentCoreSchema
  .extend({
    createdAt: nullableWireDateSchema
      .describe('ISO 8601 timestamp when the document was uploaded, or null.')
      .meta({ format: 'date-time', examples: ['2025-06-18T16:45:00Z'] }),
  })
  .meta({
    id: 'V2KnowledgeDocumentSummary',
    title: 'Knowledge document summary',
    description: 'Summary returned by document lists and upload acknowledgements.',
  })
export type V2KnowledgeDocumentSummary = z.output<typeof v2KnowledgeDocumentSummarySchema>

/**
 * Document detail — the summary plus processing state and connector provenance.
 * Every field is always present (nullable), mirroring the v1 detail projection.
 */
export const v2KnowledgeDocumentSchema = v2KnowledgeDocumentSummarySchema
  .extend({
    processingError: z
      .string()
      .nullable()
      .describe('Processing error message, or null when processing has not failed.'),
    processingStartedAt: nullableWireDateSchema
      .describe('ISO 8601 timestamp when processing started, or null.')
      .meta({ format: 'date-time', examples: ['2025-06-18T16:45:05Z'] }),
    processingCompletedAt: nullableWireDateSchema
      .describe('ISO 8601 timestamp when processing completed, or null.')
      .meta({ format: 'date-time', examples: ['2025-06-18T16:45:42Z'] }),
    connectorId: z
      .string()
      .nullable()
      .describe('Connector identifier for a synced document, or null for a direct upload.'),
    connectorType: z
      .string()
      .nullable()
      .describe('Connector type for a synced document, or null for a direct upload.'),
    sourceUrl: z
      .string()
      .nullable()
      .describe('Original source URL for a synced document, or null for a direct upload.'),
  })
  .meta({
    id: 'V2KnowledgeDocument',
    title: 'Knowledge document',
    description: 'Full document detail including processing state and connector provenance.',
  })
export type V2KnowledgeDocument = z.output<typeof v2KnowledgeDocumentSchema>

/**
 * A single vector/tag search hit. `metadata` is the document's display-named tag
 * map; values are user-defined and of mixed type (string/number/boolean/date),
 * so they are carried as `unknown` and serialized as-is.
 */
export const v2KnowledgeSearchResultSchema = z
  .object({
    documentId: z
      .string()
      .describe('Identifier of the document containing the matching chunk.')
      .meta({ examples: ['b2d4f8a0-1c3e-4a5b-9d7c-2e6f0a8b4c12'] }),
    documentName: z
      .string()
      .nullable()
      .describe('Filename of the source document, or null when unavailable.')
      .meta({ examples: ['getting-started.pdf'] }),
    sourceUrl: z
      .string()
      .nullable()
      .describe('Original source URL, or null for a directly uploaded document.'),
    content: z
      .string()
      .describe('Text content of the matching chunk.')
      .meta({ examples: ['To reset your password, open Settings and choose Security.'] }),
    chunkIndex: z
      .number()
      .int()
      .nonnegative()
      .describe('Zero-based chunk index within the document.')
      .meta({ examples: [3] }),
    metadata: z
      .record(
        z.string(),
        z.unknown().describe('User-defined string, number, boolean, or date tag value.')
      )
      .describe('Document tag values keyed by tag display name.')
      .meta({ examples: [{ category: 'billing', priority: 2 }] }),
    similarity: z
      .number()
      .describe('Similarity score for vector search; tag-only matches use 1.')
      .meta({ examples: [0.8423] }),
  })
  .meta({
    id: 'V2KnowledgeSearchResult',
    title: 'Knowledge search result',
    description: 'A matching document chunk returned by knowledge search.',
  })
export type V2KnowledgeSearchResult = z.output<typeof v2KnowledgeSearchResultSchema>

/** Search response payload — mirrors the v1 `data` object. */
export const v2KnowledgeSearchDataSchema = z
  .object({
    results: z
      .array(v2KnowledgeSearchResultSchema)
      .describe('Matching chunks ordered by relevance.'),
    query: z
      .string()
      .describe('Executed query, or an empty string for tag-only search.')
      .meta({ examples: ['How do I reset my password?'] }),
    knowledgeBaseIds: z
      .array(z.string())
      .describe('Knowledge base identifiers that were searched.')
      .meta({ examples: [['7c9e6679-7425-40de-944b-e07fc1f90ae7']] }),
    topK: z
      .number()
      .int()
      .positive()
      .describe('Maximum number of results requested.')
      .meta({ examples: [10] }),
    totalResults: z
      .number()
      .int()
      .nonnegative()
      .describe('Number of results returned.')
      .meta({ examples: [4] }),
  })
  .meta({
    id: 'V2KnowledgeSearchData',
    title: 'Knowledge search data',
    description: 'Results and execution context for a knowledge search.',
  })
export type V2KnowledgeSearchData = z.output<typeof v2KnowledgeSearchDataSchema>

/** Upload carries the workspace as a query param so auth runs before the multipart body is buffered. */
export const v2UploadKnowledgeDocumentQuerySchema = z.object({
  workspaceId: workspaceIdSchema.describe('Workspace that owns the knowledge base.'),
})
export type V2UploadKnowledgeDocumentQuery = z.output<typeof v2UploadKnowledgeDocumentQuerySchema>

export const v2KnowledgeBaseParamsSchema = knowledgeBaseParamsSchema.extend({
  id: knowledgeBaseParamsSchema.shape.id.describe('Unique knowledge base identifier.'),
})
export type V2KnowledgeBaseParams = z.output<typeof v2KnowledgeBaseParamsSchema>

export const v2KnowledgeDocumentParamsSchema = knowledgeDocumentParamsSchema.extend({
  id: knowledgeDocumentParamsSchema.shape.id.describe('Unique knowledge base identifier.'),
  documentId: knowledgeDocumentParamsSchema.shape.documentId.describe(
    'Unique knowledge document identifier.'
  ),
})
export type V2KnowledgeDocumentParams = z.output<typeof v2KnowledgeDocumentParamsSchema>

export const v2KnowledgeDocumentUploadParamsSchema = v2KnowledgeBaseParamsSchema.extend({
  uploadId: z
    .string()
    .min(1, 'uploadId is required')
    .describe('Upload session identifier returned when the upload was created.'),
})
export type V2KnowledgeDocumentUploadParams = z.output<typeof v2KnowledgeDocumentUploadParamsSchema>

const v2KnowledgeDocumentProcessingOptionsSchema =
  knowledgeDocumentUploadMetadataSchema.shape.processingOptions
    .unwrap()
    .extend({
      recipe: knowledgeDocumentUploadMetadataSchema.shape.processingOptions
        .unwrap()
        .shape.recipe.describe('Optional document processing recipe.'),
      lang: knowledgeDocumentUploadMetadataSchema.shape.processingOptions
        .unwrap()
        .shape.lang.describe('Optional document language code.'),
    })
    .strict()

export const v2KnowledgeDocumentUploadMetadataSchema = z
  .object({
    tag1: knowledgeDocumentUploadMetadataSchema.shape.tag1.describe('Value for tag slot 1.'),
    tag2: knowledgeDocumentUploadMetadataSchema.shape.tag2.describe('Value for tag slot 2.'),
    tag3: knowledgeDocumentUploadMetadataSchema.shape.tag3.describe('Value for tag slot 3.'),
    tag4: knowledgeDocumentUploadMetadataSchema.shape.tag4.describe('Value for tag slot 4.'),
    tag5: knowledgeDocumentUploadMetadataSchema.shape.tag5.describe('Value for tag slot 5.'),
    tag6: knowledgeDocumentUploadMetadataSchema.shape.tag6.describe('Value for tag slot 6.'),
    tag7: knowledgeDocumentUploadMetadataSchema.shape.tag7.describe('Value for tag slot 7.'),
    processingOptions: v2KnowledgeDocumentProcessingOptionsSchema
      .optional()
      .describe('Optional processing recipe and language.'),
  })
  .strict()
export type V2KnowledgeDocumentUploadMetadata = z.output<
  typeof v2KnowledgeDocumentUploadMetadataSchema
>

export const v2CreateKnowledgeDocumentUploadBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the knowledge base.'),
    name: z
      .string()
      .trim()
      .min(1, 'name is required')
      .max(255, 'name is too long')
      .describe('Filename recorded on the knowledge document.')
      .meta({ examples: ['getting-started.pdf'] }),
    contentType: z
      .string()
      .trim()
      .min(1, 'contentType is required')
      .max(255)
      .describe('Supported MIME type for the document.')
      .meta({ examples: ['application/pdf'] }),
    size: z
      .number()
      .int()
      .min(1)
      .max(MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE)
      .describe('Exact file size in bytes.')
      .meta({ examples: [248913] }),
    ...v2KnowledgeDocumentUploadMetadataSchema.shape,
  })
  .strict()
export type V2CreateKnowledgeDocumentUploadBody = z.input<
  typeof v2CreateKnowledgeDocumentUploadBodySchema
>

export const v2UploadKnowledgeDocumentFormSchema = z
  .object({
    file: z
      .file()
      .max(MAX_KNOWLEDGE_DOCUMENT_FILE_SIZE)
      .describe('Document file to upload; the maximum size is 100 MB.'),
  })
  .catchall(z.unknown().describe('Additional multipart form fields are ignored.'))
export type V2UploadKnowledgeDocumentForm = z.input<typeof v2UploadKnowledgeDocumentFormSchema>

export const v2KnowledgeDocumentUploadSchema = z
  .object({
    id: z.string().describe('Upload session identifier.'),
    knowledgeBaseId: z.string().describe('Knowledge base that will own the document.'),
    status: v2UploadStatusSchema.describe('Current upload-session state.'),
    name: z.string().describe('Filename recorded on the knowledge document.'),
    contentType: z.string().describe('MIME type declared for the document.'),
    size: z.number().int().positive().describe('Exact file size in bytes.'),
    expiresAt: v2TimestampSchema.describe('ISO 8601 upload-session expiration time.'),
    error: z.string().nullable().describe('Terminal upload error, or null when none occurred.'),
    document: v2KnowledgeDocumentSummarySchema
      .nullable()
      .describe('Queued document after completion, or null before completion.'),
  })
  .meta({
    id: 'V2KnowledgeDocumentUpload',
    title: 'Knowledge document upload',
    description: 'State of a resumable knowledge-document upload session.',
  })
export type V2KnowledgeDocumentUpload = z.output<typeof v2KnowledgeDocumentUploadSchema>

export const v2CreateKnowledgeDocumentUploadDataSchema = z
  .object({
    session: v2KnowledgeDocumentUploadSchema,
    uploadToken: z
      .string()
      .min(1)
      .describe('Signed control token required by subsequent upload-session requests.'),
    transfer: v2UploadTransferSchema
      .describe('Direct PUT or multipart transfer instructions.')
      .meta({
        id: 'V2KnowledgeUploadTransfer',
        title: 'Knowledge upload transfer',
        description: 'Provider transfer strategy for a knowledge document upload.',
      }),
  })
  .strict()
  .meta({
    id: 'V2CreateKnowledgeDocumentUploadData',
    title: 'Create knowledge document upload data',
    description: 'Upload session, signed control token, and transfer instructions.',
  })
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
    workspaceId: workspaceIdSchema.describe('Workspace whose knowledge bases should be listed.'),
    folderPath: v2FolderPathInputSchema
      .optional()
      .describe('Restrict results to knowledge bases in this folder.'),
    search: v2SearchSchema,
    ...v2SortFields(v2KnowledgeBaseSortFields, { sortBy: 'createdAt', sortOrder: 'asc' }),
  })
  .strict()

export type V2ListKnowledgeBasesQuery = z.output<typeof v2ListKnowledgeBasesQuerySchema>

const v2KnowledgeChunkingConfigInputSchema = v1ChunkingConfigSchema
  .extend({
    maxSize: v1ChunkingConfigSchema.shape.maxSize
      .describe('Maximum chunk size in tokens.')
      .meta({ examples: [1024] }),
    minSize: v1ChunkingConfigSchema.shape.minSize
      .describe('Minimum chunk size in characters.')
      .meta({ examples: [100] }),
    overlap: v1ChunkingConfigSchema.shape.overlap
      .describe('Number of overlapping characters between adjacent chunks.')
      .meta({ examples: [200] }),
  })
  .meta({
    id: 'V2KnowledgeChunkingConfigInput',
    title: 'Knowledge chunking configuration input',
    description: 'Chunking configuration applied when processing documents.',
  })

export const v2CreateKnowledgeBaseBodySchema = v1CreateKnowledgeBaseBodySchema
  .safeExtend({
    workspaceId: workspaceIdSchema.describe('Workspace in which to create the knowledge base.'),
    name: v1CreateKnowledgeBaseBodySchema.shape.name
      .describe('Human-readable knowledge base name.')
      .meta({ examples: ['Product Documentation'] }),
    description: v1CreateKnowledgeBaseBodySchema.shape.description
      .describe('Optional knowledge base description.')
      .meta({ examples: ['All product documentation and guides'] }),
    chunkingConfig: v2KnowledgeChunkingConfigInputSchema
      .optional()
      .default(DEFAULT_CHUNKING_CONFIG)
      .describe('Chunking configuration; defaults are applied when omitted.'),
    folderPath: v2FolderPathInputSchema
      .optional()
      .describe('Containing folder path; omission creates the knowledge base at the root.'),
  })
  .strict()

export const v2UpdateKnowledgeBaseBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the knowledge base.'),
    name: v1CreateKnowledgeBaseBodySchema.shape.name
      .optional()
      .describe('New knowledge base name.')
      .meta({ examples: ['Updated Product Documentation'] }),
    description: v1CreateKnowledgeBaseBodySchema.shape.description
      .describe('New knowledge base description.')
      .meta({ examples: ['Refreshed product documentation and guides'] }),
    chunkingConfig: v2KnowledgeChunkingConfigInputSchema
      .optional()
      .describe('New document chunking configuration.'),
    folderPath: v2FolderPathInputSchema.optional().describe('New containing-folder path.'),
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
    schema: v2DataResponse(v2KnowledgeBaseSchema),
    status: 201,
  },
})

export const v2GetKnowledgeBaseContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/knowledge/[id]',
  params: v2KnowledgeBaseParamsSchema,
  query: v1KnowledgeWorkspaceQuerySchema.extend({
    workspaceId: v1KnowledgeWorkspaceQuerySchema.shape.workspaceId.describe(
      'Workspace that owns the knowledge base.'
    ),
  }),
  response: {
    mode: 'json',
    schema: v2DataResponse(v2KnowledgeBaseSchema),
  },
})

/**
 * PATCH, not PUT: every mutable field is optional and a `superRefine` requires
 * at least one, so this is a partial update rather than a replacement.
 */
export const v2UpdateKnowledgeBaseContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/knowledge/[id]',
  params: v2KnowledgeBaseParamsSchema,
  body: v2UpdateKnowledgeBaseBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2KnowledgeBaseSchema),
  },
})

export const v2DeleteKnowledgeBaseContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/knowledge/[id]',
  params: v2KnowledgeBaseParamsSchema,
  query: v1KnowledgeWorkspaceQuerySchema.extend({
    workspaceId: v1KnowledgeWorkspaceQuerySchema.shape.workspaceId.describe(
      'Workspace that owns the knowledge base.'
    ),
  }),
  response: {
    mode: 'json',
    schema: v2DataResponse(v2KnowledgeDeleteDataSchema),
  },
})

export const v2DeleteKnowledgeFolderDataSchema = z
  .object({
    path: v2FolderPathSchema.describe('Canonical path of the deleted folder.'),
    deleted: z.literal(true).describe('Confirms that the folder was deleted.'),
    deletedItems: z
      .object({
        folders: z.number().int().nonnegative().describe('Number of deleted folders.'),
        knowledgeBases: z
          .number()
          .int()
          .nonnegative()
          .describe('Number of deleted knowledge bases.'),
      })
      .describe('Counts of deleted resources.'),
  })
  .meta({
    id: 'V2DeleteKnowledgeFolderData',
    title: 'Delete knowledge folder data',
    description: 'Folder deletion acknowledgement and deleted-resource counts.',
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
  response: { mode: 'json', schema: v2DataResponse(v2FolderSchema), status: 201 },
})

export const v2RelocateKnowledgeFolderContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/knowledge/folders',
  body: v2RelocateFolderBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2FolderSchema) },
})

export const v2DeleteKnowledgeFolderContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/knowledge/folders',
  query: v2DeleteFolderQuerySchema,
  response: { mode: 'json', schema: v2DataResponse(v2DeleteKnowledgeFolderDataSchema) },
})

const v2KnowledgeSearchTagFilterSchema = v1SearchTagFilterSchema
  .extend({
    tagName: v1SearchTagFilterSchema.shape.tagName
      .describe('Display name of the tag to filter.')
      .meta({ examples: ['category'] }),
    fieldType: v1SearchTagFilterSchema.shape.fieldType.describe('Tag field type.'),
    operator: v1SearchTagFilterSchema.shape.operator
      .describe('Comparison operator; valid operators depend on the field type.')
      .meta({ examples: ['eq'] }),
    value: v1SearchTagFilterSchema.shape.value
      .describe('Tag value to compare against.')
      .meta({ examples: ['billing'] }),
    valueTo: v1SearchTagFilterSchema.shape.valueTo.describe(
      'Upper bound for the `between` operator.'
    ),
  })
  .meta({
    id: 'V2KnowledgeSearchTagFilter',
    title: 'Knowledge search tag filter',
    description: 'A structured tag filter applied to knowledge search.',
  })

export const v2KnowledgeSearchBodySchema = v1KnowledgeSearchBodySchema.safeExtend({
  workspaceId: v1KnowledgeSearchBodySchema.shape.workspaceId.describe(
    'Workspace that owns the knowledge bases.'
  ),
  knowledgeBaseIds: v1KnowledgeSearchBodySchema.shape.knowledgeBaseIds
    .describe('One knowledge base identifier or an array of up to 20 identifiers.')
    .meta({ examples: [['7c9e6679-7425-40de-944b-e07fc1f90ae7']] }),
  query: v1KnowledgeSearchBodySchema.shape.query
    .describe('Natural-language query; required when tag filters are omitted.')
    .meta({ examples: ['How do I reset my password?'] }),
  topK: v1KnowledgeSearchBodySchema.shape.topK.describe(
    'Maximum number of search results to return. Must be a whole number between 1 and 100; the boundary schema only bounds the range, so a fractional value is admitted here and then rejected with 400 during search.'
  ),
  tagFilters: z
    .array(v2KnowledgeSearchTagFilterSchema)
    .optional()
    .describe(
      'Structured tag filters. Supported across multiple knowledge bases, but each filtered tag must resolve to the same slot and field type in every knowledge base selected; a tag missing from one of them, or defined inconsistently across them, is rejected and those knowledge bases must be searched separately. With a single knowledge base, an unknown tag name is simply ignored.'
    ),
  searchMode: v1KnowledgeSearchBodySchema.shape.searchMode.describe(
    'Retrieval strategy: vector is semantic-only, while hybrid also runs full-text search.'
  ),
})
export type V2KnowledgeSearchBody = z.input<typeof v2KnowledgeSearchBodySchema>

export const v2SearchKnowledgeContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/knowledge/search',
  body: v2KnowledgeSearchBodySchema,
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
  .extend({
    workspaceId: v1ListKnowledgeDocumentsQuerySchema.shape.workspaceId.describe(
      'Workspace that owns the knowledge base.'
    ),
    limit: v1ListKnowledgeDocumentsQuerySchema.shape.limit.describe(
      'Maximum documents to return, between 1 and 100.'
    ),
    search: v1ListKnowledgeDocumentsQuerySchema.shape.search.describe(
      'Case-insensitive filename search.'
    ),
    enabledFilter: v1ListKnowledgeDocumentsQuerySchema.shape.enabledFilter.describe(
      'Filter by whether documents are enabled for search.'
    ),
    sortBy: v1ListKnowledgeDocumentsQuerySchema.shape.sortBy.describe(
      'Document field used to sort results.'
    ),
    sortOrder: v1ListKnowledgeDocumentsQuerySchema.shape.sortOrder.describe('Sort direction.'),
    cursor: z.string().min(1).optional().describe('Opaque cursor returned by the previous page.'),
  })
export type V2ListKnowledgeDocumentsQuery = z.output<typeof v2ListKnowledgeDocumentsQuerySchema>

export const v2ListKnowledgeDocumentsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/knowledge/[id]/documents',
  params: v2KnowledgeBaseParamsSchema,
  query: v2ListKnowledgeDocumentsQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2KnowledgeDocumentSummarySchema),
  },
})

export const v2UploadKnowledgeDocumentContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/knowledge/[id]/documents',
  params: v2KnowledgeBaseParamsSchema,
  query: v2UploadKnowledgeDocumentQuerySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2KnowledgeDocumentSummarySchema),
    status: 201,
  },
})

export const v2CreateKnowledgeDocumentUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/knowledge/[id]/documents/uploads',
  params: v2KnowledgeBaseParamsSchema,
  body: v2CreateKnowledgeDocumentUploadBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2CreateKnowledgeDocumentUploadDataSchema),
    status: 201,
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
  params: v2KnowledgeDocumentParamsSchema,
  query: v1KnowledgeWorkspaceQuerySchema.extend({
    workspaceId: v1KnowledgeWorkspaceQuerySchema.shape.workspaceId.describe(
      'Workspace that owns the knowledge base.'
    ),
  }),
  response: {
    mode: 'json',
    schema: v2DataResponse(v2KnowledgeDocumentSchema),
  },
})

export const v2DeleteKnowledgeDocumentContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/knowledge/[id]/documents/[documentId]',
  params: v2KnowledgeDocumentParamsSchema,
  query: v1KnowledgeWorkspaceQuerySchema.extend({
    workspaceId: v1KnowledgeWorkspaceQuerySchema.shape.workspaceId.describe(
      'Workspace that owns the knowledge base.'
    ),
  }),
  response: {
    mode: 'json',
    schema: v2DataResponse(v2KnowledgeDeleteDataSchema),
  },
})
