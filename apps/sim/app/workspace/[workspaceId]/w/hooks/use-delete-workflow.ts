import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('useDeleteWorkflow')

interface UseDeleteWorkflowProps {
  /**
   * Current workspace ID
   */
  workspaceId: string
  /**
   * ID of the workflow to delete
   */
  workflowId: string
  /**
   * Whether this is the currently active workflow
   */
  isActive?: boolean
  /**
   * Optional callback after successful deletion
   */
  onSuccess?: () => void
}

/**
 * Hook for managing workflow deletion with navigation logic.
 *
 * Handles:
 * - Finding next workflow to navigate to
 * - Navigating before deletion (if active workflow)
 * - Removing workflow from registry
 * - Loading state management
 * - Error handling and logging
 *
 * @param props - Hook configuration
 * @returns Delete workflow handlers and state
 */
export function useDeleteWorkflow({
  workspaceId,
  workflowId,
  isActive = false,
  onSuccess,
}: UseDeleteWorkflowProps) {
  const router = useRouter()
  const { workflows, removeWorkflow } = useWorkflowRegistry()
  const [isDeleting, setIsDeleting] = useState(false)

  /**
   * Delete the workflow and navigate if needed
   */
  const handleDeleteWorkflow = useCallback(async () => {
    if (!workflowId || isDeleting) {
      return
    }

    setIsDeleting(true)
    try {
      // Find next workflow to navigate to
      const sidebarWorkflows = Object.values(workflows).filter((w) => w.workspaceId === workspaceId)
      const currentIndex = sidebarWorkflows.findIndex((w) => w.id === workflowId)

      let nextWorkflowId: string | null = null
      if (sidebarWorkflows.length > 1) {
        if (currentIndex < sidebarWorkflows.length - 1) {
          nextWorkflowId = sidebarWorkflows[currentIndex + 1].id
        } else if (currentIndex > 0) {
          nextWorkflowId = sidebarWorkflows[currentIndex - 1].id
        }
      }

      // Navigate first if this is the active workflow
      if (isActive) {
        if (nextWorkflowId) {
          router.push(`/workspace/${workspaceId}/w/${nextWorkflowId}`)
        } else {
          router.push(`/workspace/${workspaceId}/w`)
        }
      }

      // Then delete
      await removeWorkflow(workflowId)

      logger.info('Workflow deleted successfully', { workflowId })
      onSuccess?.()
    } catch (error) {
      logger.error('Error deleting workflow:', { error, workflowId })
      throw error
    } finally {
      setIsDeleting(false)
    }
  }, [workflowId, isDeleting, workflows, workspaceId, isActive, router, removeWorkflow, onSuccess])

  return {
    isDeleting,
    handleDeleteWorkflow,
  }
}
