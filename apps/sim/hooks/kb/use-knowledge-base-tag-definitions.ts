'use client'

import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { AllTagSlot } from '@/lib/knowledge/constants'
import { knowledgeKeys, useTagDefinitionsQuery } from '@/hooks/queries/knowledge'

export interface TagDefinition {
  id: string
  tagSlot: AllTagSlot
  displayName: string
  fieldType: string
  createdAt: string
  updatedAt: string
}

/**
 * Hook for fetching KB-scoped tag definitions (for filtering/selection)
 * Uses React Query as single source of truth
 */
export function useKnowledgeBaseTagDefinitions(knowledgeBaseId: string | null) {
  const queryClient = useQueryClient()
  const query = useTagDefinitionsQuery(knowledgeBaseId)

  const fetchTagDefinitions = useCallback(async () => {
    if (!knowledgeBaseId) return
    await queryClient.invalidateQueries({
      queryKey: knowledgeKeys.tagDefinitions(knowledgeBaseId),
    })
  }, [queryClient, knowledgeBaseId])

  return {
    tagDefinitions: (query.data ?? []) as TagDefinition[],
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    fetchTagDefinitions,
  }
}
