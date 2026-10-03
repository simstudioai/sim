'use client'

import { getErrorMessage } from '@sim/utils/errors'
import { useQueryClient } from '@tanstack/react-query'
import type { AllTagSlot } from '@/lib/knowledge/constants'
import { useTagDefinitionsQuery } from '@/hooks/queries/kb/knowledge'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'

export interface TagDefinition {
  id: string
  tagSlot: AllTagSlot
  displayName: string
  fieldType: string
  createdAt: string
  updatedAt: string
}

/** Stable empty fallback, so a pending query does not hand consumers a new array each render. */
export const EMPTY_TAG_DEFINITIONS: TagDefinition[] = []

/**
 * Hook for fetching KB-scoped tag definitions (for filtering/selection)
 * Uses React Query as single source of truth
 */
export function useKnowledgeBaseTagDefinitions(knowledgeBaseId: string | null) {
  const queryClient = useQueryClient()
  const query = useTagDefinitionsQuery(knowledgeBaseId)

  const fetchTagDefinitions = async () => {
    if (!knowledgeBaseId) return
    await queryClient.invalidateQueries({
      queryKey: knowledgeKeys.tagDefinitions(knowledgeBaseId),
    })
  }

  const tagDefinitions = (query.data ?? EMPTY_TAG_DEFINITIONS) as TagDefinition[]

  return {
    tagDefinitions,
    isLoading: query.isLoading,
    error: query.error ? getErrorMessage(query.error) : null,
    fetchTagDefinitions,
  }
}
