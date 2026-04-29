import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import type { StrategyOptions } from '@/lib/chunkers/types'

const wireDateSchema = z.string()
const nullableWireDateSchema = z.string().nullable()

export const knowledgeScopeSchema = z.enum(['active', 'archived', 'all'])
export type KnowledgeScope = z.output<typeof knowledgeScopeSchema>

export const knowledgeBaseParamsSchema = z.object({
  id: z.string().min(1),
})

export const knowledgeDocumentParamsSchema = knowledgeBaseParamsSchema.extend({
  documentId: z.string().min(1),
})

export const knowledgeChunkParamsSchema = knowledgeDocumentParamsSchema.extend({
  chunkId: z.string().min(1),
})

export const knowledgeTagParamsSchema = knowledgeBaseParamsSchema.extend({
  tagId: z.string().min(1),
})

export const knowledgeConnectorParamsSchema = knowledgeBaseParamsSchema.extend({
  connectorId: z.string().min(1),
})

export const listKnowledgeBasesQuerySchema = z.object({
  workspaceId: z.string().min(1).optional(),
  scope: knowledgeScopeSchema.default('active'),
})

export const chunkingStrategyOptionsSchema = z
  .object({
    pattern: z.string().max(500).optional(),
    separators: z.array(z.string()).optional(),
    recipe: z.enum(['plain', 'markdown', 'code']).optional(),
  })
  .strict() satisfies z.ZodType<StrategyOptions>

export const chunkingConfigSchema = z
  .object({
    maxSize: z.number().min(100).max(4000),
    minSize: z.number().min(1).max(2000),
    overlap: z.number().min(0).max(500),
    strategy: z.enum(['auto', 'text', 'regex', 'recursive', 'sentence', 'token']).optional(),
    strategyOptions: chunkingStrategyOptionsSchema.optional(),
  })
  .refine((data) => data.minSize < data.maxSize * 4, {
    message: 'Min chunk size (characters) must be less than max chunk size (tokens × 4)',
  })
  .refine((data) => data.overlap < data.maxSize, {
    message: 'Overlap must be less than max chunk size',
  })
  .refine(
    (data) => data.strategy !== 'regex' || typeof data.strategyOptions?.pattern === 'string',
    {
      message: 'Regex pattern is required when using the regex chunking strategy',
    }
  )

export const createKnowledgeBaseBodySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  embeddingModel: z.literal('text-embedding-3-small').default('text-embedding-3-small'),
  embeddingDimension: z.literal(1536).default(1536),
  chunkingConfig: chunkingConfigSchema.default({
    maxSize: 1024,
    minSize: 100,
    overlap: 200,
  }),
})

export const updateKnowledgeBaseBodySchema = createKnowledgeBaseBodySchema
  .pick({
    name: true,
    description: true,
    chunkingConfig: true,
  })
  .partial()
  .extend({
    workspaceId: z.string().nullable().optional(),
    embeddingModel: z.literal('text-embedding-3-small').optional(),
    embeddingDimension: z.literal(1536).optional(),
  })

// ============================================================================
// Public API v1 schemas (`/api/v1/knowledge/**`)
//
// The public API surface intentionally diverges from the in-app contracts:
// - `workspaceId` is REQUIRED (used for tenant scoping + rate-limiting), not
//   inferred from session.
// - Chunking config is the simple three-number form (no `strategy` knob).
// - Names/descriptions have explicit length caps.
// - List queries default to sensible values (`enabledFilter='all'`,
//   `sortBy='uploadedAt'`, `sortOrder='desc'`).
//
// Embedding model/dimension are fixed server-side and not accepted as input.
// ============================================================================

/** Simpler chunking config used by the public API (no `strategy`). */
export const v1ChunkingConfigSchema = z.object({
  maxSize: z.number().min(100).max(4000).default(1024),
  minSize: z.number().min(1).max(2000).default(100),
  overlap: z.number().min(0).max(500).default(200),
})

/** GET `/api/v1/knowledge` — list knowledge bases scoped to a workspace. */
export const v1ListKnowledgeBasesQuerySchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId query parameter is required'),
})

/** POST `/api/v1/knowledge` — create a knowledge base. */
export const v1CreateKnowledgeBaseBodySchema = z.object({
  workspaceId: z.string().min(1, 'Workspace ID is required'),
  name: z.string().min(1, 'Name is required').max(255, 'Name must be 255 characters or less'),
  description: z.string().max(1000, 'Description must be 1000 characters or less').optional(),
  chunkingConfig: v1ChunkingConfigSchema.optional().default({
    maxSize: 1024,
    minSize: 100,
    overlap: 200,
  }),
})

