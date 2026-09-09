'use client'

import { cn } from '@sim/emcn'
import { StageBlockCard } from '@/app/(landing)/components/hero/components/hero-platform-loop/stage-block-card'
import { STAGE_BLOCKS } from '@/app/(landing)/components/hero/components/hero-platform-loop/stage-data'
import {
  horizontalHandleAnchors,
  smoothStep,
} from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'
import { EdgeFade } from '@/app/(landing)/components/shared/edge-fade'

const BLOCKS = [
  { ...STAGE_BLOCKS[0], x: 5, y: 185, position: 'left-[5px] top-[185px]' },
  { ...STAGE_BLOCKS[1], x: 325, y: 75, position: 'left-[325px] top-[75px]' },
  { ...STAGE_BLOCKS[4], name: 'Share lead', x: 645, y: 165, position: 'left-[645px] top-[165px]' },
] as const

/** A readable close-up of lead enrichment for screens too narrow for the full platform. */
export function MobileHeroWorkflow() {
  return (
    <div
      role='img'
      aria-label='Workflow: Start, enrich a lead with an Agent, then share the lead in Slack'
      className='-mx-7 md:-mx-8 relative isolate mt-12 h-[300px] w-[calc(100%+56px)] overflow-hidden md:w-[calc(100%+64px)] lg:hidden'
    >
      <div
        aria-hidden='true'
        className='-translate-x-1/2 absolute top-0 left-1/2 h-[340px] w-[900px] origin-top scale-[0.85]'
      >
        <svg
          className='absolute inset-0 size-full overflow-visible'
          viewBox='0 0 900 340'
          fill='none'
        >
          {BLOCKS.slice(1).map((block, index) => {
            const source = horizontalHandleAnchors(BLOCKS[index]).out
            const target = horizontalHandleAnchors(block).in
            return (
              <path
                key={block.id}
                d={smoothStep(source.x, source.y, target.x, target.y)}
                stroke='var(--text-secondary)'
                strokeWidth={1.5}
              />
            )
          })}
        </svg>
        {BLOCKS.map((block, index) => (
          <div key={block.id} className={cn('absolute', block.position)}>
            <StageBlockCard
              block={block}
              orientation='horizontal'
              selected={index === 1}
              decorative
            />
          </div>
        ))}
      </div>
      <EdgeFade ground='canvas' edges={['left', 'right']} depth='stage' />
      <EdgeFade ground='canvas' edges={['top', 'bottom']} depth='preview' />
    </div>
  )
}
