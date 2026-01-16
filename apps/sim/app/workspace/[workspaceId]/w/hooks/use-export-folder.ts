import { useCallback, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import {
  downloadFile,
  exportFolderToZip,
  type FolderExportData,
  fetchWorkflowForExport,
  sanitizePathSegment,
  type WorkflowExportData,
} from '@/lib/workflows/operations/import-export'
import { useFolderStore } from '@/stores/folders/store'
import type { WorkflowFolder } from '@/stores/folders/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

const logger = createLogger('useExportFolder')

interface UseExportFolderProps {
  /**
   * The folder ID to export
   */
  folderId: string
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
 * Collects all subfolders recursively under a root folder.
 * Returns folders with parentId adjusted so direct children of rootFolderId have parentId: null.
 */
function collectSubfolders(
  rootFolderId: string,
  folders: Record<string, WorkflowFolder>
): FolderExportData[] {
  const subfolders: FolderExportData[] = []

  function collect(parentId: string) {
    for (const folder of Object.values(folders)) {
      if (folder.parentId === parentId) {
        subfolders.push({
          id: folder.id,
          name: folder.name,
          // Direct children of root become top-level in export (parentId: null)
          parentId: folder.parentId === rootFolderId ? null : folder.parentId,
        })
        collect(folder.id)
      }
    }
  }

  collect(rootFolderId)
  return subfolders
}

/**
 * Hook for managing folder export to ZIP.
 */
export function useExportFolder({ folderId, onSuccess }: UseExportFolderProps) {
  const { workflows } = useWorkflowRegistry()
  const { folders } = useFolderStore()
  const [isExporting, setIsExporting] = useState(false)

  const hasWorkflows = useMemo(() => {
    if (!folderId) return false
    return collectWorkflowsInFolder(folderId, workflows, folders).length > 0
  }, [folderId, workflows, folders])

  const handleExportFolder = useCallback(async () => {
    if (isExporting || !folderId) {
      return
    }

    setIsExporting(true)
    try {
      const folderStore = useFolderStore.getState()
      const folder = folderStore.getFolderById(folderId)

      if (!folder) {
        logger.warn('Folder not found for export', { folderId })
        return
      }

      const workflowsToExport = collectWorkflowsInFolder(folderId, workflows, folderStore.folders)

      if (workflowsToExport.length === 0) {
        logger.warn('No workflows found in folder to export', { folderId, folderName: folder.name })
        return
      }

      const subfolders = collectSubfolders(folderId, folderStore.folders)

      logger.info('Starting folder export', {
        folderId,
        folderName: folder.name,
        workflowCount: workflowsToExport.length,
        subfolderCount: subfolders.length,
      })

      const workflowExportData: WorkflowExportData[] = []

      for (const collectedWorkflow of workflowsToExport) {
        const workflowMeta = workflows[collectedWorkflow.id]
        if (!workflowMeta) {
          logger.warn(`Workflow ${collectedWorkflow.id} not found in registry`)
          continue
        }

        const remappedFolderId =
          collectedWorkflow.folderId === folderId ? null : collectedWorkflow.folderId

        const exportData = await fetchWorkflowForExport(collectedWorkflow.id, {
          name: workflowMeta.name,
          description: workflowMeta.description,
          color: workflowMeta.color,
          folderId: remappedFolderId,
        })

        if (exportData) {
          workflowExportData.push(exportData)
          logger.info(`Workflow ${collectedWorkflow.id} prepared for export`)
        }
      }

      if (workflowExportData.length === 0) {
        logger.warn('No workflows were successfully prepared for export', {
          folderId,
          folderName: folder.name,
        })
        return
      }

      const zipBlob = await exportFolderToZip(folder.name, workflowExportData, subfolders)
      const zipFilename = `${sanitizePathSegment(folder.name)}-export.zip`
      downloadFile(zipBlob, zipFilename, 'application/zip')

      const { clearSelection } = useFolderStore.getState()
      clearSelection()

      logger.info('Folder exported successfully', {
        folderId,
        folderName: folder.name,
        workflowCount: workflowExportData.length,
        subfolderCount: subfolders.length,
      })

      onSuccess?.()
    } catch (error) {
      logger.error('Error exporting folder:', { error })
      throw error
    } finally {
      setIsExporting(false)
    }
  }, [folderId, isExporting, workflows, folders, onSuccess])

  return {
    isExporting,
    hasWorkflows,
    handleExportFolder,
  }
}
