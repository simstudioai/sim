import { z } from 'zod'
import {
  chunkingConfigFieldsSchema,
  knowledgeBaseDataSchema,
  withChunkingConfigRules,
} from '@/lib/api/contracts/knowledge/base'
import { documentDataSchema } from '@/lib/api/contracts/knowledge/documents'
import {
  knowledgeBaseParamsSchema,
  knowledgeConnectorParamsSchema,
  knowledgeDocumentParamsSchema,
  nullableWireDateSchema,
} from '@/lib/api/contracts/knowledge/shared'
import {
  booleanQueryFlagSchema,
  noInputSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  KNOWLEDGE_TAG_FILTER_OPERATORS_BY_FIELD_TYPE,
  v1CreateKnowledgeBaseBodySchema,
  v1KnowledgeSearchBodySchema,
  v1KnowledgeWorkspaceQuerySchema,
  v1ListKnowledgeDocumentsQuerySchema,
  v1SearchTagFilterSchema,
} from '@/lib/api/contracts/v1/knowledge'
import {
  nameSortCollation,
  V2_FOLDER_FILTER_MISS,
  v2CreateFolderBodySchema,
  v2CursorListResponse,
  v2DataResponse,
  v2DeleteFolderQuerySchema,
  v2FolderPathInputSchema,
  v2FolderPathSchema,
  v2FolderSchema,
  v2ListFoldersQuerySchema,
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
import {
  DEFAULT_CHUNKING_CONFIG,
  MAX_KNOWLEDGE_CONNECTOR_DOCUMENT_MUTATION_ITEMS,
} from '@/lib/knowledge/constants'
import {
  DEFAULT_RERANKER_MODEL,
  rerankerModelSchema,
  rerankerStatusSchema,
} from '@/lib/knowledge/reranker-models'
import {
  KNOWLEDGE_DOCUMENT_UPLOAD_RECIPES,
  knowledgeDocumentUploadMetadataSchema,
} from '@/lib/knowledge/upload-metadata'
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
    webUrl: v2ResourceWebUrlSchema,
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
      .describe(
        'Canonical containing-folder path; `/` is the workspace root. Resolved against active folders only, so an archived knowledge base whose containing folder was archived with it reports `/`.'
      )
      .meta({ examples: ['/Product'] }),
    /** Non-null only for a knowledge base a `DELETE` archived; see `scope` on the list. */
    deletedAt: v2TimestampSchema
      .nullable()
      .describe(
        'ISO 8601 archive timestamp, or null while active. Use List Knowledge Bases with `scope=archived` to find archived knowledge bases.'
      )
      .meta({ format: 'date-time', examples: ['2026-01-16T09:00:00Z'] }),
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
 * Tag values carried on a document read, keyed by tag **display name**.
 *
 * The read and write surfaces address tags differently, deliberately:
 *
 * - **Reads are name-keyed.** This map, the `metadata` map on a search result,
 *   and the `tagName` in a search or document-list tag filter all speak display
 *   names, so everything a caller reads or filters by uses one vocabulary.
 * - **Writes are slot-keyed** (`tag1`..`tag7` on upload and on document update),
 *   because a slot is the addressable column and a display name is only unique
 *   per knowledge base and may be renamed.
 *
 * `GET /api/v2/knowledge/{knowledgeBaseId}/tags` is the mapping between the two. A slot that
 * holds a value but has no definition in the knowledge base appears under its
 * raw slot name, matching how knowledge search projects the same columns.
 */
export const v2KnowledgeDocumentTagsSchema = z
  .record(
    z.string(),
    z
      .union([z.string(), z.number(), z.boolean(), z.null()])
      .describe('Tag value; dates are ISO 8601 strings and an unset tag is null.')
  )
  .describe(
    'Document tag values keyed by display name. Writes use slots such as `tag1`; use List Tags to map names to slots.'
  )
  .meta({ examples: [{ category: 'billing', priority: 2 }] })

/**
 * Document list item — the summary plus its tag values. Upload acknowledgements
 * keep the plain summary: they echo a document the caller has just described,
 * so there is no vocabulary to resolve for them.
 */
export const v2KnowledgeTaggedDocumentSchema = v2KnowledgeDocumentSummarySchema
  .extend({
    tags: v2KnowledgeDocumentTagsSchema,
  })
  .meta({
    id: 'V2KnowledgeTaggedDocument',
    title: 'Knowledge document list item',
    description: 'Document summary with the document tag values keyed by display name.',
  })
export type V2KnowledgeTaggedDocument = z.output<typeof v2KnowledgeTaggedDocumentSchema>

/**
 * Document detail — the summary plus tag values, processing state and connector
 * provenance. Every field is always present (nullable), mirroring the v1 detail
 * projection.
 */
export const v2KnowledgeDocumentSchema = v2KnowledgeDocumentSummarySchema
  .extend({
    tags: v2KnowledgeDocumentTagsSchema,
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
    knowledgeBaseId: z
      .string()
      .describe('Knowledge base the matching chunk came from; a search may span up to 20.')
      .meta({ examples: ['7c9e6679-7425-40de-944b-e07fc1f90ae7'] }),
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
    rerankerScore: z
      .number()
      .optional()
      .describe(
        'Relevance score assigned by the reranker, present only on results a reranker ordered. Results are ordered by this score when it is present, which is why it can disagree with `similarity`.'
      )
      .meta({ examples: [0.9312] }),
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
    /**
     * Required, not optional. Reranking degrades to vector ordering on a provider
     * failure or an unconfigured credential, and that fallback was previously
     * indistinguishable from a reranker that ran — same 200, same order, no
     * `rerankerScore` on any result. A field a caller has to remember to look for
     * would reproduce the same gap for anyone who does not.
     */
    rerankerStatus: rerankerStatusSchema
      .describe(
        'What the reranker did on this search. `applied` means it ordered the results, which carry `rerankerScore`. `unavailable` means it was attempted but could not complete, so results are in vector order with no `rerankerScore` — the search still succeeded, and is worth retrying. `skipped` means there was nothing to rank. `not_requested` means `rerankerEnabled` was absent or false.'
      )
      .meta({ examples: ['applied'] }),
  })
  .meta({
    id: 'V2KnowledgeSearchData',
    title: 'Knowledge search data',
    description: 'Results and execution context for a knowledge search.',
  })
export type V2KnowledgeSearchData = z.output<typeof v2KnowledgeSearchDataSchema>

/** Upload carries the workspace as a query param so auth runs before the multipart body is buffered. */
export const v2UploadKnowledgeDocumentQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the knowledge base.'),
  })
  .strict()
export type V2UploadKnowledgeDocumentQuery = z.output<typeof v2UploadKnowledgeDocumentQuerySchema>

export const v2KnowledgeBaseParamsSchema = knowledgeBaseParamsSchema.omit({ id: true }).extend({
  knowledgeBaseId: knowledgeBaseParamsSchema.shape.id.describe('Unique knowledge base identifier.'),
})
export type V2KnowledgeBaseParams = z.output<typeof v2KnowledgeBaseParamsSchema>

