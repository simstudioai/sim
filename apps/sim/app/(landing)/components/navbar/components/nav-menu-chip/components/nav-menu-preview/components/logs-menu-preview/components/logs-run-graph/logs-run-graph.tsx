'use client'

import { useState } from 'react'
import { cn, Tooltip } from '@sim/emcn'

const BUCKET_HEIGHTS = {
  3: 'h-[30%]',
  4: 'h-[40%]',
  5: 'h-1/2',
  6: 'h-[60%]',
  7: 'h-[70%]',
  8: 'h-[80%]',
  9: 'h-[90%]',
  10: 'h-full',
} as const

interface LogsRunGraphProps {
  buckets: readonly { hour: number; count: keyof typeof BUCKET_HEIGHTS }[]
}

/** One floating tooltip follows the pointer across static hourly bars. */
export function LogsRunGraph({ buckets }: LogsRunGraphProps) {
  const [activeIndex, setActiveIndex] = useState(0)
  const bucket = buckets[activeIndex]
  const timeRange =
    bucket.hour === 23 ? 'Last hour' : `${24 - bucket.hour}–${23 - bucket.hour} hours ago`

  return (
    <Tooltip.Root preferAbove>
      <Tooltip.Trigger
        type='button'
        data-run-overview-graph
        aria-label={`Hourly successful runs. ${timeRange}: ${bucket.count} succeeded. Use left and right arrows to explore.`}
        className='pointer-events-auto mt-3 flex h-12 w-full cursor-default items-end gap-0.5 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-[var(--text-icon)] focus-visible:outline-offset-4'
        onMouseDown={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          switch (event.key) {
            case 'ArrowLeft':
              setActiveIndex(Math.max(0, activeIndex - 1))
              break
            case 'ArrowRight':
              setActiveIndex(Math.min(buckets.length - 1, activeIndex + 1))
              break
            case 'Home':
              setActiveIndex(0)
              break
            case 'End':
              setActiveIndex(buckets.length - 1)
              break
            default:
              return
          }
          event.preventDefault()
        }}
      >
        {buckets.map((item, index) => (
          <span
            key={item.hour}
            aria-hidden='true'
            data-run-count={item.count}
            className='flex h-full min-w-0 flex-1 items-end'
            onPointerEnter={() => setActiveIndex(index)}
          >
            <span
              data-run-bar
              className={cn('block w-full rounded-[2px] bg-[#525252]', BUCKET_HEIGHTS[item.count])}
            />
          </span>
        ))}
      </Tooltip.Trigger>
      <Tooltip.Content offset={10}>
        <div className='flex flex-col gap-1 whitespace-nowrap'>
          <span className='text-[var(--text-secondary)]'>{timeRange}</span>
          <span className='flex items-center gap-1.5 tabular-nums'>
            <span className='size-1.5 rounded-full bg-[#525252]' />
            {bucket.count} succeeded
            <span className='text-[var(--text-secondary)]'>·</span>$
            {(bucket.count * 0.11).toFixed(2)}
          </span>
        </div>
      </Tooltip.Content>
    </Tooltip.Root>
  )
}