/** GET/DELETE `/api/v1/knowledge/[id]` — workspace scope param. */
export const v1KnowledgeWorkspaceQuerySchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId query parameter is required'),
})

/** PUT `/api/v1/knowledge/[id]` — partial update with workspace scope in body. */
export const v1UpdateKnowledgeBaseBodySchema = z
  .object({
    workspaceId: z.string().min(1, 'Workspace ID is required'),
    name: z.string().min(1).max(255, 'Name must be 255 characters or less').optional(),
    description: z.string().max(1000, 'Description must be 1000 characters or less').optional(),
    chunkingConfig: z
      .object({
        maxSize: z.number().min(100).max(4000),
        minSize: z.number().min(1).max(2000),
        overlap: z.number().min(0).max(500),
      })
      .optional(),
  })
  .refine(
    (data) =>
      data.name !== undefined ||
      data.description !== undefined ||
      data.chunkingConfig !== undefined,
    { message: 'At least one of name, description, or chunkingConfig must be provided' }
  )

/** GET `/api/v1/knowledge/[id]/documents` — list documents (defaults differ from in-app list). */
export const v1ListKnowledgeDocumentsQuerySchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId query parameter is required'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().optional(),
  enabledFilter: z.enum(['all', 'enabled', 'disabled']).default('all'),
  sortBy: z
    .enum([
      'filename',
      'fileSize',
      'tokenCount',
      'chunkCount',
      'uploadedAt',
      'processingStatus',
      'enabled',
    ])
    .default('uploadedAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
})

/**
 * POST `/api/v1/knowledge/search` tag filter — uses display `tagName` (not
 * slot) and a default operator. Distinct from the in-app
 * `documentTagFilterSchema`, which is slot-based and used for list filtering.
 */
export const v1SearchTagFilterSchema = z.object({
  tagName: z.string(),
  fieldType: z.enum(['text', 'number', 'date', 'boolean']).optional(),
  operator: z.string().default('eq'),
  value: z.union([z.string(), z.number(), z.boolean()]),
  valueTo: z.union([z.string(), z.number()]).optional(),
})

/** POST `/api/v1/knowledge/search` body. */
export const v1KnowledgeSearchBodySchema = z
  .object({
    workspaceId: z.string().min(1, 'Workspace ID is required'),
    knowledgeBaseIds: z.union([
      z.string().min(1, 'Knowledge base ID is required'),
      z
        .array(z.string().min(1))
        .min(1, 'At least one knowledge base ID is required')
        .max(20, 'Maximum 20 knowledge base IDs allowed'),
    ]),
    query: z.string().optional(),
    topK: z.number().min(1).max(100).default(10),
    tagFilters: z.array(v1SearchTagFilterSchema).optional(),
  })
  .refine(
    (data) => {
      const hasQuery = data.query && data.query.trim().length > 0
      const hasTagFilters = data.tagFilters && data.tagFilters.length > 0
      return hasQuery || hasTagFilters
    },
    {
      message: 'Either query or tagFilters must be provided',
    }
  )

export type V1ListKnowledgeBasesQuery = z.output<typeof v1ListKnowledgeBasesQuerySchema>
export type V1CreateKnowledgeBaseBody = z.output<typeof v1CreateKnowledgeBaseBodySchema>
export type V1KnowledgeWorkspaceQuery = z.output<typeof v1KnowledgeWorkspaceQuerySchema>
export type V1UpdateKnowledgeBaseBody = z.output<typeof v1UpdateKnowledgeBaseBodySchema>
export type V1ListKnowledgeDocumentsQuery = z.output<typeof v1ListKnowledgeDocumentsQuerySchema>
export type V1KnowledgeSearchBody = z.output<typeof v1KnowledgeSearchBodySchema>

export const documentTagFilterSchema = z.object({
  tagSlot: z.string().min(1),
  fieldType: z.enum(['text', 'number', 'date', 'boolean']),
  operator: z.string().min(1),
  value: z.unknown(),
  valueTo: z.unknown().optional(),
})
export type DocumentTagFilter = z.output<typeof documentTagFilterSchema>

