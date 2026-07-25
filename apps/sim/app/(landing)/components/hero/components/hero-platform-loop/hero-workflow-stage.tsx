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
import {
  BLOCK_WIDTH,
  type BlockDef,
} from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'

/** Upper bound on the canvas render scale (the scale at the full 1300px cap). */
const MAX_STAGE_SCALE = 0.71
/** Breathing room between the canvas bounds and the card edges, in card px. */
const STAGE_MARGIN = 20

interface HeroWorkflowStageProps {
  /** How many of the stage's blocks (in build order) are on canvas. */
  builtCount: number
  /** Blocks to stage, in build order. Defaults to the homepage's lead flow. */
  blocks?: BlockDef[]
  /** Source → target pairs among {@link blocks}. Defaults with them. */
  edges?: ReadonlyArray<readonly [string, string]>
  /** Design-space bounding box of the block layout. Defaults with them. */
  canvas?: { width: number; height: number }
  /**
   * Block to dress with the selection ring - graphite (`--text-secondary`)
   * rather than the real canvas's blue, per the landing pages' grayscale
   * language - the workflows hero uses this for its "being edited" beat.
   * Off by default, so existing stages are unchanged.
   */
  selectedId?: string
}

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
 *
 * The staged flow is injectable (`blocks`/`edges`/`canvas`), defaulting to the
 * homepage's lead-enrichment flow - the enterprise loop stages its own flow
 * through the same component.
 */
export function HeroWorkflowStage({
  builtCount,
  blocks = STAGE_BLOCKS,
  edges = STAGE_EDGES,
  canvas = STAGE_CANVAS,
  selectedId,
}: HeroWorkflowStageProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(MAX_STAGE_SCALE)
  const blocksById = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks])

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
          (w - STAGE_MARGIN) / canvas.width,
          (h - STAGE_MARGIN) / canvas.height
        )
      )
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [canvas.width, canvas.height])

  const builtIds = useMemo(
    () => new Set(blocks.slice(0, builtCount).map((b) => b.id)),
    [blocks, builtCount]
  )

  return (
    <div
      ref={containerRef}
      className='flex h-full w-full items-center justify-center overflow-hidden'
    >
      <div
        className='relative shrink-0'
        style={{
          width: canvas.width * scale,
          height: canvas.height * scale,
        }}
      >
        <div
          className='absolute top-0 left-0'
          style={{
            width: canvas.width,
            height: canvas.height,
            transform: `scale(${scale})`,
            transformOrigin: '0 0',
          }}
        >
          <svg
            className='pointer-events-none absolute inset-0 overflow-visible'
            width={canvas.width}
            height={canvas.height}
            viewBox={`0 0 ${canvas.width} ${canvas.height}`}
            fill='none'
            aria-hidden='true'
          >
            {edges.map(([from, to]) => {
              const source = blocksById.get(from)
              const target = blocksById.get(to)
              if (!source || !target) return null
              const visible = builtIds.has(from) && builtIds.has(to)
              const s = handleAnchors(source).out
              const t = handleAnchors(target).in
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

          {blocks.map((block) => {
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
                <span
                  aria-hidden
                  className={cn(
                    'pointer-events-none absolute inset-0 rounded-[13px] ring-[1.75px] ring-[var(--text-secondary)] transition-opacity duration-300 ease-out',
                    selectedId === block.id && built ? 'opacity-100' : 'opacity-0'
                  )}
                />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
