import { useCallback } from 'react'
import { useFolderStore } from '@/stores/folders/store'

interface UseWorkflowSelectionProps {
  /**
   * Flat array of all workflow IDs in display order
   */
  workflowIds: string[]
  /**
   * Active workflow ID (from URL) - used as anchor for range selection
   */
  activeWorkflowId: string | undefined
}

/**
 * Hook for managing workflow selection with support for single, range, and toggle selection.
 * Handles shift-click for range selection and regular click for single selection.
 * Uses the active workflow ID as the anchor point for range selections.
 *
 * @param props - Hook props
 * @returns Selection handlers
 */
export function useWorkflowSelection({ workflowIds, activeWorkflowId }: UseWorkflowSelectionProps) {
  const { selectedWorkflows, selectOnly, selectRange, toggleWorkflowSelection } = useFolderStore()

  /**
   * Handle workflow click with support for shift-click range selection and cmd/ctrl-click toggle
   *
   * @param workflowId - ID of clicked workflow
   * @param shiftKey - Whether shift key was pressed
   * @param metaKey - Whether cmd (Mac) or ctrl (Windows) key was pressed
   */
  const handleWorkflowClick = useCallback(
    (workflowId: string, shiftKey: boolean, metaKey: boolean) => {
      // Cmd/Ctrl+Click: Toggle individual selection
      if (metaKey) {
        toggleWorkflowSelection(workflowId)
      }
      // Shift+Click: Range selection from active workflow to clicked workflow
      else if (shiftKey && activeWorkflowId && activeWorkflowId !== workflowId) {
        selectRange(workflowIds, activeWorkflowId, workflowId)
      }
      // Shift+Click without active workflow: Toggle selection
      else if (shiftKey) {
        toggleWorkflowSelection(workflowId)
      }
      // Regular click: Select only this workflow
      else {
        selectOnly(workflowId)
      }
    },
    [workflowIds, activeWorkflowId, selectOnly, selectRange, toggleWorkflowSelection]
  )

  return {
    selectedWorkflows,
    handleWorkflowClick,
  }
}
