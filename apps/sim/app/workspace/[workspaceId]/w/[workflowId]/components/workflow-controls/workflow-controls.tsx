'use client'

import { memo, useCallback, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import clsx from 'clsx'
import { Scan } from 'lucide-react'
import { useReactFlow } from 'reactflow'
import {
  Button,
  ChevronDown,
  Cursor,
  Hand,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverItem,
  PopoverTrigger,
  Redo,
  Tooltip,
  Undo,
} from '@/components/emcn'
import { useSession } from '@/lib/auth/auth-client'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { createCommand } from '@/app/workspace/[workspaceId]/utils/commands-utils'
import { useShowActionBar, useUpdateGeneralSetting } from '@/hooks/queries/general-settings'
import { useCanvasViewport } from '@/hooks/use-canvas-viewport'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useCanvasModeStore } from '@/stores/canvas-mode'
import { useTerminalStore } from '@/stores/terminal'
import { useUndoRedoStore } from '@/stores/undo-redo'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('WorkflowControls')

/**
 * Floating controls for canvas mode, undo/redo, and fit-to-view.
 */
export const WorkflowControls = memo(function WorkflowControls() {
  const reactFlowInstance = useReactFlow()
  const { fitViewToBounds } = useCanvasViewport(reactFlowInstance)
  const { mode, setMode } = useCanvasModeStore()
  const { undo, redo } = useCollaborativeWorkflow()
  const showWorkflowControls = useShowActionBar()
  const updateSetting = useUpdateGeneralSetting()
  const isTerminalResizing = useTerminalStore((state) => state.isResizing)

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
    return null
  }

  return (
    <>
      <div
        className={clsx(
          'fixed z-10 flex h-[36px] items-center gap-[2px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-[4px]',
          !isTerminalResizing && 'transition-[bottom] duration-100 ease-out'
        )}
        style={{
          bottom: 'calc(var(--terminal-height) + 16px)',
          left: 'calc(var(--sidebar-width) + 16px)',
        }}
        onContextMenu={handleContextMenu}
      >
        {/* Canvas Mode Selector */}
        <Popover
          open={isCanvasModeOpen}
          onOpenChange={setIsCanvasModeOpen}
          variant='secondary'
          size='sm'
        >
          <Tooltip.Root>
            <PopoverTrigger asChild>
              <div className='flex cursor-pointer items-center gap-[4px]'>
                <Tooltip.Trigger asChild>
                  <Button className='h-[28px] w-[28px] rounded-[6px] p-0' variant='active'>
                    {mode === 'hand' ? (
                      <Hand className='h-[14px] w-[14px]' />
                    ) : (
                      <Cursor className='h-[14px] w-[14px]' />
                    )}
                  </Button>
                </Tooltip.Trigger>
                <Button className='-m-[4px] !p-[6px] group' variant='ghost'>
                  <ChevronDown
                    className={`h-[8px] w-[10px] text-[var(--text-muted)] transition-transform duration-100 group-hover:text-[var(--text-secondary)] ${isCanvasModeOpen ? 'rotate-180' : ''}`}
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
              <Hand className='h-3 w-3' />
              <span>Mover</span>
            </PopoverItem>
            <PopoverItem
              onClick={() => {
                setMode('cursor')
                setIsCanvasModeOpen(false)
              }}
            >
              <Cursor className='h-3 w-3' />
              <span>Pointer</span>
            </PopoverItem>
          </PopoverContent>
        </Popover>

        <div className='mx-[4px] h-[20px] w-[1px] bg-[var(--border)]' />

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              variant='ghost'
              className='h-[28px] w-[28px] rounded-[6px] p-0 hover:bg-[var(--surface-5)]'
              onClick={undo}
              disabled={!canUndo}
            >
              <Undo className='h-[16px] w-[16px]' />
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
              className='h-[28px] w-[28px] rounded-[6px] p-0 hover:bg-[var(--surface-5)]'
              onClick={redo}
              disabled={!canRedo}
            >
              <Redo className='h-[16px] w-[16px]' />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content side='top'>
            <Tooltip.Shortcut keys='⌘⇧Z'>Redo</Tooltip.Shortcut>
          </Tooltip.Content>
        </Tooltip.Root>

        <div className='mx-[4px] h-[20px] w-[1px] bg-[var(--border)]' />

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              variant='ghost'
              className='h-[28px] w-[28px] rounded-[6px] p-0 hover:bg-[var(--surface-5)]'
              onClick={handleFitToView}
            >
              <Scan className='h-[16px] w-[16px]' />
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
        variant='secondary'
        size='sm'
        colorScheme='inverted'
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
