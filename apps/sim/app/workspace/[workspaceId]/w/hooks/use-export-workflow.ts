import { useCallback, useState } from 'react'
import JSZip from 'jszip'
import { createLogger } from '@/lib/logs/console/logger'
import { sanitizeForExport } from '@/lib/workflows/json-sanitizer'
import { useFolderStore } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('useExportWorkflow')

interface UseExportWorkflowProps {
  /**
   * Current workspace ID
   */
  workspaceId: string
  /**
   * Function that returns the workflow ID(s) to export
   * This function is called when export occurs to get fresh selection state
   */
  getWorkflowIds: () => string | string[]
  /**
   * Optional callback after successful export
   */
  onSuccess?: () => void
}

/**
 * Hook for managing workflow export to JSON.
 *
 * Handles:
 * - Single or bulk workflow export
 * - Fetching workflow data and variables from API
 * - Sanitizing workflow state for export
 * - Downloading as JSON file(s)
 * - Loading state management
 * - Error handling and logging
 * - Clearing selection after export
 *
 * @param props - Hook configuration
 * @returns Export workflow handlers and state
 */
export function useExportWorkflow({
  workspaceId,
  getWorkflowIds,
  onSuccess,
}: UseExportWorkflowProps) {
  const { workflows } = useWorkflowRegistry()
  const [isExporting, setIsExporting] = useState(false)

  /**
   * Download file helper
   */
  const downloadFile = (
    content: Blob | string,
    filename: string,
    mimeType = 'application/json'
  ) => {
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
   * Export the workflow(s) to JSON or ZIP
   * - Single workflow: exports as JSON file
   * - Multiple workflows: exports as ZIP file containing all JSON files
   * Fetches workflow data from API to support bulk export of non-active workflows
   */
  const handleExportWorkflow = useCallback(async () => {
    if (isExporting) {
      return
    }

    setIsExporting(true)
    try {
      // Get fresh workflow IDs at export time
      const workflowIdsOrId = getWorkflowIds()
      if (!workflowIdsOrId) {
        return
      }

      // Normalize to array for consistent handling
      const workflowIdsToExport = Array.isArray(workflowIdsOrId)
        ? workflowIdsOrId
        : [workflowIdsOrId]

      logger.info('Starting workflow export', {
        workflowIdsToExport,
        count: workflowIdsToExport.length,
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

          // Fetch workflow variables
          const variablesResponse = await fetch(`/api/workflows/${workflowId}/variables`)
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
        logger.warn('No workflows were successfully exported')
        return
      }

      // Download as single JSON or ZIP depending on count
      if (exportedWorkflows.length === 1) {
        // Single workflow - download as JSON
        const filename = `${exportedWorkflows[0].name.replace(/[^a-z0-9]/gi, '-')}.json`
        downloadFile(exportedWorkflows[0].content, filename, 'application/json')
      } else {
        // Multiple workflows - download as ZIP
        const zip = new JSZip()

        for (const exportedWorkflow of exportedWorkflows) {
          const filename = `${exportedWorkflow.name.replace(/[^a-z0-9]/gi, '-')}.json`
          zip.file(filename, exportedWorkflow.content)
        }

        const zipBlob = await zip.generateAsync({ type: 'blob' })
        const zipFilename = `workflows-export-${Date.now()}.zip`
        downloadFile(zipBlob, zipFilename, 'application/zip')
      }

      // Clear selection after successful export
      const { clearSelection } = useFolderStore.getState()
      clearSelection()

      logger.info('Workflow(s) exported successfully', {
        workflowIds: workflowIdsToExport,
        count: exportedWorkflows.length,
        format: exportedWorkflows.length === 1 ? 'JSON' : 'ZIP',
      })

      onSuccess?.()
    } catch (error) {
      logger.error('Error exporting workflow(s):', { error })
      throw error
    } finally {
      setIsExporting(false)
    }
  }, [getWorkflowIds, isExporting, workflows, onSuccess])

  return {
    isExporting,
    handleExportWorkflow,
  }
}