export const listKnowledgeDocumentsQuerySchema = z.object({
  enabledFilter: z.enum(['all', 'enabled', 'disabled']).optional(),
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
  sortBy: z
    .enum([
      'filename',
      'fileSize',
      'tokenCount',
      'chunkCount',
      'uploadedAt',
      'processingStatus',
      'enabled',
    ])
    .optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  tagFilters: z
    .string()
    .optional()
    .transform((value, ctx) => {
      if (!value) return undefined
      try {
        return z.array(documentTagFilterSchema).parse(JSON.parse(value))
      } catch {
        ctx.addIssue({ code: 'custom', message: 'tagFilters must be a valid JSON array' })
        return z.NEVER
      }
    }),
})

export const createDocumentBodySchema = z.object({
  filename: z.string().min(1, 'Filename is required'),
  fileUrl: z.string().url('File URL must be valid'),
  fileSize: z.number().min(1, 'File size must be greater than 0'),
  mimeType: z.string().min(1, 'MIME type is required'),
  tag1: z.string().optional(),
  tag2: z.string().optional(),
  tag3: z.string().optional(),
  tag4: z.string().optional(),
  tag5: z.string().optional(),
  tag6: z.string().optional(),
  tag7: z.string().optional(),
  documentTagsData: z.string().optional(),
})

export const bulkCreateDocumentsBodySchema = z.object({
  documents: z.array(createDocumentBodySchema),
  processingOptions: z
    .object({
      recipe: z.string().optional(),
      lang: z.string().optional(),
    })
    .optional(),
  bulk: z.literal(true),
})

export const knowledgeSearchTagFilterSchema = z.object({
  tagName: z.string(),
  tagSlot: z.string().optional(),
  fieldType: z.enum(['text', 'number', 'date', 'boolean']).optional(),
  operator: z.string().default('eq'),
  value: z.union([z.string(), z.number(), z.boolean()]),
  valueTo: z.union([z.string(), z.number()]).optional(),
})

export const knowledgeSearchBodySchema = z
  .object({
    knowledgeBaseIds: z.union([
      z.string().min(1, 'Knowledge base ID is required'),
      z.array(z.string().min(1)).min(1, 'At least one knowledge base ID is required'),
    ]),
    query: z
      .string()
      .optional()
      .nullable()
      .transform((val) => val || undefined),
    topK: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .nullable()
      .default(10)
      .transform((val) => val ?? 10),
    tagFilters: z
      .array(knowledgeSearchTagFilterSchema)
      .optional()
      .nullable()
      .transform((val) => val || undefined),
  })
  .refine(
    (data) => {
      const hasQuery = data.query && data.query.trim().length > 0
      const hasTagFilters = data.tagFilters && data.tagFilters.length > 0
      return hasQuery || hasTagFilters
    },
    {
      message: 'Please provide either a search query or tag filters to search your knowledge base',
    }
  )
export type KnowledgeSearchBody = z.output<typeof knowledgeSearchBodySchema>

export const upsertDocumentBodySchema = z.object({
  documentId: z.string().optional(),
  filename: z.string().min(1, 'Filename is required'),
  fileUrl: z.string().min(1, 'File URL is required'),
  fileSize: z.number().min(1, 'File size must be greater than 0'),
  mimeType: z.string().min(1, 'MIME type is required'),
  documentTagsData: z.string().optional(),
  processingOptions: z
    .object({
      recipe: z.string().optional(),
      lang: z.string().optional(),
    })
    .optional(),
  workflowId: z.string().optional(),
})
export type UpsertDocumentBody = z.output<typeof upsertDocumentBodySchema>

export const bulkCreateDocumentsResponseSchema = z.object({
  total: z.number(),
  documentsCreated: z.array(
    z.object({
      documentId: z.string(),
      filename: z.string(),
      status: z.string(),
    })
  ),
  processingMethod: z.string(),
  processingConfig: z
    .object({
      maxConcurrentDocuments: z.number(),
      batchSize: z.number(),
      totalBatches: z.number(),
    })
    .passthrough(),
})

export const updateDocumentBodySchema = z.object({
  filename: z.string().min(1, 'Filename is required').optional(),
  enabled: z.boolean().optional(),
  chunkCount: z.number().min(0).optional(),
  tokenCount: z.number().min(0).optional(),
  characterCount: z.number().min(0).optional(),
  processingStatus: z.enum(['pending', 'processing', 'completed', 'failed']).optional(),
  processingError: z.string().optional(),
  markFailedDueToTimeout: z.boolean().optional(),
  retryProcessing: z.boolean().optional(),
  tag1: z.string().optional(),
  tag2: z.string().optional(),
  tag3: z.string().optional(),
  tag4: z.string().optional(),
  tag5: z.string().optional(),
  tag6: z.string().optional(),
  tag7: z.string().optional(),
  number1: z.string().optional(),
  number2: z.string().optional(),
  number3: z.string().optional(),
  number4: z.string().optional(),
  number5: z.string().optional(),
  date1: z.string().optional(),
  date2: z.string().optional(),
  boolean1: z.string().optional(),
  boolean2: z.string().optional(),
  boolean3: z.string().optional(),
})

