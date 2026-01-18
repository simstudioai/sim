import { useCallback, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import {
  downloadFile,
  exportWorkflowsToZip,
  exportWorkflowToJson,
  fetchWorkflowForExport,
  sanitizePathSegment,
} from '@/lib/workflows/operations/import-export'
import { useFolderStore } from '@/stores/folders/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('useExportWorkflow')

interface UseExportWorkflowProps {
  /**
   * Optional callback after successful export
   */
  onSuccess?: () => void
}

/**
 * Hook for managing workflow export to JSON or ZIP.
 */
export function useExportWorkflow({ onSuccess }: UseExportWorkflowProps = {}) {
  const [isExporting, setIsExporting] = useState(false)

  const onSuccessRef = useRef(onSuccess)
  onSuccessRef.current = onSuccess

  /**
   * Export the workflow(s) to JSON or ZIP
   * - Single workflow: exports as JSON file
   * - Multiple workflows: exports as ZIP file containing all JSON files
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

        const { workflows } = useWorkflowRegistry.getState()
        const exportedWorkflows = []

        for (const workflowId of workflowIdsToExport) {
          const workflowMeta = workflows[workflowId]
          if (!workflowMeta) {
            logger.warn(`Workflow ${workflowId} not found in registry`)
            continue
          }

          const exportData = await fetchWorkflowForExport(workflowId, {
            name: workflowMeta.name,
            description: workflowMeta.description,
            color: workflowMeta.color,
            folderId: workflowMeta.folderId,
          })

          if (exportData) {
            exportedWorkflows.push(exportData)
            logger.info(`Workflow ${workflowId} prepared for export`)
          }
        }

        if (exportedWorkflows.length === 0) {
          logger.warn('No workflows were successfully prepared for export')
          return
        }

        if (exportedWorkflows.length === 1) {
          const jsonContent = exportWorkflowToJson(exportedWorkflows[0])
          const filename = `${sanitizePathSegment(exportedWorkflows[0].workflow.name)}.json`
          downloadFile(jsonContent, filename, 'application/json')
        } else {
          const zipBlob = await exportWorkflowsToZip(exportedWorkflows)
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

        onSuccessRef.current?.()
      } catch (error) {
        logger.error('Error exporting workflow(s):', { error })
        throw error
      } finally {
        setIsExporting(false)
      }
    },
    [isExporting]
  )

  return {
    isExporting,
    handleExportWorkflow,
  }
}
