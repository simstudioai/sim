import { createLogger } from '@sim/logger'
import { z } from 'zod'
import {
  readDocumentInputSchema,
  searchWorkspaceInputSchema,
} from '@/lib/api/contracts/mothership-assistant-tools'
import { getValidationErrorMessage } from '@/lib/api/server/validation'
import { EmbeddingConfigurationError } from '@/lib/embeddings/configuration-error'
import { SearchDeadlineError } from '@/lib/knowledge/search/budget'
import { liveCitationId } from '@/lib/knowledge/search/citation'
import { withSearchDiagnostics } from '@/lib/knowledge/search/diagnostics'
import { intersectWorkspaceSearchFilters } from '@/lib/knowledge/search/filters'
import {
  executeCopilotKnowledgeUseCase,
  executeCopilotOrganizationKnowledgeUseCase,
  messageForCopilotKnowledgeError,
  requireCopilotKnowledgeScope,
} from '@/lib/mothership/application/execute-knowledge-use-case'
import type { BaseServerTool, ServerToolContext } from '@/lib/mothership/tools/server/base-tool'
import { connectorDisplayName } from '@/lib/sim-search/connectors'
import { readLiveDocument, searchLiveKnowledge } from '@/lib/sim-search/live/application'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'

const logger = createLogger('WorkspaceSearchTool')

const CITATION_INSTRUCTION =
  'Cite the evidence you use as <source>{"id":"<citationId>"}</source>. Use only IDs returned by these tools with a non-null citationUrl.' +
  ' When referring to a Slack conversation, link the returned sourceContainerName to its sourceContainerUrl when available.'

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
          const nativeProjection = projectResolvedSecretModelContent(nativeQueries ?? [], registry)
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
            message: `${data.retrieval.status === 'partial' ? 'Search coverage is incomplete. Continue with a more specific query or source filter; these results cannot establish absence or completeness. ' : ''}Found ${data.results.length} live results. Read a documentId when its passage does not answer the question or more context is needed. ${CITATION_INSTRUCTION}`,
            data: {
              ...data,
              results: data.results.map((item) => ({
                ...item,
                siteName: connectorDisplayName(item.connectorType ?? ''),
                citationId: liveCitationId(item.documentId),
                citationUrl: item.sourceUrl ?? item.sourceContainerUrl ?? null,
              })),
            },
          }
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
                  ? getValidationErrorMessage(error, 'Invalid search arguments')
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
              citationId: liveCitationId(data.documentId),
              citationUrl: data.sourceUrl ?? data.sourceContainerUrl ?? null,
            },
          }
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
