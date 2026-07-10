import type { ComponentType, SVGProps } from 'react'
import { cn } from '@sim/emcn'

type FeatureGraphicIcon = ComponentType<SVGProps<SVGSVGElement>>

export interface FeatureGraphicNodeRow {
  label: string
  value: string
}

interface FeatureGraphicNodeProps {
  detail?: string
  handle?: 'source' | 'target'
  icon: FeatureGraphicIcon
  label: string
  rows?: readonly FeatureGraphicNodeRow[]
  tone?: 'outline' | 'filled'
}

/**
 * Product-native node for enterprise feature graphics. Outline nodes establish
 * context; filled nodes use the Carbon-grey focal depth reserved for the feature
 * the card is explaining.
 */
export function FeatureGraphicNode({
  detail,
  handle,
  icon: Icon,
  label,
  rows,
  tone = 'outline',
}: FeatureGraphicNodeProps) {
  const filled = tone === 'filled'

  return (
    <div
      className={cn(
        'relative overflow-visible rounded-lg border',
        filled
          ? 'border-[var(--surface-7)] bg-[var(--surface-6)] shadow-sm'
          : 'border-[var(--border-1)] bg-[var(--surface-2)]'
      )}
    >
      <div className='flex min-h-[48px] items-center gap-2 px-2.5 py-2'>
        <span
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-md border',
            filled
              ? 'border-[var(--surface-7)] bg-[var(--surface-7)]'
              : 'border-[var(--border-1)] bg-[var(--surface-4)]'
          )}
        >
          <Icon
            className={cn(
              'size-[14px]',
              filled ? 'text-[var(--text-body)]' : 'text-[var(--text-icon)]'
            )}
          />
        </span>
        <span className='min-w-0'>
          <span
            className={cn(
              'block truncate font-medium text-small leading-[1.3]',
              filled ? 'text-[var(--text-primary)]' : 'text-[var(--text-icon)]'
            )}
          >
            {label}
          </span>
          {detail && (
            <span
              className={cn(
                'block truncate text-caption leading-[1.4]',
                filled ? 'text-[var(--text-body)]' : 'text-[var(--text-muted)]'
              )}
            >
              {detail}
            </span>
          )}
        </span>
      </div>

      {rows && rows.length > 0 && (
        <div
          className={cn(
            'border-t px-2.5 py-2',
            filled ? 'border-[var(--surface-7)]' : 'border-[var(--border-1)]'
          )}
        >
          <div className='flex flex-col gap-1.5'>
            {rows.map((row) => (
              <div key={row.label} className='flex min-w-0 items-center justify-between gap-2'>
                <span className='shrink-0 text-[var(--text-muted)] text-caption'>{row.label}</span>
                <span className='truncate text-right font-medium text-[var(--text-body)] text-caption'>
                  {row.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {handle && (
        <span
          className={cn(
            '-translate-y-1/2 absolute top-1/2 h-4 w-[5px] border-[var(--surface-7)] bg-[var(--surface-7)]',
            handle === 'source'
              ? '-right-[5px] rounded-r-[2px] border-y border-r'
              : '-left-[5px] rounded-l-[2px] border-y border-l'
          )}
        />
      )}
    </div>
  )
}