export const updateDocumentTagsBodySchema = z.record(z.string(), z.string())

export const bulkDocumentOperationBodySchema = z
  .object({
    operation: z.enum(['enable', 'disable', 'delete']),
    documentIds: z.array(z.string()).min(1).max(100).optional(),
    selectAll: z.boolean().optional(),
    enabledFilter: z.enum(['all', 'enabled', 'disabled']).optional(),
  })
  .refine((data) => data.selectAll || (data.documentIds && data.documentIds.length > 0), {
    message: 'Either selectAll must be true or documentIds must be provided',
  })

export const bulkDocumentOperationDataSchema = z.object({
  operation: z.string().optional(),
  successCount: z.number(),
  failedCount: z.number().optional(),
  updatedDocuments: z
    .array(z.object({ id: z.string(), enabled: z.boolean().optional() }))
    .optional(),
})
export type BulkDocumentOperationData = z.output<typeof bulkDocumentOperationDataSchema>

export const listKnowledgeChunksQuerySchema = z.object({
  search: z.string().optional(),
  enabled: z.enum(['true', 'false', 'all']).optional().default('all'),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  offset: z.coerce.number().min(0).optional().default(0),
  sortBy: z.enum(['chunkIndex', 'tokenCount', 'enabled']).optional().default('chunkIndex'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
})

export const createChunkBodySchema = z.object({
  content: z.string().min(1, 'Content is required').max(10000, 'Content too long'),
  enabled: z.boolean().optional().default(true),
})

export const updateChunkBodySchema = createChunkBodySchema.partial()

export const bulkChunkOperationBodySchema = z.object({
  operation: z.enum(['enable', 'disable', 'delete']),
  chunkIds: z.array(z.string()).min(1, 'At least one chunk ID is required').max(100),
})

export const bulkChunkOperationDataSchema = z.object({
  operation: z.string(),
  successCount: z.number(),
  errorCount: z.number(),
  processed: z.number(),
  errors: z.array(z.string()),
})
export type BulkChunkOperationData = z.output<typeof bulkChunkOperationDataSchema>

export const nextAvailableSlotQuerySchema = z.object({
  fieldType: z.string().min(1),
})

export const createTagDefinitionBodySchema = z.object({
  tagSlot: z.string().min(1, 'Tag slot is required'),
  displayName: z.string().min(1, 'Display name is required'),
  fieldType: z.string().min(1, 'Invalid field type'),
})

export const documentTagDefinitionInputSchema = z.object({
  tagSlot: z.string().min(1, 'Tag slot is required'),
  displayName: z.string().min(1, 'Display name is required').max(100, 'Display name too long'),
  fieldType: z.string().default('text'),
  _originalDisplayName: z.string().optional(),
})

export const saveDocumentTagDefinitionsBodySchema = z.object({
  definitions: z.array(documentTagDefinitionInputSchema),
})

export const deleteDocumentTagDefinitionsQuerySchema = z.object({
  action: z.enum(['cleanup', 'all']).optional(),
})

export const createConnectorBodySchema = z.object({
  connectorType: z.string().min(1),
  credentialId: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
  sourceConfig: z.record(z.string(), z.unknown()),
  syncIntervalMinutes: z.number().int().min(0).default(1440),
})

export const updateConnectorBodySchema = z.object({
  sourceConfig: z.record(z.string(), z.unknown()).optional(),
  syncIntervalMinutes: z.number().int().min(0).optional(),
  status: z.enum(['active', 'paused']).optional(),
})

export const deleteConnectorQuerySchema = z.object({
  deleteDocuments: z.boolean().optional(),
})

export const connectorDocumentsQuerySchema = z.object({
  includeExcluded: z.boolean().optional(),
})

export const connectorDocumentsPatchBodySchema = z.object({
  operation: z.enum(['restore', 'exclude']),
  documentIds: z.array(z.string()).min(1),
})

const knowledgeChunkingConfigSchema = z
  .object({
    maxSize: z.number(),
    minSize: z.number(),
    overlap: z.number(),
    strategy: z.enum(['auto', 'text', 'regex', 'recursive', 'sentence', 'token']).optional(),
    strategyOptions: chunkingStrategyOptionsSchema.optional(),
  })
  .passthrough()

export const knowledgeBaseDataSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    tokenCount: z.number(),
    embeddingModel: z.string(),
    embeddingDimension: z.number(),
    chunkingConfig: knowledgeChunkingConfigSchema,
    createdAt: wireDateSchema,
    updatedAt: wireDateSchema,
    deletedAt: nullableWireDateSchema,
    workspaceId: z.string().nullable(),
    docCount: z.number().optional(),
    connectorTypes: z.array(z.string()).optional(),
  })
  .passthrough()
