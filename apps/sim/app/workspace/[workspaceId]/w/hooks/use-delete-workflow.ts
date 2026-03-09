import { useCallback, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useRouter } from 'next/navigation'
import { useFolderStore } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('useDeleteWorkflow')

interface UseDeleteWorkflowProps {
  /**
   * Current workspace ID
   */
  workspaceId: string
  /**
   * Workflow ID(s) to delete
   */
  workflowIds: string | string[]
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
 * @param props - Hook configuration
 * @returns Delete workflow handlers and state
 */
export function useDeleteWorkflow({
  workspaceId,
  workflowIds,
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

    if (!workflowIds) {
      return
    }

    setIsDeleting(true)
    try {
      const workflowIdsToDelete = Array.isArray(workflowIds) ? workflowIds : [workflowIds]

      const isActiveWorkflowBeingDeleted =
        typeof isActive === 'function' ? isActive(workflowIdsToDelete) : isActive

      const sidebarWorkflows = Object.values(workflows).filter((w) => w.workspaceId === workspaceId)

      let activeWorkflowId: string | null = null
      if (isActiveWorkflowBeingDeleted && typeof isActive === 'function') {
        activeWorkflowId =
          workflowIdsToDelete.find((id) => isActive([id])) || workflowIdsToDelete[0]
      } else {
        activeWorkflowId = workflowIdsToDelete[0]
      }

      const currentIndex = sidebarWorkflows.findIndex((w) => w.id === activeWorkflowId)

      let nextWorkflowId: string | null = null
      if (isActiveWorkflowBeingDeleted && sidebarWorkflows.length > workflowIdsToDelete.length) {
        const remainingWorkflows = sidebarWorkflows.filter(
          (w) => !workflowIdsToDelete.includes(w.id)
        )

        if (remainingWorkflows.length > 0) {
          const workflowsAfterCurrent = remainingWorkflows.filter((w) => {
            const idx = sidebarWorkflows.findIndex((sw) => sw.id === w.id)
            return idx > currentIndex
          })

          if (workflowsAfterCurrent.length > 0) {
            nextWorkflowId = workflowsAfterCurrent[0].id
          } else {
            nextWorkflowId = remainingWorkflows[0].id
          }
        }
      }

      if (isActiveWorkflowBeingDeleted) {
        if (nextWorkflowId) {
          router.push(`/workspace/${workspaceId}/w/${nextWorkflowId}`)
        } else {
          router.push(`/workspace/${workspaceId}/w`)
        }
      }

      await Promise.all(workflowIdsToDelete.map((id) => removeWorkflow(id)))

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
  }, [workflowIds, isDeleting, workflows, workspaceId, isActive, router, removeWorkflow, onSuccess])

  return {
    isDeleting,
    handleDeleteWorkflow,
  }
}
