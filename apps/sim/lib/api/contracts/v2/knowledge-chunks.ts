import { z } from 'zod'
import { knowledgeChunkParamsSchema } from '@/lib/api/contracts/knowledge/shared'
import { noInputSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  v2KnowledgeDeleteDataSchema,
  v2KnowledgeDocumentParamsSchema,
} from '@/lib/api/contracts/v2/knowledge'
import {
  v2CursorListResponse,
  v2DataResponse,
  v2PaginationFields,
  v2SearchSchema,
  v2SortFields,
  v2TimestampSchema,
} from '@/lib/api/contracts/v2/shared'
import { CHUNK_SORT_FIELDS } from '@/lib/knowledge/chunks/types'

/**
 * v2 knowledge chunk contracts.
 *
 * A chunk is the unit a search actually matches, so reading and editing chunks
 * is how a caller inspects why a document answers the way it does and corrects
 * an extraction the processing pipeline got wrong.
 *
 * Chunks belonging to a connector-synced document are read-only: they are
 * owned by the upstream source, and a write answers `403` with
 * `error.details.code: "CONNECTOR_MANAGED_RESOURCE_READ_ONLY"`.
 */

/** Longest chunk content a caller may write, matching the internal surface. */
export const MAX_V2_KNOWLEDGE_CHUNK_CONTENT_LENGTH = 10_000

/** Maximum chunks addressable by identifier in one bulk request. */
export const MAX_V2_BULK_KNOWLEDGE_CHUNKS = 100

const v2KnowledgeChunkTagValueSchema = z
  .string()
  .nullable()
  .describe('Text tag value inherited from the document, or null when the slot is unset.')

/**
 * A chunk, with its tag slots projected as slots rather than display names.
 *
 * That is the opposite of a document read, and deliberate: a chunk's tags are
 * copies of the document's, so the display-name map is already available one
 * level up, and projecting slots here keeps the shape stable when a definition
 * is renamed mid-page. Resolve slots to names with
 * `GET /api/v2/knowledge/{knowledgeBaseId}/tags`.
 */
export const v2KnowledgeChunkSchema = z
  .object({
    id: z
      .string()
      .describe('Unique chunk identifier.')
      .meta({ examples: ['4c1f9e77-2b3a-4f8d-9e10-6a2c8d4b1e05'] }),
    chunkIndex: z
      .number()
      .int()
      .nonnegative()
      .describe('Zero-based position of the chunk within its document.')
      .meta({ examples: [3] }),
    content: z
      .string()
      .describe('Text content of the chunk, exactly as it was embedded.')
      .meta({ examples: ['To reset your password, open Settings and choose Security.'] }),
    contentLength: z
      .number()
      .int()
      .nonnegative()
      .describe('Character count of `content`.')
      .meta({ examples: [58] }),
    tokenCount: z
      .number()
      .int()
      .nonnegative()
      .describe('Tokens the chunk consumed when embedded.')
      .meta({ examples: [14] }),
    enabled: z
      .boolean()
      .describe('Whether the chunk participates in search. A disabled chunk stays indexed.'),
    startOffset: z
      .number()
      .int()
      .nonnegative()
      .describe('Character offset of the chunk within the extracted document text.'),
    endOffset: z
      .number()
      .int()
      .nonnegative()
      .describe('Character offset just past the end of the chunk.'),
    tag1: v2KnowledgeChunkTagValueSchema,
    tag2: v2KnowledgeChunkTagValueSchema,
    tag3: v2KnowledgeChunkTagValueSchema,
    tag4: v2KnowledgeChunkTagValueSchema,
    tag5: v2KnowledgeChunkTagValueSchema,
    tag6: v2KnowledgeChunkTagValueSchema,
    tag7: v2KnowledgeChunkTagValueSchema,
    createdAt: v2TimestampSchema.describe('ISO 8601 timestamp when the chunk was created.'),
    updatedAt: v2TimestampSchema.describe('ISO 8601 timestamp when the chunk was last modified.'),
  })
  .strict()
  .meta({
    id: 'V2KnowledgeChunk',
    title: 'Knowledge chunk',
    description: 'One embedded passage of a knowledge document.',
  })
export type V2KnowledgeChunk = z.output<typeof v2KnowledgeChunkSchema>

export const v2KnowledgeChunkParamsSchema = knowledgeChunkParamsSchema.omit({ id: true }).extend({
  knowledgeBaseId: knowledgeChunkParamsSchema.shape.id.describe(
    'Unique knowledge base identifier.'
  ),
  documentId: knowledgeChunkParamsSchema.shape.documentId.describe(
    'Unique knowledge document identifier.'
  ),
  chunkId: knowledgeChunkParamsSchema.shape.chunkId.describe('Unique chunk identifier.'),
})
export type V2KnowledgeChunkParams = z.output<typeof v2KnowledgeChunkParamsSchema>

/**
 * `enabled` is a tri-state filter rather than a boolean flag: `all` is the
 * default and is a third selection, not the absence of one, so
 * `booleanQueryFlagSchema` cannot express it.
 */
export const v2ListKnowledgeChunksQuerySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the knowledge base.'),
    search: v2SearchSchema.describe('Case-insensitive substring match against chunk content.'),
    enabled: z
      .enum(['true', 'false', 'all'], {
        error: 'enabled: expected one of "true" | "false" | "all"',
      })
      .default('all')
      .describe('Restrict to enabled or disabled chunks. `all` returns both.'),
    ...v2SortFields(CHUNK_SORT_FIELDS, { sortBy: 'chunkIndex', sortOrder: 'asc' }),
    ...v2PaginationFields({ description: 'Maximum chunks to return per page.' }),
  })
  .strict()
