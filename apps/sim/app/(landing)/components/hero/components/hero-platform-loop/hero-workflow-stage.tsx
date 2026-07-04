'use client'

import { type CSSProperties, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@sim/emcn'
import {
  handleAnchors,
  STAGE_BLOCKS,
  STAGE_CANVAS,
  STAGE_EDGES,
  verticalSmoothStep,
} from '@/app/(landing)/components/hero/components/hero-platform-loop/stage-data'
import { WorkflowBlockContent } from '@/app/(landing)/components/hero/components/hero-visual/workflow-block-content'
import type { BlockDef } from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'
import { BLOCK_WIDTH } from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'

/** Upper bound on the canvas render scale (the scale at the full 1300px cap). */
const MAX_STAGE_SCALE = 0.71
/** Breathing room between the canvas bounds and the card edges, in card px. */
const STAGE_MARGIN = 20

interface HeroWorkflowStageProps {
  /** How many of {@link STAGE_BLOCKS} (in build order) are on canvas. */
  builtCount: number
}

type Positions = Record<string, { x: number; y: number }>

const initialPositions = (): Positions =>
  Object.fromEntries(STAGE_BLOCKS.map((b) => [b.id, { x: b.x, y: b.y }]))

/**
 * The hero window's live workflow canvas - the right-pane counterpart of the
 * chat loop. Blocks pop in one by one as `builtCount` advances (staggered
 * scale/fade entrances, edges stroke-draw once both endpoints exist), and every
 * block is DRAGGABLE: pointer-drag updates its position (scaled to design
 * space) and its edges follow live. The edge SVG is `overflow-visible` -
 * SVGs clip at their viewport by default, which cut the lines the moment a
 * dragged block left the design-canvas bounds while the HTML block cards
 * escaped freely. Positions reset when the parent remounts the stage for a
 * new loop pass (`key={cycleId}`).
 *
 * Blocks reuse the hero-visual's {@link WorkflowBlockContent} (the faithful
 * icon-tile + rows card body) in a card shell with vertical-flow handle nubs
 * (top in / bottom out), matching the real editor's vertical layout.
 */
export function HeroWorkflowStage({ builtCount }: HeroWorkflowStageProps) {
  const [positions, setPositions] = useState<Positions>(initialPositions)
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(MAX_STAGE_SCALE)
  const dragRef = useRef<{
    id: string
    pointerId: number
    startX: number
    startY: number
    originX: number
    originY: number
    /** Total design-px -> visual-px factor for the dragged block (this stage's
     * fit scale x the platform loop's design-space scale), captured at grab. */
    visualScale: number
  } | null>(null)

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

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, id: string) => {
      if (dragRef.current) return
      const pos = positions[id]
      dragRef.current = {
        id,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        originX: pos.x,
        originY: pos.y,
        // Rendered width / design width = the block's total visual scale, all
        // ancestor transforms included - no need to thread each factor through.
        visualScale: e.currentTarget.getBoundingClientRect().width / BLOCK_WIDTH,
      }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [positions]
  )

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || e.pointerId !== drag.pointerId || drag.visualScale <= 0) return
    const dx = (e.clientX - drag.startX) / drag.visualScale
    const dy = (e.clientY - drag.startY) / drag.visualScale
    setPositions((prev) => ({
      ...prev,
      [drag.id]: { x: drag.originX + dx, y: drag.originY + dy },
    }))
  }, [])

  const onPointerEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || e.pointerId !== drag.pointerId) return
    dragRef.current = null
  }, [])

  const byId = new Map(STAGE_BLOCKS.map((b) => [b.id, b]))
  const builtIds = new Set(STAGE_BLOCKS.slice(0, builtCount).map((b) => b.id))

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
              const source = byId.get(from)
              const target = byId.get(to)
              if (!source || !target) return null
              const visible = builtIds.has(from) && builtIds.has(to)
              const s = handleAnchors(source, positions[from]).out
              const t = handleAnchors(target, positions[to]).in
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
            const pos = positions[block.id]
            return (
              <div
                key={block.id}
                className={cn(
                  'absolute cursor-grab touch-none select-none active:cursor-grabbing',
                  'transition-[opacity,scale] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
                  built ? 'scale-100 opacity-100' : 'pointer-events-none scale-[0.94] opacity-0'
                )}
                style={{ left: pos.x, top: pos.y, width: BLOCK_WIDTH }}
                onPointerDown={(e) => onPointerDown(e, block.id)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerEnd}
                onPointerCancel={onPointerEnd}
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

/**
 * Block card shell for the vertical-flow stage - the hero-visual's faithful
 * {@link WorkflowBlockContent} body with top (incoming) / bottom (outgoing)
 * handle nubs instead of the horizontal-flow left/right ones.
 */
function StageBlockCard({ block }: { block: BlockDef }) {
  return (
    <div className='relative rounded-[13px] border border-[var(--border-1)] bg-[var(--surface-2)] shadow-sm'>
      <WorkflowBlockContent block={block} />
      {!block.isTrigger && (
        <span
          aria-hidden
          className='-translate-x-1/2 absolute top-[-7px] left-1/2 h-[7px] w-5 rounded-t-[2px] bg-[var(--workflow-edge)]'
        />
      )}
      {!block.isTerminal && (
        <span
          aria-hidden
          className='-translate-x-1/2 absolute bottom-[-7px] left-1/2 h-[7px] w-5 rounded-b-[2px] bg-[var(--workflow-edge)]'
        />
      )}
    </div>
  )
}
