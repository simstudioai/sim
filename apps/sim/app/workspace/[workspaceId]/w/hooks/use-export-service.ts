import { useCallback, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useNotificationStore } from '@/stores/notifications'

const logger = createLogger('useExportService')

interface UseExportServiceProps {
  /**
   * Function that returns the workflow ID to export
   */
  getWorkflowId: () => string | undefined
  /**
   * Optional callback after successful export
   */
  onSuccess?: () => void
}

/**
 * Hook for exporting a workflow as a standalone Python/FastAPI service.
 *
 * Exports include:
 * - workflow.json with the workflow definition
 * - .env with decrypted API keys from workspace environment
 * - Python executor files (main.py, executor.py, handlers/, etc.)
 * - requirements.txt
 * - README.md with usage instructions
 *
 * @param props - Hook configuration
 * @returns Export service handlers and state
 */
export function useExportService({ getWorkflowId, onSuccess }: UseExportServiceProps) {
  const [isExporting, setIsExporting] = useState(false)
  const isExportingRef = useRef(false)
  const addNotification = useNotificationStore((state) => state.addNotification)

  const handleExportService = useCallback(async () => {
    if (isExportingRef.current) {
      return
    }

    const workflowId = getWorkflowId()
    if (!workflowId) {
      logger.warn('No workflow ID provided for export')
      return
    }

    isExportingRef.current = true
    setIsExporting(true)
    try {
      logger.info('Starting service export', { workflowId })

      // Call the export-service API endpoint
      const response = await fetch(`/api/workflows/${workflowId}/export-service`)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))

        // Build user-friendly error message
        let errorMessage = errorData.error || 'Failed to export service'
        if (errorData.message) {
          errorMessage += `: ${errorData.message}`
        }

        logger.error('Export validation failed', {
          workflowId,
          error: errorData.error,
          unsupportedBlocks: errorData.unsupportedBlocks,
          unsupportedProviders: errorData.unsupportedProviders,
        })

        addNotification({
          level: 'error',
          message: errorMessage,
        })
        return
      }

      // Get the filename from Content-Disposition header
      const contentDisposition = response.headers.get('Content-Disposition')
      const filenameMatch = contentDisposition?.match(/filename="([^"]+)"/)
      const filename = filenameMatch?.[1] || 'workflow-service.zip'

      // Download the ZIP file
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      logger.info('Service exported successfully', { workflowId, filename })
      onSuccess?.()

    } catch (error) {
      logger.error('Error exporting service:', { error, workflowId })
      throw error
    } finally {
      isExportingRef.current = false
      setIsExporting(false)
    }
  }, [addNotification, getWorkflowId, onSuccess])

  return {
    isExporting,
    handleExportService,
  }
}
