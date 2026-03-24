import { useCallback } from 'react'
import { useFolderStore } from '@/stores/folders/store'

interface UseTaskSelectionProps {
  /**
   * Flat array of all task IDs in display order
   */
  taskIds: string[]
}

/**
 * Hook for managing task selection with support for single, range, and toggle selection.
 * Handles shift-click for range selection and cmd/ctrl-click for toggle.
 * Uses the last selected task as the anchor point for range selections.
 * Selecting tasks clears workflow/folder selections and vice versa.
 */
export function useTaskSelection({ taskIds }: UseTaskSelectionProps) {
  const selectedTasks = useFolderStore((s) => s.selectedTasks)

  const handleTaskClick = useCallback(
    (taskId: string, shiftKey: boolean, metaKey: boolean) => {
      const {
        selectTaskOnly,
        selectTaskRange,
        toggleTaskSelection,
        lastSelectedTaskId: anchor,
      } = useFolderStore.getState()
      if (metaKey) {
        toggleTaskSelection(taskId)
      } else if (shiftKey && anchor && anchor !== taskId) {
        selectTaskRange(taskIds, anchor, taskId)
      } else if (shiftKey) {
        toggleTaskSelection(taskId)
      } else {
        selectTaskOnly(taskId)
      }
    },
    [taskIds]
  )

  return {
    selectedTasks,
    handleTaskClick,
  }
}
