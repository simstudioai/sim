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

/**
 * Sanitizes a string for use as a path segment in a ZIP file.
 */
function sanitizePathSegment(name: string): string {
  return name.replace(/[^a-z0-9-_]/gi, '-')
}

/**
 * Builds a folder path relative to a root folder.
 * Returns an empty string if the folder is the root folder itself.
 */
function buildRelativeFolderPath(
  folderId: string | null | undefined,
  folders: Record<string, WorkflowFolder>,
  rootFolderId: string
): string {
  if (!folderId || folderId === rootFolderId) return ''

  const path: string[] = []
  let currentId: string | null = folderId

  while (currentId && currentId !== rootFolderId) {
    const folder: WorkflowFolder | undefined = folders[currentId]
    if (!folder) break
    path.unshift(sanitizePathSegment(folder.name))
    currentId = folder.parentId
  }

  return path.join('/')
}

/**
 * Collects all subfolders recursively under a root folder.
 */
function collectSubfolders(
  rootFolderId: string,
  folders: Record<string, WorkflowFolder>
): Array<{ id: string; name: string; parentId: string | null }> {
  const subfolders: Array<{ id: string; name: string; parentId: string | null }> = []

  function collect(parentId: string) {
    for (const folder of Object.values(folders)) {
      if (folder.parentId === parentId) {
        subfolders.push({
          id: folder.id,
          name: folder.name,
          parentId: folder.parentId === rootFolderId ? null : folder.parentId,
        })
        collect(folder.id)
      }
    }
  }

  collect(rootFolderId)
  return subfolders
}

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
 *
 * @param folderId - The folder ID to collect workflows from
 * @param workflows - All workflows in the workspace
 * @param folders - All folders in the workspace
 * @returns Array of workflow objects with id and folderId
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
 * Hook for managing folder export to ZIP.
 *
 * @param props - Hook configuration
 * @returns Export folder handlers and state
 */
export function useExportFolder({ folderId, onSuccess }: UseExportFolderProps) {
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
   * Export all workflows in the folder (including nested subfolders) to ZIP.
   * Preserves the nested folder structure within the ZIP file.
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

      const exportedWorkflows: Array<{
        name: string
        content: string
        folderId: string | null
        folderPath: string
      }> = []

      for (const collectedWorkflow of workflowsToExport) {
        try {
          const workflow = workflows[collectedWorkflow.id]
          if (!workflow) {
            logger.warn(`Workflow ${collectedWorkflow.id} not found in registry`)
            continue
          }

          const workflowResponse = await fetch(`/api/workflows/${collectedWorkflow.id}`)
          if (!workflowResponse.ok) {
            logger.error(`Failed to fetch workflow ${collectedWorkflow.id}`)
            continue
          }

          const { data: workflowData } = await workflowResponse.json()
          if (!workflowData?.state) {
            logger.warn(`Workflow ${collectedWorkflow.id} has no state`)
            continue
          }

          const variablesResponse = await fetch(`/api/workflows/${collectedWorkflow.id}/variables`)
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
              exportedAt: new Date().toISOString(),
            },
            variables: workflowVariables,
          }

          const exportState = sanitizeForExport(workflowState)
          const jsonString = JSON.stringify(exportState, null, 2)

          const relativeFolderPath = buildRelativeFolderPath(
            collectedWorkflow.folderId,
            folderStore.folders,
            folderId
          )

          exportedWorkflows.push({
            name: workflow.name,
            content: jsonString,
            folderId: collectedWorkflow.folderId,
            folderPath: relativeFolderPath,
          })

          logger.info(`Workflow ${collectedWorkflow.id} exported successfully`, {
            folderPath: relativeFolderPath || '(root)',
          })
        } catch (error) {
          logger.error(`Failed to export workflow ${collectedWorkflow.id}:`, error)
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

      const folderMetadata = {
        folder: {
          name: folder.name,
          exportedAt: new Date().toISOString(),
        },
        folders: subfolders,
      }
      zip.file('_folder.json', JSON.stringify(folderMetadata, null, 2))

      const seenFilenames = new Set<string>()

      for (const exportedWorkflow of exportedWorkflows) {
        const baseName = sanitizePathSegment(exportedWorkflow.name)
        let filename = `${baseName}.json`
        let counter = 1

        const fullPath = exportedWorkflow.folderPath
          ? `${exportedWorkflow.folderPath}/${filename}`
          : filename

        let uniqueFullPath = fullPath
        while (seenFilenames.has(uniqueFullPath.toLowerCase())) {
          filename = `${baseName}-${counter}.json`
          uniqueFullPath = exportedWorkflow.folderPath
            ? `${exportedWorkflow.folderPath}/${filename}`
            : filename
          counter++
        }
        seenFilenames.add(uniqueFullPath.toLowerCase())
        zip.file(uniqueFullPath, exportedWorkflow.content)
      }

      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const zipFilename = `${sanitizePathSegment(folder.name)}-export.zip`
      downloadFile(zipBlob, zipFilename, 'application/zip')

      const { clearSelection } = useFolderStore.getState()
      clearSelection()

      logger.info('Folder exported successfully', {
        folderId,
        folderName: folder.name,
        workflowCount: exportedWorkflows.length,
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
