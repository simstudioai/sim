import { useCallback, useEffect, useState } from 'react'
import type { SubBlockConfig } from '@/blocks/types'
import { useDisplayNamesStore } from '@/stores/display-names/store'
import { useKnowledgeStore } from '@/stores/knowledge/store'

/**
 * Generic hook to get display name for any selector value
 * Automatically fetches if not cached
 */
export function useDisplayName(
  subBlock: SubBlockConfig | undefined,
  value: unknown,
  context?: {
    workspaceId?: string
    credentialId?: string
    provider?: string
    knowledgeBaseId?: string
  }
): string | null {
  const getKnowledgeBase = useKnowledgeStore((state) => state.getKnowledgeBase)
  const [isFetching, setIsFetching] = useState(false)

  // Subscribe to knowledge base name so component re-renders when it becomes available
  const knowledgeBaseName = useKnowledgeStore(
    useCallback(
      (state) => {
        if (typeof value !== 'string') return null
        return state.knowledgeBases[value]?.name ?? null
      },
      [value]
    )
  )

  // Select actual cached value from store (not getter) so component re-renders when cache updates
  const cachedDisplayName = useDisplayNamesStore(
    useCallback(
      (state) => {
        if (!subBlock || !value || typeof value !== 'string') return null

        // Channels
        if (subBlock.type === 'channel-selector' && context?.credentialId) {
          return state.cache.channels[context.credentialId]?.[value] || null
        }

        // Workflows
        if (subBlock.id === 'workflowId') {
          return state.cache.workflows['global']?.[value] || null
        }

        // Files
        if (subBlock.type === 'file-selector' && context?.credentialId) {
          return state.cache.files[context.credentialId]?.[value] || null
        }

        // Folders
        if (subBlock.type === 'folder-selector' && context?.credentialId) {
          return state.cache.folders[context.credentialId]?.[value] || null
        }

        // Projects
        if (subBlock.type === 'project-selector' && context?.provider && context?.credentialId) {
          const projectContext = `${context.provider}-${context.credentialId}`
          return state.cache.projects[projectContext]?.[value] || null
        }

        // Documents
        if (subBlock.type === 'document-selector' && context?.knowledgeBaseId) {
          return state.cache.documents[context.knowledgeBaseId]?.[value] || null
        }

        return null
      },
      [
        subBlock,
        value,
        context?.workspaceId,
        context?.credentialId,
        context?.provider,
        context?.knowledgeBaseId,
      ]
    )
  )

  // Auto-fetch knowledge bases if needed
  useEffect(() => {
    if (
      subBlock?.type === 'knowledge-base-selector' &&
      typeof value === 'string' &&
      value &&
      !knowledgeBaseName &&
      !isFetching
    ) {
      setIsFetching(true)
      getKnowledgeBase(value as string)
        .catch(() => {
          // Silently fail if the fetch fails
        })
        .finally(() => {
          setIsFetching(false)
        })
    }
  }, [subBlock?.type, value, isFetching, knowledgeBaseName, getKnowledgeBase])

  if (!subBlock || !value || typeof value !== 'string') {
    return null
  }

  // Credentials - handled separately by useCredentialDisplay
  if (subBlock.type === 'oauth-input') {
    return null
  }

  // Knowledge Bases - use existing knowledge store
  if (subBlock.type === 'knowledge-base-selector' && context?.workspaceId) {
    if (knowledgeBaseName) {
      return knowledgeBaseName
    }
    return null
  }

  // Return the cached display name (which triggers re-render when populated)
  return cachedDisplayName
}
