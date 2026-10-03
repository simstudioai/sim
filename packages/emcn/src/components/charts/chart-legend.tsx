'use client'

import { Chip, cn } from '@sim/emcn'
import { cva, type VariantProps } from 'class-variance-authority'

export const chartLegendVariants = cva('flex min-w-0 flex-1 gap-0.5', {
  variants: {
    layout: { column: 'flex-col', row: 'flex-wrap items-center' },
  },
  defaultVariants: { layout: 'column' },
})

export interface ChartLegendItem {
  id: string
  label: string
  color: string
  value?: string
}

interface ChartLegendProps extends VariantProps<typeof chartLegendVariants> {
  items: ChartLegendItem[]
  selectedId: string | null
  highlightedId: string | null
  onHighlight(id: string | null): void
  onSelect(id: string | null): void
}

/** Hover and focus preview a series; activation holds it until toggled or escaped. */
export function ChartLegend({
  items,
  selectedId,
  highlightedId,
  onHighlight,
  onSelect,
  layout,
}: ChartLegendProps) {
  return (
    <ul className={chartLegendVariants({ layout })}>
      {items.map((item) => (
        <li
          key={item.id}
          className={cn(
            'min-w-0 transition-opacity duration-150 motion-reduce:transition-none',
            highlightedId && highlightedId !== item.id && 'opacity-40'
          )}
        >
          <Chip
            fullWidth
            active={selectedId === item.id}
            aria-pressed={selectedId === item.id}
            aria-label={`Highlight ${item.label}${item.value ? `: ${item.value}` : ''}`}
            onMouseEnter={() => onHighlight(item.id)}
            onMouseLeave={() => onHighlight(null)}
            onFocus={() => onHighlight(item.id)}
            onBlur={() => onHighlight(null)}
            onClick={() => onSelect(selectedId === item.id ? null : item.id)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                onSelect(null)
                onHighlight(null)
              }
            }}
            leftAdornment={
              <svg className='size-2 shrink-0' viewBox='0 0 8 8' aria-hidden='true'>
                <circle cx='4' cy='4' r='3' fill={item.color} />
              </svg>
            }
            rightAdornment={
              item.value ? (
                <span className='shrink-0 text-[var(--text-muted)] text-caption tabular-nums'>
                  {item.value}
                </span>
              ) : undefined
            }
          >
            {item.label}
          </Chip>
        </li>
      ))}
    </ul>
  )
}