export const v2KnowledgeDocumentParamsSchema = knowledgeDocumentParamsSchema
  .omit({ id: true })
  .extend({
    knowledgeBaseId: knowledgeDocumentParamsSchema.shape.id.describe(
      'Unique knowledge base identifier.'
    ),
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
        .shape.recipe.describe(
          `Optional document processing recipe. One of: ${KNOWLEDGE_DOCUMENT_UPLOAD_RECIPES.join(', ')}.`
        ),
      lang: knowledgeDocumentUploadMetadataSchema.shape.processingOptions
        .unwrap()
        .shape.lang.describe(
          'Optional document language: hyphen-separated letter and digit subtags such as `en`, `en-US`, or `zh-Hant-TW`. Only that shape is validated, not full BCP-47 conformance.'
        ),
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
 * Listing scopes. Two-valued, mirroring `v2FileScopeSchema`, `v2TableScopeSchema`
 * and `v2WorkflowScopeSchema` rather than the three-valued internal
 * `KnowledgeBaseScope`: `all` drops the `deleted_at` predicate entirely and
 * degrades to a full workspace scan, and a caller that wants both sets can walk
 * two pages.
 */
export const v2KnowledgeBaseScopeSchema = z.enum(['active', 'archived'])

export type V2KnowledgeBaseScope = z.output<typeof v2KnowledgeBaseScopeSchema>

/**
 * KB list query: v1's workspace scope plus the v2 search/sort convention, a
 * lifecycle scope, and a folder filter. v1's own list query stays untouched — it
 * does not implement these, and advertising a param a route ignores is worse than
 * not having it.
 */
export const v2ListKnowledgeBasesQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace whose knowledge bases should be listed.'),
    scope: v2KnowledgeBaseScopeSchema
      .default('active')
      .describe(
        'Lifecycle scope: active or archived knowledge bases. Use Restore Knowledge Base to recover archived entries. Folder paths resolve only active folders, so filtering by an archived folder returns no matches.'
      ),
    folderPath: v2FolderPathInputSchema
      .optional()
      .describe(`Restrict results to knowledge bases in this folder. ${V2_FOLDER_FILTER_MISS}`),
    search: v2SearchSchema,
    ...v2SortFields(v2KnowledgeBaseSortFields, { sortBy: 'createdAt', sortOrder: 'asc' }),
    ...v2PaginationFields({ description: 'Maximum knowledge bases to return per page.' }),
  })
  .strict()

export type V2ListKnowledgeBasesQuery = z.output<typeof v2ListKnowledgeBasesQuerySchema>

const v2KnowledgeChunkingConfigInputSchema = withChunkingConfigRules(
  chunkingConfigFieldsSchema
    .extend({
      maxSize: chunkingConfigFieldsSchema.shape.maxSize
        .default(DEFAULT_CHUNKING_CONFIG.maxSize)
        .describe('Maximum chunk size in tokens.')
        .meta({ examples: [1024] }),
      minSize: chunkingConfigFieldsSchema.shape.minSize
        .default(DEFAULT_CHUNKING_CONFIG.minSize)
        .describe('Minimum chunk size in characters.')
        .meta({ examples: [100] }),
      overlap: chunkingConfigFieldsSchema.shape.overlap
        .default(DEFAULT_CHUNKING_CONFIG.overlap)
        .describe('Number of overlapping characters between adjacent chunks.')
        .meta({ examples: [200] }),
      strategy: chunkingConfigFieldsSchema.shape.strategy.describe(
        'Chunking strategy applied during document processing. `regex` additionally requires `strategyOptions.pattern`.'
      ),
      strategyOptions: chunkingConfigFieldsSchema.shape.strategyOptions.describe(
        'Strategy-specific tuning options. `strictBoundaries` is accepted only with `strategy: "regex"`.'
      ),
    })
    .strict()
).meta({
  id: 'V2KnowledgeChunkingConfigInput',
  title: 'Knowledge chunking configuration input',
  description:
    'Chunking configuration applied when processing documents. On update this object is replaced wholesale rather than merged, so a caller preserving one key must read, modify, and write the whole object back.',
})

export const v2CreateKnowledgeBaseBodySchema = v1CreateKnowledgeBaseBodySchema
  .extend({
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
 * KB list, keyset-paginated over the active sort. Lifecycle scope, search, folder
 * filter, and sort all run in the query, not over its result.
 *
 * Archived knowledge bases are `scope=archived` on this list rather than a
 * sibling path, matching files, tables, and workflows. The two reads bind one
 * semantic operation — the archived set is the same rows under a different
 * `deleted_at` predicate, not a different resource.
 *
 * Before pagination this list returned `nextCursor` while rejecting `limit` and
 * `cursor` outright, so it advertised a pagination scheme no caller could
 * drive.
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
  query: noInputSchema,
  body: v2CreateKnowledgeBaseBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2KnowledgeBaseSchema),
    status: 201,
  },
})

export const v2GetKnowledgeBaseContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/knowledge/[knowledgeBaseId]',
  params: v2KnowledgeBaseParamsSchema,
  query: v1KnowledgeWorkspaceQuerySchema
    .extend({
      workspaceId: v1KnowledgeWorkspaceQuerySchema.shape.workspaceId.describe(
        'Workspace that owns the knowledge base.'
      ),
    })
    .strict(),
  response: {
    mode: 'json',
    schema: v2DataResponse(v2KnowledgeBaseSchema),
  },
})

export const v2ExportKnowledgeBaseQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the knowledge base.'),
    vectors: booleanQueryFlagSchema
      .optional()
      .default(true)
      .describe(
        'Include chunk vectors so an import into a deployment with the same embedding model reuses them instead of re-embedding.'
      ),
  })
  .strict()

export type V2ExportKnowledgeBaseQuery = z.input<typeof v2ExportKnowledgeBaseQuerySchema>

export const v2ExportKnowledgeBaseContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/knowledge/[knowledgeBaseId]/export',
  params: v2KnowledgeBaseParamsSchema,
  query: v2ExportKnowledgeBaseQuerySchema,
  response: { mode: 'binary' },
})

/**
 * PATCH, not PUT: every mutable field is optional and a `superRefine` requires
 * at least one, so this is a partial update rather than a replacement.
 */
export const v2UpdateKnowledgeBaseContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/knowledge/[knowledgeBaseId]',
  query: noInputSchema,
  params: v2KnowledgeBaseParamsSchema,
  body: v2UpdateKnowledgeBaseBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2KnowledgeBaseSchema),
  },
})

export const v2DeleteKnowledgeBaseContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/knowledge/[knowledgeBaseId]',
  params: v2KnowledgeBaseParamsSchema,
  query: v1KnowledgeWorkspaceQuerySchema
    .extend({
      workspaceId: v1KnowledgeWorkspaceQuerySchema.shape.workspaceId.describe(
        'Workspace that owns the knowledge base.'
      ),
    })
    .strict(),
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
  response: { mode: 'json', schema: v2CursorListResponse(v2FolderSchema, { paged: false }) },
})

export const v2CreateKnowledgeFolderContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/knowledge/folders',
  query: noInputSchema,
  body: v2CreateFolderBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2FolderSchema), status: 201 },
})

export const v2RelocateKnowledgeFolderContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/knowledge/folders',
  query: noInputSchema,
  body: v2RelocateFolderBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2FolderSchema) },
})

export const v2DeleteKnowledgeFolderContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/knowledge/folders',
  query: v2DeleteFolderQuerySchema,
  response: { mode: 'json', schema: v2DataResponse(v2DeleteKnowledgeFolderDataSchema) },
})