export type V2ListKnowledgeChunksQuery = z.output<typeof v2ListKnowledgeChunksQuerySchema>

const v2KnowledgeChunkContentSchema = z
  .string()
  .min(1, 'content cannot be empty')
  .max(
    MAX_V2_KNOWLEDGE_CHUNK_CONTENT_LENGTH,
    `content cannot exceed ${MAX_V2_KNOWLEDGE_CHUNK_CONTENT_LENGTH} characters`
  )
  .describe('Text to embed. It is embedded on write, so the chunk is searchable immediately.')

/**
 * A created chunk is appended: its `chunkIndex` is assigned server-side as one
 * past the document's current maximum, and it inherits the document's tag
 * values. The document must have finished processing.
 */
export const v2CreateKnowledgeChunkBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the knowledge base.'),
    content: v2KnowledgeChunkContentSchema,
    enabled: z.boolean().default(true).describe('Whether the new chunk participates in search.'),
  })
  .strict()
export type V2CreateKnowledgeChunkBody = z.input<typeof v2CreateKnowledgeChunkBodySchema>

export const v2UpdateKnowledgeChunkBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the knowledge base.'),
    content: v2KnowledgeChunkContentSchema
      .optional()
      .describe(
        'Replacement text. Changing it re-embeds the chunk and re-derives its token and character counts.'
      ),
    enabled: z
      .boolean()
      .optional()
      .describe('Whether the chunk participates in search. Disabling keeps it indexed.'),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.content === undefined && body.enabled === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['content'],
        message: 'At least one of content or enabled is required',
      })
    }
  })
export type V2UpdateKnowledgeChunkBody = z.input<typeof v2UpdateKnowledgeChunkBodySchema>

export const v2BulkKnowledgeChunksBodySchema = z
  .object({
    workspaceId: workspaceIdSchema.describe('Workspace that owns the knowledge base.'),
    operation: z
      .enum(['enable', 'disable', 'delete'], {
        error: 'operation: expected one of "enable" | "disable" | "delete"',
      })
      .describe('What to do with the selected chunks.'),
    chunkIds: z
      .array(z.string().min(1, 'chunkIds entries cannot be empty'))
      .min(1, 'chunkIds cannot be empty')
      .max(
        MAX_V2_BULK_KNOWLEDGE_CHUNKS,
        `chunkIds cannot contain more than ${MAX_V2_BULK_KNOWLEDGE_CHUNKS} chunks`
      )
      .describe(
        'Chunks to operate on, by identifier. An id naming no chunk in the document is reported in errors and does not fail the request.'
      ),
  })
  .strict()
export type V2BulkKnowledgeChunksBody = z.input<typeof v2BulkKnowledgeChunksBodySchema>

/**
 * Bulk chunk outcome. Unlike the per-chunk operations this is best-effort: an
 * identifier naming no chunk in the document is reported in `errors` rather
 * than failing the request, and the same rule holds for all three operations.
 * `processed` counts only the chunks that actually changed.
 */
export const v2BulkKnowledgeChunksDataSchema = z
  .object({
    operation: z.enum(['enable', 'disable', 'delete']).describe('Operation that was applied.'),
    processed: z
      .number()
      .int()
      .nonnegative()
      .describe('Number of chunks the operation changed.')
      .meta({ examples: [12] }),
    errors: z
      .array(z.string())
      .describe(
        'Per-chunk failures, including any identifier that named no chunk in the document. A populated array still answers 200.'
      ),
  })
  .strict()
  .meta({
    id: 'V2BulkKnowledgeChunksData',
    title: 'Bulk knowledge chunk update data',
    description: 'Outcome of a bulk enable, disable, or delete across knowledge chunks.',
  })

export const v2ListKnowledgeChunksContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks',
  params: v2KnowledgeDocumentParamsSchema,
  query: v2ListKnowledgeChunksQuerySchema,
  response: {
    mode: 'json',
    schema: v2CursorListResponse(v2KnowledgeChunkSchema),
  },
})

export const v2CreateKnowledgeChunkContract = defineRouteContract({
  method: 'POST',
  path: '/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks',
  query: noInputSchema,
  params: v2KnowledgeDocumentParamsSchema,
  body: v2CreateKnowledgeChunkBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2KnowledgeChunkSchema),
    status: 201,
  },
})

export const v2BulkUpdateKnowledgeChunksContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks',
  query: noInputSchema,
  params: v2KnowledgeDocumentParamsSchema,
  body: v2BulkKnowledgeChunksBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2BulkKnowledgeChunksDataSchema),
  },
})

export const v2GetKnowledgeChunkContract = defineRouteContract({
  method: 'GET',
  path: '/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks/[chunkId]',
  params: v2KnowledgeChunkParamsSchema,
  query: z
    .object({
      workspaceId: workspaceIdSchema.describe('Workspace that owns the knowledge base.'),
    })
    .strict(),
  response: {
    mode: 'json',
    schema: v2DataResponse(v2KnowledgeChunkSchema),
  },
})

export const v2UpdateKnowledgeChunkContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks/[chunkId]',
  query: noInputSchema,
  params: v2KnowledgeChunkParamsSchema,
  body: v2UpdateKnowledgeChunkBodySchema,
  response: {
    mode: 'json',
    schema: v2DataResponse(v2KnowledgeChunkSchema),
  },
})

export const v2DeleteKnowledgeChunkContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks/[chunkId]',
  params: v2KnowledgeChunkParamsSchema,
  query: z
    .object({
      workspaceId: workspaceIdSchema.describe('Workspace that owns the knowledge base.'),
    })
    .strict(),
  response: {
    mode: 'json',
    schema: v2DataResponse(v2KnowledgeDeleteDataSchema),
  },
})
