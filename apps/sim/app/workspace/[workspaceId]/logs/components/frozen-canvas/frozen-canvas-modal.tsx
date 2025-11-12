'use client'

import { useState } from 'react'
import { Maximize2, Minimize2, X } from 'lucide-react'
import { Button } from '@/components/emcn'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { FrozenCanvas } from '@/app/workspace/[workspaceId]/logs/components/frozen-canvas/frozen-canvas'

interface FrozenCanvasModalProps {
  executionId: string
  workflowName?: string
  trigger?: string
  traceSpans?: any[] // TraceSpans data from log metadata
  isOpen: boolean
  onClose: () => void
}

export function FrozenCanvasModal({
  executionId,
  workflowName,
  trigger,
  traceSpans,
  isOpen,
  onClose,
}: FrozenCanvasModalProps) {
  const [isFullscreen, setIsFullscreen] = useState(false)

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen)
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className={cn(
          'flex flex-col gap-0 p-0',
          isFullscreen
            ? 'h-[100vh] max-h-[100vh] w-[100vw] max-w-[100vw]'
            : 'h-[90vh] max-h-[90vh] overflow-hidden sm:max-w-[1100px]'
        )}
        hideCloseButton={true}
      >
        {/* Header */}
        <DialogHeader className='flex flex-row items-center justify-between border-b bg-[var(--surface-1)] p-[16px] dark:border-[var(--border)] dark:bg-[var(--surface-1)]'>
          <div className='flex items-center gap-[12px]'>
            <div>
              <DialogTitle className='font-semibold text-[15px] text-[var(--text-primary)] dark:text-[var(--text-primary)]'>
                Logged Workflow State
              </DialogTitle>
              <div className='mt-[4px] flex items-center gap-[8px]'>
                {workflowName && (
                  <span className='text-[13px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]'>
                    {workflowName}
                  </span>
                )}
                {trigger && (
                  <Badge variant='secondary' className='text-[12px]'>
                    {trigger}
                  </Badge>
                )}
                <span className='font-mono text-[12px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]'>
                  {executionId.slice(0, 8)}...
                </span>
              </div>
            </div>
          </div>

          <div className='flex items-center gap-[8px]'>
            <Button variant='ghost' onClick={toggleFullscreen} className='h-[32px] w-[32px] p-0'>
              {isFullscreen ? (
                <Minimize2 className='h-[14px] w-[14px]' />
              ) : (
                <Maximize2 className='h-[14px] w-[14px]' />
              )}
            </Button>
            <Button variant='ghost' onClick={onClose} className='h-[32px] w-[32px] p-0'>
              <X className='h-[14px] w-[14px]' />
            </Button>
          </div>
        </DialogHeader>

        {/* Canvas Container */}
        <div className='min-h-0 flex-1'>
          <FrozenCanvas
            executionId={executionId}
            traceSpans={traceSpans}
            height='100%'
            width='100%'
            // Ensure preview leaves padding at edges so nodes don't touch header
          />
        </div>

        {/* Footer with instructions */}
        <div className='border-t bg-[var(--surface-1)] px-[24px] py-[12px] dark:border-[var(--border)] dark:bg-[var(--surface-1)]'>
          <div className='text-[13px] text-[var(--text-secondary)] dark:text-[var(--text-secondary)]'>
            Click on blocks to see their input and output data at execution time. This canvas shows
            the exact state of the workflow when this execution was captured.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
