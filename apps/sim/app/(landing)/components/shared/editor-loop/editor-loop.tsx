'use client'

import { useState } from 'react'
import { cn } from '@sim/emcn'
import { HeroWorkflowStage } from '@/app/(landing)/components/hero/components/hero-platform-loop/hero-workflow-stage'
import type { BlockDef } from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'
import { HeroLoopShell } from '@/app/(landing)/components/shared/hero-loop-shell'
import type { EnterpriseSidebarProps } from '@/app/(landing)/enterprise/components/enterprise-platform-loop/enterprise-sidebar'
import { RESET_FADE_MS } from '@/app/(landing)/hooks/use-design-scale'
import { useMotionSafeCycle } from '@/app/(landing)/hooks/use-motion-safe-cycle'

/** The empty canvas holds this long before the first block lands. */
const IDLE_HOLD_MS = 900
/** Block N (build order) pops in at IDLE_HOLD_MS + N * BUILD_STEP_MS. */
const BUILD_STEP_MS = 620
/** The story block gets its selection ring this long after the last block. */
const SELECT_AFTER_MS = 700
/** The finished, selected canvas holds this long before the fade. */
const SELECTED_HOLD_MS = 5200

/** Domain content one editor-loop hero replays - sidebar identity + staged flow. */
export interface EditorLoopContent {
  /** Recent-chat entries in the sidebar - four fill the design height. */
  sidebarChats: readonly string[]
  /** Deployed workflows in the sidebar - five fill the design height. */
  sidebarWorkflows: readonly string[]
  /** Canvas blocks, ordered by build sequence. */
  blocks: BlockDef[]
  /** Source → target pairs, drawn in order as their endpoints land on canvas. */
  edges: ReadonlyArray<readonly [string, string]>
  /** Design-space bounding box of the block layout. */
  canvas: { width: number; height: number }
  /** The block the "editing" beat selects once the flow is assembled. */
  selectedBlockId: string
  /** Workspace-nav row to highlight in the sidebar; unset keeps New chat active. */
  activeNav?: EnterpriseSidebarProps['activeNav']
}

interface EditorLoopProps {
  /** The page's sidebar identity and staged workflow. */
  content: EditorLoopContent
}

/**
 * The chat-free sibling of the enterprise platform loop, shared by the
 * workflows and scheduled-tasks heroes. Same architecture (the
 * {@link HeroLoopShell}'s fixed 1280x735 design-space layer scaled to the
 * window, a parent-owned clock driving a presentational stage, reduced-motion
 * showing the finished frame) and the same live sidebar, but the workspace
 * pane is the editor canvas itself: the content's workflow assembles block by
 * block (edges stroke-draw as endpoints land), then the story block picks up
 * the real editor's selection ring - the "being edited" beat - before the
 * scene fades and the cycle restarts.
 *
 * Everything is `pointer-events-none` decorative, matching each hero's
 * `aria-hidden` frame. Under `prefers-reduced-motion` the loop never starts:
 * the fully-built, selected canvas renders statically.
 */
export function EditorLoop({ content }: EditorLoopProps) {
  const [builtCount, setBuiltCount] = useState(0)
  const [selected, setSelected] = useState(false)
  const [fading, setFading] = useState(false)
  const [cycleId, setCycleId] = useState(0)

  useMotionSafeCycle(
    {
      scheduleCycle: () => {
        setFading(false)
        setBuiltCount(0)
        setSelected(false)
        setCycleId((c) => c + 1)
        const selectAt =
          IDLE_HOLD_MS + (content.blocks.length - 1) * BUILD_STEP_MS + SELECT_AFTER_MS
        const totalMs = selectAt + SELECTED_HOLD_MS
        return {
          timers: [
            ...content.blocks.map((_, i) =>
              setTimeout(() => setBuiltCount(i + 1), IDLE_HOLD_MS + i * BUILD_STEP_MS)
            ),
            setTimeout(() => setSelected(true), selectAt),
            setTimeout(() => setFading(true), totalMs - RESET_FADE_MS),
          ],
          totalMs,
        }
      },
      showFinished: () => {
        setFading(false)
        setBuiltCount(content.blocks.length)
        setSelected(true)
      },
    },
    [content]
  )

  return (
    <HeroLoopShell
      chats={content.sidebarChats}
      workflows={content.sidebarWorkflows}
      activeNav={content.activeNav}
    >
      <div className='h-full w-full overflow-hidden rounded-[6px] border border-[var(--border)] bg-[var(--bg)]'>
        <div
          className={cn(
            'h-full w-full transition-opacity duration-300 ease-out',
            fading ? 'opacity-0' : 'opacity-100'
          )}
        >
          <HeroWorkflowStage
            key={cycleId}
            builtCount={builtCount}
            blocks={content.blocks}
            edges={content.edges}
            canvas={content.canvas}
            selectedId={selected ? content.selectedBlockId : undefined}
          />
        </div>
      </div>
    </HeroLoopShell>
  )
}
