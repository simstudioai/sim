/**
 * @deprecated This component is deprecated and kept as reference only.
 */

'use client'

import { useStore } from 'reactflow'
import { Button, Redo, Undo } from '@/components/emcn'
import { useSession } from '@/lib/auth-client'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useUndoRedoStore } from '@/stores/undo-redo'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

/**
 * Workflow controls component that provides undo/redo and zoom functionality
 * Integrates directly into the panel header for easy access
 */
export function WorkflowControls() {
  // Subscribe to React Flow store so zoom % live-updates while zooming
  const zoom = useStore((s: any) =>
    Array.isArray(s.transform) ? s.transform[2] : s.viewport?.zoom
  )

  const { undo, redo } = useCollaborativeWorkflow()
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

  return (
    <div className='flex items-center gap-[4px]'>
      {/* Undo/Redo Controls - Connected Two-Sided Button */}
      <div className='flex gap-[1px]'>
        <Button
          className='h-[28px] rounded-r-none px-[8px] py-[5px] text-[12.5px]'
          onClick={undo}
          variant={undoRedoSizes.undoSize === 0 ? 'default' : 'active'}
          title='Undo (Cmd+Z)'
        >
          <Undo className='h-[12px] w-[12px]' />
        </Button>

        <Button
          className='h-[28px] rounded-l-none px-[8px] py-[5px] text-[12.5px]'
          onClick={redo}
          variant={undoRedoSizes.redoSize === 0 ? 'default' : 'active'}
          title='Redo (Cmd+Shift+Z)'
        >
          <Redo className='h-[12px] w-[12px]' />
        </Button>
      </div>

      {/* Zoom Badge */}
      <Button className='flex h-[28px] w-[40px] items-center justify-center rounded-[4px] px-[8px] py-[5px] font-medium text-[12.5px]'>
        {currentZoom}%
      </Button>
    </div>
  )
}
