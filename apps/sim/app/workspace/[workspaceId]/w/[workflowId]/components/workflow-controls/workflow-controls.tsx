'use client'

import { memo, useCallback, useRef, useState } from 'react'
import {
  Button,
  ChipSwitch,
  Cursor,
  Hand,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverItem,
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

const CANVAS_MODE_OPTIONS = [
  {
    value: 'cursor',
    label: <span className='sr-only'>Pointer</span>,
    icon: Cursor,
  },
  {
    value: 'hand',
    label: <span className='sr-only'>Hand</span>,
    icon: Hand,
  },
] as const

/**
 * Header controls for navigating workflow history.
 */
export const WorkflowHistoryControls = memo(function WorkflowHistoryControls() {
  const { undo, redo } = useCollaborativeWorkflow()
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const { data: session } = useSession()
  const userId = session?.user?.id
  const historyKey = activeWorkflowId && userId ? `${activeWorkflowId}:${userId}` : ''
  const stack = useUndoRedoStore((state) => (historyKey ? state.stacks[historyKey] : undefined))
  const canUndo = (stack?.undo.length ?? 0) > 0
  const canRedo = (stack?.redo.length ?? 0) > 0

  return (
    <div
      className='flex flex-shrink-0 items-center gap-0.5'
      role='group'
      aria-label='Workflow history'
    >
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button
            variant='ghost'
            className='size-[28px] rounded-md p-0 hover-hover:bg-[var(--surface-5)]'
            onClick={undo}
            disabled={!canUndo}
            aria-label='Undo'
          >
            <Undo className='size-[16px]' />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content side='bottom'>
          <Tooltip.Shortcut keys='⌘Z'>Undo</Tooltip.Shortcut>
        </Tooltip.Content>
      </Tooltip.Root>

      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button
            variant='ghost'
            className='size-[28px] rounded-md p-0 hover-hover:bg-[var(--surface-5)]'
            onClick={redo}
            disabled={!canRedo}
            aria-label='Redo'
          >
            <Redo className='size-[16px]' />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content side='bottom'>
          <Tooltip.Shortcut keys='⌘⇧Z'>Redo</Tooltip.Shortcut>
        </Tooltip.Content>
      </Tooltip.Root>
    </div>
  )
})

/**
 * Header controls for canvas mode and fit-to-view.
 */
export const WorkflowControls = memo(function WorkflowControls() {
  const reactFlowInstance = useReactFlow()
  const { fitViewToBounds } = useCanvasViewport(reactFlowInstance)
  const { mode, setMode } = useCanvasModeStore(
    useShallow((s) => ({ mode: s.mode, setMode: s.setMode }))
  )
  const showWorkflowControls = useShowActionBar()
  const updateSetting = useUpdateGeneralSetting()

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
      <div className='flex flex-shrink-0 items-center gap-0.5' onContextMenu={handleContextMenu}>
        <ChipSwitch
          options={CANVAS_MODE_OPTIONS}
          value={mode}
          onChange={setMode}
          aria-label='Canvas interaction mode'
        />

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              variant='ghost'
              className='size-[28px] rounded-md p-0 hover-hover:bg-[var(--surface-5)]'
              onClick={handleFitToView}
            >
              <SelectAll className='size-[16px]' />
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
