'use client'

import { useCallback } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryClient } from '@tanstack/react-query'
import type { AllTagSlot } from '@/lib/knowledge/constants'
import {
  EMPTY_TAG_DEFINITIONS,
  type TagDefinition,
} from '@/hooks/kb/use-knowledge-base-tag-definitions'
import {
  type DocumentTagDefinitionInput,
  useDeleteDocumentTagDefinitions,
  useDocumentTagDefinitionsQuery,
  useSaveDocumentTagDefinitions,
} from '@/hooks/queries/kb/knowledge'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'

/**
 * Re-exported so both tag hooks name ONE type: consumers already import `TagDefinition` from
 * one of these files and `TagDefinitionInput` from the other, and two structurally identical
 * declarations would let them drift with nothing to catch it.
 */
export type { TagDefinition }

export interface TagDefinitionInput {
  tagSlot: AllTagSlot
  displayName: string
  fieldType: string
  _originalDisplayName?: string
}

/**
 * Hook for managing document-scoped tag definitions
 * Uses React Query as single source of truth
 */
export function useTagDefinitions(
  knowledgeBaseId: string | null,
  documentId: string | null = null
) {
  const queryClient = useQueryClient()
  const query = useDocumentTagDefinitionsQuery(knowledgeBaseId, documentId)
  const { mutateAsync: saveTagDefinitionsMutation } = useSaveDocumentTagDefinitions()
  const { mutateAsync: deleteTagDefinitionsMutation } = useDeleteDocumentTagDefinitions()

  const tagDefinitions = (query.data ?? EMPTY_TAG_DEFINITIONS) as TagDefinition[]

  const fetchTagDefinitions = useCallback(async () => {
    if (!knowledgeBaseId || !documentId) return
    await queryClient.invalidateQueries({
      queryKey: knowledgeKeys.documentTagDefinitions(knowledgeBaseId, documentId),
    })
  }, [queryClient, knowledgeBaseId, documentId])

  const saveTagDefinitions = async (definitions: TagDefinitionInput[]) => {
    if (!knowledgeBaseId || !documentId) {
      throw new Error('Knowledge base ID and document ID are required')
    }

    return saveTagDefinitionsMutation({
      knowledgeBaseId,
      documentId,
      definitions: definitions as DocumentTagDefinitionInput[],
    })
  }

  return {
    tagDefinitions,
    isLoading: query.isLoading,
    error: query.error ? getErrorMessage(query.error) : null,
    fetchTagDefinitions,
    saveTagDefinitions,
  }
}