export type KnowledgeBaseData = z.output<typeof knowledgeBaseDataSchema>

const documentTagFieldSchema = z.string().nullable().optional()
const documentNumberFieldSchema = z.number().nullable().optional()
const documentBooleanFieldSchema = z.boolean().nullable().optional()
const documentDateFieldSchema = nullableWireDateSchema.optional()

export const documentDataSchema = z
  .object({
    id: z.string(),
    knowledgeBaseId: z.string(),
    filename: z.string(),
    fileUrl: z.string(),
    fileSize: z.number(),
    mimeType: z.string(),
    chunkCount: z.number(),
    tokenCount: z.number(),
    characterCount: z.number(),
    processingStatus: z.enum(['pending', 'processing', 'completed', 'failed']),
    processingStartedAt: nullableWireDateSchema.optional(),
    processingCompletedAt: nullableWireDateSchema.optional(),
    processingError: z.string().nullable().optional(),
    enabled: z.boolean(),
    uploadedAt: wireDateSchema,
    tag1: documentTagFieldSchema,
    tag2: documentTagFieldSchema,
    tag3: documentTagFieldSchema,
    tag4: documentTagFieldSchema,
    tag5: documentTagFieldSchema,
    tag6: documentTagFieldSchema,
    tag7: documentTagFieldSchema,
    number1: documentNumberFieldSchema,
    number2: documentNumberFieldSchema,
    number3: documentNumberFieldSchema,
    number4: documentNumberFieldSchema,
    number5: documentNumberFieldSchema,
    date1: documentDateFieldSchema,
    date2: documentDateFieldSchema,
    boolean1: documentBooleanFieldSchema,
    boolean2: documentBooleanFieldSchema,
    boolean3: documentBooleanFieldSchema,
    connectorId: z.string().nullable().optional(),
    connectorType: z.string().nullable().optional(),
    sourceUrl: z.string().nullable().optional(),
  })
  .passthrough()
export type DocumentData = z.output<typeof documentDataSchema>

export const chunkDataSchema = z
  .object({
    id: z.string(),
    chunkIndex: z.number(),
    content: z.string(),
    contentLength: z.number(),
    tokenCount: z.number(),
    enabled: z.boolean(),
    startOffset: z.number(),
    endOffset: z.number(),
    tag1: documentTagFieldSchema,
    tag2: documentTagFieldSchema,
    tag3: documentTagFieldSchema,
    tag4: documentTagFieldSchema,
    tag5: documentTagFieldSchema,
    tag6: documentTagFieldSchema,
    tag7: documentTagFieldSchema,
    number1: documentNumberFieldSchema,
    number2: documentNumberFieldSchema,
    number3: documentNumberFieldSchema,
    number4: documentNumberFieldSchema,
    number5: documentNumberFieldSchema,
    date1: documentDateFieldSchema,
    date2: documentDateFieldSchema,
    boolean1: documentBooleanFieldSchema,
    boolean2: documentBooleanFieldSchema,
    boolean3: documentBooleanFieldSchema,
    createdAt: wireDateSchema,
    updatedAt: wireDateSchema,
  })
  .passthrough()
export type ChunkData = z.output<typeof chunkDataSchema>

const paginationSchema = z
  .object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
    hasMore: z.boolean(),
  })
  .passthrough()

export const documentsPaginationSchema = paginationSchema
export const chunksPaginationSchema = paginationSchema
export type DocumentsPagination = z.output<typeof documentsPaginationSchema>
export type ChunksPagination = z.output<typeof chunksPaginationSchema>

