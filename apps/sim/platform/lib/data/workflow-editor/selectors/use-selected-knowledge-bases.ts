import { useQueries } from '@tanstack/react-query'
import type { KnowledgeBaseData } from '@/lib/knowledge/types'
import { fetchKnowledgeBase, KNOWLEDGE_BASE_DETAIL_STALE_TIME } from '@/hooks/queries/kb/knowledge'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'

function presentRecords(
  results: readonly { data: KnowledgeBaseData | undefined }[]
): KnowledgeBaseData[] {
  return results
    .map((result) => result.data)
    .filter((record): record is KnowledgeBaseData => Boolean(record))
}

/**
 * Each selected knowledge base's own record, under the detail key every other reader shares, so a
 * selection the workspace list does not carry still resolves to its name.
 */
export function useSelectedKnowledgeBases(ids: readonly string[]): KnowledgeBaseData[] {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: knowledgeKeys.detail(id),
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchKnowledgeBase(id, signal),
      enabled: Boolean(id),
      staleTime: KNOWLEDGE_BASE_DETAIL_STALE_TIME,
    })),
    combine: presentRecords,
  })
}
