import { z } from 'zod'
import {
  knowledgeBaseParamsSchema,
  nullableWireDateSchema,
  successResponseSchema,
  wireDateSchema,
} from '@/lib/api/contracts/knowledge/shared'
import { defineRouteContract } from '@/lib/api/contracts/types'
import type { StrategyOptions } from '@/lib/chunkers/types'

export const knowledgeScopeSchema = z.enum(['active', 'archived', 'all'])
export type KnowledgeScope = z.output<typeof knowledgeScopeSchema>

export const listKnowledgeBasesQuerySchema = z.object({
  workspaceId: z.string().min(1).optional(),
  scope: knowledgeScopeSchema.default('active'),
})

export const chunkingStrategyOptionsSchema = z
  .object({
    pattern: z.string().max(500).optional(),
    separators: z.array(z.string()).optional(),
    recipe: z.enum(['plain', 'markdown', 'code']).optional(),
    strictBoundaries: z.boolean().optional(),
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
  .refine((data) => data.strategy === 'regex' || data.strategyOptions?.strictBoundaries !== true, {
    message: 'strictBoundaries is only valid for the regex chunking strategy',
  })

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
  })
  .partial()
  .extend({
    chunkingConfig: chunkingConfigSchema.optional(),
    workspaceId: z.string().nullable().optional(),
    embeddingModel: z.literal('text-embedding-3-small').optional(),
    embeddingDimension: z.literal(1536).optional(),
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
