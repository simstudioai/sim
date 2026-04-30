import { requestJson } from '@/lib/api/client/request'
import * as selectorContracts from '@/lib/api/contracts/selectors'
import { ensureKnowledgeBase, SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type { SelectorDefinition, SelectorKey, SelectorQueryArgs } from '@/hooks/selectors/types'

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
    fetchList: async ({ context, search, signal }: SelectorQueryArgs) => {
      const knowledgeBaseId = ensureKnowledgeBase(context)
      const result = await requestJson(selectorContracts.listKnowledgeSelectorDocumentsContract, {
        params: { id: knowledgeBaseId },
        query: {
          limit: 100,
          search,
        },
        signal,
      })
      return result.data.documents.map((doc) => ({
        id: doc.id,
        label: doc.filename,
      }))
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
