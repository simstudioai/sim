import { createLogger } from '@sim/logger'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import type { KnowledgeBaseArgs, KnowledgeBaseResult } from '@/lib/copilot/tools/shared/schemas'
import { generateSearchEmbedding } from '@/lib/knowledge/embeddings'
import {
  createKnowledgeBase,
  getKnowledgeBaseById,
  getKnowledgeBases,
} from '@/lib/knowledge/service'
import { getQueryStrategy, handleVectorOnlySearch } from '@/app/api/knowledge/search/utils'

const logger = createLogger('KnowledgeBaseServerTool')

/**
 * Knowledge base tool for copilot to create, list, and get knowledge bases
 */
export const knowledgeBaseServerTool: BaseServerTool<KnowledgeBaseArgs, KnowledgeBaseResult> = {
  name: 'knowledge_base',
  async execute(
    params: KnowledgeBaseArgs,
    context?: { userId: string }
  ): Promise<KnowledgeBaseResult> {
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

          if (!args.workspaceId) {
            return {
              success: false,
              message: 'Workspace ID is required for creating a knowledge base',
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

          const kb = await getKnowledgeBaseById(args.knowledgeBaseId)
          if (!kb) {
            return {
              success: false,
              message: `Knowledge base with ID "${args.knowledgeBaseId}" not found`,
            }
          }

          const topK = args.topK || 5

          const queryEmbedding = await generateSearchEmbedding(
            args.query,
            undefined,
            kb.workspaceId
          )
          const queryVector = JSON.stringify(queryEmbedding)

          const strategy = getQueryStrategy(1, topK)

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
