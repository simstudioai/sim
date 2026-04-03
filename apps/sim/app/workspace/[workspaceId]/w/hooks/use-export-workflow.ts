import { useCallback, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { captureEvent } from '@/lib/posthog/client'
import {
  downloadFile,
  exportWorkflowsToZip,
  exportWorkflowToJson,
  fetchWorkflowForExport,
  sanitizePathSegment,
} from '@/lib/workflows/operations/import-export'
import { getWorkflows } from '@/hooks/queries/utils/workflow-cache'
import { useFolderStore } from '@/stores/folders/store'

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
  const params = useParams()
  const workspaceId = params.workspaceId as string | undefined
  const posthog = usePostHog()

  const onSuccessRef = useRef(onSuccess)
  onSuccessRef.current = onSuccess

  const workspaceIdRef = useRef(workspaceId)
  workspaceIdRef.current = workspaceId

  const posthogRef = useRef(posthog)
  posthogRef.current = posthog

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

        if (!workspaceIdRef.current) return
        const workflowMap = new Map(getWorkflows(workspaceIdRef.current).map((w) => [w.id, w]))
        const exportedWorkflows = []

        for (const workflowId of workflowIdsToExport) {
          const workflowMeta = workflowMap.get(workflowId)
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

        captureEvent(posthogRef.current, 'workflow_exported', {
          workspace_id: workspaceIdRef.current ?? '',
          workflow_count: exportedWorkflows.length,
          format: exportedWorkflows.length === 1 ? 'json' : 'zip',
        })

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
