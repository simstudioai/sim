import { z } from 'zod'
import {
  knowledgeBaseParamsSchema,
  nullableWireDateSchema,
  successResponseSchema,
  wireDateSchema,
} from '@/lib/api/contracts/knowledge/shared'
import {
  folderIdSchema,
  requiredFieldSchema,
  workspaceIdSchema,
} from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { MAX_CHUNKING_SEPARATOR_LENGTH, MAX_CHUNKING_SEPARATORS } from '@/lib/chunkers/constants'
import type { StrategyOptions } from '@/lib/chunkers/types'
import {
  DEFAULT_CHUNKING_CONFIG,
  KNOWLEDGE_BASE_DESCRIPTION_MAX_LENGTH,
  MAX_KNOWLEDGE_BATCH_ITEMS,
} from '@/lib/knowledge/constants'

export const knowledgeScopeSchema = z.enum(['active', 'archived', 'all'])
export type KnowledgeScope = z.output<typeof knowledgeScopeSchema>

export const listKnowledgeBasesQuerySchema = z.object({
  workspaceId: z.string().min(1).optional(),
  scope: knowledgeScopeSchema.default('active'),
})

/**
 * Strategy options as they are stored. Reads stay tolerant of a `separators`
 * list written before {@link chunkingStrategyOptionsSchema} bounded it, so an
 * oversized legacy config lists instead of failing response validation. The
 * chunker clamps such a list at construction, so nothing reprocesses unbounded.
 */
export const storedChunkingStrategyOptionsSchema = z
  .object({
    pattern: z
      .string()
      .max(500)
      .optional()
      .describe('Regular expression used by the regex chunking strategy.'),
    separators: z
      .array(z.string())
      .optional()
      .describe('Ordered separators used to split content into chunks.'),
    recipe: z
      .enum(['plain', 'markdown', 'code'])
      .optional()
      .describe('Content-aware recipe used by the automatic chunking strategy.'),
    strictBoundaries: z
      .boolean()
      .optional()
      .describe('Whether regex matches must form strict chunk boundaries.'),
  })
  .strict() satisfies z.ZodType<StrategyOptions>

/**
 * Strategy options accepted on writes. `separators` is bounded in both length
 * and item size: the recursive chunker rescans the whole document once per
 * separator, synchronously, so an unbounded list turns one persisted config
 * into seconds of uninterruptible CPU on every later document upload.
 */
export const chunkingStrategyOptionsSchema = storedChunkingStrategyOptionsSchema
  .extend({
    separators: z
      .array(
        z
          .string()
          .max(
            MAX_CHUNKING_SEPARATOR_LENGTH,
            `Each separator must be ${MAX_CHUNKING_SEPARATOR_LENGTH} characters or less`
          )
      )
      .max(MAX_CHUNKING_SEPARATORS, `At most ${MAX_CHUNKING_SEPARATORS} separators are allowed`)
      .optional()
      .describe('Ordered separators used to split content into chunks.'),
  })
  .strict() satisfies z.ZodType<StrategyOptions>

export const chunkingStrategySchema = z.enum([
  'auto',
  'text',
  'regex',
  'recursive',
  'sentence',
  'token',
])

/**
 * The five chunking-config fields, before the cross-field rules below. Exported
 * so a surface can re-describe or re-bound the fields it publishes and still
 * pick the rules up from {@link withChunkingConfigRules}.
 */
export const chunkingConfigFieldsSchema = z.object({
  maxSize: z.number().min(100).max(4000),
  minSize: z.number().min(1).max(2000),
  overlap: z.number().min(0).max(500),
  strategy: chunkingStrategySchema.optional(),
  strategyOptions: chunkingStrategyOptionsSchema.optional(),
})

export type ChunkingConfigFields = z.output<typeof chunkingConfigFieldsSchema>

