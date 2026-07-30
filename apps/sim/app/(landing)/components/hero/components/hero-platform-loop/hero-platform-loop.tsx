'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@sim/emcn'
import {
  HeroChatLoop,
  type HeroChatPhase,
} from '@/app/(landing)/components/hero/components/hero-chat-loop'
import { HeroWorkflowStage } from '@/app/(landing)/components/hero/components/hero-platform-loop/hero-workflow-stage'
import { SidebarHotspots } from '@/app/(landing)/components/hero/components/hero-platform-loop/sidebar-hotspots'
import { STAGE_BLOCKS } from '@/app/(landing)/components/hero/components/hero-platform-loop/stage-data'

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
 * The workspace container's interior in the capture's design space (the shot
 * is 2560x1470 at 2x, i.e. a 1280x735 CSS layout - oversized vs the 1080x620
 * window so the whole UI displays at 84.4%, landing the app's native type at
 * cursor.com's ~12.7px demo scale): x 249-1272, y 7-727. The live layer lays
 * out at this FIXED size and scales down with the window (`transform: scale`),
 * so its text and controls shrink in lockstep with the baked sidebar pixels -
 * the "mini app" reading - instead of rendering at 1:1 CSS sizes and looking
 * oversized next to the scaled screenshot.
 */
const CHROME_INTERIOR = { width: 1024, height: 721 } as const

/**
 * The hero window's live layer - one flex region replaying the REAL Home
 * two-pane over the static screenshot. The region covers the workspace
 * container's interior (inset a hair inside the shot's baked chrome: the
 * horizontal rules 6px from the card top/bottom (the chrome's `p-[8px]` gap is
 * tightened to 6px at capture time), the container's left border at ~19.4%,
 * and its right border at ~99.4%; the container renders at `6px` radius
 * (overridden at capture time from the chrome's 8px so it DISPLAYS at the
 * concentric ~4.9px after the 84.4% shot-to-window factor), so the region
 * clips itself `rounded-[4px]` to hug the baked corner curves without
 * covering them) so every visible outline is the real UI's pixels.
 *
 * Inside, the layout mirrors `Home`: the {@link HeroChatLoop} is a flex-1
 * `--bg` column; the {@link HeroWorkflowStage} pane animates `w-0 ↔ w-1/2`
 * with the real `MothershipView` width transition (200ms,
 * `cubic-bezier(0.25,0.1,0.25,1)`, `border-l` only while open) - the baked
 * chat|stage divider is covered by this region, so the divider users see is
 * the live `border-l`, appearing exactly as it does in the product.
 *
 * Both panes stay `pointer-events-none` (decorative, matching the hero's
 * `aria-hidden` frame) - blocks are static. Remounting the stage per cycle
 * (`key={cycleId}`) resets build state.
 *
 * Under `prefers-reduced-motion` the loop never starts: the finished exchange,
 * open stage, and fully-built workflow render statically.
 */
export function HeroPlatformLoop() {
  const regionRef = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState<HeroChatPhase>('idle')
  const [stageOpen, setStageOpen] = useState(false)
  const [builtCount, setBuiltCount] = useState(0)
  const [fading, setFading] = useState(false)
  const [cycleId, setCycleId] = useState(0)
  const [scale, setScale] = useState(1)

  // Track the rendered region width and scale the design-space layer to fill
  // it, keeping the live layer's proportions locked to the screenshot's.
  useLayoutEffect(() => {
    const el = regionRef.current
    if (!el) return
    const measure = () => {
      const w = el.getBoundingClientRect().width
      if (w > 40) setScale(w / CHROME_INTERIOR.width)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

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
    <>
      <SidebarHotspots />
      <div
        ref={regionRef}
        className='absolute top-[0.95%] right-[0.55%] bottom-[0.95%] left-[19.45%] overflow-hidden rounded-[4px]'
      >
        <div
          className='flex origin-top-left'
          style={{
            width: CHROME_INTERIOR.width,
            height: CHROME_INTERIOR.height,
            transform: `scale(${scale})`,
          }}
        >
          <div className='pointer-events-none relative h-full min-w-0 flex-1'>
            <HeroChatLoop phase={phase} fading={fading} />
          </div>
          <div
            className={cn(
              'h-full shrink-0 overflow-hidden border-[var(--border)] bg-[var(--bg)] transition-[width,min-width,border-width] duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)]',
              stageOpen ? 'w-1/2 border-l' : 'w-0 min-w-0 border-l-0'
            )}
          >
            <HeroWorkflowStage key={cycleId} builtCount={builtCount} />
          </div>
        </div>
      </div>
    </>
  )
}
