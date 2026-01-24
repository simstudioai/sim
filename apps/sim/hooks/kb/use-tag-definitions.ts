'use client'

import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { AllTagSlot } from '@/lib/knowledge/constants'
import {
  type DocumentTagDefinitionInput,
  knowledgeKeys,
  useDeleteDocumentTagDefinitions,
  useDocumentTagDefinitionsQuery,
  useSaveDocumentTagDefinitions,
} from '@/hooks/queries/knowledge'

export interface TagDefinition {
  id: string
  tagSlot: AllTagSlot
  displayName: string
  fieldType: string
  createdAt: string
  updatedAt: string
}

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

  const tagDefinitions = (query.data ?? []) as TagDefinition[]

  const fetchTagDefinitions = useCallback(async () => {
    if (!knowledgeBaseId || !documentId) return
    await queryClient.invalidateQueries({
      queryKey: knowledgeKeys.documentTagDefinitions(knowledgeBaseId, documentId),
    })
  }, [queryClient, knowledgeBaseId, documentId])

  const saveTagDefinitions = useCallback(
    async (definitions: TagDefinitionInput[]) => {
      if (!knowledgeBaseId || !documentId) {
        throw new Error('Knowledge base ID and document ID are required')
      }

      return saveTagDefinitionsMutation({
        knowledgeBaseId,
        documentId,
        definitions: definitions as DocumentTagDefinitionInput[],
      })
    },
    [knowledgeBaseId, documentId, saveTagDefinitionsMutation]
  )

  const deleteTagDefinitions = useCallback(async () => {
    if (!knowledgeBaseId || !documentId) {
      throw new Error('Knowledge base ID and document ID are required')
    }

    return deleteTagDefinitionsMutation({
      knowledgeBaseId,
      documentId,
    })
  }, [knowledgeBaseId, documentId, deleteTagDefinitionsMutation])

  const getTagLabel = useCallback(
    (tagSlot: string): string => {
      const definition = tagDefinitions.find((def) => def.tagSlot === tagSlot)
      return definition?.displayName || tagSlot
    },
    [tagDefinitions]
  )

  const getTagDefinition = useCallback(
    (tagSlot: string): TagDefinition | undefined => {
      return tagDefinitions.find((def) => def.tagSlot === tagSlot)
    },
    [tagDefinitions]
  )

  return {
    tagDefinitions,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    fetchTagDefinitions,
    saveTagDefinitions,
    deleteTagDefinitions,
    getTagLabel,
    getTagDefinition,
  }
}
