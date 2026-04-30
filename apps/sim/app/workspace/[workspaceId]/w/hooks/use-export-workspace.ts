import { useCallback, useState } from 'react'
import { createLogger } from '@sim/logger'
import { requestJson } from '@/lib/api/client/request'
import {
  getWorkspaceContract,
  listFoldersContract,
  listWorkflowsContract,
} from '@/lib/api/contracts'
import {
  downloadFile,
  exportWorkspaceToZip,
  type FolderExportData,
  fetchWorkflowForExport,
  sanitizePathSegment,
  type WorkflowExportData,
} from '@/lib/workflows/operations/import-export'

const logger = createLogger('useExportWorkspace')

interface UseExportWorkspaceProps {
  /**
   * Optional callback after successful export
   */
  onSuccess?: () => void
}

/**
 * Hook for managing workspace export to ZIP.
 */
export function useExportWorkspace({ onSuccess }: UseExportWorkspaceProps = {}) {
  const [isExporting, setIsExporting] = useState(false)

  const handleExportWorkspace = useCallback(
    async (workspaceId: string, workspaceName: string) => {
      if (isExporting) return

      setIsExporting(true)
      try {
        logger.info('Exporting workspace', { workspaceId })

        const { data: workflows } = await requestJson(listWorkflowsContract, {
          query: { workspaceId },
        })

        const foldersData = await requestJson(listFoldersContract, {
          query: { workspaceId },
        })

        const workflowsToExport: WorkflowExportData[] = []

        for (const workflow of workflows) {
          const exportData = await fetchWorkflowForExport(workflow.id, {
            name: workflow.name,
            description: workflow.description ?? undefined,
            color: workflow.color,
            folderId: workflow.folderId,
          })

          if (exportData) {
            workflowsToExport.push(exportData)
          }
        }

        const foldersToExport: FolderExportData[] = (foldersData.folders || []).map((folder) => ({
          id: folder.id,
          name: folder.name,
          parentId: folder.parentId,
          sortOrder: folder.sortOrder,
        }))

        let workspaceColor: string | undefined
        try {
          const workspaceData = await requestJson(getWorkspaceContract, {
            params: { id: workspaceId },
          })
          workspaceColor = workspaceData.workspace?.color
        } catch {
          workspaceColor = undefined
        }

        const zipBlob = await exportWorkspaceToZip(
          workspaceName,
          workflowsToExport,
          foldersToExport,
          workspaceColor
        )

        const zipFilename = `${sanitizePathSegment(workspaceName)}-${Date.now()}.zip`
        downloadFile(zipBlob, zipFilename, 'application/zip')

        logger.info('Workspace exported successfully', {
          workspaceId,
          workflowsCount: workflowsToExport.length,
          foldersCount: foldersToExport.length,
        })

        onSuccess?.()
      } catch (error) {
        logger.error('Error exporting workspace:', error)
        throw error
      } finally {
        setIsExporting(false)
      }
    },
    [isExporting, onSuccess]
  )

  return {
    isExporting,
    handleExportWorkspace,
  }
}
