'use client'

import { useCallback, useEffect, useState } from 'react'
import { FileCode } from 'lucide-react'
import { Tooltip } from '@/components/emcn'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { applyWorkflowDiff } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-text-editor/workflow-applier'
import { exportWorkflow } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-text-editor/workflow-exporter'
import { WorkflowTextEditor } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-text-editor/workflow-text-editor'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

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
  const [initialContent, setInitialContent] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const { activeWorkflowId } = useWorkflowRegistry()

  // Load initial content when modal opens
  useEffect(() => {
    if (isOpen && activeWorkflowId) {
      setIsLoading(true)
      exportWorkflow('json')
        .then((content) => {
          setInitialContent(content)
        })
        .catch((error) => {
          logger.error('Failed to export workflow:', error)
          setInitialContent('// Error loading workflow content')
        })
        .finally(() => {
          setIsLoading(false)
        })
    }
  }, [isOpen, activeWorkflowId])

  // Handle save operation
  const handleSave = useCallback(
    async (content: string) => {
      if (!activeWorkflowId) {
        return { success: false, errors: ['No active workflow'] }
      }

      try {
        logger.info('Applying workflow changes from JSON editor')

        const applyResult = await applyWorkflowDiff(content, 'json')

        if (applyResult.success) {
          logger.info('Successfully applied workflow changes', {
            appliedOperations: applyResult.appliedOperations,
          })

          // Update initial content to reflect current state
          try {
            const updatedContent = await exportWorkflow('json')
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
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
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
        </Tooltip.Trigger>
        <Tooltip.Content>
          {isDisabled
            ? disabled
              ? 'Text editor not available'
              : 'No active workflow'
            : 'Edit as Text'}
        </Tooltip.Content>
      </Tooltip.Root>

      <DialogContent className='flex h-[85vh] w-[90vw] max-w-6xl flex-col p-0'>
        <DialogHeader className='flex-shrink-0 border-b px-6 py-4'>
          <DialogTitle>Workflow JSON Editor</DialogTitle>
          <DialogDescription>
            Edit your workflow as JSON. Changes will completely replace the current workflow when
            you save.
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
              onSave={handleSave}
              disabled={isDisabled}
              className='h-full rounded-none border-0'
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
