'use client'

import { cn } from '@sim/emcn'
import { StageBlockCard } from '@/app/(landing)/components/hero/components/hero-platform-loop/stage-block-card'
import {
  horizontalHandleAnchors,
  smoothStep,
} from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'
import {
  PREVIEW_BLOCKS,
  PREVIEW_EDGES,
} from '@/app/(landing)/workflows/components/workflow-builder-preview/constants'

interface WorkflowPreviewCanvasProps {
  selectedId?: string
  runningId?: string | null
  completedId?: string | null
  onSelect?: (blockId: string) => void
  onRunToggle?: (blockId: string) => void
}

/** Real StageBlockCard silhouettes and handle geometry without loading the editor or stores. */
export function WorkflowPreviewCanvas({
  selectedId,
  runningId,
  completedId,
  onSelect,
  onRunToggle,
}: WorkflowPreviewCanvasProps) {
  return (
    <div className='relative h-[376px] w-[1210px]'>
      <svg
        aria-hidden='true'
        className='absolute inset-0 size-full overflow-visible'
        viewBox='0 0 1210 376'
        fill='none'
      >
        {PREVIEW_EDGES.map(([sourceId, targetId]) => {
          const sourceBlock = PREVIEW_BLOCKS.find((block) => block.id === sourceId)
          const targetBlock = PREVIEW_BLOCKS.find((block) => block.id === targetId)
          if (!sourceBlock || !targetBlock) return null
          const source = horizontalHandleAnchors(sourceBlock).out
          const target = horizontalHandleAnchors(targetBlock).in
          return (
            <path
              key={`${sourceId}-${targetId}`}
              d={
                source.y === target.y
                  ? `M${source.x} ${source.y}H${target.x}`
                  : smoothStep(source.x, source.y, target.x, target.y)
              }
              stroke='var(--text-secondary)'
              strokeWidth={1.5}
            />
          )
        })}
      </svg>
      {PREVIEW_BLOCKS.map((block) => (
        <div
          key={block.id}
          onFocus={() => onSelect?.(block.id)}
          className={cn(
            'absolute',
            block.className,
            onSelect &&
              '[&_[role=button]:focus-visible]:outline-2 [&_[role=button]:focus-visible]:outline-[var(--text-secondary)] [&_[role=button]:focus-visible]:outline-solid [&_[role=button]:focus-visible]:outline-offset-4'
          )}
        >
          <StageBlockCard
            block={block}
            orientation='horizontal'
            selected={selectedId === block.id}
            decorative={!onSelect}
            runStatus={
              runningId === block.id ? 'running' : completedId === block.id ? 'complete' : 'idle'
            }
            onSelect={onSelect}
            onRunToggle={onRunToggle}
          />
        </div>
      ))}
    </div>
  )
}
