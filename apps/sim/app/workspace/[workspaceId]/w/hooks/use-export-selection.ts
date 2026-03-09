import { useCallback, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import {
  downloadFile,
  exportWorkflowsToZip,
  type FolderExportData,
  fetchWorkflowForExport,
  type WorkflowExportData,
} from '@/lib/workflows/operations/import-export'
import { useFolderStore } from '@/stores/folders/store'
import type { WorkflowFolder } from '@/stores/folders/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

const logger = createLogger('useExportSelection')

interface UseExportSelectionProps {
  /**
   * Optional callback after successful export
   */
  onSuccess?: () => void
}

interface CollectedWorkflow {
  id: string
  folderId: string | null
}

/**
 * Recursively collects all workflows within a folder and its subfolders.
 */
function collectWorkflowsInFolder(
  folderId: string,
  workflows: Record<string, WorkflowMetadata>,
  folders: Record<string, WorkflowFolder>
): CollectedWorkflow[] {
  const collectedWorkflows: CollectedWorkflow[] = []

  for (const workflow of Object.values(workflows)) {
    if (workflow.folderId === folderId) {
      collectedWorkflows.push({ id: workflow.id, folderId: workflow.folderId ?? null })
    }
  }

  for (const folder of Object.values(folders)) {
    if (folder.parentId === folderId) {
      const childWorkflows = collectWorkflowsInFolder(folder.id, workflows, folders)
      collectedWorkflows.push(...childWorkflows)
    }
  }

  return collectedWorkflows
}

/**
 * Collects all subfolders recursively under multiple root folders.
 */
function collectSubfoldersForMultipleFolders(
  rootFolderIds: string[],
  folders: Record<string, WorkflowFolder>
): FolderExportData[] {
  const subfolders: FolderExportData[] = []

  function collect(parentId: string, isRootLevel: boolean) {
    for (const folder of Object.values(folders)) {
      if (folder.parentId === parentId) {
        subfolders.push({
          id: folder.id,
          name: folder.name,
          parentId: isRootLevel ? null : folder.parentId,
        })
        collect(folder.id, false)
      }
    }
  }

  for (const folderId of rootFolderIds) {
    collect(folderId, true)
  }

  return subfolders
}

/**
 * Hook for managing unified export of workflows and folders.
 * Handles mixed selection by collecting all workflows from selected folders
 * and combining with directly selected workflows.
 */
export function useExportSelection({ onSuccess }: UseExportSelectionProps = {}) {
  const [isExporting, setIsExporting] = useState(false)

  const onSuccessRef = useRef(onSuccess)
  onSuccessRef.current = onSuccess

  /**
   * Export all selected workflows and folders to a ZIP file.
   * - Collects workflows from selected folders recursively
   * - Deduplicates workflows that exist in both direct selection and folder contents
   * - Preserves folder structure in the export
   */
  const handleExportSelection = useCallback(
    async (workflowIds: string[], folderIds: string[]) => {
      if (isExporting) {
        return
      }

      const hasWorkflows = workflowIds.length > 0
      const hasFolders = folderIds.length > 0

      if (!hasWorkflows && !hasFolders) {
        return
      }

      setIsExporting(true)
      try {
        const { workflows } = useWorkflowRegistry.getState()
        const { folders } = useFolderStore.getState()

        const workflowsFromFolders: CollectedWorkflow[] = []
        for (const folderId of folderIds) {
          const collected = collectWorkflowsInFolder(folderId, workflows, folders)
          workflowsFromFolders.push(...collected)
        }

        const subfolders = collectSubfoldersForMultipleFolders(folderIds, folders)

        const selectedFoldersData: FolderExportData[] = folderIds.map((folderId) => {
          const folder = folders[folderId]
          return {
            id: folder.id,
            name: folder.name,
            parentId: null,
          }
        })

        const allFolders = [...selectedFoldersData, ...subfolders]
        const workflowIdsFromFolders = workflowsFromFolders.map((w) => w.id)
        const allWorkflowIds = [...new Set([...workflowIds, ...workflowIdsFromFolders])]

        if (allWorkflowIds.length === 0) {
          logger.warn('No workflows found to export')
          return
        }

        logger.info('Starting selection export', {
          directWorkflowCount: workflowIds.length,
          folderCount: folderIds.length,
          totalWorkflowCount: allWorkflowIds.length,
          subfolderCount: subfolders.length,
        })

        const workflowExportData: WorkflowExportData[] = []

        for (const workflowId of allWorkflowIds) {
          const workflowMeta = workflows[workflowId]
          if (!workflowMeta) {
            logger.warn(`Workflow ${workflowId} not found in registry`)
            continue
          }

          const exportData = await fetchWorkflowForExport(workflowId, {
            name: workflowMeta.name,
            description: workflowMeta.description,
            color: workflowMeta.color,
            folderId: workflowMeta.folderId ?? null,
          })

          if (exportData) {
            workflowExportData.push(exportData)
            logger.info(`Workflow ${workflowId} prepared for export`)
          }
        }

        if (workflowExportData.length === 0) {
          logger.warn('No workflows were successfully prepared for export')
          return
        }

        const zipBlob = await exportWorkflowsToZip(workflowExportData)
        const zipFilename = `selection-export-${Date.now()}.zip`
        downloadFile(zipBlob, zipFilename, 'application/zip')

        const { clearSelection, clearFolderSelection } = useFolderStore.getState()
        clearSelection()
        clearFolderSelection()

        logger.info('Selection exported successfully', {
          workflowCount: workflowExportData.length,
          folderCount: allFolders.length,
        })

        onSuccessRef.current?.()
      } catch (error) {
        logger.error('Error exporting selection:', { error })
        throw error
      } finally {
        setIsExporting(false)
      }
    },
    [isExporting]
  )

  return {
    isExporting,
    handleExportSelection,
  }
}
