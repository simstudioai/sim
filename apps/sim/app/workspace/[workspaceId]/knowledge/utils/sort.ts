import type { KnowledgeBaseData } from '@/stores/knowledge/store'
import type { SortOption, SortOrder } from '../components/shared'

interface KnowledgeBaseWithDocCount extends KnowledgeBaseData {
  docCount?: number
}

/**
 * Sort knowledge bases by the specified field and order
 */
export function sortKnowledgeBases(
  knowledgeBases: KnowledgeBaseData[],
  sortBy: SortOption,
  sortOrder: SortOrder
): KnowledgeBaseData[] {
  return [...knowledgeBases].sort((a, b) => {
    let comparison = 0

    switch (sortBy) {
      case 'name':
        comparison = a.name.localeCompare(b.name)
        break
      case 'createdAt':
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        break
      case 'updatedAt':
        comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
        break
      case 'docCount':
        comparison =
          ((a as KnowledgeBaseWithDocCount).docCount || 0) -
          ((b as KnowledgeBaseWithDocCount).docCount || 0)
        break
    }

    return sortOrder === 'asc' ? comparison : -comparison
  })
}

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

  const query = searchQuery.toLowerCase()
  return knowledgeBases.filter(
    (kb) => kb.name.toLowerCase().includes(query) || kb.description?.toLowerCase().includes(query)
  )
}
