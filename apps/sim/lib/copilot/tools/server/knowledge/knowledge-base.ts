import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { truncate } from '@sim/utils/string'
import {
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
} from '@/lib/billing/core/billing-attribution'
import {
  executeCopilotKnowledgeUseCase,
  messageForCopilotKnowledgeError,
  requireCopilotKnowledgeWorkspaceId,
} from '@/lib/copilot/application/execute-knowledge-use-case'
import { ManageKnowledgeBase } from '@/lib/copilot/generated/tool-catalog-v1'
import { projectToolErrorMessageForCopilot } from '@/lib/copilot/request/tools/resolved-secret-result'
import {
  assertServerToolNotAborted,
  type BaseServerTool,
  type ServerToolContext,
} from '@/lib/copilot/tools/server/base-tool'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { PlatformEvents } from '@/lib/core/telemetry'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { isKnowledgeMemberAccessAvailable } from '@/lib/knowledge/access/availability'
import { addWorkspaceFilesToKnowledgeBase } from '@/lib/knowledge/application/add-workspace-files'
import { KnowledgeUsageLimitExceededError } from '@/lib/knowledge/application/billing'
import {
  createKnowledgeConnector,
  deleteKnowledgeConnector,
  syncKnowledgeConnector,
  updateKnowledgeConnector,
} from '@/lib/knowledge/application/connectors'
import {
  bulkDeleteKnowledgeDocuments,
  type KnowledgeDocumentTagValueAssignment,
  updateKnowledgeDocument,
} from '@/lib/knowledge/application/documents'
import {
  bulkDeleteKnowledgeBases,
  createKnowledgeBase,
  readKnowledgeBase,
  updateKnowledgeBaseOperation,
} from '@/lib/knowledge/application/knowledge-bases'
import { searchKnowledge } from '@/lib/knowledge/application/search'
import {
  createKnowledgeTag,
  deleteKnowledgeTag,
  listKnowledgeTags,
  readKnowledgeTagUsage,
  updateKnowledgeTag,
} from '@/lib/knowledge/application/tags'
import {
  ALL_TAG_SLOTS,
  KNOWLEDGE_TAG_DISPLAY_NAME_MAX_LENGTH,
  MAX_KNOWLEDGE_BATCH_ITEMS,
} from '@/lib/knowledge/constants'
import { sourceAuthor } from '@/lib/knowledge/search/author'
import { captureServerEvent } from '@/lib/posthog/server'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'

const logger = createLogger('KnowledgeBaseServerTool')

/** Results a query returns unless the caller asks for a number. */
const DEFAULT_QUERY_TOP_K = 5
/**
 * How the model cites a knowledge result in its reply. The `<source>` tag is
 * what the chat renders as a link back to the document, so a result without
 * a source URL is quoted by name instead.
 *
 * Asked for only where per-member access is on. The chip and the sources strip
 * that render the tag arrived with Sim Search, so a workspace without the
 * feature must not be told to emit one: the gate belongs here, at the emission,
 * because a client that merely declined to render the tag would leave the raw
 * `<source>{...}</source>` JSON sitting in the visible reply.
 */
const KNOWLEDGE_CITATION_INSTRUCTION =
  'Cite each result you use inline, right after the sentence it supports, as <source>{"url":"<sourceUrl>","title":"<documentName>","siteName":"<knowledgeBaseName>","connectorType":"<connectorType>","snippet":"<the sentence or two of content you relied on>","updatedAt":"<sourceModifiedAt>","author":"<author>"}</source> with every value JSON-escaped; leave out any optional field whose value is null or unknown, and omit the tag for a result whose sourceUrl is null and name the document instead.'

/**
 * Resolves an environment-variable reference passed as a connector API key.
 *
 * Models reference workspace secrets the way workflows do — `{{SIM_GITHUB_PAT}}`
 * (and, when improvising, `$SIM_GITHUB_PAT` or the bare name). Before this,
 * the literal placeholder string was sent upstream as the bearer token and the
 * provider answered 401 — an error that never named the real problem. A raw
 * key that matches no reference form passes through untouched.
 *
 * Returns an error string when a reference names a variable that is not set,
 * so the model learns the actual fix instead of retrying reference syntaxes.
 */
