import { cn } from '@sim/emcn'
import { StageBlockCard } from '@/app/(landing)/components/hero/components/hero-platform-loop/stage-block-card'
import { STAGE_BLOCKS } from '@/app/(landing)/components/hero/components/hero-platform-loop/stage-data'
import {
  horizontalHandleAnchors,
  smoothStep,
} from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'
import { EdgeFade } from '@/app/(landing)/components/shared/edge-fade'

const PLACEMENTS = [
  { x: -52, y: 244, className: '-left-[52px] top-[244px]' },
  { x: 268, y: 94, className: 'left-[268px] top-[94px]' },
  { x: 566, y: 202, className: 'left-[566px] top-[202px]' },
] as const

/** The same Start, Agent, and Function blocks as the production lead-enrichment demo. */
const BLOCKS = STAGE_BLOCKS.slice(0, 3).map((block, index) => ({
  ...block,
  ...PLACEMENTS[index],
}))

const CONTINUATION = horizontalHandleAnchors(BLOCKS[2]).out

/** A cropped production canvas with a clear center and progressively softened inner edges. */
export function WorkflowMenuPreview() {
  return (
    <div
      aria-hidden='true'
      inert
      data-workflow-menu-preview
      className='pointer-events-none absolute inset-0 isolate flex select-none items-center justify-center overflow-hidden bg-[var(--surface-3)] [container-type:inline-size]'
    >
      <div className='relative h-[360px] w-[900px] shrink-0 [scale:min(0.9,tan(atan2(100cqw,800px)))]'>
        <svg
          className='absolute inset-0 size-full overflow-visible text-[var(--text-secondary)]'
          viewBox='0 0 900 360'
          fill='none'
        >
          {BLOCKS.slice(1).map((block, index) => {
            const source = horizontalHandleAnchors(BLOCKS[index]).out
            const target = horizontalHandleAnchors(block).in
            return (
              <path
                key={block.id}
                d={smoothStep(source.x, source.y, target.x, target.y)}
                stroke='currentColor'
                strokeWidth={1.5}
              />
            )
          })}
          <path
            d={`M${CONTINUATION.x} ${CONTINUATION.y}H980`}
            stroke='var(--border-1)'
            strokeWidth={1.5}
          />
        </svg>

        {BLOCKS.map((block) => (
          <div
            key={block.id}
            data-workflow-menu-node={block.id}
            className={cn('absolute', block.className)}
          >
            <StageBlockCard
              block={block}
              orientation='horizontal'
              selected={block.id === 'enrich'}
              decorative
            />
          </div>
        ))}
      </div>
      <EdgeFade ground='surface' depth='preview' />
    </div>
  )
}
