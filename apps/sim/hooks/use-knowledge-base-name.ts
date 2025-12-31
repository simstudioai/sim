import { useKnowledgeBase } from '@/hooks/use-knowledge'

/**
 * Hook to get a knowledge base name by ID
 * Uses React Query under the hood for caching and fetching
 */
export function useKnowledgeBaseName(knowledgeBaseId?: string | null) {
  const { knowledgeBase, isLoading } = useKnowledgeBase(knowledgeBaseId ?? '')

  if (!knowledgeBaseId) return null

  return knowledgeBase?.name ?? null
}