export const v2KnowledgeSearchTagFilterSchema = v1SearchTagFilterSchema
  /** `safeExtend` so the base schema's `between` rule survives the redescribe. */
  .safeExtend({
    tagName: v1SearchTagFilterSchema.shape.tagName
      .describe('Display name of the tag to filter.')
      .meta({ examples: ['category'] }),
    fieldType: v1SearchTagFilterSchema.shape.fieldType.describe('Tag field type.'),
    operator: v1SearchTagFilterSchema.shape.operator
      .describe(
        `Comparison operator; valid operators depend on the field type. Text tags accept ${KNOWLEDGE_TAG_FILTER_OPERATORS_BY_FIELD_TYPE.text.join(', ')}; number and date tags accept ${KNOWLEDGE_TAG_FILTER_OPERATORS_BY_FIELD_TYPE.number.join(', ')}; boolean tags accept ${KNOWLEDGE_TAG_FILTER_OPERATORS_BY_FIELD_TYPE.boolean.join(', ')}. An operator the tag's field type does not implement is rejected, never ignored.`
      )
      .meta({ examples: ['eq'] }),
    value: v1SearchTagFilterSchema.shape.value
      .describe('Tag value to compare against.')
      .meta({ examples: ['billing'] }),
    valueTo: v1SearchTagFilterSchema.shape.valueTo.describe(
      'Upper bound for the `between` operator, and required whenever that operator is used.'
    ),
  })
  /**
   * Strict for the same reason the search body is: Zod strips what it does not
   * declare, so a mis-cased `valueto` left a `between` filter with no upper
   * bound and the document list answered 200 with the whole knowledge base. v1
   * keeps its historical lenient parse.
   */
  .strict()
  .meta({
    id: 'V2KnowledgeSearchTagFilter',
    title: 'Knowledge search tag filter',
    description: 'A structured tag filter applied to knowledge search.',
  })

/** Maximum tag filters accepted on one document-list or search request. */
export const MAX_V2_KNOWLEDGE_DOCUMENT_TAG_FILTERS = 10

/**
 * Maximum `query` length accepted by knowledge search.
 *
 * Every knowledge-base-eligible embedding model caps a single input at 8192
 * tokens, and the embedding client silently truncates anything longer, so a
 * caller paid for a billed search whose query was mostly discarded. The bound is
 * that ceiling expressed in characters using the four-characters-per-token
 * conversion the tokenizer's own fallback uses, which is generous enough that
 * nothing that could have been embedded whole is rejected.
 */
export const MAX_V2_KNOWLEDGE_SEARCH_QUERY_LENGTH = 8192 * 4

/**
 * Rebuilt from the v1 shape rather than extended from the v1 schema: v1 carries
 * the "query or tagFilters" rule as a bare `.refine`, which reports at path `[]`,
 * so no client could attach the failure to a field. The rule is restated below as
 * a `superRefine` with a `path` — extending v1 would inherit the pathless issue
 * alongside it and report the same violation twice.
 */
export const v2KnowledgeSearchBodySchema = z
  .object({
    ...v1KnowledgeSearchBodySchema.shape,
    workspaceId: v1KnowledgeSearchBodySchema.shape.workspaceId.describe(
      'Workspace that owns the knowledge bases.'
    ),
    knowledgeBaseIds: v1KnowledgeSearchBodySchema.shape.knowledgeBaseIds
      .describe('One knowledge base identifier or an array of up to 20 identifiers.')
      .meta({ examples: [['7c9e6679-7425-40de-944b-e07fc1f90ae7']] }),
    query: z
      .string()
      .max(
        MAX_V2_KNOWLEDGE_SEARCH_QUERY_LENGTH,
        `query cannot exceed ${MAX_V2_KNOWLEDGE_SEARCH_QUERY_LENGTH} characters`
      )
      .optional()
      .describe(
        `Natural-language query; required when tag filters are omitted. At most ${MAX_V2_KNOWLEDGE_SEARCH_QUERY_LENGTH} characters — longer text exceeds the embedding model's per-input token ceiling and would be truncated before the billed search ran.`
      )
      .meta({ examples: ['How do I reset my password?'] }),
    topK: z
      .number()
      .min(1, 'topK must be at least 1')
      .max(100, 'topK cannot exceed 100')
      .default(10)
      .describe(
        'Maximum number of search results to return. Must be a whole number between 1 and 100.'
      ),
    tagFilters: z
      .array(v2KnowledgeSearchTagFilterSchema)
      .max(
        MAX_V2_KNOWLEDGE_DOCUMENT_TAG_FILTERS,
        `tagFilters cannot contain more than ${MAX_V2_KNOWLEDGE_DOCUMENT_TAG_FILTERS} filters`
      )
      .optional()
      .describe(
        `Up to ${MAX_V2_KNOWLEDGE_DOCUMENT_TAG_FILTERS} filters combined with AND; repeating a tag narrows results. To express OR, run separate searches. Every tag must exist with the same slot and field type in each selected knowledge base or the request is rejected. List valid names with the knowledge-base tag-list operation.`
      ),
    searchMode: v1KnowledgeSearchBodySchema.shape.searchMode.describe(
      'Retrieval strategy: vector is semantic-only, while hybrid also runs full-text search.'
    ),
    rerankerEnabled: z
      .boolean()
      .optional()
      .describe(
        'Re-order retrieved chunks with a reranking model before truncating to `topK`. Ignored for a tag-only search, and billed as an additional search unit. Reranking is best-effort — a provider failure falls back to vector ordering, so check `rerankerStatus` on the response.'
      ),
    /**
     * Defaulted, matching the internal search contract this one otherwise
     * mirrors. Without it, `rerankerEnabled: true` on its own satisfied the
     * schema, failed the use case's `input.rerankerModel` guard, and returned a
     * 200 in plain vector order — while still paying for the four-times-`topK`
     * candidate retrieval that reranking widens. The old description, "required
     * for reranking to run", documented the trap instead of removing it.
     */
    rerankerModel: rerankerModelSchema
      .optional()
      .default(DEFAULT_RERANKER_MODEL)
      .describe(
        `Reranking model to use when \`rerankerEnabled\` is true. Defaults to \`${DEFAULT_RERANKER_MODEL}\`.`
      ),
    rerankerInputCount: z
      .number()
      .int('rerankerInputCount must be a whole number')
      .min(1, 'rerankerInputCount must be at least 1')
      .max(100, 'rerankerInputCount cannot exceed 100')
      .optional()
      .describe(
        'How many candidate chunks to retrieve before reranking. Defaults to four times `topK`, capped at 100. A larger pool costs more retrieval work but gives the reranker more to choose from.'
      ),
  })
  /**
   * Strict because the dropped keys are the billed ones. Zod strips what it
   * does not declare, so a mis-cased `rerankerenabled` or `topk` returned 200
   * with reranking off and `topK` silently back at its default — the caller was
   * charged for a search it did not configure and had no signal that its
   * parameters never arrived.
   */
  .strict()
  /**
   * A search with neither a query nor a tag filter has nothing to retrieve on.
   * Reported on `query`, the field a caller who sent neither is most likely to be
   * missing, so the failure lands on an input instead of on the request as a whole.
   */
  .superRefine((body, ctx) => {
    const hasQuery = Boolean(body.query && body.query.trim().length > 0)
    const hasTagFilters = Boolean(body.tagFilters && body.tagFilters.length > 0)
    if (!hasQuery && !hasTagFilters) {
      ctx.addIssue({
        code: 'custom',
        path: ['query'],
        message: 'Either query or tagFilters must be provided',
      })
    }
  })
export type V2KnowledgeSearchBody = z.input<typeof v2KnowledgeSearchBodySchema>

export const v2SearchKnowledgeContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/knowledge/search',
  query: noInputSchema,
  body: v2KnowledgeSearchBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2KnowledgeSearchDataSchema),
  },
})

const v2KnowledgeDocumentTagFiltersSchema = z
  .array(v2KnowledgeSearchTagFilterSchema)
  .max(
    MAX_V2_KNOWLEDGE_DOCUMENT_TAG_FILTERS,
    `tagFilters cannot contain more than ${MAX_V2_KNOWLEDGE_DOCUMENT_TAG_FILTERS} filters`
  )

