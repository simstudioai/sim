import { randomUUID } from 'crypto'
import { z } from 'zod'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import { generateSearchEmbedding } from '@/lib/knowledge/embeddings'
import {
  createKnowledgeBase,
  getKnowledgeBaseById,
  getKnowledgeBases,
} from '@/lib/knowledge/service'
import { createLogger } from '@/lib/logs/console/logger'
import {
  getQueryStrategy,
  handleVectorOnlySearch,
} from '@/app/api/knowledge/search/utils'

const logger = createLogger('KnowledgeBaseServerTool')

/**
 * Input schema for the knowledge_base tool
 */
export const KnowledgeBaseInput = z.object({
  operation: z.enum(['create', 'list', 'get', 'query']),
  args: z
    .object({
      /** Name of the knowledge base (required for create) */
      name: z.string().optional(),
      /** Description of the knowledge base (optional for create) */
      description: z.string().optional(),
      /** Workspace ID to associate with (optional for create/list) */
      workspaceId: z.string().optional(),
      /** Knowledge base ID (required for get, query) */
      knowledgeBaseId: z.string().optional(),
      /** Search query text (required for query) */
      query: z.string().optional(),
      /** Number of results to return (optional for query, defaults to 5) */
      topK: z.number().min(1).max(50).optional(),
      /** Chunking configuration (optional for create) */
      chunkingConfig: z
        .object({
          maxSize: z.number().min(100).max(4000).default(1024),
          minSize: z.number().min(1).max(2000).default(1),
          overlap: z.number().min(0).max(500).default(200),
        })
        .optional(),
    })
    .optional(),
})

export type KnowledgeBaseInputType = z.infer<typeof KnowledgeBaseInput>

/**
 * Result schema for the knowledge_base tool
 */
export const KnowledgeBaseResult = z.object({
  success: z.boolean(),
  message: z.string(),
  data: z.any().optional(),
})

export type KnowledgeBaseResultType = z.infer<typeof KnowledgeBaseResult>

/**
 * Knowledge base tool for copilot to create, list, and get knowledge bases
 */
