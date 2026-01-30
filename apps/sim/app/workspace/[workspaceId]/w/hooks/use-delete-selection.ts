import { useCallback, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useRouter } from 'next/navigation'
import { useDeleteFolderMutation } from '@/hooks/queries/folders'
import { useFolderStore } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('useDeleteSelection')

interface UseDeleteSelectionProps {
  /**
   * Current workspace ID
   */
  workspaceId: string
  /**
   * Workflow IDs to delete
   */
  workflowIds: string[]
  /**
   * Folder IDs to delete
   */
  folderIds: string[]
  /**
   * Function to check if a workflow ID is the active workflow
   */
  isActiveWorkflow?: (id: string) => boolean
  /**
   * Optional callback after successful deletion
   */
  onSuccess?: () => void
}

/**
 * Hook for managing unified deletion of workflows and folders.
 * Handles mixed selection by deleting folders first (which may contain workflows),
 * then deleting standalone workflows.
 *
 * @param props - Hook configuration
 * @returns Delete selection handlers and state
 */
export function useDeleteSelection({
  workspaceId,
  workflowIds,
  folderIds,
  isActiveWorkflow,
  onSuccess,
}: UseDeleteSelectionProps) {
  const router = useRouter()
  const { workflows, removeWorkflow } = useWorkflowRegistry()
  const deleteFolderMutation = useDeleteFolderMutation()
  const [isDeleting, setIsDeleting] = useState(false)

  /**
   * Delete all selected folders and workflows
   */
  const handleDeleteSelection = useCallback(async () => {
    if (isDeleting) {
      return
    }

    const hasWorkflows = workflowIds.length > 0
    const hasFolders = folderIds.length > 0

    if (!hasWorkflows && !hasFolders) {
      return
    }

    setIsDeleting(true)
    try {
      const activeWorkflowBeingDeleted = isActiveWorkflow
        ? workflowIds.some((id) => isActiveWorkflow(id))
        : false

      const sidebarWorkflows = Object.values(workflows).filter((w) => w.workspaceId === workspaceId)

      const workflowsInFolders = sidebarWorkflows
        .filter((w) => w.folderId && folderIds.includes(w.folderId))
        .map((w) => w.id)

      const allWorkflowsToDelete = [...new Set([...workflowIds, ...workflowsInFolders])]

      const activeInDeletedFolder = isActiveWorkflow
        ? workflowsInFolders.some((id) => isActiveWorkflow(id))
        : false

      const needsNavigation = activeWorkflowBeingDeleted || activeInDeletedFolder

      let nextWorkflowId: string | null = null
      if (needsNavigation && sidebarWorkflows.length > allWorkflowsToDelete.length) {
        const remainingWorkflows = sidebarWorkflows.filter(
          (w) => !allWorkflowsToDelete.includes(w.id)
        )

        if (remainingWorkflows.length > 0) {
          const activeId = isActiveWorkflow
            ? workflowIds.find((id) => isActiveWorkflow(id)) ||
              workflowsInFolders.find((id) => isActiveWorkflow(id))
            : null

          if (activeId) {
            const currentIndex = sidebarWorkflows.findIndex((w) => w.id === activeId)
            const workflowsAfterCurrent = remainingWorkflows.filter((w) => {
              const idx = sidebarWorkflows.findIndex((sw) => sw.id === w.id)
              return idx > currentIndex
            })

            nextWorkflowId =
              workflowsAfterCurrent.length > 0
                ? workflowsAfterCurrent[0].id
                : remainingWorkflows[0].id
          } else {
            nextWorkflowId = remainingWorkflows[0].id
          }
        }
      }

      if (needsNavigation) {
        if (nextWorkflowId) {
          router.push(`/workspace/${workspaceId}/w/${nextWorkflowId}`)
        } else {
          router.push(`/workspace/${workspaceId}/w`)
        }
      }

      for (const folderId of folderIds) {
        await deleteFolderMutation.mutateAsync({ id: folderId, workspaceId })
      }

      const standaloneWorkflowIds = workflowIds.filter((id) => !workflowsInFolders.includes(id))
      await Promise.all(standaloneWorkflowIds.map((id) => removeWorkflow(id)))

      const { clearSelection, clearFolderSelection } = useFolderStore.getState()
      clearSelection()
      clearFolderSelection()

      logger.info('Selection deleted successfully', {
        workflowIds: standaloneWorkflowIds,
        folderIds,
        totalWorkflowsDeleted: allWorkflowsToDelete.length,
      })

      onSuccess?.()
    } catch (error) {
      logger.error('Error deleting selection:', { error })
      throw error
    } finally {
      setIsDeleting(false)
    }
  }, [
    workflowIds,
    folderIds,
    isDeleting,
    workflows,
    workspaceId,
    isActiveWorkflow,
    router,
    removeWorkflow,
    deleteFolderMutation,
    onSuccess,
  ])

  return {
    isDeleting,
    handleDeleteSelection,
  }
}
