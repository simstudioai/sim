'use client'

import { useMemo, useState } from 'react'
import { cn } from '@sim/emcn'
import { HeroWorkflowStage } from '@/app/(landing)/components/hero/components/hero-platform-loop/hero-workflow-stage'
import { HeroLoopShell } from '@/app/(landing)/components/shared/hero-loop-shell'
import { EnterpriseHomeStage } from '@/app/(landing)/enterprise/components/enterprise-platform-loop/enterprise-home-stage'
import {
  BUILD_STEP_MS,
  buildLoopTimeline,
  ENTERPRISE_LOOP_CONTENT,
  type EnterpriseLoopContent,
  type EnterpriseLoopPhase,
} from '@/app/(landing)/enterprise/components/enterprise-platform-loop/stage-data'
import { RESET_FADE_MS } from '@/app/(landing)/hooks/use-design-scale'
import { useMotionSafeCycle } from '@/app/(landing)/hooks/use-motion-safe-cycle'

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
  const [phase, setPhase] = useState<EnterpriseLoopPhase>('idle')
  const [stageOpen, setStageOpen] = useState(false)
  const [builtCount, setBuiltCount] = useState(0)
  const [fading, setFading] = useState(false)
  const [cycleId, setCycleId] = useState(0)

  const timeline = useMemo(() => buildLoopTimeline(content), [content])
  const blockCount = content.stageBlocks.length

  useMotionSafeCycle(
    {
      scheduleCycle: () => {
        setFading(false)
        setPhase('idle')
        setStageOpen(false)
        setBuiltCount(0)
        setCycleId((c) => c + 1)
        return {
          timers: [
            setTimeout(() => setPhase('typing'), timeline.typing),
            setTimeout(() => setPhase('typed'), timeline.typed),
            setTimeout(() => setPhase('dispatch'), timeline.dispatch),
            setTimeout(() => setStageOpen(true), timeline.stageOpen),
            ...Array.from({ length: blockCount }, (_, i) =>
              setTimeout(() => setBuiltCount(i + 1), timeline.buildStart + i * BUILD_STEP_MS)
            ),
            setTimeout(() => setPhase('reply'), timeline.reply),
            setTimeout(() => setFading(true), timeline.total - RESET_FADE_MS),
          ],
          totalMs: timeline.total,
        }
      },
      showFinished: () => {
        setFading(false)
        setPhase('reply')
        setStageOpen(true)
        setBuiltCount(blockCount)
      },
    },
    [timeline, blockCount]
  )

  return (
    <HeroLoopShell
      workspaceName={content.workspaceName}
      chats={content.sidebarChats}
      workflows={content.sidebarWorkflows}
    >
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
    </HeroLoopShell>
  )
}
