import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createLogger } from '@/lib/logs/console/logger'
import { useFolderStore } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('useDeleteWorkflow')

interface UseDeleteWorkflowProps {
  /**
   * Current workspace ID
   */
  workspaceId: string
  /**
   * Function that returns the workflow ID(s) to delete
   * This function is called when deletion occurs to get fresh selection state
   */
  getWorkflowIds: () => string | string[]
  /**
   * Whether the active workflow is being deleted
   * Can be a boolean or a function that receives the workflow IDs
   */
  isActive?: boolean | ((workflowIds: string[]) => boolean)
  /**
   * Optional callback after successful deletion
   */
  onSuccess?: () => void
}

/**
 * Hook for managing workflow deletion with navigation logic.
 *
 * Handles:
 * - Single or bulk workflow deletion
 * - Finding next workflow to navigate to
 * - Navigating before deletion (if active workflow)
 * - Removing workflow(s) from registry
 * - Loading state management
 * - Error handling and logging
 *
 * @param props - Hook configuration
 * @returns Delete workflow handlers and state
 */
export function useDeleteWorkflow({
  workspaceId,
  getWorkflowIds,
  isActive = false,
  onSuccess,
}: UseDeleteWorkflowProps) {
  const router = useRouter()
  const { workflows, removeWorkflow } = useWorkflowRegistry()
  const [isDeleting, setIsDeleting] = useState(false)

  /**
   * Delete the workflow(s) and navigate if needed
   */
  const handleDeleteWorkflow = useCallback(async () => {
    if (isDeleting) {
      return
    }

    setIsDeleting(true)
    try {
      // Get fresh workflow IDs at deletion time
      const workflowIdsOrId = getWorkflowIds()
      if (!workflowIdsOrId) {
        return
      }

      // Normalize to array for consistent handling
      const workflowIdsToDelete = Array.isArray(workflowIdsOrId)
        ? workflowIdsOrId
        : [workflowIdsOrId]

      // Determine if active workflow is being deleted
      const isActiveWorkflowBeingDeleted =
        typeof isActive === 'function' ? isActive(workflowIdsToDelete) : isActive

      // Find next workflow to navigate to (if active workflow is being deleted)
      const sidebarWorkflows = Object.values(workflows).filter((w) => w.workspaceId === workspaceId)

      // Find which specific workflow is the active one (if any in the deletion list)
      let activeWorkflowId: string | null = null
      if (isActiveWorkflowBeingDeleted && typeof isActive === 'function') {
        // Check each workflow being deleted to find which one is active
        activeWorkflowId =
          workflowIdsToDelete.find((id) => isActive([id])) || workflowIdsToDelete[0]
      } else {
        activeWorkflowId = workflowIdsToDelete[0]
      }

      const currentIndex = sidebarWorkflows.findIndex((w) => w.id === activeWorkflowId)

      let nextWorkflowId: string | null = null
      if (isActiveWorkflowBeingDeleted && sidebarWorkflows.length > workflowIdsToDelete.length) {
        // Find the first workflow that's not being deleted
        const remainingWorkflows = sidebarWorkflows.filter(
          (w) => !workflowIdsToDelete.includes(w.id)
        )

        if (remainingWorkflows.length > 0) {
          // Try to find the next workflow after the current one
          const workflowsAfterCurrent = remainingWorkflows.filter((w) => {
            const idx = sidebarWorkflows.findIndex((sw) => sw.id === w.id)
            return idx > currentIndex
          })

          if (workflowsAfterCurrent.length > 0) {
            nextWorkflowId = workflowsAfterCurrent[0].id
          } else {
            // Otherwise, use the first remaining workflow
            nextWorkflowId = remainingWorkflows[0].id
          }
        }
      }

      // Navigate first if this is the active workflow
      if (isActiveWorkflowBeingDeleted) {
        if (nextWorkflowId) {
          router.push(`/workspace/${workspaceId}/w/${nextWorkflowId}`)
        } else {
          router.push(`/workspace/${workspaceId}/w`)
        }
      }

      // Delete all workflows
      await Promise.all(workflowIdsToDelete.map((id) => removeWorkflow(id)))

      // Clear selection after successful deletion
      const { clearSelection } = useFolderStore.getState()
      clearSelection()

      logger.info('Workflow(s) deleted successfully', { workflowIds: workflowIdsToDelete })
      onSuccess?.()
    } catch (error) {
      logger.error('Error deleting workflow(s):', { error })
      throw error
    } finally {
      setIsDeleting(false)
    }
  }, [
    getWorkflowIds,
    isDeleting,
    workflows,
    workspaceId,
    isActive,
    router,
    removeWorkflow,
    onSuccess,
  ])

  return {
    isDeleting,
    handleDeleteWorkflow,
  }
}