export const knowledgeBaseServerTool: BaseServerTool<KnowledgeBaseInputType, KnowledgeBaseResultType> = {
  name: 'knowledge_base',
  async execute(
    params: KnowledgeBaseInputType,
    context?: { userId: string }
  ): Promise<KnowledgeBaseResultType> {
    if (!context?.userId) {
      logger.error('Unauthorized attempt to access knowledge base - no authenticated user context')
      throw new Error('Authentication required')
    }

    const { operation, args = {} } = params

    try {
      switch (operation) {
        case 'create': {
          if (!args.name) {
            return {
              success: false,
              message: 'Name is required for creating a knowledge base',
            }
          }

          const requestId = crypto.randomUUID().slice(0, 8)
          const newKnowledgeBase = await createKnowledgeBase(
            {
              name: args.name,
              description: args.description,
              workspaceId: args.workspaceId,
              userId: context.userId,
              embeddingModel: 'text-embedding-3-small',
              embeddingDimension: 1536,
              chunkingConfig: args.chunkingConfig || {
                maxSize: 1024,
                minSize: 1,
                overlap: 200,
              },
            },
            requestId
          )

          logger.info('Knowledge base created via copilot', {
            knowledgeBaseId: newKnowledgeBase.id,
            name: newKnowledgeBase.name,
            userId: context.userId,
          })

          return {
            success: true,
            message: `Knowledge base "${newKnowledgeBase.name}" created successfully`,
            data: {
              id: newKnowledgeBase.id,
              name: newKnowledgeBase.name,
              description: newKnowledgeBase.description,
              workspaceId: newKnowledgeBase.workspaceId,
              docCount: newKnowledgeBase.docCount,
              createdAt: newKnowledgeBase.createdAt,
            },
          }
        }

        case 'list': {
          const knowledgeBases = await getKnowledgeBases(context.userId, args.workspaceId)

          logger.info('Knowledge bases listed via copilot', {
            count: knowledgeBases.length,
            userId: context.userId,
            workspaceId: args.workspaceId,
          })

          return {
            success: true,
            message: `Found ${knowledgeBases.length} knowledge base(s)`,
            data: knowledgeBases.map((kb) => ({
              id: kb.id,
              name: kb.name,
              description: kb.description,
              workspaceId: kb.workspaceId,
              docCount: kb.docCount,
              tokenCount: kb.tokenCount,
              createdAt: kb.createdAt,
              updatedAt: kb.updatedAt,
            })),
          }
        }

        case 'get': {
          if (!args.knowledgeBaseId) {
            return {
              success: false,
              message: 'Knowledge base ID is required for get operation',
            }
          }

          const knowledgeBase = await getKnowledgeBaseById(args.knowledgeBaseId)
          if (!knowledgeBase) {
            return {
              success: false,
              message: `Knowledge base with ID "${args.knowledgeBaseId}" not found`,
            }
          }

          logger.info('Knowledge base metadata retrieved via copilot', {
            knowledgeBaseId: knowledgeBase.id,
            userId: context.userId,
          })

          return {
            success: true,
            message: `Retrieved knowledge base "${knowledgeBase.name}"`,
            data: {
              id: knowledgeBase.id,
              name: knowledgeBase.name,
              description: knowledgeBase.description,
              workspaceId: knowledgeBase.workspaceId,
              docCount: knowledgeBase.docCount,
              tokenCount: knowledgeBase.tokenCount,
              embeddingModel: knowledgeBase.embeddingModel,
              chunkingConfig: knowledgeBase.chunkingConfig,
              createdAt: knowledgeBase.createdAt,
              updatedAt: knowledgeBase.updatedAt,
            },
          }
        }

        case 'query': {
          if (!args.knowledgeBaseId) {
            return {
              success: false,
              message: 'Knowledge base ID is required for query operation',
            }
          }

          if (!args.query) {
            return {
              success: false,
              message: 'Query text is required for query operation',
            }
          }

          // Verify knowledge base exists
          const kb = await getKnowledgeBaseById(args.knowledgeBaseId)
          if (!kb) {
            return {
              success: false,
              message: `Knowledge base with ID "${args.knowledgeBaseId}" not found`,
            }
          }

          const topK = args.topK || 5

          // Generate embedding for the query
          const queryEmbedding = await generateSearchEmbedding(args.query)
          const queryVector = JSON.stringify(queryEmbedding)

          // Get search strategy
          const strategy = getQueryStrategy(1, topK)

          // Perform vector search
          const results = await handleVectorOnlySearch({
            knowledgeBaseIds: [args.knowledgeBaseId],
            topK,
            queryVector,
            distanceThreshold: strategy.distanceThreshold,
          })

          logger.info('Knowledge base queried via copilot', {
            knowledgeBaseId: args.knowledgeBaseId,
            query: args.query.substring(0, 100),
            resultCount: results.length,
            userId: context.userId,
          })

          return {
            success: true,
            message: `Found ${results.length} result(s) for query "${args.query.substring(0, 50)}${args.query.length > 50 ? '...' : ''}"`,
            data: {
              knowledgeBaseId: args.knowledgeBaseId,
              knowledgeBaseName: kb.name,
              query: args.query,
              topK,
              totalResults: results.length,
              results: results.map((result) => ({
                documentId: result.documentId,
                content: result.content,
                chunkIndex: result.chunkIndex,
                similarity: 1 - result.distance,
              })),
            },
          }
        }

        default:
          return {
            success: false,
            message: `Unknown operation: ${operation}. Supported operations: create, list, get, query`,
          }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
      logger.error('Error in knowledge_base tool', {
        operation,
        error: errorMessage,
        userId: context.userId,
      })

      return {
        success: false,
        message: `Failed to ${operation} knowledge base: ${errorMessage}`,
      }
    }
  },
}

