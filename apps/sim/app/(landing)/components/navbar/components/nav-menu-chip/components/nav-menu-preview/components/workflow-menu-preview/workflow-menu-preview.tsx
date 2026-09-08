'use client'

import { useRef } from 'react'
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

interface WorkflowMenuPreviewProps {
  layout?: 'menu' | 'hero'
  onReady?: () => void
}

/** A cropped production canvas with a clear center and progressively softened inner edges. */
export function WorkflowMenuPreview({ layout = 'menu', onReady }: WorkflowMenuPreviewProps) {
  const readyBlocksRef = useRef(new Set<string>())

  const handleBlockReady = (blockId: string) => {
    if (readyBlocksRef.current.has(blockId)) return
    readyBlocksRef.current.add(blockId)
    if (readyBlocksRef.current.size === BLOCKS.length) onReady?.()
  }

  return (
    <div
      aria-hidden='true'
      inert
      data-workflow-menu-preview
      data-preview-layout={layout}
      className={cn(
        'pointer-events-none absolute inset-0 isolate flex select-none items-center justify-center overflow-hidden [container-type:inline-size]',
        layout === 'hero' ? 'bg-[var(--bg)]' : 'bg-[var(--surface-3)]'
      )}
    >
      <div
        className={cn(
          'relative h-[360px] w-[900px] shrink-0',
          layout === 'hero'
            ? '@max-[640px]:translate-x-[51px] [scale:clamp(0.9,tan(atan2(100cqw,900px)),1)]'
            : '[scale:min(0.9,tan(atan2(100cqw,800px)))]'
        )}
      >
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
            d={`M${CONTINUATION.x} ${CONTINUATION.y}H${layout === 'hero' ? 1000 : 980}`}
            stroke='var(--border)'
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
              onReady={layout === 'hero' && onReady ? handleBlockReady : undefined}
            />
          </div>
        ))}
      </div>
      {layout === 'hero' ? (
        <>
          <div className='-translate-x-1/2 pointer-events-none absolute inset-y-0 left-1/2 w-[1100px] max-w-full'>
            <EdgeFade ground='canvas' edges={['left', 'right']} depth='stage' />
          </div>
          <EdgeFade ground='canvas' edges={['top', 'bottom']} depth='preview' />
        </>
      ) : (
        <EdgeFade ground='surface' depth='preview' />
      )}
    </div>
  )
}
