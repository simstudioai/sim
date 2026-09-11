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
import { measureSearchStage } from '@/lib/knowledge/search/diagnostics'
import type { WorkspaceSearchFilters } from '@/lib/knowledge/search/filters'
import { findSearchIndex } from '@/lib/knowledge/search/search-index'
import { passageWindow } from '@/lib/knowledge/search/snippet'
import { importKnowledgeSearchResultSecretProvenance } from '@/lib/knowledge/secret-provenance'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

export interface ReadSearchDocumentInput {
  documentId: string
  assertedWorkspaceId?: string
  assertedOrganizationId?: string
  filters?: WorkspaceSearchFilters
  limit: number
  startChunkIndex?: number
  startOffset?: number
  resultSecretRegistry: ResolvedSecretTraceRegistry
  signal?: AbortSignal
}

/** Bounds model text to at most 24KB of UTF-8, with continuation even inside a large chunk. */
const READ_PAGE_CHARACTERS = 8000
const READ_PAGE_CHUNKS = 8
const STALE_POSITION_MESSAGE =
  'The passage position is no longer available; search again or read from the chunk start'

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
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > READ_PAGE_CHUNKS ||
      (input.startChunkIndex !== undefined &&
        (!Number.isSafeInteger(input.startChunkIndex) ||
          input.startChunkIndex < 0 ||
          input.startChunkIndex > 2147483647)) ||
      (input.startOffset !== undefined &&
        (!Number.isSafeInteger(input.startOffset) ||
          input.startOffset < 0 ||
          input.startOffset > 2147483647 ||
          input.startChunkIndex === undefined))
    ) {
      throw new OrchestrationError(
        'validation',
        'Document reads require limit 1–8 and nonnegative chunk positions; startOffset requires startChunkIndex'
      )
    }
    if (context.document.processingStatus !== 'completed') {
      throw new KnowledgeDocumentNotReadyError(context.document.processingStatus)
    }
    if (!context.knowledgeBase.isSearchIndex)
      throw new OrchestrationError('not_found', 'Document not found')
    if (!context.document.enabled) throw new OrchestrationError('not_found', 'Document not found')
    const access = await measureSearchStage('access_scope', () => context.access.get())
    const page = await measureSearchStage('document_read.sql', () =>
      queryChunks(
        context.documentId,
        {
          limit: input.limit,
          startChunkIndex: input.startChunkIndex,
          requireEnabledDocument: true,
          enabled: 'true',
          sortBy: 'chunkIndex',
          sortOrder: 'asc',
          documentFilters: input.filters,
        },
        generateRequestId(),
        access
      )
    )
    if (page.pagination.total === 0) throw new OrchestrationError('not_found', 'Document not found')
    if (input.startChunkIndex !== undefined && page.chunks.length === 0) {
      throw new OrchestrationError('validation', STALE_POSITION_MESSAGE)
    }
    const provenance = await measureSearchStage('result_provenance', () =>
      importKnowledgeSearchResultSecretProvenance({
        registry: input.resultSecretRegistry,
        results: page.chunks.map((chunk) => ({ ...chunk, documentId: context.documentId })),
      })
    )
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
    /** Project complete strings before slicing, so a window cannot expose part of a secret. */
    const projectedChunks = page.chunks.map((chunk) => {
      const projected = projectResolvedSecretModelContent(chunk.content, input.resultSecretRegistry)
      if (!projected.safe || typeof projected.value !== 'string')
        throw new Error('Knowledge result provenance is unavailable')
      return { ...chunk, content: projected.value }
    })
    if (
      input.startOffset &&
      (projectedChunks[0]?.chunkIndex !== input.startChunkIndex ||
        input.startOffset >= projectedChunks[0].content.length)
    ) {
      throw new OrchestrationError('validation', STALE_POSITION_MESSAGE)
    }
    let remaining = READ_PAGE_CHARACTERS
    const chunks: ReadSearchDocumentResult['chunks'] = []
    let next: ReadSearchDocumentResult['next'] = null
    for (const chunk of projectedChunks) {
      if (remaining < 2) {
        next = { startChunkIndex: chunk.chunkIndex, startOffset: 0 }
        break
      }
      const start = chunk.chunkIndex === input.startChunkIndex ? (input.startOffset ?? 0) : 0
      const excerpt = passageWindow(chunk.content, start, remaining)
      chunks.push({ chunkIndex: chunk.chunkIndex, ...excerpt })
      remaining -= excerpt.content.length
      if (excerpt.endOffset < chunk.content.length) {
        next = { startChunkIndex: chunk.chunkIndex, startOffset: excerpt.endOffset }
        break
      }
    }
    const last = chunks.at(-1)
    if (!next && page.pagination.hasMore && last) {
      next = { startChunkIndex: last.chunkIndex + 1, startOffset: 0 }
    }
    input.signal?.throwIfAborted()
    return {
      documentId: context.documentId,
      knowledgeBaseId: context.knowledgeBaseId,
      documentName: metadata?.filename ?? null,
      sourceUrl: metadata?.sourceUrl ?? null,
      chunks,
      hasMore: next !== null,
      next,
    }
  },
})
