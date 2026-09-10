'use client'

import { cn } from '@sim/emcn'
import { Pause, Play, RefreshCw } from '@sim/emcn/icons'
import { STACK_LAYERS } from '@/app/(landing)/components/sim-stack/stack-content'
import { STACK_PLAYBACK_END } from '@/app/(landing)/components/sim-stack/stack-timeline'

interface StackPlayerProps {
  progress: number
  isPlaying: boolean
  onToggle: () => void
  onSelect: (index: number) => void
}

/** A compact, seekable step track follows the scene's scroll and playback progress. */
export function StackPlayer({ progress, isPlaying, onToggle, onSelect }: StackPlayerProps) {
  const complete = progress >= STACK_PLAYBACK_END - 0.01
  const active = Math.min(STACK_LAYERS.length - 1, Math.floor(progress))
  const Icon = complete && !isPlaying ? RefreshCw : isPlaying ? Pause : Play
  const controlLabel = isPlaying
    ? 'Pause animation'
    : complete
      ? 'Replay animation'
      : 'Play animation'
  return (
    <div role='group' aria-label='Sim stack playback' className='flex items-center gap-2'>
      <div className='flex h-11 items-center rounded-full border border-[var(--border)] bg-transparent px-3'>
        {STACK_LAYERS.map((layer, index) => {
          const expanded = !complete && index === active
          const fill = complete || index < active ? 1 : index > active ? 0 : progress - index
          return (
            <button
              key={layer.id}
              type='button'
              aria-label={`Go to ${layer.title}`}
              aria-current={index === active ? 'step' : undefined}
              aria-controls='sim-stack-artwork'
              onClick={() => onSelect(index)}
              className={cn(
                'flex h-full shrink-0 items-center justify-center rounded-full text-[var(--text-body)] outline-offset-2 transition-[width] duration-300 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--text-primary)] motion-reduce:transition-none',
                expanded ? 'w-16' : 'w-6'
              )}
            >
              <svg
                aria-hidden='true'
                viewBox='0 0 44 6'
                className={cn(
                  'h-1.5 overflow-hidden rounded-full transition-[width] duration-300 ease-out motion-reduce:transition-none',
                  expanded ? 'w-11' : 'w-1.5'
                )}
                preserveAspectRatio='none'
              >
                <rect width='44' height='6' className='fill-[var(--text-muted)] opacity-30' />
                <rect width={44 * Math.min(1, Math.max(0, fill))} height='6' fill='currentColor' />
              </svg>
            </button>
          )
        })}
      </div>
      <button
        type='button'
        aria-label={controlLabel}
        aria-controls='sim-stack-artwork'
        onClick={onToggle}
        className='flex size-11 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-transparent text-[var(--text-body)] outline-offset-4 transition-colors hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--text-primary)]'
      >
        <Icon
          aria-hidden='true'
          className={cn('size-4', !isPlaying && !complete && 'translate-x-px')}
        />
      </button>
    </div>
  )
}
