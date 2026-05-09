import { useCallback } from 'react'
import { useFolderStore } from '@/stores/folders/store'

const toggleFolderExpanded = useFolderStore.getState().toggleExpanded
const setFolderExpanded = useFolderStore.getState().setExpanded

interface UseFolderExpandProps {
  folderId: string
}

/**
 * Custom hook to handle folder expand/collapse functionality.
 * Provides handlers for mouse clicks and keyboard navigation.
 *
 * @param props - Configuration object containing folderId
 * @returns Expansion state and event handlers
 */
export function useFolderExpand({ folderId }: UseFolderExpandProps) {
  const expandedFolders = useFolderStore((state) => state.expandedFolders)
  const isExpanded = expandedFolders.has(folderId)

  /**
   * Toggle folder expansion state
   */
  const handleToggleExpanded = useCallback(() => {
    toggleFolderExpanded(folderId)
  }, [folderId])

  /**
   * Expand the folder (useful when creating items inside)
   */
  const expandFolder = useCallback(() => {
    setFolderExpanded(folderId, true)
  }, [folderId])

  /**
   * Handle keyboard navigation (Enter/Space)
   */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        handleToggleExpanded()
      }
    },
    [handleToggleExpanded]
  )

  return {
    isExpanded,
    handleToggleExpanded,
    expandFolder,
    handleKeyDown,
  }
}
