'use client'

import { Button, Redo, Undo } from '@/components/emcn'
import { useSession } from '@/lib/auth/auth-client'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useUndoRedoStore } from '@/stores/undo-redo'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

/**
 * Workflow controls component that provides undo/redo functionality.
 * Styled to align with the panel tab buttons.
 */
export function WorkflowControls() {
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

  const canUndo = undoRedoSizes.undoSize > 0
  const canRedo = undoRedoSizes.redoSize > 0

  return (
    <div className='flex gap-[2px]'>
      <Button
        className='h-[28px] rounded-[6px] rounded-r-none border border-transparent px-[6px] py-[5px] hover:border-[var(--border-1)] hover:bg-[var(--surface-5)]'
        onClick={undo}
        variant={canUndo ? 'active' : 'ghost'}
        disabled={!canUndo}
        title='Undo (Cmd+Z)'
      >
        <Undo className='h-[12px] w-[12px]' />
      </Button>
      <Button
        className='h-[28px] rounded-[6px] rounded-l-none border border-transparent px-[6px] py-[5px] hover:border-[var(--border-1)] hover:bg-[var(--surface-5)]'
        onClick={redo}
        variant={canRedo ? 'active' : 'ghost'}
        disabled={!canRedo}
        title='Redo (Cmd+Shift+Z)'
      >
        <Redo className='h-[12px] w-[12px]' />
      </Button>
    </div>
  )
}
