'use client'

import { Tooltip } from '@sim/emcn'

interface DashboardMetricProps {
  label: string
  value: string
  description?: string
  loading?: boolean
}

/** A compact metric with a fixed-height value and optional definition. */
export function DashboardMetric({ label, value, description, loading }: DashboardMetricProps) {
  return (
    <div className='min-w-0' aria-busy={loading}>
      <div className='mb-2 flex min-h-5 items-center'>
        {description ? (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button type='button' className='text-left text-[var(--text-muted)] text-caption'>
                {label}
              </button>
            </Tooltip.Trigger>
            <Tooltip.Content>{description}</Tooltip.Content>
          </Tooltip.Root>
        ) : (
          <p className='text-[var(--text-muted)] text-caption'>{label}</p>
        )}
      </div>
      <div className='flex h-6 items-center text-[var(--text-body)] text-base tabular-nums'>
        {loading ? (
          <span className='h-4 w-14 rounded bg-[var(--surface-3)]' aria-label='Loading value' />
        ) : (
          value
        )}
      </div>
    </div>
  )
}
