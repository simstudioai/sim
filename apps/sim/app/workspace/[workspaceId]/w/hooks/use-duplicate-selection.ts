import { useCallback, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useRouter } from 'next/navigation'
import { getNextWorkflowColor } from '@/lib/workflows/colors'
import { useDuplicateFolderMutation } from '@/hooks/queries/folders'
import { useDuplicateWorkflowMutation } from '@/hooks/queries/workflows'
import { useFolderStore } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('useDuplicateSelection')

interface UseDuplicateSelectionProps {
  /**
   * Current workspace ID
   */
  workspaceId: string
  /**
   * Optional callback after successful duplication
   */
  onSuccess?: () => void
}

/**
 * Hook for managing unified duplication of workflows and folders.
 * Handles mixed selection by duplicating all selected items.
 *
 * @param props - Hook configuration
 * @returns Duplicate selection handlers and state
 */
export function useDuplicateSelection({ workspaceId, onSuccess }: UseDuplicateSelectionProps) {
  const router = useRouter()
  const duplicateWorkflowMutation = useDuplicateWorkflowMutation()
  const duplicateFolderMutation = useDuplicateFolderMutation()
  const [isDuplicating, setIsDuplicating] = useState(false)

  const workspaceIdRef = useRef(workspaceId)
  workspaceIdRef.current = workspaceId

  const onSuccessRef = useRef(onSuccess)
  onSuccessRef.current = onSuccess

  const generateDuplicateFolderName = useCallback((baseName: string, siblingNames: Set<string>) => {
    const trimmedName = (baseName || 'Untitled Folder').trim()
    let candidate = `${trimmedName} Copy`
    let counter = 2

    while (siblingNames.has(candidate)) {
      candidate = `${trimmedName} Copy ${counter}`
      counter += 1
    }

    return candidate
  }, [])

  /**
   * Duplicate all selected workflows and folders
   */
  const handleDuplicateSelection = useCallback(
    async (workflowIds: string[], folderIds: string[]) => {
      if (isDuplicating) return
      if (workflowIds.length === 0 && folderIds.length === 0) return

      setIsDuplicating(true)
      try {
        const { workflows } = useWorkflowRegistry.getState()
        const folderStore = useFolderStore.getState()

        const duplicatedWorkflowIds: string[] = []
        const duplicatedFolderIds: string[] = []

        for (const folderId of folderIds) {
          const folder = folderStore.getFolderById(folderId)
          if (!folder) {
            logger.warn(`Folder ${folderId} not found, skipping`)
            continue
          }

          const siblingNames = new Set(
            folderStore.getChildFolders(folder.parentId).map((sibling) => sibling.name)
          )
          siblingNames.add(folder.name)

          const duplicateName = generateDuplicateFolderName(folder.name, siblingNames)

          const result = await duplicateFolderMutation.mutateAsync({
            id: folderId,
            workspaceId: workspaceIdRef.current,
            name: duplicateName,
            parentId: folder.parentId,
            color: folder.color,
          })

          if (result?.id) {
            duplicatedFolderIds.push(result.id)
          }
        }

        for (const workflowId of workflowIds) {
          const workflow = workflows[workflowId]
          if (!workflow) {
            logger.warn(`Workflow ${workflowId} not found, skipping`)
            continue
          }

          const result = await duplicateWorkflowMutation.mutateAsync({
            workspaceId: workspaceIdRef.current,
            sourceId: workflowId,
            name: `${workflow.name} (Copy)`,
            description: workflow.description,
            color: getNextWorkflowColor(),
            folderId: workflow.folderId,
          })

          duplicatedWorkflowIds.push(result.id)
        }

        const { clearSelection, clearFolderSelection } = useFolderStore.getState()
        clearSelection()
        clearFolderSelection()

        logger.info('Selection duplicated successfully', {
          workflowIds,
          folderIds,
          duplicatedWorkflowIds,
          duplicatedFolderIds,
        })

        if (duplicatedWorkflowIds.length === 1 && duplicatedFolderIds.length === 0) {
          router.push(`/workspace/${workspaceIdRef.current}/w/${duplicatedWorkflowIds[0]}`)
        }

        onSuccessRef.current?.()
      } catch (error) {
        logger.error('Error duplicating selection:', { error })
        throw error
      } finally {
        setIsDuplicating(false)
      }
    },
    [
      isDuplicating,
      generateDuplicateFolderName,
      duplicateFolderMutation,
      duplicateWorkflowMutation,
      router,
    ]
  )

  return {
    isDuplicating,
    handleDuplicateSelection,
  }
}
