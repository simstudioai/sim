'use client'

import { Minus, Plus, Redo2, Undo2 } from 'lucide-react'
import { useReactFlow, useStore } from 'reactflow'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSession } from '@/lib/auth-client'
import { cn } from '@/lib/utils'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useGeneralStore } from '@/stores/settings/general/store'
import { useUndoRedoStore } from '@/stores/undo-redo'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

export function FloatingControls() {
  const { zoomIn, zoomOut } = useReactFlow()
  // Subscribe to React Flow store so zoom % live-updates while zooming
  const zoom = useStore((s: any) =>
    Array.isArray(s.transform) ? s.transform[2] : s.viewport?.zoom
  )
  const { undo, redo } = useCollaborativeWorkflow()
  const { showFloatingControls } = useGeneralStore()
  const { activeWorkflowId } = useWorkflowRegistry()
  const { data: session } = useSession()
  const userId = session?.user?.id || 'unknown'
  const stacks = useUndoRedoStore((s) => s.stacks)

  const undoRedoSizes = (() => {
    const key = activeWorkflowId && userId ? `${activeWorkflowId}:${userId}` : ''
    const stack = (key && stacks[key]) || { undo: [], redo: [] }
    return { undoSize: stack.undo.length, redoSize: stack.redo.length }
  })()
  const currentZoom = Math.round(((zoom as number) || 1) * 100)

  if (!showFloatingControls) return null

  const handleZoomIn = () => {
    zoomIn({ duration: 200 })
  }

  const handleZoomOut = () => {
    zoomOut({ duration: 200 })
  }

  return (
    <div className='-translate-x-1/2 fixed bottom-6 left-1/2 z-10'>
      <div className='flex items-center gap-1 rounded-[14px] border bg-card/95 p-1 shadow-lg backdrop-blur-sm'>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              onClick={handleZoomOut}
              disabled={currentZoom <= 10}
              className={cn(
                'h-9 w-9 rounded-[10px]',
                'hover:bg-muted/80',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
            >
              <Minus className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom Out</TooltipContent>
        </Tooltip>

        <div className='flex w-12 items-center justify-center font-medium text-muted-foreground text-sm'>
          {currentZoom}%
        </div>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              onClick={handleZoomIn}
              disabled={currentZoom >= 200}
              className={cn(
                'h-9 w-9 rounded-[10px]',
                'hover:bg-muted/80',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
            >
              <Plus className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Zoom In</TooltipContent>
        </Tooltip>

        <div className='mx-1 h-6 w-px bg-border' />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              onClick={undo}
              disabled={undoRedoSizes.undoSize === 0}
              className={cn(
                'h-9 w-9 rounded-[10px]',
                'hover:bg-muted/80',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
            >
              <Undo2 className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <div className='text-center'>
              <p>Undo</p>
              <p className='text-muted-foreground text-xs'>Cmd+Z</p>
            </div>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              onClick={redo}
              disabled={undoRedoSizes.redoSize === 0}
              className={cn(
                'h-9 w-9 rounded-[10px]',
                'hover:bg-muted/80',
                'disabled:cursor-not-allowed disabled:opacity-50'
              )}
            >
              <Redo2 className='h-4 w-4' />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <div className='text-center'>
              <p>Redo</p>
              <p className='text-muted-foreground text-xs'>Cmd+Shift+Z</p>
            </div>
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