export const tagDefinitionDataSchema = z.object({
  id: z.string(),
  tagSlot: z.string(),
  displayName: z.string(),
  fieldType: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type TagDefinitionData = z.output<typeof tagDefinitionDataSchema>
export type DocumentTagDefinitionData = TagDefinitionData

export const connectorDataSchema = z
  .object({
    id: z.string(),
    knowledgeBaseId: z.string(),
    connectorType: z.string(),
    credentialId: z.string().nullable(),
    sourceConfig: z.record(z.string(), z.unknown()),
    syncMode: z.string().nullable(),
    syncIntervalMinutes: z.number(),
    status: z.enum(['active', 'paused', 'syncing', 'error', 'disabled']),
    lastSyncAt: z.string().nullable(),
    lastSyncError: z.string().nullable(),
    lastSyncDocCount: z.number().nullable(),
    nextSyncAt: z.string().nullable(),
    consecutiveFailures: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough()
export type ConnectorData = z.output<typeof connectorDataSchema>

export const syncLogDataSchema = z
  .object({
    id: z.string(),
    connectorId: z.string(),
    status: z.string(),
    startedAt: z.string(),
    completedAt: z.string().nullable(),
    docsAdded: z.number(),
    docsUpdated: z.number(),
    docsDeleted: z.number(),
    docsUnchanged: z.number(),
    docsFailed: z.number(),
    errorMessage: z.string().nullable(),
  })
  .passthrough()
export type SyncLogData = z.output<typeof syncLogDataSchema>

export const connectorDetailDataSchema = connectorDataSchema.extend({
  syncLogs: z.array(syncLogDataSchema),
})
export type ConnectorDetailData = z.output<typeof connectorDetailDataSchema>

export const connectorDocumentDataSchema = z
  .object({
    id: z.string(),
    filename: z.string(),
    externalId: z.string().nullable(),
    sourceUrl: z.string().nullable(),
    enabled: z.boolean(),
    deletedAt: z.string().nullable().default(null),
    userExcluded: z.boolean(),
    uploadedAt: z.string(),
    processingStatus: z.string(),
  })
  .passthrough()
export type ConnectorDocumentData = z.output<typeof connectorDocumentDataSchema>

export const connectorDocumentsDataSchema = z.object({
  documents: z.array(connectorDocumentDataSchema),
  counts: z.object({ active: z.number(), excluded: z.number() }),
})
export type ConnectorDocumentsData = z.output<typeof connectorDocumentsDataSchema>

export const knowledgeDocumentsDataSchema = z.object({
  documents: z.array(documentDataSchema),
  pagination: documentsPaginationSchema,
})
export type KnowledgeDocumentsResponse = z.output<typeof knowledgeDocumentsDataSchema>

export type KnowledgeChunksResponse = {
  chunks: ChunkData[]
  pagination: ChunksPagination
}

export const nextAvailableSlotDataSchema = z.object({
  nextAvailableSlot: z.string().nullable(),
  fieldType: z.string(),
  usedSlots: z.array(z.string()),
  totalSlots: z.number(),
  availableSlots: z.number(),
})
export type NextAvailableSlotData = z.output<typeof nextAvailableSlotDataSchema>

export const saveDocumentTagDefinitionsDataSchema = z
  .object({
    created: z.array(tagDefinitionDataSchema).optional(),
    updated: z.array(tagDefinitionDataSchema).optional(),
    errors: z.array(z.string()).optional(),
  })
  .or(z.array(tagDefinitionDataSchema))
export type SaveDocumentTagDefinitionsResult = z.output<typeof saveDocumentTagDefinitionsDataSchema>

const successResponseSchema = <T extends z.ZodType>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
  })

const v1KnowledgeApiResponseSchema = successResponseSchema(z.unknown()).passthrough()

export const v1ListKnowledgeBasesContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/knowledge',
  query: v1ListKnowledgeBasesQuerySchema,
  response: {
    mode: 'json',
    schema: v1KnowledgeApiResponseSchema,
  },
})

export const v1CreateKnowledgeBaseContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/knowledge',
  body: v1CreateKnowledgeBaseBodySchema,
  response: {
    mode: 'json',
    schema: v1KnowledgeApiResponseSchema,
  },
})

export const v1GetKnowledgeBaseContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/knowledge/[id]',
  params: knowledgeBaseParamsSchema,
  query: v1KnowledgeWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v1KnowledgeApiResponseSchema,
  },
})

