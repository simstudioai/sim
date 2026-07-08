'use client'

import { type CSSProperties, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@sim/emcn'
import { StageBlockCard } from '@/app/(landing)/components/hero/components/hero-platform-loop/stage-block-card'
import {
  handleAnchors,
  STAGE_BLOCKS,
  STAGE_CANVAS,
  STAGE_EDGES,
  verticalSmoothStep,
} from '@/app/(landing)/components/hero/components/hero-platform-loop/stage-data'
import { BLOCK_WIDTH } from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'

/** Upper bound on the canvas render scale (the scale at the full 1300px cap). */
const MAX_STAGE_SCALE = 0.71
/** Breathing room between the canvas bounds and the card edges, in card px. */
const STAGE_MARGIN = 20

interface HeroWorkflowStageProps {
  /** How many of {@link STAGE_BLOCKS} (in build order) are on canvas. */
  builtCount: number
}

const STAGE_BLOCKS_BY_ID = new Map(STAGE_BLOCKS.map((b) => [b.id, b]))

/**
 * The hero window's live workflow canvas - the right-pane counterpart of the
 * chat loop. Blocks pop in one by one as `builtCount` advances (staggered
 * scale/fade entrances, edges stroke-draw once both endpoints exist) at their
 * fixed positions. The edge SVG is `overflow-visible` - SVGs clip
 * at their viewport by default, which would cut the lines if a block ever sat
 * outside the design-canvas bounds.
 *
 * Decorative and `aria-hidden` (via the parent frame), so blocks are NOT
 * draggable - `pointer-events-none`, matching the rest of the hero animation.
 *
 * Blocks reuse the hero-visual's {@link WorkflowBlockContent} (the faithful
 * icon-tile + rows card body) in a card shell with vertical-flow handle nubs
 * (top in / bottom out), matching the real editor's vertical layout.
 */
export function HeroWorkflowStage({ builtCount }: HeroWorkflowStageProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(MAX_STAGE_SCALE)

  // Fit the design canvas to the card: scale down when the pane narrows so the
  // branch blocks never clip, capped at the full-width scale. Measures LAYOUT
  // size (offsetWidth/Height) - the stage lives inside the platform loop's
  // scale-transformed design-space layer, and getBoundingClientRect's visual
  // size would compound that outer scale into a double shrink.
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      const w = el.offsetWidth
      const h = el.offsetHeight
      if (w < 40 || h < 40) return
      setScale(
        Math.min(
          MAX_STAGE_SCALE,
          (w - STAGE_MARGIN) / STAGE_CANVAS.width,
          (h - STAGE_MARGIN) / STAGE_CANVAS.height
        )
      )
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const builtIds = useMemo(
    () => new Set(STAGE_BLOCKS.slice(0, builtCount).map((b) => b.id)),
    [builtCount]
  )

  return (
    <div
      ref={containerRef}
      className='flex h-full w-full items-center justify-center overflow-hidden'
    >
      <div
        className='relative shrink-0'
        style={{
          width: STAGE_CANVAS.width * scale,
          height: STAGE_CANVAS.height * scale,
        }}
      >
        <div
          className='absolute top-0 left-0'
          style={{
            width: STAGE_CANVAS.width,
            height: STAGE_CANVAS.height,
            transform: `scale(${scale})`,
            transformOrigin: '0 0',
          }}
        >
          <svg
            className='pointer-events-none absolute inset-0 overflow-visible'
            width={STAGE_CANVAS.width}
            height={STAGE_CANVAS.height}
            viewBox={`0 0 ${STAGE_CANVAS.width} ${STAGE_CANVAS.height}`}
            fill='none'
            aria-hidden='true'
          >
            {STAGE_EDGES.map(([from, to]) => {
              const source = STAGE_BLOCKS_BY_ID.get(from)
              const target = STAGE_BLOCKS_BY_ID.get(to)
              if (!source || !target) return null
              const visible = builtIds.has(from) && builtIds.has(to)
              const s = handleAnchors(source, source).out
              const t = handleAnchors(target, target).in
              return (
                <path
                  key={`${from}-${to}`}
                  d={verticalSmoothStep(s.x, s.y, t.x, t.y)}
                  pathLength={1}
                  stroke='var(--workflow-edge)'
                  strokeWidth={2}
                  strokeLinecap='round'
                  className='transition-[stroke-dashoffset] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] [stroke-dasharray:1]'
                  style={{ strokeDashoffset: visible ? 0 : 1 } as CSSProperties}
                />
              )
            })}
          </svg>

          {STAGE_BLOCKS.map((block) => {
            const built = builtIds.has(block.id)
            return (
              <div
                key={block.id}
                className={cn(
                  'pointer-events-none absolute transition-[opacity,scale] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
                  built ? 'scale-100 opacity-100' : 'scale-[0.94] opacity-0'
                )}
                style={{ left: block.x, top: block.y, width: BLOCK_WIDTH }}
              >
                <StageBlockCard block={block} />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
