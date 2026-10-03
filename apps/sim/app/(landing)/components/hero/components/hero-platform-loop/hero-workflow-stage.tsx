'use client'

import { useMemo } from 'react'
import { cn } from '@sim/emcn'
import dynamic from 'next/dynamic'
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
  blockHeight,
} from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'
import { ResponsiveDesignStage } from '@/app/(landing)/components/shared/responsive-design-stage'

/** Breathing room between the canvas bounds and the card edges, in card px. */
const STAGE_MARGIN = 20

/**
 * The interactive stage mounts React Flow and the production renderers. It is
 * loaded on demand so the staged loops (and every page that renders them) never
 * ship that graph; the homepage fetches it with the lazily mounted hero loop.
 */
const ProductionWorkflowStage = dynamic(
  () =>
    import(
      '@/app/(landing)/components/hero/components/hero-platform-loop/production-workflow-stage'
    ).then((mod) => mod.ProductionWorkflowStage),
  { ssr: false }
)

interface HeroWorkflowStageProps {
  /** How many of the stage's blocks (in build order) are on canvas. */
  builtCount: number
  /** Blocks to stage, in build order. Defaults to the homepage's lead flow. */
  blocks?: BlockDef[]
  /** Source → target pairs among {@link blocks}. Defaults with them. */
  edges?: ReadonlyArray<readonly [string, string]>
  /** Design-space bounding box of the block layout. Defaults with them. */
  canvas?: { width: number; height: number }
  /** Block to dress with the selection ring in the timed, non-interactive loops. */
  selectedId?: string
  /** Mounts the shared production node and edge renderers in a real React Flow canvas. */
  interactive?: boolean
}

interface StagedHeroWorkflowStageProps {
  builtCount: number
  blocks: BlockDef[]
  edges: ReadonlyArray<readonly [string, string]>
  canvas: { width: number; height: number }
  selectedId?: string
}

/** Timed, non-interactive workflow stage used by the secondary landing loops. */
function StagedHeroWorkflowStage({
  builtCount,
  blocks,
  edges,
  canvas,
  selectedId,
}: StagedHeroWorkflowStageProps) {
  const blocksById = useMemo(() => new Map(blocks.map((block) => [block.id, block])), [blocks])
  const builtIds = useMemo(
    () => new Set(blocks.slice(0, builtCount).map((block) => block.id)),
    [blocks, builtCount]
  )

  return (
    <ResponsiveDesignStage
      width={canvas.width}
      height={canvas.height}
      inset={STAGE_MARGIN}
      className='size-full'
      contentClassName='relative'
    >
      <svg
        aria-hidden='true'
        className='pointer-events-none absolute inset-0 size-full overflow-visible'
        viewBox={`0 0 ${canvas.width} ${canvas.height}`}
        fill='none'
      >
        {edges.map(([from, to]) => {
          const source = blocksById.get(from)
          const target = blocksById.get(to)
          if (!source || !target) return null
          const visible = builtIds.has(from) && builtIds.has(to)
          const sourceAnchor = handleAnchors(source).out
          const targetAnchor = handleAnchors(target).in

          return (
            <path
              key={`${from}-${to}`}
              d={verticalSmoothStep(sourceAnchor.x, sourceAnchor.y, targetAnchor.x, targetAnchor.y)}
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
      </svg>

      {blocks.map((block) => {
        const built = builtIds.has(block.id)

        return (
          <div
            key={block.id}
            className={cn(
              'pointer-events-none absolute origin-center transition-[opacity,scale] duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]',
              built ? 'scale-100 opacity-100' : 'scale-[0.94] opacity-0'
            )}
            style={{
              left: block.x,
              top: block.y,
              width: BLOCK_WIDTH,
              height: blockHeight(block),
            }}
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
    </ResponsiveDesignStage>
  )
}

/**
 * Landing workflow stage. The homepage demo uses the exact production renderer
 * inside React Flow; secondary timed loops retain their staged presentation.
 */
export function HeroWorkflowStage({
  builtCount,
  blocks = STAGE_BLOCKS,
  edges = STAGE_EDGES,
  canvas = STAGE_CANVAS,
  selectedId,
  interactive = false,
}: HeroWorkflowStageProps) {
  if (interactive) {
    return (
      <ProductionWorkflowStage
        builtCount={builtCount}
        blocks={blocks}
        edges={edges}
        canvas={canvas}
      />
    )
  }

  return (
    <StagedHeroWorkflowStage
      builtCount={builtCount}
      blocks={blocks}
      edges={edges}
      canvas={canvas}
      selectedId={selectedId}
    />
  )
}
