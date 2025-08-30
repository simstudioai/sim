'use client'

import { useCallback, useEffect, useState } from 'react'
import type { TagSlot } from '@/lib/knowledge/consts'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('useTagDefinitions')

export interface TagDefinition {
  id: string
  tagSlot: TagSlot
  displayName: string
  fieldType: string
  createdAt: string
  updatedAt: string
}

export interface TagDefinitionInput {
  tagSlot: TagSlot
  displayName: string
  fieldType: string
  // Optional: for editing existing definitions
  _originalDisplayName?: string
}

/**
 * Hook for managing KB-scoped tag definitions
 * @param knowledgeBaseId - The knowledge base ID
 * @param documentId - The document ID (required for API calls)
 */
export function useTagDefinitions(
  knowledgeBaseId: string | null,
  documentId: string | null = null
) {
  const [tagDefinitions, setTagDefinitions] = useState<TagDefinition[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchTagDefinitions = useCallback(async () => {
    if (!knowledgeBaseId || !documentId) {
      setTagDefinitions([])
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(
        `/api/knowledge/${knowledgeBaseId}/documents/${documentId}/tag-definitions`
      )

      if (!response.ok) {
        throw new Error(`Failed to fetch tag definitions: ${response.statusText}`)
      }

      const data = await response.json()

      if (data.success && Array.isArray(data.data)) {
        setTagDefinitions(data.data)
      } else {
        throw new Error('Invalid response format')
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
      logger.error('Error fetching tag definitions:', err)
      setError(errorMessage)
      setTagDefinitions([])
    } finally {
      setIsLoading(false)
    }
  }, [knowledgeBaseId, documentId])

  const saveTagDefinitions = useCallback(
    async (definitions: TagDefinitionInput[]) => {
      if (!knowledgeBaseId || !documentId) {
        throw new Error('Knowledge base ID and document ID are required')
      }

      // Simple validation
      const validDefinitions = (definitions || []).filter(
        (def) => def?.tagSlot && def.displayName && def.displayName.trim()
      )

      try {
        const response = await fetch(
          `/api/knowledge/${knowledgeBaseId}/documents/${documentId}/tag-definitions`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ definitions: validDefinitions }),
          }
        )

        if (!response.ok) {
          throw new Error(`Failed to save tag definitions: ${response.statusText}`)
        }

        const data = await response.json()

        if (!data.success) {
          throw new Error(data.error || 'Failed to save tag definitions')
        }

        // Refresh the definitions after saving
        await fetchTagDefinitions()

        return data.data
      } catch (err) {
        logger.error('Error saving tag definitions:', err)
        throw err
      }
    },
    [knowledgeBaseId, documentId, fetchTagDefinitions]
  )

  const deleteTagDefinitions = useCallback(async () => {
    if (!knowledgeBaseId || !documentId) {
      throw new Error('Knowledge base ID and document ID are required')
    }

    try {
      const response = await fetch(
        `/api/knowledge/${knowledgeBaseId}/documents/${documentId}/tag-definitions`,
        {
          method: 'DELETE',
        }
      )

      if (!response.ok) {
        throw new Error(`Failed to delete tag definitions: ${response.statusText}`)
      }

      // Refresh the definitions after deleting
      await fetchTagDefinitions()
    } catch (err) {
      logger.error('Error deleting tag definitions:', err)
      throw err
    }
  }, [knowledgeBaseId, documentId, fetchTagDefinitions])

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

  // Auto-fetch on mount and when dependencies change
  useEffect(() => {
    fetchTagDefinitions()
  }, [fetchTagDefinitions])

  return {
    tagDefinitions,
    isLoading,
    error,
    fetchTagDefinitions,
    saveTagDefinitions,
    deleteTagDefinitions,
    getTagLabel,
    getTagDefinition,
  }
}
