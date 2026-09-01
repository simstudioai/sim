'use client'

import { memo, useCallback, useRef, useState } from 'react'
import {
  Button,
  ChevronDown,
  Cursor,
  chipHoverSurfaceClass,
  cn,
  disclosureChevronClass,
  Hand,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverItem,
  PopoverTrigger,
  Redo,
  Tooltip,
  Undo,
} from '@sim/emcn'
import { SelectAll } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { useReactFlow } from 'reactflow'
import { useShallow } from 'zustand/react/shallow'
import { useSession } from '@/lib/auth/auth-client'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { createCommand } from '@/app/workspace/[workspaceId]/utils/commands-utils'
import { useShowActionBar, useUpdateGeneralSetting } from '@/hooks/queries/general-settings'
import { useCanvasViewport } from '@/hooks/use-canvas-viewport'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useCanvasModeStore } from '@/stores/canvas-mode'
import { useUndoRedoStore } from '@/stores/undo-redo'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('WorkflowControls')

/**
 * Floating controls for canvas mode, undo/redo, and fit-to-view.
 */
export const WorkflowControls = memo(function WorkflowControls() {
  const reactFlowInstance = useReactFlow()
  const { fitViewToBounds } = useCanvasViewport(reactFlowInstance)
  const { mode, setMode } = useCanvasModeStore(
    useShallow((s) => ({ mode: s.mode, setMode: s.setMode }))
  )
  const { undo, redo } = useCollaborativeWorkflow()
  const showWorkflowControls = useShowActionBar()
  const updateSetting = useUpdateGeneralSetting()
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const { data: session } = useSession()
  const userId = session?.user?.id || 'unknown'
  const stacks = useUndoRedoStore((s) => s.stacks)
  const key = activeWorkflowId && userId ? `${activeWorkflowId}:${userId}` : ''
  const stack = (key && stacks[key]) || { undo: [], redo: [] }
  const canUndo = stack.undo.length > 0
  const canRedo = stack.redo.length > 0

  const handleFitToView = useCallback(() => {
    fitViewToBounds({ padding: 0.1, duration: 300 })
  }, [fitViewToBounds])

  useRegisterGlobalCommands([
    createCommand({
      id: 'fit-to-view',
      handler: handleFitToView,
    }),
  ])

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [isCanvasModeOpen, setIsCanvasModeOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  const handleHide = async () => {
    try {
      await updateSetting.mutateAsync({ key: 'showActionBar', value: false })
    } catch (error) {
      logger.error('Failed to hide workflow controls', error)
    } finally {
      setContextMenu(null)
    }
  }

  if (!showWorkflowControls) {
    return <div className='hidden' />
  }

  return (
    <>
      <div
        /*
         * 12px off both edges, the same clearance the toast stack keeps from the
         * terminal and the panel, so the two floating surfaces read as one row.
         * The toast reaches it as `--terminal-height + 20px` because it anchors
         * from the viewport and the terminal is itself inset by
         * CONTENT_WINDOW_GAP; these controls measure from the canvas floor and
         * wall, so they take the 12 directly.
         */
        className='absolute bottom-3 left-3 z-10 flex h-[36px] items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-1'
        onContextMenu={handleContextMenu}
      >
        {/* Canvas Mode Selector */}
        <Popover open={isCanvasModeOpen} onOpenChange={setIsCanvasModeOpen} size='sm'>
          <Tooltip.Root>
            <PopoverTrigger asChild>
              <div className='flex cursor-pointer items-center gap-1'>
                <Tooltip.Trigger asChild>
                  <Button className='size-[28px] rounded-sm p-0' variant='active'>
                    {mode === 'hand' ? (
                      <Hand className='size-[14px]' />
                    ) : (
                      <Cursor className='size-[14px]' />
                    )}
                  </Button>
                </Tooltip.Trigger>
                <Button
                  variant='ghost'
                  className={cn('size-[20px] rounded-sm p-0', chipHoverSurfaceClass)}
                >
                  <ChevronDown
                    className={cn(disclosureChevronClass, isCanvasModeOpen && 'rotate-180')}
                  />
                </Button>
              </div>
            </PopoverTrigger>
            <Tooltip.Content side='top'>{mode === 'hand' ? 'Mover' : 'Pointer'}</Tooltip.Content>
          </Tooltip.Root>
          <PopoverContent side='top' sideOffset={8} maxWidth={100} minWidth={100}>
            <PopoverItem
              onClick={() => {
                setMode('hand')
                setIsCanvasModeOpen(false)
              }}
            >
              <Hand className='size-[14px]' />
              <span>Mover</span>
            </PopoverItem>
            <PopoverItem
              onClick={() => {
                setMode('cursor')
                setIsCanvasModeOpen(false)
              }}
            >
              <Cursor className='size-[14px]' />
              <span>Pointer</span>
            </PopoverItem>
          </PopoverContent>
        </Popover>

        <div className='mx-1 h-[20px] w-px bg-[var(--border)]' />

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              variant='ghost'
              className={cn('size-[28px] rounded-sm p-0', chipHoverSurfaceClass)}
              onClick={undo}
              disabled={!canUndo}
            >
              <Undo className='size-[14px]' />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content side='top'>
            <Tooltip.Shortcut keys='⌘Z'>Undo</Tooltip.Shortcut>
          </Tooltip.Content>
        </Tooltip.Root>

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              variant='ghost'
              className={cn('size-[28px] rounded-sm p-0', chipHoverSurfaceClass)}
              onClick={redo}
              disabled={!canRedo}
            >
              <Redo className='size-[14px]' />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content side='top'>
            <Tooltip.Shortcut keys='⌘⇧Z'>Redo</Tooltip.Shortcut>
          </Tooltip.Content>
        </Tooltip.Root>

        <div className='mx-1 h-[20px] w-px bg-[var(--border)]' />

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              variant='ghost'
              className={cn('size-[28px] rounded-sm p-0', chipHoverSurfaceClass)}
              onClick={handleFitToView}
            >
              <SelectAll className='size-[14px]' />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content side='top'>
            <Tooltip.Shortcut keys='⌘⇧F'>Fit to View</Tooltip.Shortcut>
          </Tooltip.Content>
        </Tooltip.Root>
      </div>

      <Popover
        open={contextMenu !== null}
        onOpenChange={(open) => !open && setContextMenu(null)}
        size='sm'
      >
        <PopoverAnchor
          style={{
            position: 'fixed',
            left: `${contextMenu?.x ?? 0}px`,
            top: `${contextMenu?.y ?? 0}px`,
            width: '1px',
            height: '1px',
          }}
        />
        <PopoverContent ref={menuRef} align='start' side='bottom' sideOffset={4}>
          <PopoverItem onClick={handleHide}>Hide canvas controls</PopoverItem>
        </PopoverContent>
      </Popover>
    </>
  )
})
