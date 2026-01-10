'use client'

import { useRef, useState } from 'react'
import { useReactFlow } from 'reactflow'
import {
  Button,
  Cursor,
  Expand,
  Hand,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverItem,
  Redo,
  Tooltip,
  Undo,
  ZoomIn,
  ZoomOut,
} from '@/components/emcn'
import { useSession } from '@/lib/auth/auth-client'
import { useUpdateGeneralSetting } from '@/hooks/queries/general-settings'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useCanvasModeStore } from '@/stores/canvas-mode'
import { useGeneralStore } from '@/stores/settings/general'
import { useUndoRedoStore } from '@/stores/undo-redo'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

export function ActionBar() {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const { mode, setMode } = useCanvasModeStore()
  const { undo, redo } = useCollaborativeWorkflow()
  const showActionBar = useGeneralStore((s) => s.showActionBar)
  const updateSetting = useUpdateGeneralSetting()

  const { activeWorkflowId } = useWorkflowRegistry()
  const { data: session } = useSession()
  const userId = session?.user?.id || 'unknown'
  const stacks = useUndoRedoStore((s) => s.stacks)
  const key = activeWorkflowId && userId ? `${activeWorkflowId}:${userId}` : ''
  const stack = (key && stacks[key]) || { undo: [], redo: [] }
  const canUndo = stack.undo.length > 0
  const canRedo = stack.redo.length > 0

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  const handleHide = async () => {
    setContextMenu(null)
    await updateSetting.mutateAsync({ key: 'showActionBar', value: false })
  }

  if (!showActionBar) {
    return null
  }

  return (
    <>
      <div
        className='fixed bottom-[calc(var(--terminal-height)+12px)] left-[calc(var(--sidebar-width)+12px)] z-10 flex h-[36px] items-center gap-[2px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-[4px] shadow-sm transition-[left,bottom] duration-100 ease-out'
        onContextMenu={handleContextMenu}
      >
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              variant={mode === 'hand' ? 'secondary' : 'ghost'}
              className='h-[28px] w-[28px] p-0'
              onClick={() => setMode('hand')}
            >
              <Hand className='h-[16px] w-[16px]' />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content side='top'>Hand tool</Tooltip.Content>
        </Tooltip.Root>

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              variant={mode === 'cursor' ? 'secondary' : 'ghost'}
              className='h-[28px] w-[28px] p-0'
              onClick={() => setMode('cursor')}
            >
              <Cursor className='h-[16px] w-[16px]' />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content side='top'>Move</Tooltip.Content>
        </Tooltip.Root>

        <div className='mx-[4px] h-[20px] w-[1px] bg-[var(--border)]' />

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              variant='ghost'
              className='h-[28px] w-[28px] p-0'
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
              className='h-[28px] w-[28px] p-0'
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
            <Button variant='ghost' className='h-[28px] w-[28px] p-0' onClick={() => zoomOut()}>
              <ZoomOut className='h-[16px] w-[16px]' />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content side='top'>Zoom out</Tooltip.Content>
        </Tooltip.Root>

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button variant='ghost' className='h-[28px] w-[28px] p-0' onClick={() => zoomIn()}>
              <ZoomIn className='h-[16px] w-[16px]' />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content side='top'>Zoom in</Tooltip.Content>
        </Tooltip.Root>

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              variant='ghost'
              className='h-[28px] w-[28px] p-0'
              onClick={() => fitView({ padding: 0.3, duration: 300 })}
            >
              <Expand className='h-[16px] w-[16px]' />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content side='top'>Zoom to fit</Tooltip.Content>
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
}
