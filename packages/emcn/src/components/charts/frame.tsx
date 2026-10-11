'use client'

import type { ReactNode } from 'react'
import { Chip, Tooltip } from '@sim/emcn'

interface ChartFrameProps {
  title?: string
  description?: string
  height?: number
  loading?: boolean
  error?: string
  onRetry?: () => void
  children: ReactNode
}

/** Keeps chart geometry stable while data loads or fails. */
export function ChartFrame({
  title,
  description,
  height = 166,
  loading = false,
  error,
  onRetry,
  children,
}: ChartFrameProps) {
  return (
    <section className='min-w-0' aria-label={title} aria-busy={loading}>
      {title && (
        <div className='mb-2 flex h-5 items-center'>
          {description ? (
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button type='button' className='text-[var(--text-muted)] text-caption'>
                  {title}
                </button>
              </Tooltip.Trigger>
              <Tooltip.Content>{description}</Tooltip.Content>
            </Tooltip.Root>
          ) : (
            <p className='text-[var(--text-muted)] text-caption'>{title}</p>
          )}
        </div>
      )}
      <div className='relative'>
        <svg width='100%' height={height} aria-hidden='true' className='block'>
          {(loading || error) && (
            <g stroke='var(--border)' strokeWidth='0.5' opacity='0.6'>
              {[0.25, 0.5, 0.75, 1].map((fraction) => (
                <line
                  key={fraction}
                  x1='32'
                  x2='95%'
                  y1={16 + (height - 42) * fraction}
                  y2={16 + (height - 42) * fraction}
                />
              ))}
            </g>
          )}
        </svg>
        <div className='absolute inset-0'>
          {error ? (
            <div className='flex h-full flex-col items-center justify-center gap-2'>
              <p role='alert' className='text-[var(--text-muted)] text-caption'>
                {error}
              </p>
              {onRetry && <Chip onClick={onRetry}>Retry</Chip>}
            </div>
          ) : loading ? (
            <span className='sr-only'>Loading {title ?? 'chart'}</span>
          ) : (
            children
          )}
        </div>
      </div>
    </section>
  )
}
