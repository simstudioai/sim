import { useCallback, useEffect, useState } from 'react'
import type { SubBlockConfig } from '@/blocks/types'
import { useDisplayNamesStore } from '@/stores/display-names/store'
import { useKnowledgeStore } from '@/stores/knowledge/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

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
  const getCachedKnowledgeBase = useKnowledgeStore((state) => state.getCachedKnowledgeBase)
  const getKnowledgeBase = useKnowledgeStore((state) => state.getKnowledgeBase)
  const getDocuments = useKnowledgeStore((state) => state.getDocuments)
  const [isFetching, setIsFetching] = useState(false)

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
      [subBlock, value, context?.credentialId, context?.provider, context?.knowledgeBaseId]
    )
  )

  // Auto-fetch knowledge bases if needed
  useEffect(() => {
    if (
      subBlock?.type === 'knowledge-base-selector' &&
      typeof value === 'string' &&
      value &&
      !isFetching
    ) {
      const kb = getCachedKnowledgeBase(value)
      if (!kb) {
        setIsFetching(true)
        getKnowledgeBase(value)
          .catch(() => {
            // Silently fail
          })
          .finally(() => {
            setIsFetching(false)
          })
      }
    }
  }, [subBlock?.type, value, isFetching, getCachedKnowledgeBase, getKnowledgeBase])

  // Auto-fetch documents if needed
  useEffect(() => {
    if (
      subBlock?.type === 'document-selector' &&
      context?.knowledgeBaseId &&
      typeof value === 'string' &&
      value &&
      !cachedDisplayName &&
      !isFetching
    ) {
      setIsFetching(true)
      getDocuments(context.knowledgeBaseId)
        .then((docs) => {
          if (docs.length > 0) {
            const documentMap = docs.reduce<Record<string, string>>((acc, doc) => {
              acc[doc.id] = doc.filename
              return acc
            }, {})
            useDisplayNamesStore
              .getState()
              .setDisplayNames('documents', context.knowledgeBaseId!, documentMap)
          }
        })
        .catch(() => {
          // Silently fail
        })
        .finally(() => {
          setIsFetching(false)
        })
    }
  }, [subBlock?.type, value, context?.knowledgeBaseId, cachedDisplayName, isFetching, getDocuments])

  // Auto-fetch workflows if needed
  useEffect(() => {
    if (subBlock?.id !== 'workflowId' || typeof value !== 'string' || !value) return
    if (cachedDisplayName || isFetching) return

    const workflows = useWorkflowRegistry.getState().workflows
    if (!workflows[value]) return

    const workflowMap = Object.entries(workflows).reduce<Record<string, string>>(
      (acc, [id, workflow]) => {
        acc[id] = workflow.name || `Workflow ${id.slice(0, 8)}`
        return acc
      },
      {}
    )

    useDisplayNamesStore.getState().setDisplayNames('workflows', 'global', workflowMap)
  }, [subBlock?.id, value, cachedDisplayName, isFetching])

  if (!subBlock || !value || typeof value !== 'string') {
    return null
  }

  // Credentials - handled separately by useCredentialDisplay
  if (subBlock.type === 'oauth-input') {
    return null
  }

  // Knowledge Bases - use existing knowledge store
  if (subBlock.type === 'knowledge-base-selector') {
    const kb = getCachedKnowledgeBase(value)
    return kb?.name || null
  }

  // Return the cached display name (which triggers re-render when populated)
  return cachedDisplayName
}
