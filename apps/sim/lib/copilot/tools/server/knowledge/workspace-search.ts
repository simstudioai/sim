import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { workspaceSearchFiltersSchema } from '@/lib/api/contracts/knowledge/search'
import {
  executeCopilotKnowledgeUseCase,
  executeCopilotOrganizationKnowledgeUseCase,
  messageForCopilotKnowledgeError,
  requireCopilotKnowledgeScope,
} from '@/lib/copilot/application/execute-knowledge-use-case'
import type { BaseServerTool, ServerToolContext } from '@/lib/copilot/tools/server/base-tool'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { readSearchDocument } from '@/lib/knowledge/application/read-search-document'
import {
  searchOrganizationKnowledge,
  searchWorkspaceKnowledge,
} from '@/lib/knowledge/application/workspace-search'
import { sourceAuthor } from '@/lib/knowledge/search/author'
import { createKnowledgeDocumentCitation } from '@/lib/knowledge/search/citation'
import { intersectWorkspaceSearchFilters } from '@/lib/knowledge/search/filters'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'

const logger = createLogger('WorkspaceSearchTool')
const searchInputSchema = workspaceSearchFiltersSchema.extend({
  query: z.string().trim().min(1).max(2000),
  topK: z.number().int().min(1).max(50).default(20),
})
const readInputSchema = z.object({
  documentId: z.string().min(1).max(200),
  offset: z.number().int().min(0).max(5000).default(0),
  limit: z.number().int().min(1).max(50).default(20),
})

const CITATION_INSTRUCTION =
  'Cite the evidence you use as <source>{"id":"<citationId>"}</source>. Use only IDs returned by these tools.'

export const searchWorkspaceServerTool: BaseServerTool = {
  name: 'search_workspace',
  async execute(raw, context?: ServerToolContext) {
    try {
      const scope = requireCopilotKnowledgeScope(context)
      const { query, topK, ...requestedFilters } = searchInputSchema.parse(raw)
      const registry = context?.resolvedSecretTraceRegistry
      if (!registry) throw new Error('Knowledge result provenance is unavailable')
      const projected = projectResolvedSecretModelContent(query, registry)
      if (!projected.safe || typeof projected.value !== 'string') {
        return {
          success: false,
          message: 'Search query contains protected content. Rephrase the query.',
        }
      }
      const input = {
        query: projected.value,
        topK,
        filters: intersectWorkspaceSearchFilters(requestedFilters, context?.assistantSearch),
        surface: 'copilot',
        resultSecretRegistry: registry,
        signal: context?.abortSignal,
      } as const
      const result =
        scope.kind === 'organization'
          ? await executeCopilotOrganizationKnowledgeUseCase(context, searchOrganizationKnowledge, {
              ...input,
              organizationId: scope.organizationId,
            })
          : await executeCopilotKnowledgeUseCase(context, searchWorkspaceKnowledge, {
              ...input,
              workspaceId: scope.workspaceId,
            })
      const names = new Map(result.knowledgeBases.map((base) => [base.id, base.name]))
      return {
        success: true,
        message: `Found ${result.results.length} passages. ${CITATION_INSTRUCTION}`,
        data: {
          query,
          results: result.results.map((item) => ({
            documentId: item.documentId,
            knowledgeBaseId: item.knowledgeBaseId,
            knowledgeBaseName: names.get(item.knowledgeBaseId) ?? '',
            documentName: item.documentName,
            sourceUrl: item.sourceUrl,
            connectorType: item.connectorType,
            sourceModifiedAt: item.sourceModifiedAt?.toISOString() ?? null,
            author: sourceAuthor(item.metadata),
            content: item.content,
            chunkIndex: item.chunkIndex,
            similarity: item.similarity,
            ...createKnowledgeDocumentCitation({
              scope,
              knowledgeBaseId: item.knowledgeBaseId,
              documentId: item.documentId,
              sourceUrl: item.sourceUrl,
              baseUrl: getBaseUrl(),
            }),
          })),
        },
      }
    } catch (error) {
      logger.error('Workspace search failed', { error })
      return {
        success: false,
        message:
          error instanceof z.ZodError
            ? 'Invalid search arguments'
            : messageForCopilotKnowledgeError(error),
      }
    }
  },
}

export const readDocumentServerTool: BaseServerTool = {
  name: 'read_document',
  async execute(raw, context?: ServerToolContext) {
    try {
      const scope = requireCopilotKnowledgeScope(context)
      const input = readInputSchema.parse(raw)
      const registry = context?.resolvedSecretTraceRegistry
      if (!registry) throw new Error('Knowledge result provenance is unavailable')
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
      const result =
        scope.kind === 'organization'
          ? await executeCopilotOrganizationKnowledgeUseCase(context, readSearchDocument, readInput)
          : await executeCopilotKnowledgeUseCase(context, readSearchDocument, readInput)
      return {
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
  },
}
