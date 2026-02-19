import { createLogger } from '@sim/logger'
import type { BaseServerTool } from '@/lib/copilot/tools/server/base-tool'
import type { KnowledgeBaseArgs, KnowledgeBaseResult } from '@/lib/copilot/tools/shared/schemas'
import { generateSearchEmbedding } from '@/lib/knowledge/embeddings'
import {
  createKnowledgeBase,
  deleteKnowledgeBase,
  getKnowledgeBaseById,
  getKnowledgeBases,
  updateKnowledgeBase,
} from '@/lib/knowledge/service'
import {
  createTagDefinition,
  deleteTagDefinition,
  getDocumentTagDefinitions,
  getNextAvailableSlot,
  getTagUsageStats,
  updateTagDefinition,
} from '@/lib/knowledge/tags/service'
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

        case 'update': {
          if (!args.knowledgeBaseId) {
            return {
              success: false,
              message: 'Knowledge base ID is required for update operation',
            }
          }

          const updates: { name?: string; description?: string; chunkingConfig?: { maxSize: number; minSize: number; overlap: number } } = {}
          if (args.name) updates.name = args.name
          if (args.description !== undefined) updates.description = args.description
          if (args.chunkingConfig) updates.chunkingConfig = args.chunkingConfig

          if (!updates.name && updates.description === undefined && !updates.chunkingConfig) {
            return {
              success: false,
              message: 'At least one of name, description, or chunkingConfig is required for update',
            }
          }

          const requestId = crypto.randomUUID().slice(0, 8)
          const updatedKb = await updateKnowledgeBase(args.knowledgeBaseId, updates, requestId)

          logger.info('Knowledge base updated via copilot', {
            knowledgeBaseId: args.knowledgeBaseId,
            userId: context.userId,
          })

          return {
            success: true,
            message: `Knowledge base "${updatedKb.name}" updated successfully`,
            data: {
              id: updatedKb.id,
              name: updatedKb.name,
              description: updatedKb.description,
              workspaceId: updatedKb.workspaceId,
              docCount: updatedKb.docCount,
              updatedAt: updatedKb.updatedAt,
            },
          }
        }

        case 'delete': {
          if (!args.knowledgeBaseId) {
            return {
              success: false,
              message: 'Knowledge base ID is required for delete operation',
            }
          }

          const kbToDelete = await getKnowledgeBaseById(args.knowledgeBaseId)
          if (!kbToDelete) {
            return {
              success: false,
              message: `Knowledge base with ID "${args.knowledgeBaseId}" not found`,
            }
          }

          const requestId = crypto.randomUUID().slice(0, 8)
          await deleteKnowledgeBase(args.knowledgeBaseId, requestId)

          logger.info('Knowledge base deleted via copilot', {
            knowledgeBaseId: args.knowledgeBaseId,
            name: kbToDelete.name,
            userId: context.userId,
          })

          return {
            success: true,
            message: `Knowledge base "${kbToDelete.name}" deleted successfully`,
            data: {
              id: args.knowledgeBaseId,
              name: kbToDelete.name,
            },
          }
        }

        case 'list_tags': {
          if (!args.knowledgeBaseId) {
            return {
              success: false,
              message: 'Knowledge base ID is required for list_tags operation',
            }
          }

          const tagDefinitions = await getDocumentTagDefinitions(args.knowledgeBaseId)

          logger.info('Tag definitions listed via copilot', {
            knowledgeBaseId: args.knowledgeBaseId,
            count: tagDefinitions.length,
            userId: context.userId,
          })

          return {
            success: true,
            message: `Found ${tagDefinitions.length} tag definition(s)`,
            data: tagDefinitions.map((td) => ({
              id: td.id,
              tagSlot: td.tagSlot,
              displayName: td.displayName,
              fieldType: td.fieldType,
              createdAt: td.createdAt,
            })),
          }
        }

        case 'create_tag': {
          if (!args.knowledgeBaseId) {
            return {
              success: false,
              message: 'Knowledge base ID is required for create_tag operation',
            }
          }
          if (!args.tagDisplayName) {
            return {
              success: false,
              message: 'tagDisplayName is required for create_tag operation',
            }
          }
          const fieldType = args.tagFieldType || 'text'

          const tagSlot = await getNextAvailableSlot(args.knowledgeBaseId, fieldType)
          if (!tagSlot) {
            return {
              success: false,
              message: `No available slots for field type "${fieldType}". Maximum tags of this type reached.`,
            }
          }

          const requestId = crypto.randomUUID().slice(0, 8)
          const newTag = await createTagDefinition(
            {
              knowledgeBaseId: args.knowledgeBaseId,
              tagSlot,
              displayName: args.tagDisplayName,
              fieldType,
            },
            requestId
          )

          logger.info('Tag definition created via copilot', {
            knowledgeBaseId: args.knowledgeBaseId,
            tagId: newTag.id,
            displayName: newTag.displayName,
            userId: context.userId,
          })

          return {
            success: true,
            message: `Tag "${newTag.displayName}" created successfully`,
            data: {
              id: newTag.id,
              tagSlot: newTag.tagSlot,
              displayName: newTag.displayName,
              fieldType: newTag.fieldType,
            },
          }
        }

        case 'update_tag': {
          if (!args.tagDefinitionId) {
            return {
              success: false,
              message: 'tagDefinitionId is required for update_tag operation',
            }
          }

          const updateData: { displayName?: string; fieldType?: string } = {}
          if (args.tagDisplayName) updateData.displayName = args.tagDisplayName
          if (args.tagFieldType) updateData.fieldType = args.tagFieldType

          if (!updateData.displayName && !updateData.fieldType) {
            return {
              success: false,
              message: 'At least one of tagDisplayName or tagFieldType is required for update_tag',
            }
          }

          const requestId = crypto.randomUUID().slice(0, 8)
          const updatedTag = await updateTagDefinition(args.tagDefinitionId, updateData, requestId)

          logger.info('Tag definition updated via copilot', {
            tagId: args.tagDefinitionId,
            userId: context.userId,
          })

          return {
            success: true,
            message: `Tag "${updatedTag.displayName}" updated successfully`,
            data: {
              id: updatedTag.id,
              tagSlot: updatedTag.tagSlot,
              displayName: updatedTag.displayName,
              fieldType: updatedTag.fieldType,
            },
          }
        }

        case 'delete_tag': {
          if (!args.tagDefinitionId) {
            return {
              success: false,
              message: 'tagDefinitionId is required for delete_tag operation',
            }
          }

          const requestId = crypto.randomUUID().slice(0, 8)
          const deleted = await deleteTagDefinition(args.tagDefinitionId, requestId)

          logger.info('Tag definition deleted via copilot', {
            tagId: args.tagDefinitionId,
            tagSlot: deleted.tagSlot,
            displayName: deleted.displayName,
            userId: context.userId,
          })

          return {
            success: true,
            message: `Tag "${deleted.displayName}" deleted successfully. All document/chunk references cleared.`,
            data: {
              tagSlot: deleted.tagSlot,
              displayName: deleted.displayName,
            },
          }
        }

        case 'get_tag_usage': {
          if (!args.knowledgeBaseId) {
            return {
              success: false,
              message: 'Knowledge base ID is required for get_tag_usage operation',
            }
          }

          const requestId = crypto.randomUUID().slice(0, 8)
          const stats = await getTagUsageStats(args.knowledgeBaseId, requestId)

          return {
            success: true,
            message: `Retrieved usage stats for ${stats.length} tag(s)`,
            data: stats,
          }
        }

        default:
          return {
            success: false,
            message: `Unknown operation: ${operation}. Supported operations: create, list, get, query, update, delete, list_tags, create_tag, update_tag, delete_tag, get_tag_usage`,
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
