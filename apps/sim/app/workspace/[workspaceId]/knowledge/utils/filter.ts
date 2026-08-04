import type { KnowledgeBaseData } from '@/lib/knowledge/types'

/**
 * Filter knowledge bases by search query
 */
export function filterKnowledgeBases(
  knowledgeBases: KnowledgeBaseData[],
  searchQuery: string
): KnowledgeBaseData[] {
  if (!searchQuery.trim()) {
    return knowledgeBases
  }

  const query = searchQuery.trim().toLowerCase()
  return knowledgeBases.filter(
    (kb) => kb.name.toLowerCase().includes(query) || kb.description?.toLowerCase().includes(query)
  )
}
