'use client'

import { useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useReactFlow } from 'reactflow'
import {
  Button,
  ChevronDown,
  Cursor,
  Expand,
  Hand,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverItem,
  PopoverTrigger,
  Redo,
  Tooltip,
  Undo,
  ZoomIn,
  ZoomOut,
} from '@/components/emcn'
import { useSession } from '@/lib/auth/auth-client'
import { useUpdateGeneralSetting } from '@/hooks/queries/general-settings'
import { useCanvasViewport } from '@/hooks/use-canvas-viewport'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useCanvasModeStore } from '@/stores/canvas-mode'
import { useGeneralStore } from '@/stores/settings/general'
import { useUndoRedoStore } from '@/stores/undo-redo'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('ActionBar')

export function ActionBar() {
  const reactFlowInstance = useReactFlow()
  const { zoomIn, zoomOut } = reactFlowInstance
  const { fitViewToBounds } = useCanvasViewport(reactFlowInstance)
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
      logger.error('Failed to hide action bar', error)
    } finally {
      setContextMenu(null)
    }
  }

  if (!showActionBar) {
    return null
  }

  return (
    <>
      <div
        className='-translate-x-1/2 fixed bottom-[calc(var(--terminal-height)+16px)] left-[calc((100vw+var(--sidebar-width)-var(--panel-width))/2)] z-10 flex h-[36px] items-center gap-[2px] rounded-[8px] border border-[var(--border)] bg-[var(--surface-1)] p-[4px] shadow-sm transition-[left,bottom] duration-100 ease-out'
        onContextMenu={handleContextMenu}
      >
        {/* Canvas Mode Selector */}
        <Popover
          open={isCanvasModeOpen}
          onOpenChange={setIsCanvasModeOpen}
          variant='secondary'
          size='sm'
        >
          <PopoverTrigger asChild>
            <div className='flex cursor-pointer items-center gap-[4px]'>
              <Button className='h-[28px] w-[28px] rounded-[6px] p-0' variant='active'>
                {mode === 'hand' ? (
                  <Hand className='h-[14px] w-[14px]' />
                ) : (
                  <Cursor className='h-[14px] w-[14px]' />
                )}
              </Button>
              <Button className='!p-[2px] group' variant='ghost'>
                <ChevronDown className='h-[8px] w-[10px] text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]' />
              </Button>
            </div>
          </PopoverTrigger>
          <PopoverContent align='center' side='top' sideOffset={8} maxWidth={100} minWidth={100}>
            <PopoverItem
              onClick={() => {
                setMode('cursor')
                setIsCanvasModeOpen(false)
              }}
            >
              <Cursor className='h-3 w-3' />
              <span>Pointer</span>
            </PopoverItem>
            <PopoverItem
              onClick={() => {
                setMode('hand')
                setIsCanvasModeOpen(false)
              }}
            >
              <Hand className='h-3 w-3' />
              <span>Mover</span>
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
              onClick={() => zoomOut()}
            >
              <ZoomOut className='h-[16px] w-[16px]' />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content side='top'>Zoom out</Tooltip.Content>
        </Tooltip.Root>

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              variant='ghost'
              className='h-[28px] w-[28px] rounded-[6px] p-0 hover:bg-[var(--surface-5)]'
              onClick={() => zoomIn()}
            >
              <ZoomIn className='h-[16px] w-[16px]' />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content side='top'>Zoom in</Tooltip.Content>
        </Tooltip.Root>

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              variant='ghost'
              className='h-[28px] w-[28px] rounded-[6px] p-0 hover:bg-[var(--surface-5)]'
              onClick={() => fitViewToBounds({ padding: 0.1, duration: 300 })}
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