/**
 * The four cross-field rules every chunking-config write must satisfy.
 *
 * Applied through a function rather than baked into one schema because the
 * refinements make the result unextendable: a surface that needs its own
 * descriptions, bounds, or strictness has to build the object first and take
 * the rules afterwards. Restating them per surface is how a write path loses
 * one — and the `strategyOptions.separators` bound that
 * {@link chunkingStrategyOptionsSchema} carries is the difference between a
 * persisted config and seconds of uninterruptible CPU on every later upload.
 */
export function withChunkingConfigRules<T extends ChunkingConfigFields>(
  schema: z.ZodType<T>
): z.ZodType<T> {
  return schema
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
    .refine(
      (data) => data.strategy === 'regex' || data.strategyOptions?.strictBoundaries !== true,
      {
        message: 'strictBoundaries is only valid for the regex chunking strategy',
      }
    )
}

export const chunkingConfigSchema = withChunkingConfigRules(chunkingConfigFieldsSchema)

export const createKnowledgeBaseBodySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z
    .string()
    .max(
      KNOWLEDGE_BASE_DESCRIPTION_MAX_LENGTH,
      `Description must be ${KNOWLEDGE_BASE_DESCRIPTION_MAX_LENGTH} characters or less`
    )
    .optional(),
  workspaceId: workspaceIdSchema,
  /**
   * Folder the knowledge base is created in, from the `knowledge_base` folder tree.
   * `null` (or omitted) creates it at the workspace root.
   */
  folderId: z.string().min(1, 'Folder ID cannot be empty').nullable().optional(),
  chunkingConfig: chunkingConfigSchema.default(DEFAULT_CHUNKING_CONFIG),
})

export const updateKnowledgeBaseBodySchema = createKnowledgeBaseBodySchema
  .pick({
    name: true,
    description: true,
  })
  .partial()
  .extend({
    chunkingConfig: chunkingConfigSchema.optional(),
    /**
     * Moves the knowledge base between folders. Omitted leaves the folder untouched;
     * explicit `null` moves it back to the workspace root.
     */
    folderId: z.string().min(1, 'Folder ID cannot be empty').nullable().optional(),
    workspaceId: workspaceIdSchema.optional(),
  })

export type UpdateKnowledgeBaseBody = z.input<typeof updateKnowledgeBaseBodySchema>

const knowledgeChunkingConfigSchema = z
  .object({
    maxSize: z.number(),
    minSize: z.number(),
    overlap: z.number(),
    strategy: chunkingStrategySchema.optional(),
    strategyOptions: storedChunkingStrategyOptionsSchema.optional(),
  })
  .passthrough()

export const knowledgeBaseDataSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    name: z.string(),
    isSearchIndex: z.boolean().optional(),
    description: z.string().nullable(),
    tokenCount: z.number(),
    embeddingModel: z.string(),
    embeddingDimension: z.number(),
    chunkingConfig: knowledgeChunkingConfigSchema,
    createdAt: wireDateSchema,
    updatedAt: wireDateSchema,
    deletedAt: nullableWireDateSchema,
    workspaceId: z.string().nullable(),
    folderId: z.string().nullable(),
    docCount: z.number().optional(),
    connectorTypes: z.array(z.string()).optional(),
    hasPermissionScopedConnector: z.boolean().optional(),
  })
  .passthrough()
export type KnowledgeBaseData = z.output<typeof knowledgeBaseDataSchema>

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

const bulkKnowledgeIdListSchema = z
  .array(requiredFieldSchema('id entries cannot be empty'))
  .max(MAX_KNOWLEDGE_BATCH_ITEMS, `cannot contain more than ${MAX_KNOWLEDGE_BATCH_ITEMS} ids`)
  .default([])

/**
 * Bounds a mixed selection from the Knowledge list, which interleaves folder
 * rows and knowledge base rows in one grid. Both lists travel in one request so
 * a mixed selection commits as one authorized operation instead of a
 * client-sequenced fan-out.
 *
 * The cap is on the combined count: each list is individually bounded first so
 * an oversized array is rejected before the combined arithmetic, and folders
 * cost more than bases because they cascade.
 */
