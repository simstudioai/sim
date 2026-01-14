import { useCallback, useState } from 'react'
import { createLogger } from '@sim/logger'
import JSZip from 'jszip'
import { sanitizeForExport } from '@/lib/workflows/sanitization/json-sanitizer'
import { useFolderStore } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import type { Variable } from '@/stores/workflows/workflow/types'

const logger = createLogger('useExportWorkflow')

interface UseExportWorkflowProps {
  /**
   * Current workspace ID
   */
  workspaceId: string
  /**
   * Optional callback after successful export
   */
  onSuccess?: () => void
}

/**
 * Hook for managing workflow export to JSON.
 *
 * @param props - Hook configuration
 * @returns Export workflow handlers and state
 */
export function useExportWorkflow({ workspaceId, onSuccess }: UseExportWorkflowProps) {
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
   * @param workflowIds - The workflow ID(s) to export
   */
  const handleExportWorkflow = useCallback(
    async (workflowIds: string | string[]) => {
      if (isExporting) {
        return
      }

      if (!workflowIds || (Array.isArray(workflowIds) && workflowIds.length === 0)) {
        return
      }

      setIsExporting(true)
      try {
        const workflowIdsToExport = Array.isArray(workflowIds) ? workflowIds : [workflowIds]

        logger.info('Starting workflow export', {
          workflowIdsToExport,
          count: workflowIdsToExport.length,
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
          logger.warn('No workflows were successfully exported')
          return
        }

        if (exportedWorkflows.length === 1) {
          const filename = `${exportedWorkflows[0].name.replace(/[^a-z0-9]/gi, '-')}.json`
          downloadFile(exportedWorkflows[0].content, filename, 'application/json')
        } else {
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
          const zipFilename = `workflows-export-${Date.now()}.zip`
          downloadFile(zipBlob, zipFilename, 'application/zip')
        }

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
    },
    [isExporting, workflows, onSuccess]
  )

  return {
    isExporting,
    handleExportWorkflow,
  }
}
