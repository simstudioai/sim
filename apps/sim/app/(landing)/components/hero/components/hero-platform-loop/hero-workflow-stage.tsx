import { useMemo } from 'react'
import { cn } from '@sim/emcn'
import { StageBlockCard } from '@/app/(landing)/components/hero/components/hero-platform-loop/stage-block-card'
import {
  blockHeight,
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
 * chat loop. One stable SVG viewBox owns both the edge and block coordinate
 * systems, so drawing a line or revealing a block never changes the canvas's
 * measured scale. Blocks pop in one by one as `builtCount` advances and edges
 * stroke-draw once both endpoints exist.
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
  const blocksById = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks])

  const builtIds = useMemo(
    () => new Set(blocks.slice(0, builtCount).map((b) => b.id)),
    [blocks, builtCount]
  )

  return (
    <svg
      aria-hidden='true'
      className='size-full overflow-hidden'
      viewBox={`${-STAGE_MARGIN / 2} ${-STAGE_MARGIN / 2} ${canvas.width + STAGE_MARGIN} ${canvas.height + STAGE_MARGIN}`}
      preserveAspectRatio='xMidYMid meet'
      fill='none'
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
            className={cn(
              'transition-[stroke-dashoffset] duration-500 [stroke-dasharray:1] [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]',
              visible ? '[stroke-dashoffset:0]' : '[stroke-dashoffset:1]'
            )}
          />
        )
      })}

      {blocks.map((block) => {
        const built = builtIds.has(block.id)
        return (
          <foreignObject
            key={block.id}
            x={block.x}
            y={block.y}
            width={BLOCK_WIDTH}
            height={blockHeight(block)}
            overflow='visible'
          >
            <div
              className={cn(
                'pointer-events-none relative size-full origin-center transition-[opacity,scale] duration-300 will-change-[opacity,transform] [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]',
                built ? 'scale-100 opacity-100' : 'scale-[0.94] opacity-0'
              )}
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
          </foreignObject>
        )
      })}
    </svg>
  )
}
