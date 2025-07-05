'use client'

import { useState } from 'react'
import { X, Maximize2, Minimize2, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
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
          'p-0 gap-0 flex flex-col',
          isFullscreen
            ? 'max-w-[100vw] max-h-[100vh] w-[100vw] h-[100vh] rounded-none'
            : 'max-h-[90vh] h-[90vh] overflow-hidden sm:max-w-[1100px]'
        )}
        hideCloseButton={true}
      >
        {/* Header */}
        <DialogHeader className="flex flex-row items-center justify-between p-4 border-b bg-gray-900 border-gray-700">
          <div className="flex items-center gap-3">
            <Eye className="h-5 w-5 text-blue-400" />
            <div>
              <DialogTitle className="text-lg font-semibold text-white">
                Logged Workflow State
              </DialogTitle>
              <div className="flex items-center gap-2 mt-1">
                {workflowName && (
                  <span className="text-sm text-gray-300">
                    {workflowName}
                  </span>
                )}
                {trigger && (
                  <Badge variant="secondary" className="text-xs bg-gray-700 text-gray-200 border-gray-600">
                    {trigger}
                  </Badge>
                )}
                <span className="text-xs text-gray-400 font-mono">
                  {executionId.slice(0, 8)}...
                </span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleFullscreen}
              className="h-8 w-8 p-0 text-gray-300 hover:text-white hover:bg-gray-800"
            >
              {isFullscreen ? (
                <Minimize2 className="h-4 w-4" />
              ) : (
                <Maximize2 className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-8 w-8 p-0 text-gray-300 hover:text-white hover:bg-gray-800"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        {/* Canvas Container */}
        <div className="flex-1 min-h-0">
          <FrozenCanvas
            executionId={executionId}
            height="100%"
            width="100%"
          />
        </div>

        {/* Footer with instructions */}
        <div className="border-t border-gray-700 bg-gray-900 px-6 py-3">
          <div className="text-sm text-gray-300">
            💡 Hover over blocks to see their input and output data at execution time.
            This canvas shows the exact state of the workflow when this execution was captured.
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
