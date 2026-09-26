import { createLogger } from '@sim/logger'
import { z } from 'zod'
import {
  readDocumentInputSchema,
  searchWorkspaceInputSchema,
} from '@/lib/api/contracts/mothership-assistant-tools'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { EmbeddingConfigurationError } from '@/lib/embeddings/configuration-error'
import { sourceAuthor } from '@/lib/knowledge/search/author'
import { SearchDeadlineError } from '@/lib/knowledge/search/budget'
import { createKnowledgeDocumentCitation, liveCitationId } from '@/lib/knowledge/search/citation'
import {
  annotateSearchDiagnostics,
  measureSearchStage,
  recordSearchStageDuration,
  withSearchDiagnostics,
} from '@/lib/knowledge/search/diagnostics'
import { intersectWorkspaceSearchFilters } from '@/lib/knowledge/search/filters'
import { matchPassage } from '@/lib/knowledge/search/snippet'
import {
  executeCopilotKnowledgeUseCase,
  executeCopilotOrganizationKnowledgeUseCase,
  messageForCopilotKnowledgeError,
  requireCopilotKnowledgeScope,
} from '@/lib/mothership/application/execute-knowledge-use-case'
import type { BaseServerTool, ServerToolContext } from '@/lib/mothership/tools/server/base-tool'
import { connectorDisplayName } from '@/lib/sim-search/connectors'
import {
  readSearchDocument,
  searchOrganizationKnowledge,
  searchWorkspaceKnowledge,
} from '@/lib/sim-search/indexed'
import { isIndexedOrgSearchEnabled } from '@/lib/sim-search/indexed/gate'
import { readLiveDocument, searchLiveKnowledge } from '@/lib/sim-search/live/application'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'

const logger = createLogger('WorkspaceSearchTool')

const CITATION_INSTRUCTION =
  'Cite the evidence you use as <source>{"id":"<citationId>"}</source>. Use only IDs returned by these tools.' +
  (isIndexedOrgSearchEnabled()
    ? ''
    : ' When referring to a Slack conversation, link the returned sourceContainerName to its sourceContainerUrl when available.')

