'use client'

import { StageBlockCard } from '@/app/(landing)/components/hero/components/hero-platform-loop/stage-block-card'
import {
  type BlockDef,
  horizontalHandleAnchors,
  smoothStep,
} from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'
import { EdgeFade } from '@/app/(landing)/components/shared/edge-fade'

interface TwoBlockWorkflowPreviewProps {
  /** The upstream card, drawn at the fixed left slot. */
  source: BlockDef
  /** The downstream card, drawn selected at the fixed right slot. */
  target: BlockDef
}

/**
 * Two production block cards wired left to right on a centered 640×360
 * stage, with the edge entering from the left gutter and leaving through the
 * right one so the flow reads as a fragment of a longer workflow. The cards
 * sit at the slots their `x`/`y` describe (24/72 and 340/180).
 */
export function TwoBlockWorkflowPreview({ source, target }: TwoBlockWorkflowPreviewProps) {
  const sourceAnchors = horizontalHandleAnchors(source)
  const targetAnchors = horizontalHandleAnchors(target)

  return (
    <div className='absolute inset-0 isolate overflow-hidden bg-[var(--bg)]'>
      <div className='-translate-x-1/2 max-sm:-translate-x-[70%] absolute top-8 left-1/2 h-[360px] w-[640px]'>
        <svg
          aria-hidden='true'
          className='absolute inset-0 size-full'
          viewBox='0 0 640 360'
          fill='none'
        >
          <path
            d={`M0 ${sourceAnchors.in.y} H${sourceAnchors.in.x}`}
            stroke='var(--border)'
            strokeWidth='1.5'
          />
          <path
            d={smoothStep(
              sourceAnchors.out.x,
              sourceAnchors.out.y,
              targetAnchors.in.x,
              targetAnchors.in.y
            )}
            stroke='var(--text-icon)'
            strokeWidth='1.5'
          />
          <path
            d={`M${targetAnchors.out.x} ${targetAnchors.out.y} H640`}
            stroke='var(--border)'
            strokeWidth='1.5'
          />
        </svg>
        <div className='absolute top-[72px] left-6'>
          <StageBlockCard block={source} orientation='horizontal' decorative />
        </div>
        <div className='absolute top-[180px] left-[340px]'>
          <StageBlockCard block={target} orientation='horizontal' selected decorative />
        </div>
      </div>
      <EdgeFade ground='canvas' edges={['left', 'right']} depth='preview' />
    </div>
  )
}
