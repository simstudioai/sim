import { useCallback, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'
import { exportWorkspaceToZip, type WorkflowExportData } from '@/lib/workflows/import-export'

const logger = createLogger('useExportWorkspace')

interface UseExportWorkspaceProps {
  /**
   * Optional callback after successful export
   */
  onSuccess?: () => void
}

/**
 * Hook for managing workspace export to ZIP.
 *
 * Handles:
 * - Fetching all workflows and folders from workspace
 * - Fetching workflow states and variables
 * - Creating ZIP file with all workspace data
 * - Downloading the ZIP file
 * - Loading state management
 * - Error handling and logging
 *
 * @param props - Hook configuration
 * @returns Export workspace handlers and state
 */
export function useExportWorkspace({ onSuccess }: UseExportWorkspaceProps = {}) {
  const [isExporting, setIsExporting] = useState(false)

  /**
   * Export workspace to ZIP file
   */
  const handleExportWorkspace = useCallback(
    async (workspaceId: string, workspaceName: string) => {
      if (isExporting) return

      setIsExporting(true)
      try {
        logger.info('Exporting workspace', { workspaceId })

        // Fetch all workflows in workspace
        const workflowsResponse = await fetch(`/api/workflows?workspaceId=${workspaceId}`)
        if (!workflowsResponse.ok) {
          throw new Error('Failed to fetch workflows')
        }
        const { data: workflows } = await workflowsResponse.json()

        // Fetch all folders in workspace
        const foldersResponse = await fetch(`/api/folders?workspaceId=${workspaceId}`)
        if (!foldersResponse.ok) {
          throw new Error('Failed to fetch folders')
        }
        const foldersData = await foldersResponse.json()

        // Export each workflow
        const workflowsToExport: WorkflowExportData[] = []

        for (const workflow of workflows) {
          try {
            const workflowResponse = await fetch(`/api/workflows/${workflow.id}`)
            if (!workflowResponse.ok) {
              logger.warn(`Failed to fetch workflow ${workflow.id}`)
              continue
            }

            const { data: workflowData } = await workflowResponse.json()
            if (!workflowData?.state) {
              logger.warn(`Workflow ${workflow.id} has no state`)
              continue
            }

            const variablesResponse = await fetch(`/api/workflows/${workflow.id}/variables`)
            let workflowVariables: any[] = []
            if (variablesResponse.ok) {
              const variablesData = await variablesResponse.json()
              workflowVariables = Object.values(variablesData?.data || {}).map((v: any) => ({
                id: v.id,
                name: v.name,
                type: v.type,
                value: v.value,
              }))
            }

            workflowsToExport.push({
              workflow: {
                id: workflow.id,
                name: workflow.name,
                description: workflow.description,
                color: workflow.color,
                folderId: workflow.folderId,
              },
              state: workflowData.state,
              variables: workflowVariables,
            })
          } catch (error) {
            logger.error(`Failed to export workflow ${workflow.id}:`, error)
          }
        }

        const foldersToExport: Array<{
          id: string
          name: string
          parentId: string | null
        }> = (foldersData.folders || []).map((folder: any) => ({
          id: folder.id,
          name: folder.name,
          parentId: folder.parentId,
        }))

        const zipBlob = await exportWorkspaceToZip(
          workspaceName,
          workflowsToExport,
          foldersToExport
        )

        const blobUrl = URL.createObjectURL(zipBlob)
        const a = document.createElement('a')
        a.href = blobUrl
        a.download = `${workspaceName.replace(/[^a-z0-9]/gi, '-')}-${Date.now()}.zip`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(blobUrl)

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
