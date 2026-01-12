import { useCallback, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import JSZip from 'jszip'
import { sanitizeForExport } from '@/lib/workflows/sanitization/json-sanitizer'
import { useFolderStore } from '@/stores/folders/store'
import type { WorkflowFolder } from '@/stores/folders/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'
import type { Variable } from '@/stores/workflows/workflow/types'

const logger = createLogger('useExportFolder')

interface UseExportFolderProps {
  /**
   * Current workspace ID
   */
  workspaceId: string
  /**
   * Function that returns the folder ID to export
   * This function is called when export occurs to get fresh state
   */
  getFolderId: () => string
  /**
   * Optional callback after successful export
   */
  onSuccess?: () => void
}

/**
 * Recursively collects all workflow IDs within a folder and its subfolders.
 *
 * @param folderId - The folder ID to collect workflows from
 * @param workflows - All workflows in the workspace
 * @param folders - All folders in the workspace
 * @returns Array of workflow IDs
 */
function collectWorkflowsInFolder(
  folderId: string,
  workflows: Record<string, WorkflowMetadata>,
  folders: Record<string, WorkflowFolder>
): string[] {
  const workflowIds: string[] = []

  // Get workflows directly in this folder
  for (const workflow of Object.values(workflows)) {
    if (workflow.folderId === folderId) {
      workflowIds.push(workflow.id)
    }
  }

  // Recursively get workflows from child folders
  for (const folder of Object.values(folders)) {
    if (folder.parentId === folderId) {
      const childWorkflowIds = collectWorkflowsInFolder(folder.id, workflows, folders)
      workflowIds.push(...childWorkflowIds)
    }
  }

  return workflowIds
}

/**
 * Hook for managing folder export to ZIP.
 *
 * Handles:
 * - Collecting all workflows within a folder (including nested subfolders)
 * - Fetching workflow data and variables from API
 * - Sanitizing workflow state for export
 * - Downloading as ZIP file
 * - Loading state management
 * - Error handling and logging
 * - Clearing selection after export
 *
 * @param props - Hook configuration
 * @returns Export folder handlers and state
 */
export function useExportFolder({ workspaceId, getFolderId, onSuccess }: UseExportFolderProps) {
  const { workflows } = useWorkflowRegistry()
  const { folders } = useFolderStore()
  const [isExporting, setIsExporting] = useState(false)

  /**
   * Check if the folder has any workflows (recursively)
   */
  const hasWorkflows = useMemo(() => {
    const folderId = getFolderId()
    if (!folderId) return false
    return collectWorkflowsInFolder(folderId, workflows, folders).length > 0
  }, [getFolderId, workflows, folders])

  /**
   * Download file helper
   */
  const downloadFile = (content: Blob, filename: string, mimeType = 'application/zip') => {
    try {
      const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (error) {
      logger.error('Failed to download file:', error)
    }
  }

  /**
   * Export all workflows in the folder (including nested subfolders) to ZIP
   */
  const handleExportFolder = useCallback(async () => {
    if (isExporting) {
      return
    }

    setIsExporting(true)
    try {
      // Get fresh folder ID at export time
      const folderId = getFolderId()
      if (!folderId) {
        logger.warn('No folder ID provided for export')
        return
      }

      const folderStore = useFolderStore.getState()
      const folder = folderStore.getFolderById(folderId)

      if (!folder) {
        logger.warn('Folder not found for export', { folderId })
        return
      }

      // Collect all workflow IDs recursively
      const workflowIdsToExport = collectWorkflowsInFolder(folderId, workflows, folderStore.folders)

      if (workflowIdsToExport.length === 0) {
        logger.warn('No workflows found in folder to export', { folderId, folderName: folder.name })
        return
      }

      logger.info('Starting folder export', {
        folderId,
        folderName: folder.name,
        workflowCount: workflowIdsToExport.length,
      })

      const exportedWorkflows: Array<{ name: string; content: string }> = []

      // Export each workflow
      for (const workflowId of workflowIdsToExport) {
        try {
          const workflow = workflows[workflowId]
          if (!workflow) {
            logger.warn(`Workflow ${workflowId} not found in registry`)
            continue
          }

          // Fetch workflow state from API
          const workflowResponse = await fetch(`/api/workflows/${workflowId}`)
          if (!workflowResponse.ok) {
            logger.error(`Failed to fetch workflow ${workflowId}`)
            continue
          }

          const { data: workflowData } = await workflowResponse.json()
          if (!workflowData?.state) {
            logger.warn(`Workflow ${workflowId} has no state`)
            continue
          }

          // Fetch workflow variables (API returns Record format directly)
          const variablesResponse = await fetch(`/api/workflows/${workflowId}/variables`)
          let workflowVariables: Record<string, Variable> | undefined
          if (variablesResponse.ok) {
            const variablesData = await variablesResponse.json()
            workflowVariables = variablesData?.data
          }

          // Prepare export state
          const workflowState = {
            ...workflowData.state,
            metadata: {
              name: workflow.name,
              description: workflow.description,
              color: workflow.color,
              exportedAt: new Date().toISOString(),
            },
            variables: workflowVariables,
          }

          const exportState = sanitizeForExport(workflowState)
          const jsonString = JSON.stringify(exportState, null, 2)

          exportedWorkflows.push({
            name: workflow.name,
            content: jsonString,
          })

          logger.info(`Workflow ${workflowId} exported successfully`)
        } catch (error) {
          logger.error(`Failed to export workflow ${workflowId}:`, error)
        }
      }

      if (exportedWorkflows.length === 0) {
        logger.warn('No workflows were successfully exported from folder', {
          folderId,
          folderName: folder.name,
        })
        return
      }

      // Always export as ZIP for folders (even with single workflow)
      const zip = new JSZip()

      for (const exportedWorkflow of exportedWorkflows) {
        const filename = `${exportedWorkflow.name.replace(/[^a-z0-9]/gi, '-')}.json`
        zip.file(filename, exportedWorkflow.content)
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const zipFilename = `${folder.name.replace(/[^a-z0-9]/gi, '-')}-export.zip`
      downloadFile(zipBlob, zipFilename, 'application/zip')

      // Clear selection after successful export
      const { clearSelection } = useFolderStore.getState()
      clearSelection()

      logger.info('Folder exported successfully', {
        folderId,
        folderName: folder.name,
        workflowCount: exportedWorkflows.length,
      })

      onSuccess?.()
    } catch (error) {
      logger.error('Error exporting folder:', { error })
      throw error
    } finally {
      setIsExporting(false)
    }
  }, [getFolderId, isExporting, workflows, onSuccess])

  return {
    isExporting,
    hasWorkflows,
    handleExportFolder,
  }
}
