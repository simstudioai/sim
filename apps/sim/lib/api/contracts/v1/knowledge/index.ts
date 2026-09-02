import { z } from 'zod'
import { knowledgeSearchModeSchema } from '@/lib/api/contracts/knowledge/search'
import {
  knowledgeBaseParamsSchema,
  knowledgeDocumentParamsSchema,
  successResponseSchema,
} from '@/lib/api/contracts/knowledge/shared'
import { requiredFieldSchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import {
  DEFAULT_CHUNKING_CONFIG,
  KNOWLEDGE_BASE_DESCRIPTION_MAX_LENGTH,
} from '@/lib/knowledge/constants'

/**
 * Public API v1 schemas (`/api/v1/knowledge/**`)
 *
 * The public API surface intentionally diverges from the in-app contracts:
 * - `workspaceId` is REQUIRED (used for tenant scoping + rate-limiting), not
 *   inferred from session.
 * - Chunking config is the simple three-number form (no `strategy` knob).
 * - Names/descriptions have explicit length caps.
 * - List queries default to sensible values (`enabledFilter='all'`,
 *   `sortBy='uploadedAt'`, `sortOrder='desc'`).
 *
 * Embedding model/dimension are fixed server-side and not accepted as input.
 */

/** Simpler chunking config used by the public API (no `strategy`). */
export const v1ChunkingConfigSchema = z.object({
  maxSize: z.number().min(100).max(4000).default(DEFAULT_CHUNKING_CONFIG.maxSize),
  minSize: z.number().min(1).max(2000).default(DEFAULT_CHUNKING_CONFIG.minSize),
  overlap: z.number().min(0).max(500).default(DEFAULT_CHUNKING_CONFIG.overlap),
})

/** GET `/api/v1/knowledge` — list knowledge bases scoped to a workspace. */
export const v1ListKnowledgeBasesQuerySchema = z.object({
  workspaceId: requiredFieldSchema('workspaceId query parameter is required'),
})

/** POST `/api/v1/knowledge` — create a knowledge base. */
export const v1CreateKnowledgeBaseBodySchema = z.object({
  workspaceId: workspaceIdSchema,
  name: requiredFieldSchema('Name is required').max(255, 'Name must be 255 characters or less'),
  description: z
    .string()
    .max(
      KNOWLEDGE_BASE_DESCRIPTION_MAX_LENGTH,
      `Description must be ${KNOWLEDGE_BASE_DESCRIPTION_MAX_LENGTH} characters or less`
    )
    .optional(),
  chunkingConfig: v1ChunkingConfigSchema.optional().default(DEFAULT_CHUNKING_CONFIG),
})

/** GET/DELETE `/api/v1/knowledge/[id]` — workspace scope param. */
export const v1KnowledgeWorkspaceQuerySchema = z.object({
  workspaceId: requiredFieldSchema('workspaceId query parameter is required'),
})

/** PUT `/api/v1/knowledge/[id]` — partial update with workspace scope in body. */
export const v1UpdateKnowledgeBaseBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    name: z.string().min(1).max(255, 'Name must be 255 characters or less').optional(),
    description: z
      .string()
      .max(
        KNOWLEDGE_BASE_DESCRIPTION_MAX_LENGTH,
        `Description must be ${KNOWLEDGE_BASE_DESCRIPTION_MAX_LENGTH} characters or less`
      )
      .optional(),
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
  workspaceId: requiredFieldSchema('workspaceId query parameter is required'),
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
 * Comparison operators the tag filter builders implement, per field type.
 *
 * Both builders — `lib/knowledge/documents/tag-filter.ts` for document lists and
 * `lib/knowledge/search/queries.ts` for search — recognize exactly these. An
 * operator outside the set used to be admitted by the boundary and then diverge:
 * the document list dropped the predicate and returned the whole knowledge base,
 * while search fell through to equality. Enumerating them here makes both
 * `default:` arms unreachable instead of load-bearing.
 */
export const KNOWLEDGE_TAG_FILTER_OPERATORS_BY_FIELD_TYPE = {
  text: ['eq', 'neq', 'contains', 'not_contains', 'starts_with', 'ends_with'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between'],
  date: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between'],
  boolean: ['eq', 'neq'],
} as const satisfies Record<'text' | 'number' | 'date' | 'boolean', readonly string[]>

/** Every operator any field type implements; the field type narrows it further. */
export const KNOWLEDGE_TAG_FILTER_OPERATORS = [
  'eq',
  'neq',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
] as const

/**
 * POST `/api/v1/knowledge/search` tag filter — uses display `tagName` (not
 * slot) and a default operator. Distinct from the in-app
 * `documentTagFilterSchema`, which is slot-based and used for list filtering.
 *
 * Deliberately not strict. v1 has always stripped unrecognized keys, and
 * rejecting them now would break shipped callers for no correctness win; v2
 * layers `.strict()` on top of this schema instead. The one stripped key that
 * changed an answer — a mis-cased `valueto` leaving a `between` filter with no
 * upper bound, which the document list then discarded entirely — is caught on
 * both versions by the `valueTo` rule below.
 */
export const v1SearchTagFilterSchema = z
  .object({
    tagName: z.string(),
    fieldType: z.enum(['text', 'number', 'date', 'boolean']).optional(),
    operator: z
      .enum(KNOWLEDGE_TAG_FILTER_OPERATORS, {
        error: `operator must be one of: ${KNOWLEDGE_TAG_FILTER_OPERATORS.join(', ')}`,
      })
      .default('eq'),
    value: z.union([z.string(), z.number(), z.boolean()]),
    valueTo: z.union([z.string(), z.number()]).optional(),
  })
  .refine((filter) => filter.operator !== 'between' || filter.valueTo !== undefined, {
    message: 'valueTo is required when operator is "between"',
    path: ['valueTo'],
  })

/** POST `/api/v1/knowledge/search` body. */
export const v1KnowledgeSearchBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    knowledgeBaseIds: z.union([
      requiredFieldSchema('Knowledge base ID is required'),
      z
        .array(z.string().min(1))
        .min(1, 'At least one knowledge base ID is required')
        .max(20, 'Maximum 20 knowledge base IDs allowed'),
    ]),
    query: z.string().optional(),
    topK: z.number().min(1).max(100).default(10),
    tagFilters: z.array(v1SearchTagFilterSchema).optional(),
    /**
     * `hybrid` (default) fuses a full-text leg with semantic retrieval by
     * reciprocal rank; `vector` is semantic-only.
     */
    searchMode: knowledgeSearchModeSchema,
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
