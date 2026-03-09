import { useCallback, useMemo } from 'react'
import { useFolderStore } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

interface UseCanDeleteProps {
  /**
   * Current workspace ID
   */
  workspaceId: string
}

interface UseCanDeleteReturn {
  /**
   * Checks if the given workflow IDs can be deleted.
   * Returns false if deleting them would leave no workflows in the workspace.
   */
  canDeleteWorkflows: (workflowIds: string[]) => boolean
  /**
   * Checks if the given folder can be deleted.
   * Returns false if deleting it would leave no workflows in the workspace.
   */
  canDeleteFolder: (folderId: string) => boolean
  /**
   * Total number of workflows in the workspace.
   */
  totalWorkflows: number
}

/**
 * Hook for checking if workflows or folders can be deleted.
 * Prevents deletion if it would leave the workspace with no workflows.
 *
 * Uses pre-computed lookup maps for O(1) access instead of repeated filter() calls.
 *
 * @param props - Hook configuration
 * @returns Functions to check deletion eligibility
 */
export function useCanDelete({ workspaceId }: UseCanDeleteProps): UseCanDeleteReturn {
  const { workflows } = useWorkflowRegistry()
  const { folders } = useFolderStore()

  /**
   * Pre-computed data structures for efficient lookups
   */
  const { totalWorkflows, workflowIdSet, workflowsByFolderId, childFoldersByParentId } =
    useMemo(() => {
      const workspaceWorkflows = Object.values(workflows).filter(
        (w) => w.workspaceId === workspaceId
      )

      const idSet = new Set(workspaceWorkflows.map((w) => w.id))

      const byFolderId = new Map<string, number>()
      for (const w of workspaceWorkflows) {
        if (w.folderId) {
          byFolderId.set(w.folderId, (byFolderId.get(w.folderId) || 0) + 1)
        }
      }

      const childrenByParent = new Map<string, string[]>()
      for (const folder of Object.values(folders)) {
        if (folder.workspaceId === workspaceId && folder.parentId) {
          const children = childrenByParent.get(folder.parentId) || []
          children.push(folder.id)
          childrenByParent.set(folder.parentId, children)
        }
      }

      return {
        totalWorkflows: workspaceWorkflows.length,
        workflowIdSet: idSet,
        workflowsByFolderId: byFolderId,
        childFoldersByParentId: childrenByParent,
      }
    }, [workflows, folders, workspaceId])

  /**
   * Count workflows in a folder and all its subfolders recursively.
   * Uses pre-computed maps for efficient lookups.
   */
  const countWorkflowsInFolder = useCallback(
    (folderId: string): number => {
      let count = workflowsByFolderId.get(folderId) || 0

      const childFolders = childFoldersByParentId.get(folderId)
      if (childFolders) {
        for (const childId of childFolders) {
          count += countWorkflowsInFolder(childId)
        }
      }

      return count
    },
    [workflowsByFolderId, childFoldersByParentId]
  )

  /**
   * Check if the given workflow IDs can be deleted.
   * Returns false if deleting would remove all workflows from the workspace.
   */
  const canDeleteWorkflows = useCallback(
    (workflowIds: string[]): boolean => {
      const workflowsToDelete = workflowIds.filter((id) => workflowIdSet.has(id)).length

      // Must have at least one workflow remaining after deletion
      return totalWorkflows > 0 && workflowsToDelete < totalWorkflows
    },
    [totalWorkflows, workflowIdSet]
  )

  /**
   * Check if the given folder can be deleted.
   * Empty folders are always deletable. Folders containing all workspace workflows are not.
   */
  const canDeleteFolder = useCallback(
    (folderId: string): boolean => {
      const workflowsInFolder = countWorkflowsInFolder(folderId)

      if (workflowsInFolder === 0) return true
      return workflowsInFolder < totalWorkflows
    },
    [totalWorkflows, countWorkflowsInFolder]
  )

  return {
    canDeleteWorkflows,
    canDeleteFolder,
    totalWorkflows,
  }
}