function refineBoundedKnowledgeSelection(
  selection: { knowledgeBaseIds: string[]; folderIds: string[] },
  ctx: z.RefinementCtx
): void {
  const total = selection.knowledgeBaseIds.length + selection.folderIds.length
  if (total === 0) {
    ctx.addIssue({
      code: 'custom',
      path: ['knowledgeBaseIds'],
      message: 'At least one knowledge base or folder must be selected',
    })
    return
  }
  if (total > MAX_KNOWLEDGE_BATCH_ITEMS) {
    ctx.addIssue({
      code: 'custom',
      path: ['knowledgeBaseIds'],
      message: `knowledgeBaseIds and folderIds cannot contain more than ${MAX_KNOWLEDGE_BATCH_ITEMS} ids combined`,
    })
  }
}

export const bulkMoveKnowledgeItemsBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    knowledgeBaseIds: bulkKnowledgeIdListSchema,
    folderIds: bulkKnowledgeIdListSchema,
    /** Destination folder in the `knowledge_base` tree. `null` is the workspace root. */
    targetFolderId: folderIdSchema.nullable(),
  })
  .superRefine(refineBoundedKnowledgeSelection)
export type BulkMoveKnowledgeItemsBody = z.input<typeof bulkMoveKnowledgeItemsBodySchema>

export const bulkDeleteKnowledgeItemsBodySchema = z
  .object({
    workspaceId: workspaceIdSchema,
    knowledgeBaseIds: bulkKnowledgeIdListSchema,
    /** Folders to delete. Each cascades to every knowledge base and subfolder inside it. */
    folderIds: bulkKnowledgeIdListSchema,
  })
  .superRefine(refineBoundedKnowledgeSelection)
export type BulkDeleteKnowledgeItemsBody = z.input<typeof bulkDeleteKnowledgeItemsBodySchema>

const bulkKnowledgeItemKindSchema = z.enum(['knowledgeBase', 'folder'])

const bulkKnowledgeItemSchema = z.object({
  kind: bulkKnowledgeItemKindSchema,
  id: z.string(),
  name: z.string(),
})

/** An id nothing active resolved to. Carries no name, because nothing was found to name. */
const bulkKnowledgeMissingSchema = z.object({
  kind: bulkKnowledgeItemKindSchema,
  id: z.string(),
})

/**
 * An item the batch reached but could not act on for a reason the caller can
 * act on in turn. Distinct from `notFound`, which also absorbs the items the
 * caller may not write to.
 */
const bulkKnowledgeFailureSchema = bulkKnowledgeItemSchema.extend({ reason: z.string() })

/**
 * Items dropped because a selected folder already carries them: a knowledge
 * base filed inside a selected folder, or a subfolder of another selected one.
 */
const bulkKnowledgeSkippedSchema = z.array(bulkKnowledgeItemSchema)

export const bulkMoveKnowledgeItemsContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/bulk-move',
  body: bulkMoveKnowledgeItemsBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        moved: z.array(bulkKnowledgeItemSchema),
        skipped: bulkKnowledgeSkippedSchema,
        notFound: z.array(bulkKnowledgeMissingSchema),
        failed: z.array(bulkKnowledgeFailureSchema),
      })
    ),
  },
})

export const bulkDeleteKnowledgeItemsContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/bulk-delete',
  body: bulkDeleteKnowledgeItemsBodySchema,
  response: {
    mode: 'json',
    schema: successResponseSchema(
      z.object({
        deleted: z.array(bulkKnowledgeItemSchema),
        skipped: bulkKnowledgeSkippedSchema,
        notFound: z.array(bulkKnowledgeMissingSchema),
        failed: z.array(bulkKnowledgeFailureSchema),
        /** Totals across the explicit deletes and every folder cascade they triggered. */
        deletedItems: z.object({
          knowledgeBases: z.number().int(),
          folders: z.number().int(),
        }),
      })
    ),
  },
})