export const searchWorkspaceServerTool: BaseServerTool = {
  name: 'search_workspace',
  inputSchema: searchWorkspaceInputSchema,
  async execute(raw, context?: ServerToolContext) {
    return withSearchDiagnostics(
      {
        surface: context?.searchSurface ?? 'copilot',
        operation: 'search_workspace',
        toolCallId: context?.toolCallId,
        executionId: context?.executionId,
      },
      async () => {
        try {
          const inputStarted = performance.now()
          const scope = requireCopilotKnowledgeScope(context)
          const { query, topK, nativeQueries, ...requestedFilters } =
            searchWorkspaceInputSchema.parse(raw)
          const registry = context?.resolvedSecretTraceRegistry
          if (!registry) throw new Error('Knowledge result provenance is unavailable')
          const projected = projectResolvedSecretModelContent(query, registry)
          if (!projected.safe || typeof projected.value !== 'string') {
            return {
              success: false,
              message: 'Search query contains protected content. Rephrase the query.',
            }
          }
          const safeQuery = projected.value
          const input = {
            query: safeQuery,
            topK,
            allowPartialResults: true,
            filters: intersectWorkspaceSearchFilters(requestedFilters, context?.assistantSearch),
            surface: context?.searchSurface ?? 'copilot',
            resultSecretRegistry: registry,
            signal: context?.abortSignal,
          } as const
          if (!isIndexedOrgSearchEnabled()) {
            const nativeProjection = projectResolvedSecretModelContent(
              nativeQueries ?? [],
              registry
            )
            if (!nativeProjection.safe)
              return {
                success: false,
                message: 'Native queries contain protected content. Rephrase them.',
              }
            const liveInput = {
              ...input,
              nativeQueries: searchWorkspaceInputSchema.shape.nativeQueries.parse(
                nativeQueries ? nativeProjection.value : undefined
              ),
            }
            const data =
              scope.kind === 'organization'
                ? await executeCopilotOrganizationKnowledgeUseCase(context, searchLiveKnowledge, {
                    ...liveInput,
                    organizationId: scope.organizationId,
                  })
                : await executeCopilotKnowledgeUseCase(context, searchLiveKnowledge, {
                    ...liveInput,
                    workspaceId: scope.workspaceId,
                  })
            return {
              success: true,
              message: `Found ${data.results.length} live results. Read a documentId when its passage does not answer the question or more context is needed. ${CITATION_INSTRUCTION}`,
              data: {
                ...data,
                results: data.results.map((item) => ({
                  ...item,
                  siteName: connectorDisplayName(item.connectorType ?? ''),
                  ...createKnowledgeDocumentCitation({
                    scope,
                    knowledgeBaseId: '',
                    documentId: item.documentId,
                    sourceUrl: item.sourceUrl,
                    baseUrl: getBaseUrl(),
                  }),
                  citationId: liveCitationId(item.documentId),
                })),
              },
            }
          }
          if (
            nativeQueries ||
            !safeQuery.trim() ||
            requestedFilters.startDate ||
            requestedFilters.endDate ||
            requestedFilters.sortBy
          )
            return {
              success: false,
              message:
                'Native queries, date-only search, startDate/endDate and sorting require live search. Use modifiedAfter/modifiedBefore with a text query for indexed search.',
            }
          recordSearchStageDuration('tool_input', performance.now() - inputStarted)
          const result = await measureSearchStage('tool_application', () =>
            scope.kind === 'organization'
              ? executeCopilotOrganizationKnowledgeUseCase(context, searchOrganizationKnowledge, {
                  ...input,
                  organizationId: scope.organizationId,
                })
              : executeCopilotKnowledgeUseCase(context, searchWorkspaceKnowledge, {
                  ...input,
                  workspaceId: scope.workspaceId,
                })
          )
          return await measureSearchStage('tool_presentation', () => {
            const names = new Map(result.knowledgeBases.map((base) => [base.id, base.name]))
            const output = {
              success: true,
              message: `${result.retrieval.status === 'partial' ? 'Search coverage is incomplete. Continue with a more specific query or source filter; these results cannot establish absence or completeness. ' : ''}Found ${result.results.length} passage previews. Read a document at its chunkIndex for more context. ${CITATION_INSTRUCTION}`,
              data: {
                query: safeQuery,
                retrieval: result.retrieval,
                results: result.results.map((item) => {
                  const content = projectResolvedSecretModelContent(item.content, registry)
                  if (!content.safe || typeof content.value !== 'string')
                    throw new Error('Knowledge result provenance is unavailable')
                  return {
                    documentId: item.documentId,
                    knowledgeBaseId: item.knowledgeBaseId,
                    knowledgeBaseName: names.get(item.knowledgeBaseId) ?? '',
                    siteName: item.connectorType
                      ? connectorDisplayName(item.connectorType)
                      : names.get(item.knowledgeBaseId),
                    documentName: item.documentName,
                    sourceUrl: item.sourceUrl,
                    connectorType: item.connectorType,
                    sourceModifiedAt: item.sourceModifiedAt?.toISOString() ?? null,
                    author: sourceAuthor(item.metadata),
                    ...matchPassage(content.value, safeQuery, 1200),
                    chunkIndex: item.chunkIndex,
                    similarity: item.similarity,
                    ...createKnowledgeDocumentCitation({
                      scope,
                      knowledgeBaseId: item.knowledgeBaseId,
                      documentId: item.documentId,
                      sourceUrl: item.sourceUrl,
                      baseUrl: getBaseUrl(),
                    }),
                  }
                }),
              },
            }
            const passageBytes = output.data.results.map((item) => Buffer.byteLength(item.content))
            annotateSearchDiagnostics({
              toolResultBytes: Buffer.byteLength(JSON.stringify(output)),
              passageBytes: passageBytes.reduce((total, bytes) => total + bytes, 0),
              originalPassageBytes: result.results.reduce(
                (total, item) => total + Buffer.byteLength(item.content),
                0
              ),
              maxPassageBytes: Math.max(0, ...passageBytes),
              uniqueDocumentCount: new Set(output.data.results.map((item) => item.documentId)).size,
            })
            return output
          })
        } catch (error) {
          logger.error('Workspace search failed', { error })
          return {
            success: false,
            retryable: error instanceof SearchDeadlineError,
            ...(error instanceof EmbeddingConfigurationError
              ? { capability: error.capability, reason: error.reason, recovery: error.recovery }
              : {}),
            message:
              error instanceof SearchDeadlineError
                ? error.message
                : error instanceof z.ZodError
                  ? 'Invalid search arguments'
                  : messageForCopilotKnowledgeError(error),
          }
        }
      }
    )
  },
}

