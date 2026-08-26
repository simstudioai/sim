'use client'

import { useEffect, useState } from 'react'
import { cn } from '@sim/emcn'
import {
  HeroChatLoop,
  type HeroChatPhase,
} from '@/app/(landing)/components/hero/components/hero-chat-loop'
import { HeroWorkflowStage } from '@/app/(landing)/components/hero/components/hero-platform-loop/hero-workflow-stage'
import { STAGE_BLOCKS } from '@/app/(landing)/components/hero/components/hero-platform-loop/stage-data'
import { HeroLoopShell } from '@/app/(landing)/components/shared/hero-loop-shell'
import {
  PREVIEW_SIDEBAR_CHATS,
  PREVIEW_SIDEBAR_WORKFLOWS,
} from '@/app/(landing)/components/shared/sidebar-preview-content'

/**
 * One pass of the synced loop, matching the REAL platform behavior: the chat
 * runs FULL-WIDTH (stage collapsed, exactly like `MothershipView`'s `w-0`
 * state); the user message lands and the Mothership starts thinking; the stage
 * pane SLIDES IN from the right (the real `w-1/2` + `border-l` width
 * transition); the workflow assembles block by block inside it; the reply
 * lands once the flow is built; the scene holds, fades, and restarts.
 */
const PHASE_STARTS = { user: 500, thinking: 1400 } as const
/** The stage pane starts sliding open here (during thinking). */
const STAGE_OPEN_AT = 1900
/** Block N (build order) pops in at BUILD_START + N * BUILD_STEP. */
const BUILD_START = 2400
const BUILD_STEP = 620
const REPLY_AT = 6400
const TOTAL_MS = 12_500
const RESET_FADE_MS = 260

/**
 * The homepage's live platform preview, rendered through the same shared shell
 * as every product and solutions hero so the sidebar never drifts between
 * landing surfaces. Inside, the layout mirrors `Home`: the
 * {@link HeroChatLoop} is a flex-1
 * `--bg` column; the {@link HeroWorkflowStage} pane animates `w-0 ↔ w-1/2`
 * with the real `MothershipView` width transition (200ms,
 * `cubic-bezier(0.25,0.1,0.25,1)`, `border-l` only while open), matching the
 * divider users see in the product.
 *
 * Both panes stay `pointer-events-none` (decorative, matching the hero's
 * `aria-hidden` frame) - blocks are static. Remounting the stage per cycle
 * (`key={cycleId}`) resets build state.
 *
 * Under `prefers-reduced-motion` the loop never starts: the finished exchange,
 * open stage, and fully-built workflow render statically.
 */
export function HeroPlatformLoop() {
  const [phase, setPhase] = useState<HeroChatPhase>('idle')
  const [stageOpen, setStageOpen] = useState(false)
  const [builtCount, setBuiltCount] = useState(0)
  const [fading, setFading] = useState(false)
  const [cycleId, setCycleId] = useState(0)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let timers: ReturnType<typeof setTimeout>[] = []

    const clearScheduled = () => {
      timers.forEach(clearTimeout)
      timers = []
    }

    const showFinished = () => {
      clearScheduled()
      setFading(false)
      setPhase('reply')
      setStageOpen(true)
      setBuiltCount(STAGE_BLOCKS.length)
    }

    const runCycle = () => {
      setFading(false)
      setPhase('idle')
      setStageOpen(false)
      setBuiltCount(0)
      setCycleId((c) => c + 1)
      timers = [
        setTimeout(() => setPhase('user'), PHASE_STARTS.user),
        setTimeout(() => setPhase('thinking'), PHASE_STARTS.thinking),
        setTimeout(() => setStageOpen(true), STAGE_OPEN_AT),
        ...STAGE_BLOCKS.map((_, i) =>
          setTimeout(() => setBuiltCount(i + 1), BUILD_START + i * BUILD_STEP)
        ),
        setTimeout(() => setPhase('reply'), REPLY_AT),
        setTimeout(() => setFading(true), TOTAL_MS - RESET_FADE_MS),
        setTimeout(runCycle, TOTAL_MS),
      ]
    }

    const syncMotionPreference = () => {
      clearScheduled()
      if (media.matches) {
        showFinished()
        return
      }
      runCycle()
    }

    syncMotionPreference()
    media.addEventListener('change', syncMotionPreference)
    return () => {
      media.removeEventListener('change', syncMotionPreference)
      clearScheduled()
    }
  }, [])

  return (
    <HeroLoopShell chats={PREVIEW_SIDEBAR_CHATS} workflows={PREVIEW_SIDEBAR_WORKFLOWS}>
      <div className='flex h-full w-full overflow-hidden rounded-[6px] border border-[var(--border)] bg-[var(--bg)]'>
        <div className='relative h-full min-w-0 flex-1'>
          <HeroChatLoop phase={phase} fading={fading} />
        </div>
        <div
          className={cn(
            'h-full shrink-0 overflow-hidden border-[var(--border)] bg-[var(--bg)] transition-[width,min-width,border-width] duration-200 [transition-timing-function:cubic-bezier(0.25,0.1,0.25,1)]',
            stageOpen ? 'w-1/2 border-l' : 'w-0 min-w-0 border-l-0'
          )}
        >
          <div
            className={cn(
              'h-full w-full transition-opacity duration-300 ease-out',
              fading ? 'opacity-0' : 'opacity-100'
            )}
          >
            <HeroWorkflowStage key={cycleId} builtCount={builtCount} />
          </div>
        </div>
      </div>
    </HeroLoopShell>
  )
}