async function resolveConnectorApiKey(
  context: ServerToolContext,
  workspaceId: string,
  apiKey: string | undefined
): Promise<{ apiKey?: string; error?: string }> {
  if (!apiKey) return { apiKey }
  const braced = apiKey.match(/^\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/)
  const dollar = apiKey.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/)
  const referencedName = braced?.[1] ?? dollar?.[1]
  const env = await getEffectiveDecryptedEnv(context.userId, workspaceId)
  const name = referencedName ?? (Object.hasOwn(env, apiKey) ? apiKey : undefined)
  if (!name) return { apiKey }
  const value = env[name]
  if (value === undefined || value === '') {
    return {
      error: `Environment variable "${name}" is not set for this workspace or user, so it cannot be used as the connector API key. Set it first, pass a different {{ENV_VAR}} reference, or pass the raw key.`,
    }
  }
  // Activate the resolved secret on the call's egress registry so any
  // accidental echo of it (provider error bodies, logs) is redacted.
  context.resolvedSecretTraceRegistry?.recordResolved(name, value)
  return { apiKey: value }
}

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

/** Records the existing Copilot product analytics after application success. */
function captureKnowledgeBaseCreated(
  userId: string,
  workspaceId: string,
  knowledgeBase: { id: string; name: string }
): void {
  PlatformEvents.knowledgeBaseCreated({
    knowledgeBaseId: knowledgeBase.id,
    name: knowledgeBase.name,
    workspaceId,
  })
  captureServerEvent(
    userId,
    'knowledge_base_created',
    {
      knowledge_base_id: knowledgeBase.id,
      workspace_id: workspaceId,
      name: knowledgeBase.name,
    },
    {
      groups: { workspace: workspaceId },
      setOnce: { first_kb_created_at: new Date().toISOString() },
    }
  )
}

function captureKnowledgeDocumentsUploaded(
  userId: string,
  workspaceId: string,
  knowledgeBaseId: string,
  documents: readonly { mimeType: string; fileSize: number }[]
): void {
  for (const document of documents) {
    PlatformEvents.knowledgeBaseDocumentsUploaded({
      knowledgeBaseId,
      documentsCount: 1,
      uploadType: 'single',
      mimeType: document.mimeType,
      fileSize: document.fileSize,
    })
    captureServerEvent(
      userId,
      'knowledge_base_document_uploaded',
      {
        knowledge_base_id: knowledgeBaseId,
        workspace_id: workspaceId,
        document_count: 1,
        upload_type: 'single',
      },
      {
        groups: { workspace: workspaceId },
        setOnce: { first_document_uploaded_at: new Date().toISOString() },
      }
    )
  }
}

function captureKnowledgeDocumentsDeleted(
  userId: string,
  workspaceId: string,
  knowledgeBaseId: string,
  count: number
): void {
  for (let index = 0; index < count; index += 1) {
    captureServerEvent(
      userId,
      'knowledge_base_document_deleted',
      { knowledge_base_id: knowledgeBaseId, workspace_id: workspaceId },
      { groups: { workspace: workspaceId } }
    )
  }
}

function captureKnowledgeConnectorAdded(
  userId: string,
  workspaceId: string,
  knowledgeBaseId: string,
  connectorType: string,
  syncIntervalMinutes: number
): void {
  captureServerEvent(
    userId,
    'knowledge_base_connector_added',
    {
      knowledge_base_id: knowledgeBaseId,
      workspace_id: workspaceId,
      connector_type: connectorType,
      sync_interval_minutes: syncIntervalMinutes,
    },
    {
      groups: { workspace: workspaceId },
      setOnce: { first_connector_added_at: new Date().toISOString() },
    }
  )
}

function captureKnowledgeConnectorRemoved(
  userId: string,
  workspaceId: string,
  knowledgeBaseId: string,
  connectorType: string,
  documentsDeleted: number
): void {
  captureServerEvent(
    userId,
    'knowledge_base_connector_removed',
    {
      knowledge_base_id: knowledgeBaseId,
      workspace_id: workspaceId,
      connector_type: connectorType,
      documents_deleted: documentsDeleted,
    },
    { groups: { workspace: workspaceId } }
  )
}

