import {
  SHOWCASE_BLOCKS,
  SHOWCASE_CANVAS,
  SHOWCASE_EDGES,
} from '@/app/(landing)/components/features/components/build-callout/components/workflow-showcase/showcase-data'
import { WorkflowBlock } from '@/app/(landing)/components/hero/components/hero-visual/workflow-block'
import {
  BLOCK_WIDTH,
  HANDLE_Y_OFFSET,
  smoothStep,
} from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'

/**
 * The Build card's centerpiece - the left-to-right support-triage pipeline
 * from {@link SHOWCASE_BLOCKS} / {@link SHOWCASE_EDGES} rendered raw on the
 * card's solid grey stage, every block on canvas and every edge drawn. Static
 * and server-rendered; blocks reuse the hero-visual's {@link WorkflowBlock}
 * (the horizontal-flow card with left/right handle nubs).
 *
 * The 990x686 design canvas renders at fixed per-breakpoint scales - 0.62
 * (1280+), 0.38 (below `xl`, where the side-by-side card leaves the
 * aspect-locked stage narrow), 0.45 (below `lg`, stacked full-width), 0.29
 * (below `sm`) - each chosen as the largest zoom that keeps the WHOLE flow
 * inside that tier's media stage, so the graph sits centered and uncut. Each
 * sizer tier is the canvas dimensions times that tier's scale.
 */
export function WorkflowShowcase() {
  const byId = new Map(SHOWCASE_BLOCKS.map((block) => [block.id, block]))
  return (
    <div className='absolute inset-0 flex items-center justify-center'>
      <div className='relative h-[425px] w-[614px] shrink-0 max-sm:h-[199px] max-sm:w-[287px] max-lg:h-[309px] max-lg:w-[446px] max-xl:h-[261px] max-xl:w-[376px]'>
        <div className='absolute top-0 left-0 h-[686px] w-[990px] origin-top-left [transform:scale(0.62)] max-sm:[transform:scale(0.29)] max-lg:[transform:scale(0.45)] max-xl:[transform:scale(0.38)]'>
          <svg
            className='absolute inset-0 overflow-visible'
            width={SHOWCASE_CANVAS.width}
            height={SHOWCASE_CANVAS.height}
            viewBox={`0 0 ${SHOWCASE_CANVAS.width} ${SHOWCASE_CANVAS.height}`}
            fill='none'
          >
            {SHOWCASE_EDGES.map(([from, to]) => {
              const source = byId.get(from)
              const target = byId.get(to)
              if (!source || !target) return null
              return (
                <path
                  key={`${from}-${to}`}
                  d={smoothStep(
                    source.x + BLOCK_WIDTH,
                    source.y + HANDLE_Y_OFFSET,
                    target.x,
                    target.y + HANDLE_Y_OFFSET
                  )}
                  stroke='var(--workflow-edge)'
                  strokeWidth={2}
                  strokeLinecap='round'
                />
              )
            })}
          </svg>
          {SHOWCASE_BLOCKS.map((block) => (
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
    </div>
  )
}
