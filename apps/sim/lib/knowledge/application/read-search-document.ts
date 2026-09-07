import type { Principal } from '@sim/auth/principal'
import type { ReadSearchDocumentResult } from '@/lib/api/contracts/knowledge/documents'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { importDurableSecretProvenance } from '@/lib/execution/durable-secret-provenance'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { KnowledgeDocumentNotReadyError } from '@/lib/knowledge/application/chunk-errors'
import { resolveCanonicalActiveKnowledgeDocumentContext } from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { queryChunks } from '@/lib/knowledge/chunks/service'
import type { WorkspaceSearchFilters } from '@/lib/knowledge/search/filters'
import { findSearchIndex } from '@/lib/knowledge/search/search-index'
import { importKnowledgeSearchResultSecretProvenance } from '@/lib/knowledge/secret-provenance'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

export interface ReadSearchDocumentInput {
  documentId: string
  assertedWorkspaceId?: string
  assertedOrganizationId?: string
  filters?: WorkspaceSearchFilters
  offset: number
  limit: number
  resultSecretRegistry: ResolvedSecretTraceRegistry
  signal?: AbortSignal
}

/** Reads enabled indexed passages with the same document scope and ACLs as search. */
export const readSearchDocument = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.readDocument,
  resolveContext: async ({
    principal,
    input,
  }: {
    principal: Principal
    input: ReadSearchDocumentInput
  }) => {
    if (Boolean(input.assertedWorkspaceId) === Boolean(input.assertedOrganizationId))
      throw new OrchestrationError('validation', 'Document reads require exactly one search owner')
    const index = await findSearchIndex(
      input.assertedOrganizationId
        ? { kind: 'organization', organizationId: input.assertedOrganizationId }
        : { kind: 'workspace', workspaceId: input.assertedWorkspaceId! }
    )
    if (!index) throw new OrchestrationError('not_found', 'Document not found')
    return resolveCanonicalActiveKnowledgeDocumentContext(
      { ...input, knowledgeBaseId: index.id },
      principal
    )
  },
  async execute({ input, context }): Promise<ReadSearchDocumentResult> {
    input.signal?.throwIfAborted()
    if (
      !Number.isInteger(input.offset) ||
      input.offset < 0 ||
      input.offset > 5000 ||
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 50
    ) {
      throw new OrchestrationError(
        'validation',
        'Document reads require offset 0–5000 and limit 1–50'
      )
    }
    if (context.document.processingStatus !== 'completed') {
      throw new KnowledgeDocumentNotReadyError(context.document.processingStatus)
    }
    if (!context.knowledgeBase.isSearchIndex)
      throw new OrchestrationError('not_found', 'Document not found')
    if (!context.document.enabled) throw new OrchestrationError('not_found', 'Document not found')
    const page = await queryChunks(
      context.documentId,
      {
        offset: input.offset,
        limit: input.limit,
        enabled: 'true',
        sortBy: 'chunkIndex',
        sortOrder: 'asc',
        documentFilters: input.filters,
      },
      generateRequestId(),
      await context.access.get()
    )
    if (page.pagination.total === 0) throw new OrchestrationError('not_found', 'Document not found')
    const provenance = await importKnowledgeSearchResultSecretProvenance({
      registry: input.resultSecretRegistry,
      results: page.chunks.map((chunk) => ({ ...chunk, documentId: context.documentId })),
    })
    if (!provenance.imported) throw new Error('Knowledge result provenance is unavailable')
    const metadata = provenance.documentMetadata[context.documentId]
    if (
      metadata &&
      !(await importDurableSecretProvenance(
        input.resultSecretRegistry,
        metadata.provenance,
        { documentName: metadata.filename, sourceUrl: metadata.sourceUrl },
        'knowledge'
      ))
    ) {
      throw new Error('Knowledge document provenance is unavailable')
    }
    input.signal?.throwIfAborted()
    return {
      documentId: context.documentId,
      knowledgeBaseId: context.knowledgeBaseId,
      documentName: metadata?.filename ?? null,
      sourceUrl: metadata?.sourceUrl ?? null,
      chunks: page.chunks.map(({ content, chunkIndex }) => ({ content, chunkIndex })),
      hasMore: page.pagination.hasMore,
      nextOffset: page.pagination.hasMore ? input.offset + page.chunks.length : null,
    }
  },
})