function captureKnowledgeConnectorSynced(
  userId: string,
  workspaceId: string,
  knowledgeBaseId: string,
  connectorType: string
): void {
  captureServerEvent(
    userId,
    'knowledge_base_connector_synced',
    {
      knowledge_base_id: knowledgeBaseId,
      workspace_id: workspaceId,
      connector_type: connectorType,
    },
    { groups: { workspace: workspaceId } }
  )
}

function applicationFailureFallback(operation: string): string | null {
  switch (operation) {
    case 'update_document':
      return 'Failed to update document'
    case 'create_tag':
      return 'Failed to create tag'
    case 'add_connector':
      return 'Failed to add connector'
    case 'update_connector':
      return 'Failed to update connector'
    case 'delete_connector':
      return 'Failed to delete connector'
    case 'sync_connector':
      return 'Failed to sync connector'
    default:
      return null
  }
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

function isKnowledgeDocumentTagValueAssignment(
  value: unknown
): value is KnowledgeDocumentTagValueAssignment {
  if (typeof value !== 'object' || value === null) return false
  const assignment = value as Record<string, unknown>
  if (typeof assignment.tagDefinitionId !== 'string' || !assignment.tagDefinitionId.trim()) {
    return false
  }
  if (!Object.hasOwn(assignment, 'value')) return false
  return (
    assignment.value === null ||
    typeof assignment.value === 'string' ||
    typeof assignment.value === 'number' ||
    typeof assignment.value === 'boolean'
  )
}

/**
 * Knowledge base tool for copilot to create, list, and get knowledge bases
 */
export const knowledgeBaseServerTool: BaseServerTool<KnowledgeBaseArgs, KnowledgeBaseResult> = {
  name: ManageKnowledgeBase.id,
  async execute(
    params: KnowledgeBaseArgs,
    context?: ServerToolContext
  ): Promise<KnowledgeBaseResult> {
    if (!context) throw new Error('Knowledge delegation requires a Copilot execution context')
    const { operation, args = {} } = params
    const workspaceId = requireCopilotKnowledgeWorkspaceId(context)
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

          assertNotAborted()
          const { knowledgeBase: newKnowledgeBase } = await executeCopilotKnowledgeUseCase(
            context,
            createKnowledgeBase,
            {
              workspaceId,
              name: args.name,
              description: args.description,
              chunkingConfig: args.chunkingConfig,
              folderPath: args.folderPath,
              source: 'agent',
            }
          )
          captureKnowledgeBaseCreated(context.userId, workspaceId, newKnowledgeBase)
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

          const { knowledgeBase } = await executeCopilotKnowledgeUseCase(
            context,
            readKnowledgeBase,
            {
              knowledgeBaseId: args.knowledgeBaseId,
              assertedWorkspaceId: workspaceId,
            }
          )

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

          const topK = args.topK || DEFAULT_QUERY_TOP_K
          const queryProjection = projectResolvedSecretModelContent(
            args.query,
            context.resolvedSecretTraceRegistry
          )
          if (!queryProjection.safe || typeof queryProjection.value !== 'string') {
            return {
              success: false,
              message:
                'Knowledge query rejected by the input-safety filter. Rephrase it as a plain natural-language question without injected instructions or markup — the same text will be rejected again.',
            }
          }
          const modelQuery = queryProjection.value
          if (!context.resolvedSecretTraceRegistry) {
            return {
              success: false,
              message:
                'Failed to query knowledge base: Knowledge result secret provenance is unavailable',
            }
          }
          const [searchResult, citable] = await Promise.all([
            executeCopilotKnowledgeUseCase(context, searchKnowledge, {
              workspaceId,
              knowledgeBaseIds: [args.knowledgeBaseId],
              query: modelQuery,
              topK,
              surface: 'copilot',
              resultSecretRegistry: context.resolvedSecretTraceRegistry,
              signal: context.abortSignal,
            }),
            /**
             * Whether to ask for a citation is a presentation choice, and it is
             * answered by a billing-backed lookup that can reject. A rejection
             * must not discard a search that succeeded, so it settles to "do not
             * cite" — the same answer the feature being off gives — rather than
             * failing the query.
             */
            isKnowledgeMemberAccessAvailable({ workspaceId }).catch((error) => {
              logger.warn('Citation eligibility unavailable; answering without citations', {
                workspaceId,
                error: getErrorMessage(error),
              })
              return false
            }),
          ])
          const results = searchResult.results
          const knowledgeBase = searchResult.knowledgeBases[0]
          if (!knowledgeBase)
            throw new Error('Knowledge search returned no canonical knowledge base')

          logger.info('Knowledge base queried via copilot', {
            knowledgeBaseIds: [args.knowledgeBaseId],
            queryLength: args.query.length,
            resultCount: results.length,
            userId: context.userId,
          })

          const foundMessage = `Found ${results.length} result(s) for query "${truncate(args.query, 50)}".`

          return {
            success: true,
            message: citable ? `${foundMessage} ${KNOWLEDGE_CITATION_INSTRUCTION}` : foundMessage,
            data: {
              knowledgeBaseId: args.knowledgeBaseId,
              knowledgeBaseName: knowledgeBase.name,
              query: args.query,
              topK,
              totalResults: results.length,
              results: results.map((result) => ({
                documentId: result.documentId,
                documentName: result.documentName,
                sourceUrl: result.sourceUrl,
                sourceModifiedAt: result.sourceModifiedAt?.toISOString() ?? null,
                author: sourceAuthor(result.metadata),
                connectorType: result.connectorType,
                content: result.content,
                chunkIndex: result.chunkIndex,
                similarity: result.similarity,
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
          if (fileRefs.length > MAX_KNOWLEDGE_BATCH_ITEMS) {
            return {
              success: false,
              message: `Too many files (${fileRefs.length}). Maximum is ${MAX_KNOWLEDGE_BATCH_ITEMS}.`,
            }
          }

          assertNotAborted()
          const outcome = await executeCopilotKnowledgeUseCase(
            context,
            addWorkspaceFilesToKnowledgeBase,
            {
              knowledgeBaseId: args.knowledgeBaseId,
              assertedWorkspaceId: workspaceId,
              fileReferences: fileRefs,
              cancellationSignal: context.userStopSignal,
              source: 'agent',
            }
          )
          captureKnowledgeDocumentsUploaded(
            context.userId,
            workspaceId,
            outcome.knowledgeBaseId,
            outcome.added
          )
          assertNotAborted()

          const added = outcome.added.map(({ documentId, filename }) => ({
            documentId,
            filename,
          }))
          const addedNames = added.map((item) => item.filename).join(', ')
          return {
            success: added.length > 0,
            message:
              added.length > 0
                ? `Added ${added.length} file(s) to "${outcome.knowledgeBaseName}": ${addedNames}. Processing started.`
                : `No files could be added.`,
            data: {
              knowledgeBaseId: args.knowledgeBaseId,
              knowledgeBaseName: outcome.knowledgeBaseName,
              added,
              failed: outcome.failed,
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

          assertNotAborted()
          const { knowledgeBase: updatedKb } = await executeCopilotKnowledgeUseCase(
            context,
            updateKnowledgeBaseOperation,
            {
              knowledgeBaseId: args.knowledgeBaseId,
              assertedWorkspaceId: workspaceId,
              ...updates,
              source: 'agent',
            }
          )
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
          if (kbIds.length > MAX_KNOWLEDGE_BATCH_ITEMS) {
            return {
              success: false,
              message: `Too many knowledge base IDs (${kbIds.length}). Maximum is ${MAX_KNOWLEDGE_BATCH_ITEMS}.`,
            }
          }

          assertNotAborted()
          const { deleted, notFound, failed } = await executeCopilotKnowledgeUseCase(
            context,
            bulkDeleteKnowledgeBases,
            {
              assertedWorkspaceId: workspaceId,
              knowledgeBaseIds: kbIds,
              cancellationSignal: context.userStopSignal,
              source: 'agent',
            }
          )
          assertNotAborted()

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
          if (docIds.length > MAX_KNOWLEDGE_BATCH_ITEMS) {
            return {
              success: false,
              message: `Too many document IDs (${docIds.length}). Maximum is ${MAX_KNOWLEDGE_BATCH_ITEMS}.`,
            }
          }

          assertNotAborted()
          const { knowledgeBaseId, deleted, deletedDocuments, failed } =
            await executeCopilotKnowledgeUseCase(context, bulkDeleteKnowledgeDocuments, {
              knowledgeBaseId: args.knowledgeBaseId,
              documentIds: docIds,
              assertedWorkspaceId: workspaceId,
              cancellationSignal: context.userStopSignal,
              source: 'agent',
            })
          captureKnowledgeDocumentsDeleted(
            context.userId,
            workspaceId,
            knowledgeBaseId,
            deletedDocuments.length
          )
          assertNotAborted()

          return {
            success: deleted.length > 0,
            message: `Deleted ${deleted.length} document(s)${failed.length > 0 ? `, ${failed.length} failed` : ''}`,
            data: { knowledgeBaseId, deleted, failed },
          }
        }

        case 'update_document': {
          if (!args.knowledgeBaseId) {
            return { success: false, message: 'knowledgeBaseId is required for update_document' }
          }
          if (!args.documentId) {
            return { success: false, message: 'documentId is required for update_document' }
          }
          const updateData: {
            filename?: string
            enabled?: boolean
            tagValues?: KnowledgeDocumentTagValueAssignment[]
          } = {}
          if (args.filename !== undefined) {
            updateData.filename = args.filename
          }
          if (args.enabled !== undefined) {
            updateData.enabled = args.enabled
          }
          if (args.tagValues !== undefined) {
            if (
              !Array.isArray(args.tagValues) ||
              args.tagValues.length === 0 ||
              !args.tagValues.every(isKnowledgeDocumentTagValueAssignment)
            ) {
              return {
                success: false,
                message:
                  'tagValues must be a non-empty array of { tagDefinitionId, value } assignments',
              }
            }
            if (args.tagValues.length > ALL_TAG_SLOTS.length) {
              return {
                success: false,
                message: `Too many tag values (${args.tagValues.length}). Maximum is ${ALL_TAG_SLOTS.length}.`,
              }
            }
            updateData.tagValues = args.tagValues
          }
          if (Object.keys(updateData).length === 0) {
            return {
              success: false,
              message:
                'At least one of filename, enabled, or tagValues is required for update_document',
            }
          }
          assertNotAborted()
          await executeCopilotKnowledgeUseCase(context, updateKnowledgeDocument, {
            knowledgeBaseId: args.knowledgeBaseId,
            documentId: args.documentId,
            assertedWorkspaceId: workspaceId,
            ...updateData,
            source: 'agent',
          })

          return {
            success: true,
            message: `Document updated successfully`,
            data: {
              documentId: args.documentId,
              knowledgeBaseId: args.knowledgeBaseId,
              ...(updateData.filename !== undefined && {
                filename: updateData.filename,
              }),
              ...(updateData.enabled !== undefined && {
                enabled: updateData.enabled,
              }),
              ...(updateData.tagValues !== undefined && {
                tagDefinitionIds: updateData.tagValues.map(
                  (assignment) => assignment.tagDefinitionId
                ),
              }),
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

          const { tagDefinitions } = await executeCopilotKnowledgeUseCase(
            context,
            listKnowledgeTags,
            {
              knowledgeBaseId: args.knowledgeBaseId,
              assertedWorkspaceId: workspaceId,
            }
          )

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
          if (args.tagDisplayName.length > KNOWLEDGE_TAG_DISPLAY_NAME_MAX_LENGTH) {
            return {
              success: false,
              message: `tagDisplayName must be ${KNOWLEDGE_TAG_DISPLAY_NAME_MAX_LENGTH} characters or less`,
            }
          }

          const fieldType = args.tagFieldType || 'text'
          assertNotAborted()
          const { tagDefinition: newTag } = await executeCopilotKnowledgeUseCase(
            context,
            createKnowledgeTag,
            {
              knowledgeBaseId: args.knowledgeBaseId,
              displayName: args.tagDisplayName,
              fieldType,
              assertedWorkspaceId: workspaceId,
              source: 'agent',
            }
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
          if (
            updateData.displayName &&
            updateData.displayName.length > KNOWLEDGE_TAG_DISPLAY_NAME_MAX_LENGTH
          ) {
            return {
              success: false,
              message: `tagDisplayName must be ${KNOWLEDGE_TAG_DISPLAY_NAME_MAX_LENGTH} characters or less`,
            }
          }

          assertNotAborted()
          const { tagDefinition: updatedTag, knowledgeBaseId } =
            await executeCopilotKnowledgeUseCase(context, updateKnowledgeTag, {
              tagDefinitionId: args.tagDefinitionId,
              assertedWorkspaceId: workspaceId,
              updates: updateData,
              source: 'agent',
            })

          logger.info('Tag definition updated via copilot', {
            tagId: args.tagDefinitionId,
            knowledgeBaseId,
            userId: context.userId,
          })

          return {
            success: true,
            message: `Tag "${updatedTag.displayName}" updated successfully`,
            data: {
              id: updatedTag.id,
              knowledgeBaseId,
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

          assertNotAborted()
          const deleted = await executeCopilotKnowledgeUseCase(context, deleteKnowledgeTag, {
            knowledgeBaseId: args.knowledgeBaseId,
            tagDefinitionId: args.tagDefinitionId,
            assertedWorkspaceId: workspaceId,
            source: 'agent',
          })

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

          const { usage: stats } = await executeCopilotKnowledgeUseCase(
            context,
            readKnowledgeTagUsage,
            {
              knowledgeBaseId: args.knowledgeBaseId,
              assertedWorkspaceId: workspaceId,
            }
          )

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
          const sourceConfig: Record<string, unknown> = { ...(args.sourceConfig ?? {}) }
          if (args.disabledTagIds?.length) {
            sourceConfig.disabledTagIds = args.disabledTagIds
          }

          const resolvedKey = await resolveConnectorApiKey(context, workspaceId, args.apiKey)
          if (resolvedKey.error) {
            return { success: false, message: resolvedKey.error }
          }

          assertNotAborted()
          const { connector, workspaceId: canonicalWorkspaceId } =
            await executeCopilotKnowledgeUseCase(context, createKnowledgeConnector, {
              knowledgeBaseId: args.knowledgeBaseId,
              assertedWorkspaceId: workspaceId,
              connectorType: args.connectorType,
              credentialId: args.credentialId,
              apiKey: resolvedKey.apiKey,
              sourceConfig,
              syncIntervalMinutes: args.syncIntervalMinutes ?? 1440,
              resolveBillingAttribution: async (billingWorkspaceId) =>
                requireKnowledgeBillingAttribution(context, billingWorkspaceId),
              source: 'agent',
            })
          if (canonicalWorkspaceId !== workspaceId) {
            throw new Error('Knowledge connector workspace does not match the authorized workspace')
          }
          captureKnowledgeConnectorAdded(
            context.userId,
            canonicalWorkspaceId,
            connector.knowledgeBaseId,
            connector.connectorType,
            connector.syncIntervalMinutes
          )
          return {
            success: true,
            message: `Connector "${args.connectorType}" added to knowledge base. Initial sync started.`,
            data: {
              id: connector.id,
              connectorType: connector.connectorType,
              status: connector.status,
              knowledgeBaseId: connector.knowledgeBaseId,
            },
          }
        }

        case 'update_connector': {
          if (!args.connectorId) {
            return { success: false, message: 'connectorId is required for update_connector' }
          }

          const updates = {
            sourceConfig: args.sourceConfig,
            syncIntervalMinutes: args.syncIntervalMinutes,
            status: args.connectorStatus,
          }

          assertNotAborted()
          const { connector } = await executeCopilotKnowledgeUseCase(
            context,
            updateKnowledgeConnector,
            {
              connectorId: args.connectorId,
              assertedWorkspaceId: workspaceId,
              updates,
              resolveBillingAttribution: async (canonicalWorkspaceId) =>
                requireKnowledgeBillingAttribution(context, canonicalWorkspaceId),
              source: 'agent',
            }
          )

          return {
            success: true,
            message:
              updates.sourceConfig === undefined
                ? 'Connector updated successfully'
                : connector.status === 'paused' || connector.status === 'disabled'
                  ? 'Connector updated successfully. The source change will synchronize when the connector is resumed.'
                  : 'Connector updated successfully. Synchronization was queued for the source change.',
            data: {
              id: args.connectorId,
              ...(updates.sourceConfig !== undefined && { sourceConfig: updates.sourceConfig }),
              ...(updates.syncIntervalMinutes !== undefined && {
                syncIntervalMinutes: updates.syncIntervalMinutes,
              }),
              ...(updates.status !== undefined && { status: updates.status }),
            },
          }
        }

        case 'delete_connector': {
          if (!args.connectorId) {
            return { success: false, message: 'connectorId is required for delete_connector' }
          }

          assertNotAborted()
          const outcome = await executeCopilotKnowledgeUseCase(context, deleteKnowledgeConnector, {
            connectorId: args.connectorId,
            assertedWorkspaceId: workspaceId,
            source: 'agent',
          })
          if (!outcome.workspaceId) {
            throw new Error('Knowledge connector deletion is missing its workspace scope')
          }
          captureKnowledgeConnectorRemoved(
            context.userId,
            outcome.workspaceId,
            outcome.knowledgeBaseId,
            outcome.connectorType,
            outcome.documentsDeleted
          )

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

          assertNotAborted()
          const outcome = await executeCopilotKnowledgeUseCase(context, syncKnowledgeConnector, {
            connectorId: args.connectorId,
            assertedWorkspaceId: workspaceId,
            resolveBillingAttribution: async (canonicalWorkspaceId) =>
              requireKnowledgeBillingAttribution(context, canonicalWorkspaceId),
            source: 'agent',
          })
          if (outcome.workspaceId !== workspaceId) {
            throw new Error('Knowledge connector workspace does not match the authorized workspace')
          }
          captureKnowledgeConnectorSynced(
            context.userId,
            outcome.workspaceId,
            outcome.knowledgeBaseId,
            outcome.connectorType
          )

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
      logger.error('Error in manage_knowledge_base tool', {
        operation,
        error: projectToolErrorMessageForCopilot(errorMessage, context.resolvedSecretTraceRegistry),
        userId: context.userId,
      })

      if (operation === 'query' && context.resolvedSecretTraceRegistry?.isPermanentlyIncomplete()) {
        return {
          success: false,
          message:
            'Failed to query knowledge base: Knowledge result secret provenance is unavailable',
        }
      }
      if (error instanceof KnowledgeUsageLimitExceededError) {
        return { success: false, message: error.message }
      }
      if (context.userStopSignal?.aborted) throw error
      const classified = asOrchestrationError(error)
      if (classified?.code === 'not_found' || classified?.code === 'forbidden') {
        if (args.connectorId) {
          return { success: false, message: `Connector "${args.connectorId}" not found` }
        }
        if (args.tagDefinitionId) {
          return {
            success: false,
            message: `Tag definition with ID "${args.tagDefinitionId}" not found`,
          }
        }
        if (args.documentId) {
          return {
            success: false,
            message: `Document with ID "${args.documentId}" not found`,
          }
        }
        if (args.knowledgeBaseId) {
          return {
            success: false,
            message: `Knowledge base with ID "${args.knowledgeBaseId}" not found`,
          }
        }
      }
      const directFallback = applicationFailureFallback(operation)
      const fallback = directFallback ?? `Failed to ${operation} knowledge base`
      const safeMessage = messageForCopilotKnowledgeError(error, fallback)
      return {
        success: false,
        message:
          directFallback || safeMessage === fallback ? safeMessage : `${fallback}: ${safeMessage}`,
      }
    }
  },
}
