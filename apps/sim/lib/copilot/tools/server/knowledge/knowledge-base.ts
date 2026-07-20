import { db } from '@sim/db'
import { knowledgeConnector } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { truncate } from '@sim/utils/string'
import { and, eq, isNull } from 'drizzle-orm'
import { generateInternalToken } from '@/lib/auth/internal'
import { checkActorUsageLimits } from '@/lib/billing/calculations/usage-monitor'
import {
  assertBillingAttributionSnapshot,
  BILLING_ATTRIBUTION_HEADER,
  type BillingAttributionSnapshot,
  checkAttributedUsageLimits,
  serializeBillingAttributionHeader,
} from '@/lib/billing/core/billing-attribution'
import { KnowledgeBase } from '@/lib/copilot/generated/tool-catalog-v1'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import { getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import {
  createSingleDocument,
  deleteDocument,
  processDocumentAsync,
  updateDocument,
} from '@/lib/knowledge/documents/service'
import {
  EMBEDDING_DIMENSIONS,
  generateSearchEmbedding,
  getConfiguredEmbeddingModel,
  recordSearchEmbeddingUsage,
} from '@/lib/knowledge/embeddings'
import { type FilterFieldType, getOperatorsForFieldType } from '@/lib/knowledge/filters/types'
import {
  createKnowledgeBase,
  deleteKnowledgeBase,
  getKnowledgeBaseById,
  updateKnowledgeBase,
} from '@/lib/knowledge/service'
import {
  createTagDefinition,
  deleteTagDefinition,
  getDocumentTagDefinitions,
  getNextAvailableSlot,
  getTagDefinitionById,
  getTagUsageStats,
  updateTagDefinition,
} from '@/lib/knowledge/tags/service'
import { buildUndefinedTagsError, validateTagValue } from '@/lib/knowledge/tags/utils'
import type { StructuredFilter, TagDefinition } from '@/lib/knowledge/types'
import { StorageService } from '@/lib/uploads'
import { resolveWorkspaceFileReference } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import {
  getQueryStrategy,
  handleTagAndVectorSearch,
  handleVectorOnlySearch,
} from '@/app/api/knowledge/search/utils'
import {
  checkDocumentWriteAccess,
  checkKnowledgeBaseAccess,
  checkKnowledgeBaseWriteAccess,
} from '@/app/api/knowledge/utils'
import { parseDocumentTags, parseTagFilters } from '@/tools/shared/tags'

const logger = createLogger('KnowledgeBaseServerTool')

function requireKnowledgeBillingAttribution(
  context: ServerToolContext,
  workspaceId: string
): BillingAttributionSnapshot {
  if (!context.billingAttribution) {
    throw new Error('Billing attribution is required for knowledge operations')
  }
  const attribution = assertBillingAttributionSnapshot(context.billingAttribution)
  if (attribution.actorUserId !== context.userId || attribution.workspaceId !== workspaceId) {
    throw new Error('Knowledge billing attribution does not match its actor and workspace')
  }
  return attribution
}

type KnowledgeBaseArgs = {
  operation: string
  args?: Record<string, any>
}

type KnowledgeBaseResult = {
  success: boolean
  message: string
  data?: any
}

/**
 * Knowledge base tool for copilot to create, list, and get knowledge bases
 */
export const knowledgeBaseServerTool: BaseServerTool<KnowledgeBaseArgs, KnowledgeBaseResult> = {
  name: KnowledgeBase.id,
  async execute(
    params: KnowledgeBaseArgs,
    context?: ServerToolContext
  ): Promise<KnowledgeBaseResult> {
    const withMessageId = (message: string) =>
      context?.messageId ? `${message} [messageId:${context.messageId}]` : message

    if (!context?.userId) {
      logger.error('Unauthorized attempt to access knowledge base - no authenticated user context')
      throw new Error('Authentication required')
    }

    const { operation, args = {} } = params
    const workspaceId =
      context.workspaceId || ((args as Record<string, unknown>).workspaceId as string | undefined)
    const assertNotAborted = () =>
      assertServerToolNotAborted(
        context,
        'Request aborted before knowledge mutation could be applied.'
      )

    try {
      switch (operation) {
        case 'create': {
          if (!args.name) {
            return {
              success: false,
              message: 'Name is required for creating a knowledge base',
            }
          }

          if (!workspaceId) {
            return {
              success: false,
              message: 'Workspace ID is required for creating a knowledge base',
            }
          }

          const requestId = generateId().slice(0, 8)
          assertNotAborted()
          const newKnowledgeBase = await createKnowledgeBase(
            {
              name: args.name,
              description: args.description,
              workspaceId,
              userId: context.userId,
              embeddingModel: getConfiguredEmbeddingModel(),
              embeddingDimension: EMBEDDING_DIMENSIONS,
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

        case 'get': {
          if (!args.knowledgeBaseId) {
            return {
              success: false,
              message: 'Knowledge base ID is required for get operation',
            }
          }

          const access = await checkKnowledgeBaseAccess(args.knowledgeBaseId, context.userId)
          if (!access.hasAccess) {
            return {
              success: false,
              message: `Knowledge base with ID "${args.knowledgeBaseId}" not found`,
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

          const access = await checkKnowledgeBaseAccess(args.knowledgeBaseId, context.userId)
          if (!access.hasAccess) {
            return {
              success: false,
              message: `Knowledge base with ID "${args.knowledgeBaseId}" not found`,
            }
          }

          const kb = await getKnowledgeBaseById(args.knowledgeBaseId)
          if (!kb) {
            return {
              success: false,
              message: `Knowledge base with ID "${args.knowledgeBaseId}" not found`,
            }
          }

          const parsedTagFilters = parseTagFilters(args.tagFilters)
          if (args.tagFilters !== undefined && parsedTagFilters.length === 0) {
            return {
              success: false,
              message: 'tagFilters must contain at least one tagName and tagValue',
            }
          }

          const tagDefinitions =
            parsedTagFilters.length > 0 ? await getDocumentTagDefinitions(args.knowledgeBaseId) : []
          const structuredFilters = resolveStructuredTagFilters(parsedTagFilters, tagDefinitions)
          if (!structuredFilters.success) {
            return structuredFilters.result
          }

          const topK = args.topK || 5

          const billingAttribution = kb.workspaceId
            ? requireKnowledgeBillingAttribution(context, kb.workspaceId)
            : undefined
          const usage = billingAttribution
            ? await checkAttributedUsageLimits(billingAttribution)
            : await checkActorUsageLimits(context.userId)
          if (usage.isExceeded) {
            return {
              success: false,
              message:
                usage.message || 'Usage limit exceeded. Please upgrade your plan to continue.',
            }
          }

          const { embedding: queryEmbedding, isBYOK: queryEmbeddingIsBYOK } =
            await generateSearchEmbedding(args.query, kb.embeddingModel, kb.workspaceId)
          const queryVector = JSON.stringify(queryEmbedding)

          const strategy = getQueryStrategy(1, topK)

          const searchParams = {
            knowledgeBaseIds: [args.knowledgeBaseId],
            topK,
            queryVector,
            distanceThreshold: strategy.distanceThreshold,
          }
          const results =
            structuredFilters.filters.length > 0
              ? await handleTagAndVectorSearch({
                  ...searchParams,
                  structuredFilters: structuredFilters.filters,
                })
              : await handleVectorOnlySearch(searchParams)

          await recordSearchEmbeddingUsage({
            userId: context.userId,
            workspaceId: kb.workspaceId,
            embeddingModel: kb.embeddingModel,
            query: args.query,
            isBYOK: queryEmbeddingIsBYOK,
            sourceReference: `copilot-kb-search:${args.knowledgeBaseId}`,
            billingAttribution,
          })

          logger.info('Knowledge base queried via copilot', {
            knowledgeBaseId: args.knowledgeBaseId,
            query: args.query.substring(0, 100),
            resultCount: results.length,
            userId: context.userId,
          })

          return {
            success: true,
            message: `Found ${results.length} result(s) for query "${truncate(args.query, 50)}"`,
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

        case 'add_file': {
          if (!args.knowledgeBaseId) {
            return {
              success: false,
              message: 'Knowledge base ID is required for add_file operation',
            }
          }

          const fileRefs: string[] =
            args.filePaths ??
            args.fileIds ??
            (args.fileId ? [args.fileId] : args.filePath ? [args.filePath] : [])
          if (fileRefs.length === 0) {
            return {
              success: false,
              message:
                'filePaths is required for add_file. Use canonical VFS file paths from glob("files/**").',
            }
          }

          const writeAccess = await checkKnowledgeBaseWriteAccess(
            args.knowledgeBaseId,
            context.userId
          )
          if (!writeAccess.hasAccess) {
            return {
              success: false,
              message: `Knowledge base with ID "${args.knowledgeBaseId}" not found`,
            }
          }

          const targetKb = await getKnowledgeBaseById(args.knowledgeBaseId)
          if (!targetKb || !targetKb.workspaceId) {
            return {
              success: false,
              message: `Knowledge base with ID "${args.knowledgeBaseId}" not found`,
            }
          }

          const kbWorkspaceId: string = targetKb.workspaceId
          const billingAttribution = requireKnowledgeBillingAttribution(context, kbWorkspaceId)
          const added: Array<{ documentId: string; filename: string }> = []
          const failedFiles: string[] = []

          for (const fileRef of fileRefs) {
            const fileRecord = await resolveWorkspaceFileReference(kbWorkspaceId, fileRef)
            if (!fileRecord) {
              failedFiles.push(fileRef)
              continue
            }

            const presignedUrl = await StorageService.generatePresignedDownloadUrl(
              fileRecord.key,
              'workspace',
              5 * 60
            )

            const requestId = generateId().slice(0, 8)
            assertNotAborted()
            const doc = await createSingleDocument(
              {
                filename: fileRecord.name,
                fileUrl: presignedUrl,
                fileSize: fileRecord.size,
                mimeType: fileRecord.type,
              },
              args.knowledgeBaseId,
              requestId,
              context.userId
            )

            processDocumentAsync(
              args.knowledgeBaseId,
              doc.id,
              {
                filename: fileRecord.name,
                fileUrl: presignedUrl,
                fileSize: fileRecord.size,
                mimeType: fileRecord.type,
              },
              {},
              billingAttribution
            ).catch((err) => {
              logger.error('Background document processing failed', {
                documentId: doc.id,
                error: toError(err).message,
              })
            })

            added.push({ documentId: doc.id, filename: fileRecord.name })

            logger.info('Workspace file added to knowledge base via copilot', {
              knowledgeBaseId: args.knowledgeBaseId,
              documentId: doc.id,
              fileName: fileRecord.name,
              userId: context.userId,
            })
          }

          const addedNames = added.map((a) => a.filename).join(', ')
          return {
            success: added.length > 0,
            message:
              added.length > 0
                ? `Added ${added.length} file(s) to "${targetKb.name}": ${addedNames}. Processing started.`
                : `No files could be added.`,
            data: {
              knowledgeBaseId: args.knowledgeBaseId,
              knowledgeBaseName: targetKb.name,
              added,
              failed: failedFiles,
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

          const updates: {
            name?: string
            description?: string
            chunkingConfig?: { maxSize: number; minSize: number; overlap: number }
          } = {}
          if (args.name) updates.name = args.name
          if (args.description !== undefined) updates.description = args.description
          if (args.chunkingConfig) updates.chunkingConfig = args.chunkingConfig

          if (!updates.name && updates.description === undefined && !updates.chunkingConfig) {
            return {
              success: false,
              message:
                'At least one of name, description, or chunkingConfig is required for update',
            }
          }

          const writeAccess = await checkKnowledgeBaseWriteAccess(
            args.knowledgeBaseId,
            context.userId
          )
          if (!writeAccess.hasAccess) {
            return {
              success: false,
              message: `Knowledge base with ID "${args.knowledgeBaseId}" not found`,
            }
          }

          const requestId = generateId().slice(0, 8)
          assertNotAborted()
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
          const kbIds: string[] =
            args.knowledgeBaseIds ?? (args.knowledgeBaseId ? [args.knowledgeBaseId] : [])
          if (kbIds.length === 0) {
            return {
              success: false,
              message: 'knowledgeBaseId or knowledgeBaseIds is required for delete operation',
            }
          }

          const deleted: Array<{ id: string; name: string }> = []
          const notFound: string[] = []

          for (const kbId of kbIds) {
            const writeAccess = await checkKnowledgeBaseWriteAccess(kbId, context.userId)
            if (!writeAccess.hasAccess) {
              notFound.push(kbId)
              continue
            }

            const kbToDelete = await getKnowledgeBaseById(kbId)
            if (!kbToDelete) {
              notFound.push(kbId)
              continue
            }

            const requestId = generateId().slice(0, 8)
            assertNotAborted()
            await deleteKnowledgeBase(kbId, requestId)
            deleted.push({ id: kbId, name: kbToDelete.name })

            logger.info('Knowledge base deleted via copilot', {
              knowledgeBaseId: kbId,
              name: kbToDelete.name,
              userId: context.userId,
            })
          }

          return {
            success: deleted.length > 0,
            message:
              deleted.length > 0
                ? `Deleted: ${deleted.map((d) => d.name).join(', ')}`
                : 'No knowledge bases found',
            data: { deleted, notFound },
          }
        }

        case 'delete_document': {
          if (!args.knowledgeBaseId) {
            return { success: false, message: 'knowledgeBaseId is required for delete_document' }
          }
          const docIds: string[] = args.documentIds ?? (args.documentId ? [args.documentId] : [])
          if (docIds.length === 0) {
            return {
              success: false,
              message: 'documentId or documentIds is required for delete_document',
            }
          }

          const deleted: string[] = []
          const failed: string[] = []

          for (const docId of docIds) {
            assertNotAborted()
            const docAccess = await checkDocumentWriteAccess(
              args.knowledgeBaseId,
              docId,
              context.userId
            )
            if (!docAccess.hasAccess) {
              failed.push(docId)
              continue
            }
            const requestId = generateId().slice(0, 8)
            const result = await deleteDocument(docId, requestId)
            if (result.success) {
              deleted.push(docId)
            } else {
              failed.push(docId)
            }
          }

          return {
            success: deleted.length > 0,
            message: `Deleted ${deleted.length} document(s)${failed.length > 0 ? `, ${failed.length} failed` : ''}`,
            data: { knowledgeBaseId: args.knowledgeBaseId, deleted, failed },
          }
        }

        case 'update_document': {
          if (!args.knowledgeBaseId) {
            return { success: false, message: 'knowledgeBaseId is required for update_document' }
          }
          if (!args.documentId) {
            return { success: false, message: 'documentId is required for update_document' }
          }
          const docAccess = await checkDocumentWriteAccess(
            args.knowledgeBaseId,
            args.documentId,
            context.userId
          )
          if (!docAccess.hasAccess) {
            return {
              success: false,
              message: `Document with ID "${args.documentId}" not found`,
            }
          }
          const updateData: Parameters<typeof updateDocument>[1] = {}
          if (args.filename !== undefined) {
            updateData.filename = args.filename
          }
          if (args.enabled !== undefined) {
            updateData.enabled = args.enabled
          }
          const parsedDocumentTags = parseDocumentTags(args.documentTags)
          if (args.documentTags !== undefined && parsedDocumentTags.length === 0) {
            return {
              success: false,
              message: 'documentTags must contain at least one tagName and tagValue',
            }
          }

          const updatedTags: Record<string, string> = {}
          if (parsedDocumentTags.length > 0) {
            const tagDefinitions = await getDocumentTagDefinitions(args.knowledgeBaseId)
            const tagDefinitionsByName = new Map(
              tagDefinitions.map((definition) => [definition.displayName, definition])
            )
            const undefinedTags: string[] = []
            const typeErrors: string[] = []

            for (const tag of parsedDocumentTags) {
              const definition = tagDefinitionsByName.get(tag.tagName)
              if (!definition) {
                undefinedTags.push(tag.tagName)
                continue
              }
              const validationError = validateTagValue(tag.tagName, tag.value, definition.fieldType)
              if (validationError) {
                typeErrors.push(validationError)
                continue
              }

              ;(updateData as Record<string, string | boolean | undefined>)[definition.tagSlot] =
                tag.value
              updatedTags[tag.tagName] = tag.value
            }

            if (undefinedTags.length > 0 || typeErrors.length > 0) {
              return {
                success: false,
                message: [
                  ...(undefinedTags.length > 0 ? [buildUndefinedTagsError(undefinedTags)] : []),
                  ...typeErrors,
                ].join('\n'),
              }
            }
          }
          if (Object.keys(updateData).length === 0) {
            return {
              success: false,
              message:
                'At least one of filename, enabled, or documentTags is required for update_document',
            }
          }
          const requestId = generateId().slice(0, 8)
          assertNotAborted()
          await updateDocument(args.documentId, updateData, requestId)
          return {
            success: true,
            message: `Document updated successfully`,
            data: {
              documentId: args.documentId,
              knowledgeBaseId: args.knowledgeBaseId,
              ...(args.filename !== undefined && { filename: args.filename }),
              ...(args.enabled !== undefined && { enabled: args.enabled }),
              ...(Object.keys(updatedTags).length > 0 && { tags: updatedTags }),
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

          const access = await checkKnowledgeBaseAccess(args.knowledgeBaseId, context.userId)
          if (!access.hasAccess) {
            return {
              success: false,
              message: `Knowledge base with ID "${args.knowledgeBaseId}" not found`,
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
            data: {
              tags: tagDefinitions.map((td) => ({
                id: td.id,
                tagSlot: td.tagSlot,
                displayName: td.displayName,
                fieldType: td.fieldType,
                createdAt: td.createdAt,
              })),
            },
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

          const writeAccess = await checkKnowledgeBaseWriteAccess(
            args.knowledgeBaseId,
            context.userId
          )
          if (!writeAccess.hasAccess) {
            return {
              success: false,
              message: `Knowledge base with ID "${args.knowledgeBaseId}" not found`,
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

          const requestId = generateId().slice(0, 8)
          assertNotAborted()
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
              knowledgeBaseId: args.knowledgeBaseId,
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

          const existingTag = await getTagDefinitionById(args.tagDefinitionId)
          if (!existingTag) {
            return {
              success: false,
              message: `Tag definition with ID "${args.tagDefinitionId}" not found`,
            }
          }

          const writeAccess = await checkKnowledgeBaseWriteAccess(
            existingTag.knowledgeBaseId,
            context.userId
          )
          if (!writeAccess.hasAccess) {
            return {
              success: false,
              message: `Tag definition with ID "${args.tagDefinitionId}" not found`,
            }
          }

          const requestId = generateId().slice(0, 8)
          assertNotAborted()
          const updatedTag = await updateTagDefinition(args.tagDefinitionId, updateData, requestId)

          logger.info('Tag definition updated via copilot', {
            tagId: args.tagDefinitionId,
            knowledgeBaseId: existingTag.knowledgeBaseId,
            userId: context.userId,
          })

          return {
            success: true,
            message: `Tag "${updatedTag.displayName}" updated successfully`,
            data: {
              id: updatedTag.id,
              knowledgeBaseId: existingTag.knowledgeBaseId,
              tagSlot: updatedTag.tagSlot,
              displayName: updatedTag.displayName,
              fieldType: updatedTag.fieldType,
            },
          }
        }

        case 'delete_tag': {
          if (!args.knowledgeBaseId) {
            return {
              success: false,
              message: 'knowledgeBaseId is required for delete_tag operation',
            }
          }
          if (!args.tagDefinitionId) {
            return {
              success: false,
              message: 'tagDefinitionId is required for delete_tag operation',
            }
          }

          const writeAccess = await checkKnowledgeBaseWriteAccess(
            args.knowledgeBaseId,
            context.userId
          )
          if (!writeAccess.hasAccess) {
            return {
              success: false,
              message: `Knowledge base with ID "${args.knowledgeBaseId}" not found`,
            }
          }

          const requestId = generateId().slice(0, 8)
          assertNotAborted()
          const deleted = await deleteTagDefinition(
            args.knowledgeBaseId,
            args.tagDefinitionId,
            requestId
          )

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
              knowledgeBaseId: args.knowledgeBaseId,
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

          const access = await checkKnowledgeBaseAccess(args.knowledgeBaseId, context.userId)
          if (!access.hasAccess) {
            return {
              success: false,
              message: `Knowledge base with ID "${args.knowledgeBaseId}" not found`,
            }
          }

          const requestId = generateId().slice(0, 8)
          const stats = await getTagUsageStats(args.knowledgeBaseId, requestId)

          return {
            success: true,
            message: `Retrieved usage stats for ${stats.length} tag(s)`,
            data: { usage: stats },
          }
        }

        case 'add_connector': {
          if (!args.knowledgeBaseId) {
            return { success: false, message: 'Knowledge base ID is required for add_connector' }
          }
          if (!args.connectorType) {
            return { success: false, message: 'connectorType is required for add_connector' }
          }
          if (!args.credentialId && !args.apiKey) {
            return {
              success: false,
              message:
                'Either credentialId (for OAuth connectors) or apiKey (for API key connectors) is required for add_connector.',
            }
          }

          const writeAccess = await checkKnowledgeBaseWriteAccess(
            args.knowledgeBaseId,
            context.userId
          )
          if (!writeAccess.hasAccess) {
            return {
              success: false,
              message: `Knowledge base with ID "${args.knowledgeBaseId}" not found`,
            }
          }
          const connectorWorkspaceId = writeAccess.knowledgeBase.workspaceId
          if (!connectorWorkspaceId) {
            return {
              success: false,
              message: `Knowledge base with ID "${args.knowledgeBaseId}" has no workspace billing context`,
            }
          }
          const billingAttribution = requireKnowledgeBillingAttribution(
            context,
            connectorWorkspaceId
          )

          const createBody: Record<string, unknown> = {
            connectorType: args.connectorType,
            sourceConfig: args.sourceConfig ?? {},
            syncIntervalMinutes: args.syncIntervalMinutes ?? 1440,
          }

          if (args.credentialId) {
            createBody.credentialId = args.credentialId
          }
          if (args.apiKey) {
            createBody.apiKey = args.apiKey
          }

          if (args.disabledTagIds?.length) {
            ;(createBody.sourceConfig as Record<string, unknown>).disabledTagIds =
              args.disabledTagIds
          }

          assertNotAborted()
          const createRes = await connectorApiCall(
            context.userId,
            `/api/knowledge/${args.knowledgeBaseId}/connectors`,
            'POST',
            createBody,
            billingAttribution
          )

          if (!createRes.success) {
            return { success: false, message: createRes.error ?? 'Failed to create connector' }
          }

          const connector = createRes.data
          logger.info('Connector created via copilot', {
            connectorId: connector.id,
            connectorType: args.connectorType,
            knowledgeBaseId: args.knowledgeBaseId,
            userId: context.userId,
          })

          return {
            success: true,
            message: `Connector "${args.connectorType}" added to knowledge base. Initial sync started.`,
            data: {
              id: connector.id,
              connectorType: connector.connectorType ?? connector.connector_type,
              status: connector.status,
              knowledgeBaseId: args.knowledgeBaseId,
            },
          }
        }

        case 'update_connector': {
          if (!args.connectorId) {
            return { success: false, message: 'connectorId is required for update_connector' }
          }

          const kbId = await resolveKnowledgeBaseId(args.connectorId)
          if (!kbId) {
            return { success: false, message: `Connector "${args.connectorId}" not found` }
          }

          const writeAccess = await checkKnowledgeBaseWriteAccess(kbId, context.userId)
          if (!writeAccess.hasAccess) {
            return { success: false, message: `Connector "${args.connectorId}" not found` }
          }

          const updateBody: Record<string, unknown> = {}
          if (args.sourceConfig !== undefined) updateBody.sourceConfig = args.sourceConfig
          if (args.syncIntervalMinutes !== undefined)
            updateBody.syncIntervalMinutes = args.syncIntervalMinutes
          if (args.connectorStatus !== undefined) updateBody.status = args.connectorStatus

          if (Object.keys(updateBody).length === 0) {
            return {
              success: false,
              message:
                'At least one of sourceConfig, syncIntervalMinutes, or connectorStatus is required',
            }
          }

          assertNotAborted()
          const updateRes = await connectorApiCall(
            context.userId,
            `/api/knowledge/${kbId}/connectors/${args.connectorId}`,
            'PATCH',
            updateBody
          )

          if (!updateRes.success) {
            return { success: false, message: updateRes.error ?? 'Failed to update connector' }
          }

          logger.info('Connector updated via copilot', {
            connectorId: args.connectorId,
            userId: context.userId,
          })

          return {
            success: true,
            message: 'Connector updated successfully',
            data: { id: args.connectorId, ...updateBody },
          }
        }

        case 'delete_connector': {
          if (!args.connectorId) {
            return { success: false, message: 'connectorId is required for delete_connector' }
          }

          const deleteKbId = await resolveKnowledgeBaseId(args.connectorId)
          if (!deleteKbId) {
            return { success: false, message: `Connector "${args.connectorId}" not found` }
          }

          const writeAccess = await checkKnowledgeBaseWriteAccess(deleteKbId, context.userId)
          if (!writeAccess.hasAccess) {
            return { success: false, message: `Connector "${args.connectorId}" not found` }
          }

          assertNotAborted()
          const deleteRes = await connectorApiCall(
            context.userId,
            `/api/knowledge/${deleteKbId}/connectors/${args.connectorId}`,
            'DELETE'
          )

          if (!deleteRes.success) {
            return { success: false, message: deleteRes.error ?? 'Failed to delete connector' }
          }

          logger.info('Connector deleted via copilot', {
            connectorId: args.connectorId,
            userId: context.userId,
          })

          return {
            success: true,
            message: 'Connector deleted successfully. Associated documents have been removed.',
            data: { id: args.connectorId },
          }
        }

        case 'sync_connector': {
          if (!args.connectorId) {
            return { success: false, message: 'connectorId is required for sync_connector' }
          }

          const syncKbId = await resolveKnowledgeBaseId(args.connectorId)
          if (!syncKbId) {
            return { success: false, message: `Connector "${args.connectorId}" not found` }
          }

          const writeAccess = await checkKnowledgeBaseWriteAccess(syncKbId, context.userId)
          if (!writeAccess.hasAccess) {
            return { success: false, message: `Connector "${args.connectorId}" not found` }
          }
          const connectorWorkspaceId = writeAccess.knowledgeBase.workspaceId
          if (!connectorWorkspaceId) {
            return {
              success: false,
              message: `Connector "${args.connectorId}" has no workspace billing context`,
            }
          }
          const billingAttribution = requireKnowledgeBillingAttribution(
            context,
            connectorWorkspaceId
          )

          assertNotAborted()
          const syncRes = await connectorApiCall(
            context.userId,
            `/api/knowledge/${syncKbId}/connectors/${args.connectorId}/sync`,
            'POST',
            undefined,
            billingAttribution
          )

          if (!syncRes.success) {
            return { success: false, message: syncRes.error ?? 'Failed to sync connector' }
          }

          logger.info('Connector sync triggered via copilot', {
            connectorId: args.connectorId,
            userId: context.userId,
          })

          return {
            success: true,
            message: 'Sync triggered. Documents will be updated in the background.',
            data: { id: args.connectorId },
          }
        }

        default:
          return {
            success: false,
            message: `Unknown operation: ${operation}. Supported operations: create, get, query, add_file, update, delete, list_tags, create_tag, update_tag, delete_tag, get_tag_usage, add_connector, update_connector, delete_connector, sync_connector`,
          }
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error, 'Unknown error occurred')
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

async function connectorApiCall(
  userId: string,
  path: string,
  method: string,
  body?: Record<string, unknown>,
  billingAttribution?: BillingAttributionSnapshot
): Promise<{ success: boolean; data?: any; error?: string }> {
  const token = await generateInternalToken(userId)
  const baseUrl = getInternalApiBaseUrl()

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(billingAttribution
        ? {
            [BILLING_ATTRIBUTION_HEADER]: serializeBillingAttributionHeader(billingAttribution),
          }
        : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })

  const json = await res.json().catch(() => ({}))

  if (!res.ok) {
    return {
      success: false,
      error: json.error || `API returned ${res.status}`,
    }
  }

  return { success: true, data: json.data }
}

async function resolveKnowledgeBaseId(connectorId: string): Promise<string | null> {
  const rows = await db
    .select({ knowledgeBaseId: knowledgeConnector.knowledgeBaseId })
    .from(knowledgeConnector)
    .where(
      and(
        eq(knowledgeConnector.id, connectorId),
        isNull(knowledgeConnector.archivedAt),
        isNull(knowledgeConnector.deletedAt)
      )
    )
    .limit(1)

  return rows[0]?.knowledgeBaseId ?? null
}

function resolveStructuredTagFilters(
  filters: StructuredFilter[],
  tagDefinitions: TagDefinition[]
):
  | { success: true; filters: StructuredFilter[] }
  | { success: false; result: KnowledgeBaseResult } {
  if (filters.length === 0) {
    return { success: true, filters: [] }
  }

  const definitionsByName = new Map(
    tagDefinitions.map((definition) => [definition.displayName, definition])
  )
  const undefinedTags: string[] = []
  const validationErrors: string[] = []
  const resolvedFilters: StructuredFilter[] = []

  for (const filter of filters) {
    const definition = definitionsByName.get(filter.tagName ?? '')
    if (!definition) {
      undefinedTags.push(filter.tagName ?? '')
      continue
    }
    if (!isFilterFieldType(definition.fieldType)) {
      validationErrors.push(
        `Tag "${definition.displayName}" has unsupported field type "${definition.fieldType}"`
      )
      continue
    }

    const validOperators = getOperatorsForFieldType(definition.fieldType).map(
      (operator) => operator.value
    )
    if (!validOperators.includes(filter.operator)) {
      validationErrors.push(
        `Tag "${definition.displayName}" does not support operator "${filter.operator}"`
      )
      continue
    }

    const valueError = validateTagValue(
      definition.displayName,
      String(filter.value),
      definition.fieldType
    )
    if (valueError) {
      validationErrors.push(valueError)
      continue
    }

    if (filter.operator === 'between') {
      if (filter.valueTo === undefined) {
        validationErrors.push(
          `Tag "${definition.displayName}" requires valueTo for the "between" operator`
        )
        continue
      }
      const valueToError = validateTagValue(
        definition.displayName,
        String(filter.valueTo),
        definition.fieldType
      )
      if (valueToError) {
        validationErrors.push(valueToError)
        continue
      }
    }

    resolvedFilters.push({
      tagSlot: definition.tagSlot,
      fieldType: definition.fieldType,
      operator: filter.operator,
      value: filter.value,
      valueTo: filter.valueTo,
    })
  }

  if (undefinedTags.length > 0 || validationErrors.length > 0) {
    return {
      success: false,
      result: {
        success: false,
        message: [
          ...(undefinedTags.length > 0 ? [buildUndefinedTagsError(undefinedTags)] : []),
          ...validationErrors,
        ].join('\n'),
      },
    }
  }

  return { success: true, filters: resolvedFilters }
}

function isFilterFieldType(fieldType: string): fieldType is FilterFieldType {
  return ['text', 'number', 'date', 'boolean'].includes(fieldType)
}
