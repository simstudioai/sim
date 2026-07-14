'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@sim/emcn'
import { HeroWorkflowStage } from '@/app/(landing)/components/hero/components/hero-platform-loop/hero-workflow-stage'
import { EnterpriseHomeStage } from '@/app/(landing)/enterprise/components/enterprise-platform-loop/enterprise-home-stage'
import { EnterpriseSidebar } from '@/app/(landing)/enterprise/components/enterprise-platform-loop/enterprise-sidebar'
import {
  BUILD_STEP_MS,
  buildLoopTimeline,
  ENTERPRISE_LOOP_CONTENT,
  type EnterpriseLoopContent,
  type EnterpriseLoopPhase,
  RESET_FADE_MS,
} from '@/app/(landing)/enterprise/components/enterprise-platform-loop/stage-data'

/**
 * The window interior's design space, matching the homepage loop's capture
 * geometry (the 2560x1470 shot is a 1280x735 CSS layout shown in the 1080x620
 * window, so the app's native type reads at the same ~84.4% "mini app" scale):
 * the sidebar column is 249px, and the workspace container is inset 7-8px.
 */
const DESIGN = { width: 1280, height: 735 } as const

interface EnterprisePlatformLoopProps {
  /**
   * Domain content the loop replays - sidebar identity, chat exchange, and
   * staged workflow. Defaults to the enterprise page's own content, so
   * existing consumers render exactly as before; the solutions pages pass
   * their per-domain content through the same shape.
   */
  content?: EnterpriseLoopContent
}

/**
 * The enterprise hero's platform loop - a sibling of the homepage
 * `HeroPlatformLoop` that shares its architecture (fixed design-space layer
 * scaled to the window via ResizeObserver + `transform: scale`, a parent-owned
 * timeline clock driving presentational stages, reduced-motion showing a
 * static finished frame) but diverges in content: where the homepage overlays
 * a live chat over a baked screenshot, this variant renders the WHOLE interior
 * live - the {@link EnterpriseSidebar} (a filled-out Brightwave workspace) and
 * the {@link EnterpriseHomeStage} (the real new-chat home view, replaying an
 * enterprise prompt) - because its sidebar content differs from the shot's.
 *
 * Timeline (see `stage-data.ts` - later stages append beats there): idle
 * new-chat view → prompt types out → send arms → dispatch (user bubble +
 * thinking, full-width) → the stage pane slides in from the right (the real
 * `MothershipView` `w-0 ↔ w-1/2` width transition) → the staged workflow
 * assembles block by block (the shared {@link HeroWorkflowStage}) → the reply
 * streams in → hold → fade → restart.
 *
 * Everything is `pointer-events-none` decorative, matching the hero's
 * `aria-hidden` frame. Under `prefers-reduced-motion` the loop never starts:
 * the finished exchange, open stage, and fully-built workflow render
 * statically.
 */
export function EnterprisePlatformLoop({
  content = ENTERPRISE_LOOP_CONTENT,
}: EnterprisePlatformLoopProps = {}) {
  const regionRef = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState<EnterpriseLoopPhase>('idle')
  const [stageOpen, setStageOpen] = useState(false)
  const [builtCount, setBuiltCount] = useState(0)
  const [fading, setFading] = useState(false)
  const [cycleId, setCycleId] = useState(0)
  const [scale, setScale] = useState(1)

  const timeline = useMemo(() => buildLoopTimeline(content), [content])
  const blockCount = content.stageBlocks.length

  // Track the rendered region width and scale the design-space layer to fill
  // it, keeping the live layer's proportions locked to the window's.
  useLayoutEffect(() => {
    const el = regionRef.current
    if (!el) return
    const measure = () => {
      const w = el.getBoundingClientRect().width
      if (w > 40) setScale(w / DESIGN.width)
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
      setBuiltCount(blockCount)
    }

    const runCycle = () => {
      setFading(false)
      setPhase('idle')
      setStageOpen(false)
      setBuiltCount(0)
      setCycleId((c) => c + 1)
      timers = [
        setTimeout(() => setPhase('typing'), timeline.typing),
        setTimeout(() => setPhase('typed'), timeline.typed),
        setTimeout(() => setPhase('dispatch'), timeline.dispatch),
        setTimeout(() => setStageOpen(true), timeline.stageOpen),
        ...Array.from({ length: blockCount }, (_, i) =>
          setTimeout(() => setBuiltCount(i + 1), timeline.buildStart + i * BUILD_STEP_MS)
        ),
        setTimeout(() => setPhase('reply'), timeline.reply),
        setTimeout(() => setFading(true), timeline.total - RESET_FADE_MS),
        setTimeout(runCycle, timeline.total),
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
  }, [timeline, blockCount])

  return (
    <div ref={regionRef} className='pointer-events-none absolute inset-0 overflow-hidden'>
      <div
        className='flex origin-top-left bg-[var(--surface-1)]'
        style={{
          width: DESIGN.width,
          height: DESIGN.height,
          transform: `scale(${scale})`,
        }}
      >
        <EnterpriseSidebar
          workspaceName={content.workspaceName}
          chats={content.sidebarChats}
          workflows={content.sidebarWorkflows}
        />
        <div className='h-full min-w-0 flex-1 py-[7px] pr-[8px]'>
          <div className='flex h-full w-full overflow-hidden rounded-[6px] border border-[var(--border)] bg-[var(--bg)]'>
            <div className='relative h-full min-w-0 flex-1'>
              <EnterpriseHomeStage
                phase={phase}
                fading={fading}
                greeting={content.greeting}
                placeholder={content.placeholder}
                prompt={content.prompt}
                reply={content.reply}
                suggestedActions={content.suggestedActions}
              />
            </div>
            <div
              className={cn(
                'h-full shrink-0 overflow-hidden border-[var(--border)] bg-[var(--bg)] transition-[width,min-width,border-width] duration-200 ease-[cubic-bezier(0.25,0.1,0.25,1)]',
                stageOpen ? 'w-1/2 border-l' : 'w-0 min-w-0 border-l-0'
              )}
            >
              <div
                className={cn(
                  'h-full w-full transition-opacity duration-300 ease-out',
                  fading ? 'opacity-0' : 'opacity-100'
                )}
              >
                <HeroWorkflowStage
                  key={cycleId}
                  builtCount={builtCount}
                  blocks={content.stageBlocks}
                  edges={content.stageEdges}
                  canvas={content.stageCanvas}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
