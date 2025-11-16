import { useEffect, useState } from 'react'
import { useKnowledgeStore } from '@/stores/knowledge/store'

export function useKnowledgeBaseName(knowledgeBaseId?: string | null) {
  const getCachedKnowledgeBase = useKnowledgeStore((state) => state.getCachedKnowledgeBase)
  const getKnowledgeBase = useKnowledgeStore((state) => state.getKnowledgeBase)
  const [isLoading, setIsLoading] = useState(false)

  const cached = knowledgeBaseId ? getCachedKnowledgeBase(knowledgeBaseId) : null

  useEffect(() => {
    if (!knowledgeBaseId || cached || isLoading) return
    setIsLoading(true)
    getKnowledgeBase(knowledgeBaseId)
      .catch(() => {
        // ignore
      })
      .finally(() => setIsLoading(false))
  }, [knowledgeBaseId, cached, isLoading, getKnowledgeBase])

  return cached?.name ?? null
}