export const v1UpdateKnowledgeBaseContract = defineRouteContract({
  method: 'PUT',
  path: '/api/v1/knowledge/[id]',
  params: knowledgeBaseParamsSchema,
  body: v1UpdateKnowledgeBaseBodySchema,
  response: {
    mode: 'json',
    schema: v1KnowledgeApiResponseSchema,
  },
})

export const v1DeleteKnowledgeBaseContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v1/knowledge/[id]',
  params: knowledgeBaseParamsSchema,
  query: v1KnowledgeWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v1KnowledgeApiResponseSchema,
  },
})

export const v1ListKnowledgeDocumentsContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/knowledge/[id]/documents',
  params: knowledgeBaseParamsSchema,
  query: v1ListKnowledgeDocumentsQuerySchema,
  response: {
    mode: 'json',
    schema: v1KnowledgeApiResponseSchema,
  },
})

export const v1UploadKnowledgeDocumentContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/knowledge/[id]/documents',
  params: knowledgeBaseParamsSchema,
  response: {
    mode: 'json',
    schema: v1KnowledgeApiResponseSchema,
  },
})

export const v1GetKnowledgeDocumentContract = defineRouteContract({
  method: 'GET',
  path: '/api/v1/knowledge/[id]/documents/[documentId]',
  params: knowledgeDocumentParamsSchema,
  query: v1KnowledgeWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v1KnowledgeApiResponseSchema,
  },
})

export const v1DeleteKnowledgeDocumentContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v1/knowledge/[id]/documents/[documentId]',
  params: knowledgeDocumentParamsSchema,
  query: v1KnowledgeWorkspaceQuerySchema,
  response: {
    mode: 'json',
    schema: v1KnowledgeApiResponseSchema,
  },
})

export const v1KnowledgeSearchContract = defineRouteContract({
  method: 'POST',
  path: '/api/v1/knowledge/search',
  body: v1KnowledgeSearchBodySchema,
  response: {
    mode: 'json',
    schema: v1KnowledgeApiResponseSchema,
  },
})

export const listKnowledgeBasesContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge',
  query: listKnowledgeBasesQuerySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.array(knowledgeBaseDataSchema)),
  },
})

export const createKnowledgeBaseContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge',
  body: createKnowledgeBaseBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(knowledgeBaseDataSchema),
  },
})

export const getKnowledgeBaseContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/[id]',
  params: knowledgeBaseParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(knowledgeBaseDataSchema),
  },
})

export const updateKnowledgeBaseContract = defineRouteContract({
  method: 'PUT',
  path: '/api/knowledge/[id]',
  params: knowledgeBaseParamsSchema,
  body: updateKnowledgeBaseBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(knowledgeBaseDataSchema),
  },
})

export const deleteKnowledgeBaseContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/knowledge/[id]',
  params: knowledgeBaseParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.object({ message: z.string() })),
  },
})

export const restoreKnowledgeBaseContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/[id]/restore',
  params: knowledgeBaseParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true) }).passthrough(),
  },
})

export const getKnowledgeDocumentContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/[id]/documents/[documentId]',
  params: knowledgeDocumentParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(documentDataSchema),
  },
})

export const listKnowledgeDocumentsContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/[id]/documents',
  params: knowledgeBaseParamsSchema,
  query: listKnowledgeDocumentsQuerySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(knowledgeDocumentsDataSchema),
  },
})

export const bulkCreateKnowledgeDocumentsContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/[id]/documents',
  params: knowledgeBaseParamsSchema,
  body: bulkCreateDocumentsBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(bulkCreateDocumentsResponseSchema),
  },
})

export const updateKnowledgeDocumentContract = defineRouteContract({
  method: 'PUT',
  path: '/api/knowledge/[id]/documents/[documentId]',
  params: knowledgeDocumentParamsSchema,
  body: updateDocumentBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(documentDataSchema),
  },
})

export const updateKnowledgeDocumentTagsContract = defineRouteContract({
  method: 'PUT',
  path: '/api/knowledge/[id]/documents/[documentId]',
  params: knowledgeDocumentParamsSchema,
  body: updateDocumentTagsBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(documentDataSchema),
  },
})

export const deleteKnowledgeDocumentContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/knowledge/[id]/documents/[documentId]',
  params: knowledgeDocumentParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.unknown()),
  },
})

export const bulkKnowledgeDocumentsContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/knowledge/[id]/documents',
  params: knowledgeBaseParamsSchema,
  body: bulkDocumentOperationBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(bulkDocumentOperationDataSchema),
  },
})