export type V2KnowledgeDocumentTagFilters = z.output<typeof v2KnowledgeDocumentTagFiltersSchema>

export type ParsedV2KnowledgeTagFilters =
  | { success: true; filters: V2KnowledgeDocumentTagFilters | undefined }
  | { success: false; message: string }

/**
 * Decodes the JSON-encoded `tagFilters` query param.
 *
 * A query param cannot carry a structured array, so the filters travel as JSON
 * text and are validated here rather than by the query schema. The result is a
 * discriminated union so the caller renders a 400 — no input can escape as an
 * unhandled parse failure.
 */
export function parseV2KnowledgeTagFiltersParam(
  value: string | undefined
): ParsedV2KnowledgeTagFilters {
  if (value === undefined) return { success: true, filters: undefined }
  let decoded: unknown
  try {
    decoded = JSON.parse(value)
  } catch {
    return { success: false, message: 'tagFilters must be a JSON-encoded array of tag filters' }
  }
  const parsed = v2KnowledgeDocumentTagFiltersSchema.safeParse(decoded)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      success: false,
      message: `tagFilters is not a valid tag filter array${
        issue ? `: ${[...issue.path, issue.message].join(' ')}` : ''
      }`,
    }
  }
  return { success: true, filters: parsed.data }
}

/**
 * Document list query: the v1 filter and sort shape, with `offset` swapped for
 * an opaque `cursor` and with `limit`, `cursor`, and `search` taken from the
 * shared v2 schemas rather than v1. Total doc count is available as `docCount`
 * on the knowledge base.
 *
 * Sharing `search` is what closed the last gap: the v1 shape was an unbounded,
 * empty-accepting string, so `?search=` answered 200 with the full page here
 * while the sibling `GET /knowledge?search=` answered 400, and the term reached
 * an unindexed filename `LIKE` scan with no length ceiling.
 */
export const v2ListKnowledgeDocumentsQuerySchema = v1ListKnowledgeDocumentsQuerySchema
  .omit({ offset: true })
  .extend({
    workspaceId: v1ListKnowledgeDocumentsQuerySchema.shape.workspaceId.describe(
      'Workspace that owns the knowledge base.'
    ),
    ...v2PaginationFields({ description: 'Maximum documents to return per page.' }),
    search: v2SearchSchema.describe(
      'Case-insensitive substring match against the document filename.'
    ),
    enabledFilter: v1ListKnowledgeDocumentsQuerySchema.shape.enabledFilter.describe(
      'Filter by whether documents are enabled for search.'
    ),
    sortBy: v1ListKnowledgeDocumentsQuerySchema.shape.sortBy.describe(
      `Field used to sort the result. ${nameSortCollation('filename')}`
    ),
    sortOrder: v1ListKnowledgeDocumentsQuerySchema.shape.sortOrder.describe('Sort direction.'),
    tagFilters: z
      .string()
      .optional()
      .describe(
        `A JSON-encoded array of at most ${MAX_V2_KNOWLEDGE_DOCUMENT_TAG_FILTERS} tag filters, using the same display-name shape as knowledge search: \`[{"tagName":"category","operator":"eq","value":"billing"}]\`. Every filter must hold, including two that name the same tag. A name that is not defined in this knowledge base is rejected, never ignored.`
      )
      .meta({ examples: ['[{"tagName":"category","operator":"eq","value":"billing"}]'] }),
  })
  .strict()
export type V2ListKnowledgeDocumentsQuery = z.output<typeof v2ListKnowledgeDocumentsQuerySchema>

export const v2ListKnowledgeDocumentsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/knowledge/[knowledgeBaseId]/documents',
  params: v2KnowledgeBaseParamsSchema,
  query: v2ListKnowledgeDocumentsQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2KnowledgeTaggedDocumentSchema),
  },
})

export const v2UploadKnowledgeDocumentContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/knowledge/[knowledgeBaseId]/documents',
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
  path: '/api/v2/knowledge/[knowledgeBaseId]/documents/uploads',
  query: noInputSchema,
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
  path: '/api/v2/knowledge/[knowledgeBaseId]/documents/uploads/[uploadId]',
  params: v2KnowledgeDocumentUploadParamsSchema,
  query: v2UploadKnowledgeDocumentQuerySchema,
  headers: v2UploadTokenHeadersSchema,
  response: { mode: 'json', schema: v2DataResponse(v2KnowledgeDocumentUploadSchema) },
})

export const v2CreateKnowledgeDocumentUploadPartUrlsContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/knowledge/[knowledgeBaseId]/documents/uploads/[uploadId]/parts',
  params: v2KnowledgeDocumentUploadParamsSchema,
  query: v2UploadKnowledgeDocumentQuerySchema,
  headers: v2UploadTokenHeadersSchema,
  body: v2PartUrlsBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2PartUrlsDataSchema) },
})

export const v2CompleteKnowledgeDocumentUploadContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/knowledge/[knowledgeBaseId]/documents/uploads/[uploadId]/complete',
  params: v2KnowledgeDocumentUploadParamsSchema,
  query: v2UploadKnowledgeDocumentQuerySchema,
  headers: v2UploadTokenHeadersSchema,
  response: { mode: 'json', schema: v2DataResponse(v2KnowledgeDocumentUploadSchema) },
})

export const v2GetKnowledgeDocumentContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]',
  params: v2KnowledgeDocumentParamsSchema,
  query: v1KnowledgeWorkspaceQuerySchema
    .extend({
      workspaceId: v1KnowledgeWorkspaceQuerySchema.shape.workspaceId.describe(
        'Workspace that owns the knowledge base.'
      ),
    })
    .strict(),
  response: {
    mode: 'json',
    schema: v2DataResponse(v2KnowledgeDocumentSchema),
  },
})

/**
 * A tag definition — the mapping between the display name reads and filters use
 * and the slot writes address.
 */
export const v2KnowledgeTagSchema = z
  .object({
    id: z.string().describe('Tag definition ID used by Update Tag and Delete Tag.'),
    displayName: z
      .string()
      .describe('Display name used by tag filters and by tag values on document reads.')
      .meta({ examples: ['category'] }),
    tagSlot: z
      .string()
      .describe(
        'Storage slot the tag occupies. Document writes set tag values by slot (`tag1`..`tag7`).'
      )
      .meta({ examples: ['tag1'] }),
    fieldType: z
      .string()
      .describe('Value type stored in the slot; it determines the valid filter operators.')
      .meta({ examples: ['text'] }),
  })
  .strict()
  .meta({
    id: 'V2KnowledgeTag',
    title: 'Knowledge tag',
    description: 'A tag defined on a knowledge base, and the slot it is stored in.',
  })
export type V2KnowledgeTag = z.output<typeof v2KnowledgeTagSchema>

/**
 * Tag vocabulary for one knowledge base. A full-set list: the number of tags is
 * bounded by the fixed slot table, so the whole set is always one page and
 * `nextCursor` is always null.
 */
export const v2ListKnowledgeTagsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/knowledge/[knowledgeBaseId]/tags',
  params: v2KnowledgeBaseParamsSchema,
  query: v1KnowledgeWorkspaceQuerySchema
    .extend({
      workspaceId: v1KnowledgeWorkspaceQuerySchema.shape.workspaceId.describe(
        'Workspace that owns the knowledge base.'
      ),
    })
    .strict(),
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2KnowledgeTagSchema, { paged: false }),
  },
})

