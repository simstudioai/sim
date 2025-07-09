'use client'

import { useState } from 'react'
import { Download, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              disabled={disabled || isExporting || !currentWorkflow}
              className='hover:text-foreground'
            >
              <Download className='h-5 w-5' />
              <span className='sr-only'>Export Workflow</span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {disabled
            ? 'Export not available'
            : !currentWorkflow
              ? 'No workflow to export'
              : 'Export Workflow'}
        </TooltipContent>
      </Tooltip>

      <DropdownMenuContent align='end' className='w-48'>
        <DropdownMenuItem
          onClick={handleExportYaml}
          disabled={isExporting || !currentWorkflow}
          className='flex cursor-pointer items-center gap-2'
        >
          <FileText className='h-4 w-4' />
          <div className='flex flex-col'>
            <span>Export as YAML</span>
            <span className='text-muted-foreground text-xs'>workflow language</span>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
