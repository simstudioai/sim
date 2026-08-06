import { db } from '@sim/db'
import { knowledgeConnector } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { filterUndefined } from '@sim/utils/object'
import { truncate } from '@sim/utils/string'
import { and, eq, isNull } from 'drizzle-orm'
import { checkActorUsageLimits } from '@/lib/billing/calculations/usage-monitor'
import {
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
  checkAttributedUsageLimits,
} from '@/lib/billing/core/billing-attribution'
import { KnowledgeBase } from '@/lib/copilot/generated/tool-catalog-v1'
import { projectToolErrorMessageForCopilot } from '@/lib/copilot/request/tools/resolved-secret-result'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import { projectServerToolModelInput } from '@/lib/copilot/tools/server/model-input'
import {
  messageForOrchestrationError,
  type OrchestrationErrorCode,
} from '@/lib/core/orchestration/types'
import { generateSearchEmbedding, recordSearchEmbeddingUsage } from '@/lib/knowledge/embeddings'
import {
  performCreateKnowledgeBase,
  performCreateKnowledgeConnector,
  performDeleteKnowledgeBase,
  performDeleteKnowledgeConnector,
  performDeleteKnowledgeDocument,
  performSyncKnowledgeConnector,
  performUpdateKnowledgeBase,
  performUpdateKnowledgeConnector,
  performUpdateKnowledgeDocument,
  performUploadKnowledgeDocument,
} from '@/lib/knowledge/orchestration'
import { executeKnowledgeSearch } from '@/lib/knowledge/search/queries'
import { importKnowledgeSearchResultSecretProvenance } from '@/lib/knowledge/secret-provenance'
import { getKnowledgeBaseById } from '@/lib/knowledge/service'
import {
  createTagDefinition,
  deleteTagDefinition,
  getDocumentTagDefinitions,
  getNextAvailableSlot,
  getTagDefinitionById,
  getTagUsageStats,
  updateTagDefinition,
} from '@/lib/knowledge/tags/service'
import { StorageService } from '@/lib/uploads'
import { resolveWorkspaceFileReference } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { getBoundWorkspaceFileSecretProvenance } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { getCredential } from '@/app/api/auth/oauth/utils'
import {
  checkDocumentWriteAccess,
  checkKnowledgeBaseAccess,
  checkKnowledgeBaseWriteAccess,
} from '@/app/api/knowledge/utils'

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

/**
 * The message the agent — and therefore the user — is shown for a failed
 * operation. Mirrors `messageForOrchestrationError` on the HTTP surfaces: a
 * classified failure is caller-fixable and safe to relay, an unclassified one
 * carries whatever text the fault happened to have (a driver's failed SQL, say)
 * and is replaced by the operation's own wording.
 */