const v2UpdateKnowledgeDocumentTagSlotSchema = z
  .string()
  .max(1000, 'Tag values cannot exceed 1000 characters')

/**
 * Number, date and boolean tag slots take their natural JSON type, mirroring
 * how a document read projects them. The storage columns are typed
 * (`double precision`, `timestamp`, `boolean`), so accepting a loose string
 * here would push a malformed value onto a parser that answers `null` — the
 * caller would get 200 and a silently cleared tag instead of a 400 naming the
 * field.
 */
const v2UpdateKnowledgeDocumentNumberSlotSchema = z
  .number()
  .finite('Number tag values must be a finite number')

const v2UpdateKnowledgeDocumentDateSlotSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date tag values must be formatted YYYY-MM-DD')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number)
    const date = new Date(year, month - 1, day)
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
  }, 'Date tag values must be a real calendar date')

const v2UpdateKnowledgeDocumentBooleanSlotSchema = z.boolean()

/** The typed tag slots, declared once so the body and its mutex refine agree. */
const v2UpdateKnowledgeDocumentTagSlotFields = {
  tag1: v2UpdateKnowledgeDocumentTagSlotSchema.optional().describe('New value for tag slot 1.'),
  tag2: v2UpdateKnowledgeDocumentTagSlotSchema.optional().describe('New value for tag slot 2.'),
  tag3: v2UpdateKnowledgeDocumentTagSlotSchema.optional().describe('New value for tag slot 3.'),
  tag4: v2UpdateKnowledgeDocumentTagSlotSchema.optional().describe('New value for tag slot 4.'),
  tag5: v2UpdateKnowledgeDocumentTagSlotSchema.optional().describe('New value for tag slot 5.'),
  tag6: v2UpdateKnowledgeDocumentTagSlotSchema.optional().describe('New value for tag slot 6.'),
  tag7: v2UpdateKnowledgeDocumentTagSlotSchema.optional().describe('New value for tag slot 7.'),
  number1: v2UpdateKnowledgeDocumentNumberSlotSchema
    .optional()
    .describe('New value for number tag slot 1.'),
  number2: v2UpdateKnowledgeDocumentNumberSlotSchema
    .optional()
    .describe('New value for number tag slot 2.'),
  number3: v2UpdateKnowledgeDocumentNumberSlotSchema
    .optional()
    .describe('New value for number tag slot 3.'),
  number4: v2UpdateKnowledgeDocumentNumberSlotSchema
    .optional()
    .describe('New value for number tag slot 4.'),
  number5: v2UpdateKnowledgeDocumentNumberSlotSchema
    .optional()
    .describe('New value for number tag slot 5.'),
  date1: v2UpdateKnowledgeDocumentDateSlotSchema
    .optional()
    .describe('New value for date tag slot 1, formatted YYYY-MM-DD.'),
  date2: v2UpdateKnowledgeDocumentDateSlotSchema
    .optional()
    .describe('New value for date tag slot 2, formatted YYYY-MM-DD.'),
  boolean1: v2UpdateKnowledgeDocumentBooleanSlotSchema
    .optional()
    .describe('New value for boolean tag slot 1.'),
  boolean2: v2UpdateKnowledgeDocumentBooleanSlotSchema
    .optional()
    .describe('New value for boolean tag slot 2.'),
  boolean3: v2UpdateKnowledgeDocumentBooleanSlotSchema
    .optional()
    .describe('New value for boolean tag slot 3.'),
} as const

/** Every writable tag slot, in the order `TAG_SLOT_CONFIG` declares them. */
export const V2_WRITABLE_TAG_SLOTS = Object.keys(
  v2UpdateKnowledgeDocumentTagSlotFields
) as ReadonlyArray<keyof typeof v2UpdateKnowledgeDocumentTagSlotFields>

/**
 * Document update body.
 *
 * Only the fields a caller owns are accepted. Derived indexing state
 * (`chunkCount`, `tokenCount`, `characterCount`, `processingStatus`,
 * `processingError`) is deliberately absent: it is written by the processing
 * pipeline, and letting a caller assert `processingStatus: "completed"` on a
 * document that was never indexed would silently corrupt search results.
 *
 * `retryProcessing` requeues a failed or stuck document and is mutually
 * exclusive with the field updates — the retry runs instead of them, so
 * accepting both would silently drop half the request.
 */
export const v2UpdateKnowledgeDocumentBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the knowledge base.'),
    filename: z
      .string()
      .trim()
      .min(1, 'filename cannot be empty')
      .max(255, 'filename is too long')
      .optional()
      .describe('New filename for the document.')
      .meta({ examples: ['getting-started-v2.pdf'] }),
    enabled: z
      .boolean()
      .optional()
      .describe('Whether the document participates in search. Disabling keeps it indexed.'),
    ...v2UpdateKnowledgeDocumentTagSlotFields,
    retryProcessing: z
      .literal(true)
      .optional()
      .describe(
        'Requeue a failed or stuck document for processing. Send it alone — no other field may accompany it — and it answers with a queue acknowledgement rather than the document.'
      ),
  })
  .strict()
  .superRefine((body, ctx) => {
    const mutatedFields = (['filename', 'enabled', ...V2_WRITABLE_TAG_SLOTS] as const).filter(
      (field) => body[field] !== undefined
    )
    if (body.retryProcessing && mutatedFields.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['retryProcessing'],
        message: `retryProcessing cannot be combined with ${mutatedFields.join(', ')}; send it on its own request`,
      })
      return
    }
    if (!body.retryProcessing && mutatedFields.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['filename'],
        message: 'At least one of filename, enabled, tag1-tag7, or retryProcessing is required',
      })
    }
  })
export type V2UpdateKnowledgeDocumentBody = z.input<typeof v2UpdateKnowledgeDocumentBodySchema>

/** Acknowledgement for a document requeued by `retryProcessing`. */
export const v2KnowledgeDocumentProcessingSchema = z
  .object({
    id: z.string().describe('Identifier of the requeued document.'),
    queued: z.literal(true).describe('Confirms that processing was requeued.'),
    processingStatus: z
      .string()
      .describe('Processing state the document was moved to.')
      .meta({ examples: ['pending'] }),
    message: z.string().describe('Human-readable outcome of the requeue.'),
  })
  .strict()
  .meta({
    id: 'V2KnowledgeDocumentProcessing',
    title: 'Knowledge document processing acknowledgement',
    description: 'Acknowledgement returned when a document is requeued for processing.',
  })

/**
 * The update response is the updated document with its tag values, except for a
 * `retryProcessing` request, which returns the requeue acknowledgement — the
 * document's indexing state is not yet settled at that point, so returning it
 * would be a snapshot of work in flight. The acknowledgement carries
 * `queued: true`, which the document never does.
 *
 * The updated document omits the connector provenance the detail read carries:
 * the update writes and returns the document row alone. Re-read with GET for the
 * full detail.
 */
const v2UpdateKnowledgeDocumentDataSchema = z.union([
  v2KnowledgeTaggedDocumentSchema,
  v2KnowledgeDocumentProcessingSchema,
])

export const v2UpdateKnowledgeDocumentContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]',
  query: noInputSchema,
  params: v2KnowledgeDocumentParamsSchema,
  body: v2UpdateKnowledgeDocumentBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2UpdateKnowledgeDocumentDataSchema),
  },
})

/** Maximum documents addressable by identifier in one bulk request. */
export const MAX_V2_BULK_KNOWLEDGE_DOCUMENTS = 100

