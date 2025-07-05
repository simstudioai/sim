'use client'

import { useState } from 'react'
import { Eye, Maximize2, Minimize2, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { FrozenCanvas } from './frozen-canvas'

interface FrozenCanvasModalProps {
  executionId: string
  workflowName?: string
  trigger?: string
  isOpen: boolean
  onClose: () => void
}

export function FrozenCanvasModal({
  executionId,
  workflowName,
  trigger,
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
            ? 'h-[100vh] max-h-[100vh] w-[100vw] max-w-[100vw] rounded-none'
            : 'h-[90vh] max-h-[90vh] overflow-hidden sm:max-w-[1100px]'
        )}
        hideCloseButton={true}
      >
        {/* Header */}
        <DialogHeader className='flex flex-row items-center justify-between border-gray-700 border-b bg-gray-900 p-4'>
          <div className='flex items-center gap-3'>
            <Eye className='h-5 w-5 text-blue-400' />
            <div>
              <DialogTitle className='font-semibold text-lg text-white'>
                Logged Workflow State
              </DialogTitle>
              <div className='mt-1 flex items-center gap-2'>
                {workflowName && <span className='text-gray-300 text-sm'>{workflowName}</span>}
                {trigger && (
                  <Badge
                    variant='secondary'
                    className='border-gray-600 bg-gray-700 text-gray-200 text-xs'
                  >
                    {trigger}
                  </Badge>
                )}
                <span className='font-mono text-gray-400 text-xs'>
                  {executionId.slice(0, 8)}...
                </span>
              </div>
            </div>
          </div>

          <div className='flex items-center gap-2'>
            <Button
              variant='ghost'
              size='sm'
              onClick={toggleFullscreen}
              className='h-8 w-8 p-0 text-gray-300 hover:bg-gray-800 hover:text-white'
            >
              {isFullscreen ? <Minimize2 className='h-4 w-4' /> : <Maximize2 className='h-4 w-4' />}
            </Button>
            <Button
              variant='ghost'
              size='sm'
              onClick={onClose}
              className='h-8 w-8 p-0 text-gray-300 hover:bg-gray-800 hover:text-white'
            >
              <X className='h-4 w-4' />
            </Button>
          </div>
        </DialogHeader>

        {/* Canvas Container */}
        <div className='min-h-0 flex-1'>
          <FrozenCanvas executionId={executionId} height='100%' width='100%' />
        </div>

        {/* Footer with instructions */}
        <div className='border-gray-700 border-t bg-gray-900 px-6 py-3'>
          <div className='text-gray-300 text-sm'>
            💡 Hover over blocks to see their input and output data at execution time. This canvas
            shows the exact state of the workflow when this execution was captured.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
