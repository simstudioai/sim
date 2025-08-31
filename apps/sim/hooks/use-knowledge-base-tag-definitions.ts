'use client'

import { useCallback, useEffect, useState } from 'react'
import type { TagSlot } from '@/lib/knowledge/consts'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('useKnowledgeBaseTagDefinitions')

export interface TagDefinition {
  id: string
  tagSlot: TagSlot
  displayName: string
  fieldType: string
  createdAt: string
  updatedAt: string
}

/**
 * Hook for fetching KB-scoped tag definitions (for filtering/selection)
 * @param knowledgeBaseId - The knowledge base ID
 */
export function useKnowledgeBaseTagDefinitions(knowledgeBaseId: string | null) {
  const [tagDefinitions, setTagDefinitions] = useState<TagDefinition[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchTagDefinitions = useCallback(async () => {
    if (!knowledgeBaseId) {
      setTagDefinitions([])
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/knowledge/${knowledgeBaseId}/tag-definitions`)

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
  }, [knowledgeBaseId])

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
    getTagLabel,
    getTagDefinition,
  }
}