export const readDocumentServerTool: BaseServerTool = {
  name: 'read_document',
  inputSchema: readDocumentInputSchema,
  async execute(raw, context?: ServerToolContext) {
    return withSearchDiagnostics(
      {
        surface: context?.searchSurface ?? 'copilot',
        toolCallId: context?.toolCallId,
        executionId: context?.executionId,
        operation: 'read_document',
      },
      async () => {
        try {
          const scope = requireCopilotKnowledgeScope(context)
          const input = readDocumentInputSchema.parse(raw)
          const registry = context?.resolvedSecretTraceRegistry
          if (!registry) throw new Error('Knowledge result provenance is unavailable')
          if (!isIndexedOrgSearchEnabled()) {
            const liveInput = {
              ...input,
              filters: intersectWorkspaceSearchFilters(
                { documentIds: [input.documentId] },
                context?.assistantSearch
              ),
              resultSecretRegistry: registry,
              signal: context?.abortSignal,
            }
            const data =
              scope.kind === 'organization'
                ? await executeCopilotOrganizationKnowledgeUseCase(context, readLiveDocument, {
                    ...liveInput,
                    organizationId: scope.organizationId,
                  })
                : await executeCopilotKnowledgeUseCase(context, readLiveDocument, {
                    ...liveInput,
                    workspaceId: scope.workspaceId,
                  })
            return {
              success: true,
              message: CITATION_INSTRUCTION,
              data: {
                ...data,
                ...createKnowledgeDocumentCitation({
                  scope,
                  knowledgeBaseId: '',
                  documentId: data.documentId,
                  sourceUrl: data.sourceUrl,
                  baseUrl: getBaseUrl(),
                }),
                citationId: liveCitationId(data.documentId),
              },
            }
          }
          const readInput = {
            ...input,
            ...(scope.kind === 'organization'
              ? { assertedOrganizationId: scope.organizationId }
              : { assertedWorkspaceId: scope.workspaceId }),
            filters: intersectWorkspaceSearchFilters(
              { documentIds: [input.documentId] },
              context?.assistantSearch
            ),
            resultSecretRegistry: registry,
            signal: context?.abortSignal,
          }
          const result = await measureSearchStage('document_read', () =>
            scope.kind === 'organization'
              ? executeCopilotOrganizationKnowledgeUseCase(context, readSearchDocument, readInput)
              : executeCopilotKnowledgeUseCase(context, readSearchDocument, readInput)
          )
          const output = {
            success: true,
            message: CITATION_INSTRUCTION,
            data: {
              ...result,
              ...createKnowledgeDocumentCitation({
                scope,
                knowledgeBaseId: result.knowledgeBaseId,
                documentId: result.documentId,
                sourceUrl: result.sourceUrl,
                baseUrl: getBaseUrl(),
              }),
            },
          }
          annotateSearchDiagnostics({
            toolResultBytes: Buffer.byteLength(JSON.stringify(output)),
            passageBytes: result.chunks.reduce(
              (total, chunk) => total + Buffer.byteLength(chunk.content),
              0
            ),
          })
          return output
        } catch (error) {
          logger.error('Document read failed', { error })
          return {
            success: false,
            message:
              error instanceof z.ZodError
                ? 'Invalid document arguments'
                : messageForCopilotKnowledgeError(error),
          }
        }
      }
    )
  },
}
