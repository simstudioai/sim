'use client'

import type { CSSProperties } from 'react'
import { AnimatedNumber, cn, Tooltip } from '@sim/emcn'
import { cva, type VariantProps } from 'class-variance-authority'

export const dashboardMetricValueVariants = cva(
  'flex min-w-0 items-baseline gap-1 whitespace-nowrap text-[var(--text-body)] tabular-nums',
  {
    variants: {
      size: {
        default: 'h-6 text-base',
        large:
          'h-10 text-[length:min(36px,calc(100cqi/var(--metric-width-units)))] leading-10 tracking-tight',
      },
    },
    defaultVariants: { size: 'default' },
  }
)

interface DashboardMetricProps extends VariantProps<typeof dashboardMetricValueVariants> {
  label: string
  value: string | number
  animated?: boolean
  maximumFractionDigits?: number
  unit?: string
  description?: string
  loading?: boolean
}

/** A compact metric with a fixed-height value and optional definition. */
export function DashboardMetric({
  label,
  value,
  animated,
  maximumFractionDigits = 2,
  unit,
  description,
  loading,
  size,
}: DashboardMetricProps) {
  const formattedValue =
    typeof value === 'number' ? value.toLocaleString(undefined, { maximumFractionDigits }) : value
  const valueStyle: CSSProperties & { '--metric-width-units': number } = {
    '--metric-width-units': Math.max(
      4,
      formattedValue.length * 0.65 + (unit?.length ?? 0) * 0.4 + 0.3
    ),
  }
  const labelClassName = cn(
    'text-left',
    size === 'large'
      ? 'text-[var(--text-secondary)] text-md leading-6'
      : 'text-[var(--text-muted)] text-caption'
  )
  return (
    <div className='@container min-w-0' aria-busy={loading}>
      <div className='mb-2 flex min-h-5 items-center'>
        {description ? (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button type='button' className={labelClassName}>
                {label}
              </button>
            </Tooltip.Trigger>
            <Tooltip.Content>{description}</Tooltip.Content>
          </Tooltip.Root>
        ) : (
          <p className={labelClassName}>{label}</p>
        )}
      </div>
      <div className={dashboardMetricValueVariants({ size })} style={valueStyle}>
        {loading ? (
          <>
            <span className='h-4 w-14 rounded bg-[var(--surface-3)]' aria-hidden='true' />
            <span className='sr-only'>Loading value</span>
          </>
        ) : (
          <>
            {animated && typeof value === 'number' ? (
              <AnimatedNumber value={value} maximumFractionDigits={maximumFractionDigits} />
            ) : (
              formattedValue
            )}
            {unit && (
              <span
                className={cn(
                  'shrink-0',
                  size === 'large' && 'text-[0.5em] text-[var(--text-tertiary)] tracking-normal'
                )}
              >
                {unit}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  )
}
