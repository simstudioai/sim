'use client'

import { useCallback, useEffect, useState } from 'react'
import { FileCode } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { applyWorkflowDiff } from './workflow-applier'
import { exportWorkflow } from './workflow-exporter'
import { type EditorFormat, WorkflowTextEditor } from './workflow-text-editor'

const logger = createLogger('WorkflowTextEditorModal')

interface WorkflowTextEditorModalProps {
  disabled?: boolean
  className?: string
}

export function WorkflowTextEditorModal({
  disabled = false,
  className,
}: WorkflowTextEditorModalProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [format, setFormat] = useState<EditorFormat>('yaml')
  const [initialContent, setInitialContent] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const { activeWorkflowId } = useWorkflowRegistry()

  // Load initial content when modal opens
  useEffect(() => {
    if (isOpen && activeWorkflowId) {
      setIsLoading(true)
      try {
        const content = exportWorkflow(format)
        setInitialContent(content)
      } catch (error) {
        logger.error('Failed to export workflow:', error)
        setInitialContent('# Error loading workflow content')
      } finally {
        setIsLoading(false)
      }
    }
  }, [isOpen, format, activeWorkflowId])

  // Handle format changes
  const handleFormatChange = useCallback((newFormat: EditorFormat) => {
    setFormat(newFormat)
  }, [])

  // Handle save operation
  const handleSave = useCallback(
    async (content: string, contentFormat: EditorFormat) => {
      if (!activeWorkflowId) {
        return { success: false, errors: ['No active workflow'] }
      }

      try {
        logger.info('Applying workflow changes from text editor', { format: contentFormat })

        // Apply changes using the simplified approach
        const applyResult = await applyWorkflowDiff(content, contentFormat)

        if (applyResult.success) {
          logger.info('Successfully applied workflow changes', {
            appliedOperations: applyResult.appliedOperations,
          })

          // Update initial content to reflect current state
          try {
            const updatedContent = exportWorkflow(contentFormat)
            setInitialContent(updatedContent)
          } catch (error) {
            logger.error('Failed to refresh content after save:', error)
          }
        }

        return {
          success: applyResult.success,
          errors: applyResult.errors,
          warnings: applyResult.warnings,
        }
      } catch (error) {
        logger.error('Failed to save workflow changes:', error)
        return {
          success: false,
          errors: [error instanceof Error ? error.message : 'Unknown error'],
        }
      }
    },
    [activeWorkflowId]
  )

  const handleOpenChange = useCallback((open: boolean) => {
    setIsOpen(open)
    if (!open) {
      // Reset state when closing
      setInitialContent('')
    }
  }, [])

  const isDisabled = disabled || !activeWorkflowId

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DialogTrigger asChild>
            {isDisabled ? (
              <div className='inline-flex h-10 w-10 cursor-not-allowed items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium text-sm opacity-50 ring-offset-background transition-colors [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0'>
                <FileCode className='h-5 w-5' />
              </div>
            ) : (
              <Button
                variant='ghost'
                size='icon'
                className={cn('hover:text-foreground', className)}
              >
                <FileCode className='h-5 w-5' />
                <span className='sr-only'>Edit as Text</span>
              </Button>
            )}
          </DialogTrigger>
        </TooltipTrigger>
        <TooltipContent>
          {isDisabled
            ? disabled
              ? 'Text editor not available'
              : 'No active workflow'
            : 'Edit as Text'}
        </TooltipContent>
      </Tooltip>

      <DialogContent className='flex h-[85vh] w-[90vw] max-w-6xl flex-col p-0'>
        <DialogHeader className='flex-shrink-0 border-b px-6 py-4'>
          <DialogTitle>Workflow Text Editor</DialogTitle>
          <DialogDescription>
            Edit your workflow as YAML or JSON. Changes will completely replace the current workflow
            when you save.
          </DialogDescription>
        </DialogHeader>

        <div className='flex-1 overflow-hidden'>
          {isLoading ? (
            <div className='flex h-full items-center justify-center'>
              <div className='text-center'>
                <div className='mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-primary border-b-2' />
                <p className='text-muted-foreground'>Loading workflow content...</p>
              </div>
            </div>
          ) : (
            <WorkflowTextEditor
              initialValue={initialContent}
              format={format}
              onSave={handleSave}
              onFormatChange={handleFormatChange}
              disabled={isDisabled}
              className='h-full rounded-none border-0'
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
