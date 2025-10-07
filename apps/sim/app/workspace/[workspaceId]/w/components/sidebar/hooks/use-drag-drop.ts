import { useCallback, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import { useFolderStore } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('WorkflowList:DragDrop')

/**
 * Custom hook for handling drag and drop operations for workflows and folders
 */
export function useDragDrop() {
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null)
  const [rootDragOver, setRootDragOver] = useState(false)

  const { updateFolderAPI, getFolderPath } = useFolderStore()
  const { updateWorkflow } = useWorkflowRegistry()

  /**
   * Moves one or more workflows to a target folder
   */
  const handleWorkflowDrop = useCallback(
    async (workflowIds: string[], targetFolderId: string | null) => {
      try {
        for (const workflowId of workflowIds) {
          await updateWorkflow(workflowId, { folderId: targetFolderId })
        }
        logger.info(`Moved ${workflowIds.length} workflow(s)`)
      } catch (error) {
        logger.error('Failed to move workflows:', error)
      }
    },
    [updateWorkflow]
  )

  /**
   * Moves a folder to a new parent folder, with validation
   */
  const handleFolderMove = useCallback(
    async (draggedFolderId: string, targetFolderId: string | null) => {
      try {
        const folderStore = useFolderStore.getState()
        const draggedFolderPath = folderStore.getFolderPath(draggedFolderId)

        // Prevent moving folder into its own descendant
        if (
          targetFolderId &&
          draggedFolderPath.some((ancestor) => ancestor.id === targetFolderId)
        ) {
          logger.info('Cannot move folder into its own descendant')
          return
        }

        await updateFolderAPI(draggedFolderId, { parentId: targetFolderId })
        logger.info(`Moved folder to ${targetFolderId ? `folder ${targetFolderId}` : 'root'}`)
      } catch (error) {
        logger.error('Failed to move folder:', error)
      }
    },
    [updateFolderAPI]
  )

  /**
   * Handles drop events for both workflows and folders
   */
  const handleFolderDrop = useCallback(
    async (e: React.DragEvent, targetFolderId: string | null) => {
      e.preventDefault()
      e.stopPropagation()
      setDragOverFolderId(null)
      setRootDragOver(false)

      // Check if dropping workflows
      const workflowIdsData = e.dataTransfer.getData('workflow-ids')
      if (workflowIdsData) {
        const workflowIds = JSON.parse(workflowIdsData) as string[]
        await handleWorkflowDrop(workflowIds, targetFolderId)
        return
      }

      // Check if dropping a folder
      const folderIdData = e.dataTransfer.getData('folder-id')
      if (folderIdData && targetFolderId !== folderIdData) {
        await handleFolderMove(folderIdData, targetFolderId)
      }
    },
    [handleWorkflowDrop, handleFolderMove]
  )

  /**
   * Creates drag event handlers for a specific folder
   */
  const createFolderDragHandlers = useCallback(
    (folderId: string) => ({
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setDragOverFolderId(folderId)
      },
      onDragLeave: (e: React.DragEvent) => {
        e.preventDefault()
        e.stopPropagation()
        setDragOverFolderId(null)
      },
      onDrop: (e: React.DragEvent) => handleFolderDrop(e, folderId),
    }),
    [handleFolderDrop]
  )

  /**
   * Creates drag event handlers for the root drop zone
   */
  const createRootDragHandlers = useCallback(
    () => ({
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault()
        setRootDragOver(true)
      },
      onDragLeave: (e: React.DragEvent) => {
        e.preventDefault()
        setRootDragOver(false)
      },
      onDrop: (e: React.DragEvent) => handleFolderDrop(e, null),
    }),
    [handleFolderDrop]
  )

  return {
    dragOverFolderId,
    rootDragOver,
    createFolderDragHandlers,
    createRootDragHandlers,
  }
}