/**
 * Bulk document body.
 *
 * `enable` and `disable` only. A bulk `delete` is deliberately absent: the
 * underlying bulk operation records no semantic audit, so a public bulk delete
 * would remove a knowledge base's documents leaving no `DOCUMENT_DELETED`
 * entries, while `DELETE /api/v2/knowledge/{knowledgeBaseId}/documents/{documentId}` audits
 * every single deletion. Delete documents one request at a time.
 */
export const v2BulkKnowledgeDocumentsBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the knowledge base.'),
    operation: z
      .enum(['enable', 'disable'], {
        error: 'operation: expected one of "enable" | "disable"',
      })
      .describe('Whether the selected documents become enabled or disabled for search.'),
    documentIds: z
      .array(z.string().min(1, 'documentIds entries cannot be empty'))
      .min(1, 'documentIds cannot be empty')
      .max(
        MAX_V2_BULK_KNOWLEDGE_DOCUMENTS,
        `documentIds cannot contain more than ${MAX_V2_BULK_KNOWLEDGE_DOCUMENTS} documents`
      )
      .optional()
      .describe('Documents to update, by identifier.'),
    selectAll: z
      .literal(true)
      .optional()
      .describe(
        'Update every document in the knowledge base instead of an explicit list, narrowed by `enabledFilter`.'
      ),
    enabledFilter: z
      .enum(['all', 'enabled', 'disabled'])
      .optional()
      .describe('With `selectAll`, restrict the update to documents in this state.'),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.selectAll && body.documentIds) {
      ctx.addIssue({
        code: 'custom',
        path: ['documentIds'],
        message: 'documentIds cannot be combined with selectAll',
      })
    }
    if (!body.selectAll && !body.documentIds) {
      ctx.addIssue({
        code: 'custom',
        path: ['documentIds'],
        message: 'Either documentIds or selectAll is required',
      })
    }
    if (body.enabledFilter && !body.selectAll) {
      ctx.addIssue({
        code: 'custom',
        path: ['enabledFilter'],
        message: 'enabledFilter applies only with selectAll',
      })
    }
  })
export type V2BulkKnowledgeDocumentsBody = z.input<typeof v2BulkKnowledgeDocumentsBodySchema>

/** Bulk update outcome — one object, not a page. */
export const v2BulkKnowledgeDocumentsDataSchema = z
  .object({
    operation: z.enum(['enable', 'disable']).describe('Operation that was applied.'),
    updatedCount: z
      .number()
      .int()
      .nonnegative()
      .describe('Number of documents the operation changed.')
      .meta({ examples: [42] }),
    documentIds: z
      .array(z.string())
      .optional()
      .describe(
        'Identifiers of the documents the operation changed. Present only for an explicit `documentIds` request, which is bounded to ' +
          `${MAX_V2_BULK_KNOWLEDGE_DOCUMENTS} documents; a \`selectAll\` request omits it because the selection is unbounded, and reports \`updatedCount\` instead.`
      ),
  })
  .strict()
  .meta({
    id: 'V2BulkKnowledgeDocumentsData',
    title: 'Bulk knowledge document update data',
    description: 'Outcome of a bulk enable or disable across knowledge documents.',
  })

export const v2BulkUpdateKnowledgeDocumentsContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/knowledge/[knowledgeBaseId]/documents',
  query: noInputSchema,
  params: v2KnowledgeBaseParamsSchema,
  body: v2BulkKnowledgeDocumentsBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2BulkKnowledgeDocumentsDataSchema),
  },
})

export const v2DeleteKnowledgeDocumentContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]',
  params: v2KnowledgeDocumentParamsSchema,
  query: v1KnowledgeWorkspaceQuerySchema
    .extend({
      workspaceId: v1KnowledgeWorkspaceQuerySchema.shape.workspaceId.describe(
        'Workspace that owns the knowledge base.'
      ),
    })
    .strict(),
  response: {
    mode: 'json',
    schema: v2DataResponse(v2KnowledgeDeleteDataSchema),
  },
})

export const v2KnowledgeConnectorSchema = z
  .object({
    id: z.string().min(1).describe('Unique connector identifier.'),
    knowledgeBaseId: z.string().min(1).describe('Knowledge base synced by the connector.'),
    connectorType: z.string().min(1).describe('Registered external source type.'),
    credentialId: z
      .string()
      .nullable()
      .describe('OAuth credential identifier, or null for API-key and unauthenticated sources.'),
    sourceConfig: z
      .record(z.string(), z.unknown().describe('Connector-specific source configuration value.'))
      .describe('Connector-specific source selection and filtering configuration.'),
    syncMode: z.string().describe('Synchronization mode used by the connector.'),
    syncIntervalMinutes: z
      .number()
      .int()
      .nonnegative()
      .describe('Scheduled synchronization interval in minutes; zero disables scheduled syncs.'),
    status: z
      .enum(['active', 'paused', 'pending', 'syncing', 'error', 'disabled'])
      .describe('Current connector state. `pending` means a sync is queued but not yet running.'),
    lastSyncAt: v2TimestampSchema
      .nullable()
      .describe('Time of the most recent synchronization, or null before the first sync.'),
    lastSyncError: z
      .string()
      .nullable()
      .describe('Most recent synchronization error, or null when none is recorded.'),
    lastSyncDocCount: z
      .number()
      .int()
      .nonnegative()
      .nullable()
      .describe('Documents observed by the most recent synchronization.'),
    nextSyncAt: v2TimestampSchema
      .nullable()
      .describe('Next scheduled synchronization time, or null when not scheduled.'),
    consecutiveFailures: z
      .number()
      .int()
      .nonnegative()
      .describe('Number of consecutive synchronization failures.'),
    createdAt: v2TimestampSchema.describe('Time the connector was created.'),
    updatedAt: v2TimestampSchema.describe('Time the connector was last updated.'),
  })
  .strict()
  .meta({
    id: 'V2KnowledgeConnector',
    title: 'Knowledge connector',
    description: 'An external document source linked to a knowledge base, without secret material.',
  })
export type V2KnowledgeConnector = z.output<typeof v2KnowledgeConnectorSchema>

export const v2KnowledgeConnectorSyncLogSchema = z
  .object({
    id: z.string().min(1).describe('Unique synchronization log identifier.'),
    connectorId: z.string().min(1).describe('Connector that produced the log.'),
    status: z.string().min(1).describe('Synchronization outcome or current state.'),
    startedAt: v2TimestampSchema.describe('Time synchronization started.'),
    completedAt: v2TimestampSchema
      .nullable()
      .describe('Time synchronization completed, or null while it is running.'),
    docsAdded: z.number().int().nonnegative().describe('Documents added.'),
    docsUpdated: z.number().int().nonnegative().describe('Documents updated.'),
    docsDeleted: z.number().int().nonnegative().describe('Documents deleted.'),
    docsUnchanged: z.number().int().nonnegative().describe('Documents unchanged.'),
    docsSkipped: z
      .number()
      .int()
      .nonnegative()
      .default(0)
      .describe('Documents intentionally skipped because they could not be indexed safely.'),
    docsFailed: z.number().int().nonnegative().describe('Documents that failed to synchronize.'),
    errorMessage: z.string().nullable().describe('Synchronization error, or null.'),
  })
  .strict()
  .meta({
    id: 'V2KnowledgeConnectorSyncLog',
    title: 'Knowledge connector sync log',
    description: 'One synchronization attempt for a knowledge connector.',
  })
export type V2KnowledgeConnectorSyncLog = z.output<typeof v2KnowledgeConnectorSyncLogSchema>

