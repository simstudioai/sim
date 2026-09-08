'use client'

import { useState } from 'react'
import { cn } from '@sim/emcn'
import { noop } from '@sim/utils/helpers'
import {
  HeroChatLoop,
  type HeroChatPhase,
} from '@/app/(landing)/components/hero/components/hero-chat-loop'
import { HeroResourcePanel } from '@/app/(landing)/components/hero/components/hero-platform-loop/hero-resource-panel'
import { PREVIEW_BUILD_TIMING } from '@/app/(landing)/components/hero/components/hero-platform-loop/preview-build-timing'
import {
  DEFAULT_REPLY_MESSAGE,
  DEFAULT_USER_MESSAGE,
} from '@/app/(landing)/components/hero/components/hero-platform-loop/preview-chat-content'
import { STAGE_BLOCKS } from '@/app/(landing)/components/hero/components/hero-platform-loop/stage-data'
import { HeroLoopShell } from '@/app/(landing)/components/shared/hero-loop-shell'
import { PLATFORM_LOOP_RESET_FADE_MS } from '@/app/(landing)/components/shared/platform-loop-constants'
import {
  PREVIEW_SIDEBAR_CHATS,
  PREVIEW_SIDEBAR_WORKFLOWS,
} from '@/app/(landing)/components/shared/sidebar-preview-content'
import { useMotionSafeCycle } from '@/app/(landing)/hooks/use-motion-safe-cycle'

/** The cycle, in ms from its start. */
const REPLY_AT =
  PREVIEW_BUILD_TIMING.blockStartAt +
  STAGE_BLOCKS.length * PREVIEW_BUILD_TIMING.blockStepMs +
  PREVIEW_BUILD_TIMING.replyPauseMs
const HOLD_MS = 3_600

const OPEN_RESOURCES = ['workflow'] as const

/**
 * The platform suite's "Build agents" preview: Sim's real chat presentation
 * building a workflow on the real workflow stage, the way the hero's live
 * preview does, but on its own loop - the request posts, Sim thinks, the
 * resource pane opens and the blocks land one by one, Sim replies, the frame
 * holds and fades back to the start. Every piece is the hero's own
 * ({@link HeroChatLoop}, {@link HeroResourcePanel}, the lead-enrichment
 * `STAGE_BLOCKS`); only the driver differs, and nothing here takes input -
 * the host window is `pointer-events-none`. Reduced motion shows the finished
 * build.
 */
export function BuildAgentsLoop() {
  const [phase, setPhase] = useState<HeroChatPhase>('reply')
  const [stageOpen, setStageOpen] = useState(true)
  const [builtCount, setBuiltCount] = useState(STAGE_BLOCKS.length)
  const [fading, setFading] = useState(false)
  const [cycleId, setCycleId] = useState(0)

  useMotionSafeCycle({
    scheduleCycle: () => {
      setFading(false)
      setPhase('user')
      setStageOpen(false)
      setBuiltCount(0)
      setCycleId((id) => id + 1)
      const totalMs = REPLY_AT + HOLD_MS
      return {
        timers: [
          setTimeout(() => setPhase('thinking'), PREVIEW_BUILD_TIMING.thinkingAt),
          setTimeout(() => setPhase('dispatching'), PREVIEW_BUILD_TIMING.dispatchAt),
          setTimeout(() => setPhase('building'), PREVIEW_BUILD_TIMING.agentAt),
          setTimeout(() => setStageOpen(true), PREVIEW_BUILD_TIMING.stageOpenAt),
          ...STAGE_BLOCKS.map((_, index) =>
            setTimeout(
              () => setBuiltCount(index + 1),
              PREVIEW_BUILD_TIMING.blockStartAt + index * PREVIEW_BUILD_TIMING.blockStepMs
            )
          ),
          setTimeout(() => setPhase('reply'), REPLY_AT),
          setTimeout(() => setFading(true), totalMs - PLATFORM_LOOP_RESET_FADE_MS),
        ],
        totalMs,
      }
    },
    showFinished: () => {
      setFading(false)
      setPhase('reply')
      setStageOpen(true)
      setBuiltCount(STAGE_BLOCKS.length)
    },
  })

  return (
    <HeroLoopShell chats={PREVIEW_SIDEBAR_CHATS} workflows={PREVIEW_SIDEBAR_WORKFLOWS}>
      <div
        className={cn(
          'relative flex h-full w-full overflow-hidden rounded-[6px] border border-[var(--border)] bg-[var(--bg)] transition-opacity duration-300 ease-out',
          fading ? 'opacity-0' : 'opacity-100'
        )}
      >
        <div className='relative h-full min-w-0 flex-1'>
          <HeroChatLoop
            phase={phase}
            fading={fading}
            userMessage={DEFAULT_USER_MESSAGE}
            replyMessage={DEFAULT_REPLY_MESSAGE}
            composerValue=''
            isSending={phase !== 'reply'}
            onComposerValueChange={noop}
            onOpenWorkflowResource={noop}
            onFollowUpSelect={noop}
            onSubmit={noop}
            onStopGeneration={noop}
          />
        </div>
        <div
          className={cn(
            'h-full shrink-0 overflow-hidden border-[var(--border)] bg-[var(--bg)] transition-[width,border-width] duration-200 [transition-timing-function:cubic-bezier(0.25,0.1,0.25,1)]',
            stageOpen ? 'w-1/2 border-l' : 'w-0 border-l-0'
          )}
        >
          <div className='h-full w-full'>
            <HeroResourcePanel
              activeId='workflow'
              builtCount={builtCount}
              openIds={OPEN_RESOURCES}
              workflowKey={cycleId}
              onActiveChange={noop}
              onClose={noop}
              onCloseResource={noop}
              onOpenResource={noop}
              onRunWorkflow={noop}
            />
          </div>
        </div>
      </div>
    </HeroLoopShell>
  )
}
