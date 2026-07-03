'use client'

import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@sim/emcn'
import { WorkflowBlock } from '@/app/(landing)/components/hero/components/hero-visual/workflow-block'
import {
  BLOCK_WIDTH,
  BLOCKS,
  CANVAS,
  EDGES,
  WORKFLOW_FOCUS_SCALE,
} from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'

/** The camera beat: held on the first block, panning out, or settled on the whole flow. */
export type WorkflowCameraStage = 'focus' | 'out' | 'hold'

interface StageWorkflowProps {
  stage: WorkflowCameraStage
}

/** First (GitHub) block center in design space - the camera's focus target. */
const FOCUS_CENTER = { x: BLOCK_WIDTH / 2, y: 38 }
/** Whole-canvas center - the overview camera target. */
const CANVAS_CENTER = { x: CANVAS.width / 2, y: CANVAS.height / 2 }
/** Zoomed-in scale while held on the first block (≈ the morphed chat card size). */
const FOCUS_SCALE = WORKFLOW_FOCUS_SCALE
/** Pulled-back scale that fits the whole workflow in the panel. */
const OVERVIEW_SCALE = 0.68

/**
 * The workflow stage of the hero visual - a design-space canvas with a moving
 * "camera". It opens **focused** on the first block (the chat card has just
 * morphed into it), holds while that block's content lands and the first edge
 * draws, then the camera **pans + zooms out together** to reveal the whole
 * GitHub → Agent → Jira flow (the {@link stage} prop drives this).
 *
 * The camera is a transform on the design-space canvas, positioned so the focus
 * point lands at the panel center: `translate(vpW/2 - cx·s, vpH/2 - cy·s)
 * scale(s)` (origin top-left). The panel size is measured; until it is known,
 * and on first mount, the transition is suppressed so the opening focus frame
 * doesn't animate in from a fallback. Purely decorative - `aria-hidden`.
 */
export function StageWorkflow({ stage }: StageWorkflowProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [vp, setVp] = useState<{ w: number; h: number } | null>(null)
  const [animate, setAnimate] = useState(false)

  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      // Guard an unpainted/collapsed panel from poisoning the camera math.
      if (r.width > 120 && r.height > 120) setVp({ w: r.width, h: r.height })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Enable the camera transition only after the opening focus frame is painted,
  // so mounting (and the first measurement) snaps into focus rather than gliding.
  useEffect(() => {
    if (vp) setAnimate(true)
  }, [vp])

  const focused = stage === 'focus'
  const center = focused ? FOCUS_CENTER : CANVAS_CENTER
  const scale = focused ? FOCUS_SCALE : OVERVIEW_SCALE
  const transform = vp
    ? `translate(${vp.w / 2 - center.x * scale}px, ${vp.h / 2 - center.y * scale}px) scale(${scale})`
    : `translate(0px, 0px) scale(${OVERVIEW_SCALE})`

  return (
    <div ref={viewportRef} className='relative h-full w-full overflow-hidden'>
      <div
        className={cn(
          'absolute top-0 left-0',
          animate && 'transition-transform duration-[1700ms] ease-[cubic-bezier(0.22,1,0.36,1)]'
        )}
        style={{
          width: CANVAS.width,
          height: CANVAS.height,
          transform,
          transformOrigin: '0 0',
        }}
      >
        <svg
          className='absolute inset-0'
          width={CANVAS.width}
          height={CANVAS.height}
          viewBox={`0 0 ${CANVAS.width} ${CANVAS.height}`}
          fill='none'
          aria-hidden='true'
        >
          {EDGES.map((edge, i) => (
            <path
              key={edge.id}
              d={edge.d}
              pathLength={1}
              stroke='var(--workflow-edge)'
              strokeWidth={2}
              strokeLinecap='round'
              className='transition-[stroke-dashoffset] duration-[700ms] ease-[cubic-bezier(0.22,1,0.36,1)] [stroke-dasharray:1]'
              // Edges stay undrawn while focused; once the camera pulls out they
              // draw in order (the second trails the first) as each target is revealed.
              style={
                {
                  strokeDashoffset: focused ? 1 : 0,
                  transitionDelay: `${i * 700}ms`,
                } as CSSProperties
              }
            />
          ))}
        </svg>
        {BLOCKS.map((block) => (
          // The first block is already on screen - the chat card morphed into it,
          // and the focused camera lands it pixel-matched here; the rest sit in
          // design space and are revealed by the camera pull-out.
          <div
            key={block.id}
            className='absolute'
            style={{ left: block.x, top: block.y, width: BLOCK_WIDTH }}
          >
            <WorkflowBlock block={block} />
          </div>
        ))}
      </div>
    </div>
  )
}
