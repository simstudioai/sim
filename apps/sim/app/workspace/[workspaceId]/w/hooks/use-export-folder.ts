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
   * The folder ID to export
   */
  folderId: string
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

  for (const workflow of Object.values(workflows)) {
    if (workflow.folderId === folderId) {
      workflowIds.push(workflow.id)
    }
  }

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
 * @param props - Hook configuration
 * @returns Export folder handlers and state
 */
export function useExportFolder({ workspaceId, folderId, onSuccess }: UseExportFolderProps) {
  const { workflows } = useWorkflowRegistry()
  const { folders } = useFolderStore()
  const [isExporting, setIsExporting] = useState(false)

  /**
   * Check if the folder has any workflows (recursively)
   */
  const hasWorkflows = useMemo(() => {
    if (!folderId) return false
    return collectWorkflowsInFolder(folderId, workflows, folders).length > 0
  }, [folderId, workflows, folders])

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

    if (!folderId) {
      logger.warn('No folder ID provided for export')
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

      for (const workflowId of workflowIdsToExport) {
        try {
          const workflow = workflows[workflowId]
          if (!workflow) {
            logger.warn(`Workflow ${workflowId} not found in registry`)
            continue
          }

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

          const variablesResponse = await fetch(`/api/workflows/${workflowId}/variables`)
          let workflowVariables: Record<string, Variable> | undefined
          if (variablesResponse.ok) {
            const variablesData = await variablesResponse.json()
            workflowVariables = variablesData?.data
          }

          const workflowState = {
            ...workflowData.state,
            metadata: {
              name: workflow.name,
              description: workflow.description,
              color: workflow.color,
              sortOrder: workflow.sortOrder,
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

      const zip = new JSZip()
      const seenFilenames = new Set<string>()

      for (const exportedWorkflow of exportedWorkflows) {
        const baseName = exportedWorkflow.name.replace(/[^a-z0-9]/gi, '-')
        let filename = `${baseName}.json`
        let counter = 1
        while (seenFilenames.has(filename.toLowerCase())) {
          filename = `${baseName}-${counter}.json`
          counter++
        }
        seenFilenames.add(filename.toLowerCase())
        zip.file(filename, exportedWorkflow.content)
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const zipFilename = `${folder.name.replace(/[^a-z0-9]/gi, '-')}-export.zip`
      downloadFile(zipBlob, zipFilename, 'application/zip')

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
  }, [folderId, isExporting, workflows, folders, onSuccess])

  return {
    isExporting,
    hasWorkflows,
    handleExportFolder,
  }
}