export const v2KnowledgeConnectorDetailSchema = v2KnowledgeConnectorSchema
  .extend({
    syncLogs: z
      .array(v2KnowledgeConnectorSyncLogSchema)
      .describe('The ten most recent synchronization attempts.'),
  })
  .meta({
    id: 'V2KnowledgeConnectorDetail',
    title: 'Knowledge connector detail',
    description: 'A knowledge connector and its recent synchronization history.',
  })
export type V2KnowledgeConnectorDetail = z.output<typeof v2KnowledgeConnectorDetailSchema>

export const v2KnowledgeConnectorDocumentSchema = z
  .object({
    id: z.string().min(1).describe('Unique document identifier.'),
    filename: z.string().min(1).describe('Document filename.'),
    externalId: z.string().nullable().describe('Identifier assigned by the external source.'),
    sourceUrl: z.string().nullable().describe('Original external source URL.'),
    enabled: z.boolean().describe('Whether the document is enabled for knowledge search.'),
    userExcluded: z
      .boolean()
      .describe('Whether a user explicitly excluded the document from connector sync results.'),
    createdAt: v2TimestampSchema.describe('Time the document was first synchronized.'),
    processingStatus: z.string().describe('Current document processing state.'),
  })
  .strict()
  .meta({
    id: 'V2KnowledgeConnectorDocument',
    title: 'Knowledge connector document',
    description: 'A knowledge document produced by an external connector.',
  })
export type V2KnowledgeConnectorDocument = z.output<typeof v2KnowledgeConnectorDocumentSchema>

export const v2KnowledgeConnectorParamsSchema = knowledgeConnectorParamsSchema
  .omit({ id: true })
  .extend({
    knowledgeBaseId: knowledgeConnectorParamsSchema.shape.id.describe(
      'Knowledge base that owns the connector.'
    ),
    connectorId: knowledgeConnectorParamsSchema.shape.connectorId.describe(
      'Connector selected for the operation.'
    ),
  })
  .strict()
export type V2KnowledgeConnectorParams = z.output<typeof v2KnowledgeConnectorParamsSchema>

export const v2KnowledgeConnectorWorkspaceQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the knowledge base.'),
  })
  .strict()
export type V2KnowledgeConnectorWorkspaceQuery = z.output<
  typeof v2KnowledgeConnectorWorkspaceQuerySchema
>

export const v2KnowledgeConnectorSortFields = ['connectorType', 'createdAt', 'updatedAt'] as const

export const v2ListKnowledgeConnectorsQuerySchema = v2KnowledgeConnectorWorkspaceQuerySchema
  .extend({
    ...v2SortFields(v2KnowledgeConnectorSortFields, {
      sortBy: 'createdAt',
      sortOrder: 'desc',
    }),
    ...v2PaginationFields({ description: 'Maximum connectors to return per page.' }),
  })
  .strict()
export type V2ListKnowledgeConnectorsQuery = z.output<typeof v2ListKnowledgeConnectorsQuerySchema>

export const v2CreateKnowledgeConnectorBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the knowledge base.'),
    connectorType: z.string().trim().min(1).max(100).describe('Registered connector type.'),
    credentialId: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .optional()
      .describe('OAuth credential identifier for connectors that require OAuth.'),
    apiKey: z
      .string()
      .min(1)
      .max(10_000)
      .optional()
      .describe('Write-only API key for connectors that use API-key authentication.'),
    sourceConfig: z
      .record(z.string(), z.unknown().describe('Connector-specific source configuration value.'))
      .describe('Connector-specific source selection and filtering configuration.'),
    syncIntervalMinutes: z
      .number()
      .int()
      .min(0)
      .max(525_600)
      .default(1440)
      .describe('Scheduled synchronization interval in minutes; zero disables scheduling.'),
  })
  .strict()
export type V2CreateKnowledgeConnectorBody = z.input<typeof v2CreateKnowledgeConnectorBodySchema>

export const v2UpdateKnowledgeConnectorBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the knowledge base.'),
    sourceConfig: z
      .record(z.string(), z.unknown().describe('Connector-specific source configuration value.'))
      .optional()
      .describe(
        'Replacement source selection and filtering configuration. Updating a runnable connector queues synchronization; paused connectors remain paused.'
      ),
    syncIntervalMinutes: z
      .number()
      .int()
      .min(0)
      .max(525_600)
      .optional()
      .describe('New scheduled synchronization interval in minutes.'),
    status: z.enum(['active', 'paused']).optional().describe('New connector state.'),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (
      body.sourceConfig === undefined &&
      body.syncIntervalMinutes === undefined &&
      body.status === undefined
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourceConfig'],
        message: 'At least one of sourceConfig, syncIntervalMinutes, or status is required',
      })
    }
  })
export type V2UpdateKnowledgeConnectorBody = z.input<typeof v2UpdateKnowledgeConnectorBodySchema>

export const v2DeleteKnowledgeConnectorQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the knowledge base.'),
    deleteDocuments: booleanQueryFlagSchema
      .optional()
      .default(false)
      .describe('Also permanently delete documents produced by this connector.'),
  })
  .strict()
export type V2DeleteKnowledgeConnectorQuery = z.input<typeof v2DeleteKnowledgeConnectorQuerySchema>

export const v2SyncKnowledgeConnectorBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the knowledge base.'),
    rehydrate: z
      .boolean()
      .optional()
      .default(false)
      .describe('Re-fetch and re-index every existing connector document.'),
  })
  .strict()
export type V2SyncKnowledgeConnectorBody = z.input<typeof v2SyncKnowledgeConnectorBodySchema>

export const v2ListKnowledgeConnectorDocumentsQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the knowledge base.'),
    includeExcluded: booleanQueryFlagSchema
      .optional()
      .default(false)
      .describe('Include documents explicitly excluded by a user.'),
    ...v2PaginationFields({ description: 'Maximum connector documents to return per page.' }),
  })
  .strict()
export type V2ListKnowledgeConnectorDocumentsQuery = z.output<
  typeof v2ListKnowledgeConnectorDocumentsQuerySchema
>

export const v2UpdateKnowledgeConnectorDocumentsBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the knowledge base.'),
    operation: z
      .enum(['restore', 'exclude'])
      .describe('Whether to restore or exclude the selected documents.'),
    documentIds: z
      .array(z.string().min(1).max(255))
      .min(1, 'At least one document id is required')
      .max(MAX_KNOWLEDGE_CONNECTOR_DOCUMENT_MUTATION_ITEMS)
      .describe('Connector document identifiers to update.'),
  })
  .strict()
export type V2UpdateKnowledgeConnectorDocumentsBody = z.input<
  typeof v2UpdateKnowledgeConnectorDocumentsBodySchema
>

export const v2KnowledgeConnectorDeleteDataSchema = z
  .object({
    id: z.string().min(1).describe('Deleted connector identifier.'),
    deleted: z.literal(true).describe('Whether the connector was deleted.'),
    documentsDeleted: z.number().int().nonnegative().describe('Connector documents deleted.'),
    documentsKept: z.number().int().nonnegative().describe('Connector documents retained.'),
  })
  .strict()
  .meta({
    id: 'V2KnowledgeConnectorDeleteData',
    title: 'Knowledge connector deletion data',
    description: 'Connector deletion acknowledgement and affected document counts.',
  })
export type V2KnowledgeConnectorDeleteData = z.output<typeof v2KnowledgeConnectorDeleteDataSchema>

export const v2KnowledgeConnectorSyncDataSchema = z
  .object({
    id: z.string().min(1).describe('Connector queued for synchronization.'),
    syncTriggered: z.literal(true).describe('Whether synchronization was queued.'),
  })
  .strict()
  .meta({
    id: 'V2KnowledgeConnectorSyncData',
    title: 'Knowledge connector sync data',
    description: 'Acknowledgement that connector synchronization was queued.',
  })