function agentFacingError(
  outcome: { error?: string; errorCode?: OrchestrationErrorCode },
  fallback: string
): string {
  return messageForOrchestrationError(outcome, fallback)
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
    /**
     * The acting agent, as every knowledge orchestration function expects it.
     * `source: 'agent'` is what makes an agent-driven mutation distinguishable in
     * the audit log — before these operations went through orchestration they
     * were not recorded there at all.
     */
    const actor = (requestId: string) => ({
      userId: context.userId as string,
      source: 'agent' as const,
      requestId,
    })

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
          const outcome = await performCreateKnowledgeBase({
            ...actor(requestId),
            workspaceId,
            name: args.name,
            description: args.description,
            chunkingConfig: args.chunkingConfig,
          })
          if (!outcome.success) {
            return {
              success: false,
              message: agentFacingError(outcome, 'Failed to create knowledge base'),
            }
          }

          const newKnowledgeBase = outcome.knowledgeBase
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

          if (!args.query?.trim()) {
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

          const { query: modelQuery } = projectServerToolModelInput({ query: args.query }, context)
          const { embedding: queryEmbedding, isBYOK: queryEmbeddingIsBYOK } =
            await generateSearchEmbedding(modelQuery, kb.embeddingModel, kb.workspaceId)
          const queryVector = JSON.stringify(queryEmbedding)

          const results = await executeKnowledgeSearch({
            knowledgeBaseIds: [args.knowledgeBaseId],
            topK,
            searchMode: 'vector',
            query: modelQuery,
            queryVector,
          })

          await recordSearchEmbeddingUsage({
            userId: context.userId,
            workspaceId: kb.workspaceId,
            embeddingModel: kb.embeddingModel,
            query: modelQuery,
            isBYOK: queryEmbeddingIsBYOK,
            sourceReference: `copilot-kb-search:${args.knowledgeBaseId}`,
            billingAttribution,
          })

          const resultRegistry = context.resolvedSecretTraceRegistry
          if (!resultRegistry) {
            throw new Error('Knowledge result secret provenance is unavailable')
          }
          const resultProvenance = await importKnowledgeSearchResultSecretProvenance({
            registry: resultRegistry,
            results,
          })
          if (!resultProvenance.imported) {
            resultRegistry.markIncomplete()
            throw new Error('Knowledge result secret provenance is unavailable')
          }

          logger.info('Knowledge base queried via copilot', {
            knowledgeBaseId: args.knowledgeBaseId,
            queryLength: args.query.length,
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

          // Gate the payer before accepting indexing work, same as the upload routes.
          const usage = await checkAttributedUsageLimits(billingAttribution)
          if (usage.isExceeded) {
            return {
              success: false,
              message:
                usage.message || 'Usage limit exceeded. Please upgrade your plan to continue.',
            }
          }

          const added: Array<{ documentId: string; filename: string }> = []
          const failedFiles: string[] = []

          for (const fileRef of fileRefs) {
            const fileRecord = await resolveWorkspaceFileReference(kbWorkspaceId, fileRef)
            if (!fileRecord) {
              failedFiles.push(fileRef)
              continue
            }

            const fileProvenance = await getBoundWorkspaceFileSecretProvenance(kbWorkspaceId, {
              fileId: fileRecord.id,
              key: fileRecord.key,
              context: 'workspace',
            })
            if (fileProvenance.status !== 'exact' || fileProvenance.entries.length > 0) {
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
            const outcome = await performUploadKnowledgeDocument({
              ...actor(requestId),
              knowledgeBase: {
                id: args.knowledgeBaseId,
                name: targetKb.name,
                workspaceId: kbWorkspaceId,
              },
              document: {
                filename: fileRecord.name,
                fileUrl: presignedUrl,
                fileSize: fileRecord.size,
                mimeType: fileRecord.type,
              },
              startProcessing: 'async',
              billingAttribution,
            })
            if (!outcome.success) {
              failedFiles.push(fileRef)
              continue
            }

            added.push({ documentId: outcome.document.id, filename: fileRecord.name })
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
          const outcome = await performUpdateKnowledgeBase({
            ...actor(requestId),
            knowledgeBaseId: args.knowledgeBaseId,
            workspaceId: writeAccess.knowledgeBase.workspaceId ?? null,
            updates,
          })
          if (!outcome.success) {
            return {
              success: false,
              message: agentFacingError(outcome, 'Failed to update knowledge base'),
            }
          }

          const updatedKb = outcome.knowledgeBase
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
          // A knowledge base that exists but could not be archived is neither
          // deleted nor missing. Folding it into `notFound` told the user it was
          // never there instead of why the delete failed.
          const failed: Array<{ id: string; name: string; reason: string }> = []

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
            const outcome = await performDeleteKnowledgeBase({
              ...actor(requestId),
              knowledgeBase: {
                id: kbId,
                name: kbToDelete.name,
                workspaceId: kbToDelete.workspaceId,
              },
            })
            if (!outcome.success) {
              if (outcome.errorCode === 'not_found') {
                notFound.push(kbId)
              } else {
                failed.push({
                  id: kbId,
                  name: kbToDelete.name,
                  reason: agentFacingError(outcome, 'Failed to delete knowledge base'),
                })
              }
              continue
            }
            deleted.push({ id: kbId, name: kbToDelete.name })
          }

          const deleteSummary = [
            deleted.length > 0 ? `Deleted: ${deleted.map((d) => d.name).join(', ')}` : null,
            failed.length > 0
              ? `Failed: ${failed.map((f) => `${f.name} (${f.reason})`).join(', ')}`
              : null,
          ]
            .filter(Boolean)
            .join('. ')

          return {
            success: deleted.length > 0,
            message: deleteSummary || 'No knowledge bases found',
            data: { deleted, notFound, failed },
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
            const outcome = await performDeleteKnowledgeDocument({
              ...actor(requestId),
              knowledgeBase: {
                id: args.knowledgeBaseId,
                name: docAccess.knowledgeBase.name,
                workspaceId: docAccess.knowledgeBase.workspaceId ?? null,
              },
              document: docAccess.document,
            })
            if (outcome.success) {
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
          const updateData: { filename?: string; enabled?: boolean } = {}
          if (args.filename !== undefined) {
            updateData.filename = args.filename
          }
          if (args.enabled !== undefined) {
            updateData.enabled = args.enabled
          }
          if (Object.keys(updateData).length === 0) {
            return {
              success: false,
              message: 'At least one of filename or enabled is required for update_document',
            }
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
          const requestId = generateId().slice(0, 8)
          assertNotAborted()
          const outcome = await performUpdateKnowledgeDocument({
            ...actor(requestId),
            knowledgeBase: {
              id: args.knowledgeBaseId,
              name: docAccess.knowledgeBase.name,
              workspaceId: docAccess.knowledgeBase.workspaceId ?? null,
            },
            document: docAccess.document,
            updates: updateData,
          })
          if (!outcome.success) {
            return {
              success: false,
              message: agentFacingError(outcome, 'Failed to update document'),
            }
          }

          return {
            success: true,
            message: `Document updated successfully`,
            data: {
              documentId: args.documentId,
              knowledgeBaseId: args.knowledgeBaseId,
              ...updateData,
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
            data: stats,
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

          const sourceConfig: Record<string, unknown> = { ...(args.sourceConfig ?? {}) }
          if (args.disabledTagIds?.length) {
            sourceConfig.disabledTagIds = args.disabledTagIds
          }

          const requestId = generateId().slice(0, 8)
          assertNotAborted()
          const outcome = await performCreateKnowledgeConnector({
            ...actor(requestId),
            knowledgeBase: {
              id: args.knowledgeBaseId,
              name: writeAccess.knowledgeBase.name,
              workspaceId: connectorWorkspaceId,
            },
            connectorType: args.connectorType,
            credentialId: args.credentialId,
            apiKey: args.apiKey,
            sourceConfig,
            syncIntervalMinutes: args.syncIntervalMinutes ?? 1440,
            resolveBillingAttribution: async () => billingAttribution,
            resolveAccessToken: async (credentialId) =>
              (await getCredential(requestId, credentialId, context.userId as string))
                ?.accessToken ?? null,
          })
          if (!outcome.success) {
            return { success: false, message: agentFacingError(outcome, 'Failed to add connector') }
          }

          const connector = outcome.connector
          return {
            success: true,
            message: `Connector "${args.connectorType}" added to knowledge base. Initial sync started.`,
            data: {
              id: connector.id,
              connectorType: connector.connectorType,
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

          const updates = {
            sourceConfig: args.sourceConfig,
            syncIntervalMinutes: args.syncIntervalMinutes,
            status: args.connectorStatus,
          }

          const requestId = generateId().slice(0, 8)
          assertNotAborted()
          // No `validateSourceConfig`: the agent has no requesting identity to
          // resolve the connector's OAuth token with, so a replacement config is
          // stored unvalidated and the next sync reports any problem with it.
          const outcome = await performUpdateKnowledgeConnector({
            ...actor(requestId),
            knowledgeBase: {
              id: kbId,
              name: writeAccess.knowledgeBase.name,
              workspaceId: writeAccess.knowledgeBase.workspaceId ?? null,
            },
            connectorId: args.connectorId,
            updates,
          })
          if (!outcome.success) {
            return {
              success: false,
              message: agentFacingError(outcome, 'Failed to update connector'),
            }
          }

          return {
            success: true,
            message: 'Connector updated successfully',
            data: { id: args.connectorId, ...filterUndefined(updates) },
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

          const requestId = generateId().slice(0, 8)
          assertNotAborted()
          const outcome = await performDeleteKnowledgeConnector({
            ...actor(requestId),
            knowledgeBase: {
              id: deleteKbId,
              name: writeAccess.knowledgeBase.name,
              workspaceId: writeAccess.knowledgeBase.workspaceId ?? null,
            },
            connectorId: args.connectorId,
          })
          if (!outcome.success) {
            return {
              success: false,
              message: agentFacingError(outcome, 'Failed to delete connector'),
            }
          }

          // Report what the delete actually did. The documents are kept — this
          // used to claim they had been removed, which was never true on this
          // path: it reached the route over HTTP with no query string, so the
          // route's keep-documents default always applied.
          return {
            success: true,
            message:
              outcome.documentsKept > 0
                ? `Connector deleted successfully. Its ${outcome.documentsKept} document(s) were kept in the knowledge base.`
                : 'Connector deleted successfully.',
            data: {
              id: args.connectorId,
              documentsKept: outcome.documentsKept,
              documentsDeleted: outcome.documentsDeleted,
            },
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

          const requestId = generateId().slice(0, 8)
          assertNotAborted()
          const outcome = await performSyncKnowledgeConnector({
            ...actor(requestId),
            knowledgeBase: {
              id: syncKbId,
              name: writeAccess.knowledgeBase.name,
              workspaceId: connectorWorkspaceId,
            },
            connectorId: args.connectorId,
            resolveBillingAttribution: async () => billingAttribution,
          })
          if (!outcome.success) {
            return {
              success: false,
              message: agentFacingError(outcome, 'Failed to sync connector'),
            }
          }

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
        error: projectToolErrorMessageForCopilot(errorMessage, context.resolvedSecretTraceRegistry),
        userId: context.userId,
      })

      return {
        success: false,
        message: `Failed to ${operation} knowledge base: ${errorMessage}`,
      }
    }
  },
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
