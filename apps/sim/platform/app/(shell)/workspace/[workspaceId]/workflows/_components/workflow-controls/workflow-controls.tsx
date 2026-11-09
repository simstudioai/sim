'use client'

import { memo, useState } from 'react'
import { IconButton } from '@sim/emcn/button'
import { PointActionMenu } from '@sim/emcn/menu/action-menu'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { Tooltip } from '@sim/emcn/tooltip'
import { useReactFlow } from '@xyflow/react'
import { useShallow } from 'zustand/react/shallow'
import { CANVAS_VIEWPORT_OPTIONS } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/workflow-canvas/workflow-canvas-constants'
import { useRegisterGlobalCommands } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/global-commands/global-commands'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/workflow-controls/workflow-controls.module.css'
import {
  createCommand,
  createLogger,
  useCanvasModeStore,
  useCanvasViewport,
  useCollaborativeWorkflow,
  useIsMobile,
  useSession,
  useShowActionBar,
  useUndoRedoStore,
  useUpdateGeneralSetting,
  useWorkflowRegistry,
} from '@/platform/lib/data/workflows'

const logger = createLogger('WorkflowControls')

/** The canvas modes in the legacy selector's order, by the names it shows. */
const CANVAS_MODE_OPTIONS = [
  { label: 'Mover', value: 'hand' },
  { label: 'Pointer', value: 'cursor' },
] as const

/**
 * Floating controls for canvas mode, undo/redo, and fit-to-view, at the canvas's bottom-left
 * corner. Right-clicking them offers to hide them (the `showActionBar` setting), and they register
 * the fit-to-view shortcut whether or not they are shown.
 */
export const WorkflowControls = memo(function WorkflowControls() {
  const isMobile = useIsMobile()
  const reactFlowInstance = useReactFlow()
  const { fitViewToBounds } = useCanvasViewport(reactFlowInstance, CANVAS_VIEWPORT_OPTIONS)
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

  const handleFitToView = () => {
    fitViewToBounds({ padding: 0.1, duration: 300 })
  }

  useRegisterGlobalCommands([
    createCommand({
      id: 'fit-to-view',
      handler: handleFitToView,
    }),
  ])

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

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

  if (!showWorkflowControls) return null

  return (
    <>
      <div
        role='group'
        aria-label='Canvas controls'
        className={styles.toolbar}
        data-material='floating'
        data-elevation='menu'
        onContextMenu={handleContextMenu}
      >
        {!isMobile && (
          <ChoiceMenu
            label='Canvas mode'
            options={CANVAS_MODE_OPTIONS}
            value={mode}
            onValueChange={(next) => {
              if (next === 'hand' || next === 'cursor') setMode(next)
            }}
          />
        )}

        <span aria-hidden='true' className={styles.modeDivider} />

        <Tooltip label='Undo (⌘Z)'>
          <IconButton label='Undo' icon='I055' disabled={!canUndo} onClick={() => void undo()} />
        </Tooltip>
        <Tooltip label='Redo (⌘⇧Z)'>
          <IconButton
            label='Redo'
            icon='I055'
            mirrored
            disabled={!canRedo}
            onClick={() => void redo()}
          />
        </Tooltip>

        <span aria-hidden='true' className={styles.divider} />

        <Tooltip label='Fit to View (⌘⇧F)'>
          <IconButton label='Fit to View' icon='I060' onClick={handleFitToView} />
        </Tooltip>
      </div>

      <PointActionMenu
        label='Canvas controls actions'
        point={contextMenu}
        onClose={() => setContextMenu(null)}
        actions={() => [
          {
            id: 'hide-canvas-controls',
            label: 'Hide canvas controls',
            onSelect: () => void handleHide(),
          },
        ]}
      />
    </>
  )
})