export type V2KnowledgeConnectorSyncData = z.output<typeof v2KnowledgeConnectorSyncDataSchema>

export const v2KnowledgeConnectorDocumentsUpdateDataSchema = z
  .object({
    operation: z.enum(['restore', 'exclude']).describe('Operation that was applied.'),
    updatedCount: z.number().int().nonnegative().describe('Documents changed.'),
    documentIds: z.array(z.string()).describe('Identifiers of documents changed.'),
  })
  .strict()
  .meta({
    id: 'V2KnowledgeConnectorDocumentsUpdateData',
    title: 'Knowledge connector documents update data',
    description: 'Outcome of restoring or excluding connector documents.',
  })
export type V2KnowledgeConnectorDocumentsUpdateData = z.output<
  typeof v2KnowledgeConnectorDocumentsUpdateDataSchema
>

export const v2ListKnowledgeConnectorsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/knowledge/[knowledgeBaseId]/connectors',
  params: v2KnowledgeBaseParamsSchema,
  query: v2ListKnowledgeConnectorsQuerySchema,
  response: { mode: 'json', schema: v2CursorListResponse(v2KnowledgeConnectorSchema) },
})

export const v2CreateKnowledgeConnectorContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/knowledge/[knowledgeBaseId]/connectors',
  params: v2KnowledgeBaseParamsSchema,
  query: noInputSchema,
  body: v2CreateKnowledgeConnectorBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2KnowledgeConnectorSchema), status: 201 },
})

export const v2GetKnowledgeConnectorContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/knowledge/[knowledgeBaseId]/connectors/[connectorId]',
  params: v2KnowledgeConnectorParamsSchema,
  query: v2KnowledgeConnectorWorkspaceQuerySchema,
  response: { mode: 'json', schema: v2DataResponse(v2KnowledgeConnectorDetailSchema) },
})

export const v2UpdateKnowledgeConnectorContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/knowledge/[knowledgeBaseId]/connectors/[connectorId]',
  params: v2KnowledgeConnectorParamsSchema,
  query: noInputSchema,
  body: v2UpdateKnowledgeConnectorBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2KnowledgeConnectorSchema) },
})

export const v2DeleteKnowledgeConnectorContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/knowledge/[knowledgeBaseId]/connectors/[connectorId]',
  params: v2KnowledgeConnectorParamsSchema,
  query: v2DeleteKnowledgeConnectorQuerySchema,
  response: { mode: 'json', schema: v2DataResponse(v2KnowledgeConnectorDeleteDataSchema) },
})

export const v2SyncKnowledgeConnectorContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/knowledge/[knowledgeBaseId]/connectors/[connectorId]/sync',
  params: v2KnowledgeConnectorParamsSchema,
  query: noInputSchema,
  body: v2SyncKnowledgeConnectorBodySchema,
  response: { mode: 'json', schema: v2DataResponse(v2KnowledgeConnectorSyncDataSchema) },
})

export const v2ListKnowledgeConnectorDocumentsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/knowledge/[knowledgeBaseId]/connectors/[connectorId]/documents',
  params: v2KnowledgeConnectorParamsSchema,
  query: v2ListKnowledgeConnectorDocumentsQuerySchema,
  response: { mode: 'json', schema: v2CursorListResponse(v2KnowledgeConnectorDocumentSchema) },
})

export const v2UpdateKnowledgeConnectorDocumentsContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/knowledge/[knowledgeBaseId]/connectors/[connectorId]/documents',
  params: v2KnowledgeConnectorParamsSchema,
  query: noInputSchema,
  body: v2UpdateKnowledgeConnectorDocumentsBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2KnowledgeConnectorDocumentsUpdateDataSchema),
  },
})

export const v2RestoreKnowledgeBaseBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the knowledge base.'),
  })
  .strict()

export type V2RestoreKnowledgeBaseBody = z.input<typeof v2RestoreKnowledgeBaseBodySchema>

/**
 * Restore is idempotent: restoring a knowledge base that is already active
 * answers `200` with its current representation rather than `409`, so a retry
 * after a dropped response cannot look like a failure. No audit entry is
 * recorded for that no-op.
 */
export const v2RestoreKnowledgeBaseContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/knowledge/[knowledgeBaseId]/restore',
  query: noInputSchema,
  params: v2KnowledgeBaseParamsSchema,
  body: v2RestoreKnowledgeBaseBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2KnowledgeBaseSchema),
  },
})

/**
 * Indexes files already in workspace storage.
 *
 * Without it a file the server already holds has to be downloaded and
 * re-uploaded byte-for-byte through `POST /api/v2/knowledge/{knowledgeBaseId}/documents`
 * purely to be indexed. Each reference is authorized against the *file's* own
 * canonical context, so naming a file the caller cannot read fails that entry
 * rather than the request.
 */
export const v2AddWorkspaceFilesToKnowledgeBaseBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns both the files and the base.'),
    fileReferences: z
      .array(z.string().min(1, 'fileReferences entries cannot be empty'))
      .min(1, 'fileReferences must contain at least one file')
      .max(
        MAX_V2_BULK_KNOWLEDGE_DOCUMENTS,
        `fileReferences cannot contain more than ${MAX_V2_BULK_KNOWLEDGE_DOCUMENTS} files`
      )
      .describe(
        'Workspace file identifiers or storage keys to index. Duplicates resolving to the same file are indexed once.'
      ),
  })
  .strict()

export type V2AddWorkspaceFilesToKnowledgeBaseBody = z.input<
  typeof v2AddWorkspaceFilesToKnowledgeBaseBodySchema
>

export const v2AddedWorkspaceFileDocumentSchema = z
  .object({
    documentId: z.string().describe('Identifier of the queued knowledge document.'),
    filename: z.string().describe('Filename recorded on the knowledge document.'),
    mimeType: z.string().describe('MIME type of the source workspace file.'),
    fileSize: z.number().int().nonnegative().describe('File size in bytes.'),
  })
  .strict()
  .meta({
    id: 'V2AddedWorkspaceFileDocument',
    title: 'Indexed workspace file',
    description: 'A workspace file that was queued for indexing into a knowledge base.',
  })

/**
 * Partial success is a `200` with a populated `failed` array, not a `207`: v2
 * has exactly two body shapes and a multi-status is neither. A reference lands
 * in `failed` when it names no readable file, exceeds the size limit, carries an
 * unsupported type, or carries secret provenance that blocks ingestion.
 */
export const v2AddWorkspaceFilesToKnowledgeBaseDataSchema = z
  .object({
    knowledgeBaseId: z.string().describe('Knowledge base the files were added to.'),
    added: z
      .array(v2AddedWorkspaceFileDocumentSchema)
      .describe('Files queued for indexing, in request order.'),
    failed: z
      .array(z.string())
      .describe('References that could not be indexed, echoed exactly as they were sent.'),
  })
  .strict()
  .meta({
    id: 'V2AddWorkspaceFilesToKnowledgeBaseData',
    title: 'Add workspace files data',
    description: 'Outcome of indexing workspace files into a knowledge base.',
  })

export const v2AddWorkspaceFilesToKnowledgeBaseContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/knowledge/[knowledgeBaseId]/documents/from-workspace-files',
  query: noInputSchema,
  params: v2KnowledgeBaseParamsSchema,
  body: v2AddWorkspaceFilesToKnowledgeBaseBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2AddWorkspaceFilesToKnowledgeBaseDataSchema),
  },
})
