'use client'

import { useState } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console/logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('ExportControls')

interface ExportControlsProps {
  disabled?: boolean
}

export function ExportControls({ disabled = false }: ExportControlsProps) {
  const [isExporting, setIsExporting] = useState(false)
  const { workflows, activeWorkflowId } = useWorkflowRegistry()

  const currentWorkflow = activeWorkflowId ? workflows[activeWorkflowId] : null

  const downloadFile = (content: string, filename: string, mimeType: string) => {
    try {
      const blob = new Blob([content], { type: mimeType })
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

  const handleExportYaml = async () => {
    if (!currentWorkflow || !activeWorkflowId) {
      logger.warn('No active workflow to export')
      return
    }

    setIsExporting(true)
    try {
      // Use the new database-based export endpoint
      const response = await fetch(`/api/workflows/yaml/export?workflowId=${activeWorkflowId}`)

      if (!response.ok) {
        const errorData = await response.json().catch(() => null)
        throw new Error(errorData?.error || `Failed to export YAML: ${response.statusText}`)
      }

      const result = await response.json()

      if (!result.success || !result.yaml) {
        throw new Error(result.error || 'Failed to export YAML')
      }

      const filename = `${currentWorkflow.name.replace(/[^a-z0-9]/gi, '-')}.yaml`
      downloadFile(result.yaml, filename, 'text/yaml')
      logger.info('Workflow exported as YAML from database')
    } catch (error) {
      logger.error('Failed to export workflow as YAML:', error)
    } finally {
      setIsExporting(false)
    }
  }

  const isDisabled = disabled || isExporting || !currentWorkflow

  const getTooltipText = () => {
    if (disabled) return 'Export not available'
    if (!currentWorkflow) return 'No workflow to export'
    if (isExporting) return 'Exporting...'
    return 'Export as YAML'
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {isDisabled ? (
          <div className='inline-flex h-12 w-12 cursor-not-allowed items-center justify-center rounded-[11px] border bg-card text-card-foreground opacity-50 shadow-xs transition-colors'>
            <Upload className='h-4 w-4' />
          </div>
        ) : (
          <Button
            variant='outline'
            onClick={handleExportYaml}
            className='h-12 w-12 rounded-[11px] border bg-card text-card-foreground shadow-xs hover:bg-secondary'
          >
            <Upload className='h-5 w-5' />
            <span className='sr-only'>Export as YAML</span>
          </Button>
        )}
      </TooltipTrigger>
      <TooltipContent>{getTooltipText()}</TooltipContent>
    </Tooltip>
  )
}