export const listKnowledgeChunksContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/[id]/documents/[documentId]/chunks',
  params: knowledgeDocumentParamsSchema,
  query: listKnowledgeChunksQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      data: z.array(chunkDataSchema),
      pagination: chunksPaginationSchema,
    }),
  },
})

export const createKnowledgeChunkContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/[id]/documents/[documentId]/chunks',
  params: knowledgeDocumentParamsSchema,
  body: createChunkBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(chunkDataSchema),
  },
})

export const updateKnowledgeChunkContract = defineRouteContract({
  method: 'PUT',
  path: '/api/knowledge/[id]/documents/[documentId]/chunks/[chunkId]',
  params: knowledgeChunkParamsSchema,
  body: updateChunkBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(chunkDataSchema),
  },
})

export const deleteKnowledgeChunkContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/knowledge/[id]/documents/[documentId]/chunks/[chunkId]',
  params: knowledgeChunkParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.object({ message: z.string() })),
  },
})

export const bulkKnowledgeChunksContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/knowledge/[id]/documents/[documentId]/chunks',
  params: knowledgeDocumentParamsSchema,
  body: bulkChunkOperationBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(bulkChunkOperationDataSchema),
  },
})

export const listTagDefinitionsContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/[id]/tag-definitions',
  params: knowledgeBaseParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.array(tagDefinitionDataSchema)),
  },
})

export const createTagDefinitionContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/[id]/tag-definitions',
  params: knowledgeBaseParamsSchema,
  body: createTagDefinitionBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(tagDefinitionDataSchema),
  },
})

export const deleteTagDefinitionContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/knowledge/[id]/tag-definitions/[tagId]',
  params: knowledgeTagParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true) }).passthrough(),
  },
})

export const nextAvailableSlotContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/[id]/next-available-slot',
  params: knowledgeBaseParamsSchema,
  query: nextAvailableSlotQuerySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(nextAvailableSlotDataSchema),
  },
})

export const listDocumentTagDefinitionsContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/[id]/documents/[documentId]/tag-definitions',
  params: knowledgeDocumentParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.array(tagDefinitionDataSchema)),
  },
})

export const saveDocumentTagDefinitionsContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/[id]/documents/[documentId]/tag-definitions',
  params: knowledgeDocumentParamsSchema,
  body: saveDocumentTagDefinitionsBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(saveDocumentTagDefinitionsDataSchema),
  },
})

export const deleteDocumentTagDefinitionsContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/knowledge/[id]/documents/[documentId]/tag-definitions',
  params: knowledgeDocumentParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true) }).passthrough(),
  },
})

export const listKnowledgeConnectorsContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/[id]/connectors',
  params: knowledgeBaseParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(z.array(connectorDataSchema)),
  },
})

export const createKnowledgeConnectorContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/[id]/connectors',
  params: knowledgeBaseParamsSchema,
  body: createConnectorBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(connectorDataSchema),
  },
})

export const getKnowledgeConnectorContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/[id]/connectors/[connectorId]',
  params: knowledgeConnectorParamsSchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(connectorDetailDataSchema),
  },
})

export const updateKnowledgeConnectorContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/knowledge/[id]/connectors/[connectorId]',
  params: knowledgeConnectorParamsSchema,
  body: updateConnectorBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(connectorDataSchema),
  },
})

export const deleteKnowledgeConnectorContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/knowledge/[id]/connectors/[connectorId]',
  params: knowledgeConnectorParamsSchema,
  query: deleteConnectorQuerySchema,
  response: {
    mode: 'json',
    schema: z.object({ success: z.literal(true) }),
  },
})

export const triggerKnowledgeConnectorSyncContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/[id]/connectors/[connectorId]/sync',
  params: knowledgeConnectorParamsSchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      message: z.string(),
    }),
  },
})

export const listKnowledgeConnectorDocumentsContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/[id]/connectors/[connectorId]/documents',
  params: knowledgeConnectorParamsSchema,
  query: connectorDocumentsQuerySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(connectorDocumentsDataSchema),
  },
})

export const patchKnowledgeConnectorDocumentsContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/knowledge/[id]/connectors/[connectorId]/documents',
  params: knowledgeConnectorParamsSchema,
  body: connectorDocumentsPatchBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z
        .object({
          excludedCount: z.number().optional(),
          restoredCount: z.number().optional(),
          documentIds: z.array(z.string()).optional(),
        })
        .passthrough()
    ),
  },
})
