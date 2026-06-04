import { requestJson } from '@/lib/api/client/request'
import * as selectorContracts from '@/lib/api/contracts/selectors'
import { ensureKnowledgeBase, SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type { SelectorDefinition, SelectorKey, SelectorQueryArgs } from '@/hooks/selectors/types'

const KNOWLEDGE_DOCUMENTS_PAGE_LIMIT = 100

export const knowledgeSelectors = {
  'knowledge.documents': {
    key: 'knowledge.documents',
    contracts: [
      selectorContracts.listKnowledgeSelectorDocumentsContract,
      selectorContracts.getKnowledgeSelectorDocumentContract,
    ],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context, search }: SelectorQueryArgs) => [
      'selectors',
      'knowledge.documents',
      context.knowledgeBaseId ?? 'none',
      search ?? '',
    ],
    enabled: ({ context }) => Boolean(context.knowledgeBaseId),
    /**
     * Drives pagination through {@link useSelectorOptions}, which drains every
     * page via this callback. The `pagination.hasMore` flag from the route
     * decides when to stop; `nextCursor` encodes the next `offset`.
     */
    fetchPage: async ({ context, search, cursor, signal }) => {
      const knowledgeBaseId = ensureKnowledgeBase(context)
      const offset = cursor ? Number(cursor) : 0
      const result = await requestJson(selectorContracts.listKnowledgeSelectorDocumentsContract, {
        params: { id: knowledgeBaseId },
        query: {
          limit: KNOWLEDGE_DOCUMENTS_PAGE_LIMIT,
          offset,
          search,
        },
        signal,
      })
      const { pagination } = result.data
      const nextOffset = pagination.offset + pagination.limit
      return {
        items: result.data.documents.map((doc) => ({
          id: doc.id,
          label: doc.filename,
        })),
        nextCursor: pagination.hasMore ? String(nextOffset) : undefined,
      }
    },
    fetchById: async ({ context, detailId, signal }: SelectorQueryArgs) => {
      if (!detailId) return null
      const knowledgeBaseId = ensureKnowledgeBase(context)
      const result = await requestJson(selectorContracts.getKnowledgeSelectorDocumentContract, {
        params: { id: knowledgeBaseId, documentId: detailId },
        query: { includeDisabled: 'true' },
        signal,
      })
      return { id: result.data.id, label: result.data.filename }
    },
  },
} satisfies Record<Extract<SelectorKey, 'knowledge.documents'>, SelectorDefinition>
