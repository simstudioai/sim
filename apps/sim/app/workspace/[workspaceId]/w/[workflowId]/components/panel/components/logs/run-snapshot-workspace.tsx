'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chip } from '@sim/emcn'
import { motion, useReducedMotion } from 'framer-motion'
import { DiagnosticsWorkspace } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/logs/diagnostics-workspace'
import {
  getRunSteps,
  PROTOTYPE_EXECUTED_BLOCKS,
  PROTOTYPE_RUNS,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/logs/prototype-data'
import { PreviewWorkflow } from '@/app/workspace/[workspaceId]/w/components/preview/components/preview-workflow'
import { useDragResize } from '@/hooks/use-drag-resize'
import { useWorkflowRunSnapshotStore } from '@/stores/logs/workflow-run-snapshot'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

/** Diagnostics drawer sizing, mirroring the terminal's own constraints. */
const DIAGNOSTICS_HEIGHT = { DEFAULT: 340, MIN: 160, MAX_RATIO: 0.85 } as const

/** Expo-out, matching the toast stack so both surfaces settle with the same feel. */
const BANNER_EASE = [0.22, 1, 0.36, 1] as const

interface SnapshotBannerProps {
  runLabel: string
  onExit: () => void
}

/**
 * Canvas-scoped sibling of the emcn toast card: same chrome, but anchored top
 * center over the snapshot and wider, so the run label and its exit sit on one
 * line rather than stacking.
 */
function SnapshotBanner({ runLabel, onExit }: SnapshotBannerProps) {
  const reduceMotion = useReducedMotion()

  return (
    <div className='pointer-events-none absolute inset-x-0 top-[52px] z-20 flex justify-center px-3'>
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.35, ease: BANNER_EASE }}
        className='pointer-events-auto flex w-[380px] max-w-full items-center gap-2 rounded-2xl border border-[var(--border-1)] bg-[var(--bg)] p-2 pl-3 shadow-[var(--shadow-overlay)]'
      >
        <div className='min-w-0 flex-1'>
          <p className='truncate text-[var(--text-body)] text-sm leading-5'>Viewing {runLabel}</p>
          <p className='truncate text-[var(--text-muted)] text-small leading-[18px]'>
            Read-only snapshot
          </p>
        </div>
        <Chip onClick={onExit} className='flex-none'>
          Back to current
        </Chip>
        {/* The shortcut is stated where the click is, so the key is discoverable
            rather than something a user has to guess at. */}
        <kbd className='flex-none pr-1 font-normal font-sans text-[var(--text-muted)] text-caption'>
          ESC
        </kbd>
      </motion.div>
    </div>
  )
}

interface RunSnapshotWorkspaceProps {
  workflowState: WorkflowState
  selectedBlockId?: string | null
  mode?: 'live' | 'snapshot' | 'diagnostics'
}

export function RunSnapshotWorkspace({
  workflowState,
  selectedBlockId,
  mode = 'snapshot',
}: RunSnapshotWorkspaceProps) {
  const selectBlock = useWorkflowRunSnapshotStore((state) => state.selectBlock)
  const showLive = useWorkflowRunSnapshotStore((state) => state.showLive)
  const executionId = useWorkflowRunSnapshotStore((state) => state.snapshot?.executionId)

  const run = PROTOTYPE_RUNS.find((candidate) => candidate.id === executionId)
  const runLabel = run?.label ?? 'this run'
  const viewingRun = mode !== 'live'

  /* Escape is the way out of every other read-only overlay in the editor. */
  useEffect(() => {
    if (!viewingRun) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      showLive()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [showLive, viewingRun])

  const drawerRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number>(DIAGNOSTICS_HEIGHT.DEFAULT)

  /* Measured off the canvas area, not the window — the drawer lives inside it. */
  const computeHeight = useCallback((event: PointerEvent) => {
    const bounds = drawerRef.current?.parentElement?.getBoundingClientRect()
    if (!bounds) return null
    const maxHeight = Math.max(DIAGNOSTICS_HEIGHT.MIN, bounds.height * DIAGNOSTICS_HEIGHT.MAX_RATIO)
    return Math.min(Math.max(bounds.bottom - event.clientY, DIAGNOSTICS_HEIGHT.MIN), maxHeight)
  }, [])

  const { handlePointerDown } = useDragResize({
    cursor: 'ns-resize',
    cssVar: '--diagnostics-height',
    getTarget: () => drawerRef.current,
    compute: computeHeight,
    commit: setHeight,
  })

  /** Block outcomes for the run being viewed, not for whichever run authored the fixture. */
  const executedBlocks = useMemo(() => {
    /* The current workflow has no run behind it, so nothing on it is coloured. */
    if (!viewingRun) return undefined
    if (!run) return PROTOTYPE_EXECUTED_BLOCKS
    return Object.fromEntries(
      getRunSteps(run).map((step) => [
        step.blockId,
        {
          status:
            step.status === 'error'
              ? 'error'
              : step.status === 'skipped'
                ? 'not-executed'
                : 'success',
        },
      ])
    )
  }, [run, viewingRun])

  return (
    <div className='relative h-full min-h-0 bg-[var(--bg)]'>
      <PreviewWorkflow
        /* Entering or leaving a run is a change of subject, so the view refits
           rather than keeping wherever the last selected block left it. */
        key={viewingRun ? 'run' : 'live'}
        workflowState={workflowState}
        className='h-full w-full'
        executedBlocks={executedBlocks}
        selectedBlockId={viewingRun ? selectedBlockId : null}
        onNodeClick={(blockId) => selectBlock(blockId)}
        fitPadding={0.14}
        nodeVariant='workflow'
        focusSelectedNode={viewingRun}
      />

      {viewingRun ? <SnapshotBanner runLabel={runLabel} onExit={showLive} /> : null}

      {/*
       * Diagnostics opens as a bottom drawer rather than replacing the canvas, so
       * the run's snapshot stays on screen while its code is read — the block that
       * failed is still visible above the error it produced.
       */}
      {mode === 'diagnostics' ? (
        <div
          ref={drawerRef}
          /* The drag writes the variable; the fallback is the committed height. */
          style={{ height: `var(--diagnostics-height, ${height}px)` }}
          className='absolute inset-x-0 bottom-0 z-30 flex flex-col overflow-hidden border-[var(--border)] border-t bg-[var(--bg)] shadow-[var(--shadow-overlay)]'
        >
          <div
            role='separator'
            aria-orientation='horizontal'
            aria-label='Resize diagnostics'
            onPointerDown={handlePointerDown}
            className='absolute inset-x-0 top-[-4px] z-10 h-2 cursor-ns-resize'
          />
          <DiagnosticsWorkspace />
        </div>
      ) : null}
    </div>
  )
}
