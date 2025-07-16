'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console-logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowYamlStore } from '@/stores/workflows/yaml/store'

const logger = createLogger('ExportControls')

interface ExportControlsProps {
  disabled?: boolean
}

export function ExportControls({ disabled = false }: ExportControlsProps) {
  const [isExporting, setIsExporting] = useState(false)
  const { workflows, activeWorkflowId } = useWorkflowRegistry()
  const getYaml = useWorkflowYamlStore((state) => state.getYaml)

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

  const handleExportYaml = () => {
    if (!currentWorkflow || !activeWorkflowId) {
      logger.warn('No active workflow to export')
      return
    }

    setIsExporting(true)
    try {
      const yamlContent = getYaml()
      const filename = `${currentWorkflow.name.replace(/[^a-z0-9]/gi, '_')}_workflow.yaml`

      downloadFile(yamlContent, filename, 'text/yaml')
      logger.info('Workflow exported as YAML')
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
          <div className='inline-flex h-12 w-12 cursor-not-allowed items-center justify-center gap-2 whitespace-nowrap rounded-[11px] border bg-card font-medium text-card-foreground text-sm opacity-50 ring-offset-background transition-colors [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0'>
            <Download className='h-5 w-5' />
          </div>
        ) : (
          <Button
            variant='outline'
            onClick={handleExportYaml}
            className='h-12 w-12 rounded-[11px] border bg-card text-card-foreground shadow-xs hover:bg-secondary'
          >
            <Download className='h-5 w-5' />
            <span className='sr-only'>Export as YAML</span>
          </Button>
        )}
      </TooltipTrigger>
      <TooltipContent>{getTooltipText()}</TooltipContent>
    </Tooltip>
  )
}
