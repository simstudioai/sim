'use client'

import { useState } from 'react'
import { ChartLegend } from '@sim/emcn'

export interface DonutChartSegment {
  label: string
  value: number
  color: string
  display?: string
}

interface DonutChartProps {
  segments: DonutChartSegment[]
  label: string
  totalLabel?: string
}

/** Shows a part-to-whole distribution, including single-category and empty totals. */
export function DonutChart({ segments, label, totalLabel }: DonutChartProps) {
  const [hoveredLabel, setHoveredLabel] = useState<string | null>(null)
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null)
  const selected = segments.find((segment) => segment.label === selectedLabel)
  const highlighted = segments.find((segment) => segment.label === hoveredLabel) ?? selected
  const values = segments.filter((segment) => Number.isFinite(segment.value) && segment.value > 0)
  const total = values.reduce((sum, segment) => sum + segment.value, 0)
  let offset = 0
  return (
    <div className='flex h-full min-w-0 items-center gap-4'>
      <svg viewBox='0 0 140 140' className='size-[128px] shrink-0' role='img' aria-label={label}>
        <title>{label}</title>
        <circle cx='70' cy='70' r='52' fill='none' stroke='var(--border)' strokeWidth='12' />
        {values.map((segment) => {
          const share = (segment.value / total) * 100
          const start = offset
          offset += share
          return (
            <circle
              key={segment.label}
              cx='70'
              cy='70'
              r='52'
              pathLength='100'
              fill='none'
              stroke={segment.color}
              strokeWidth='12'
              strokeDasharray={`${share} ${100 - share}`}
              strokeDashoffset={-start}
              opacity={highlighted && highlighted.label !== segment.label ? 0.2 : 1}
              className='transition-opacity duration-150 motion-reduce:transition-none'
              onMouseEnter={() => setHoveredLabel(segment.label)}
              onMouseLeave={() => setHoveredLabel(null)}
              transform='rotate(-90 70 70)'
            >
              <title>{`${segment.label}: ${segment.display ?? segment.value.toLocaleString()} (${share.toFixed(1)}%)`}</title>
            </circle>
          )
        })}
        <text x='70' y='74' textAnchor='middle' fill='var(--text-body)' fontSize='14'>
          {highlighted
            ? (highlighted.display ??
              new Intl.NumberFormat(undefined, { notation: 'compact' }).format(highlighted.value))
            : (totalLabel ??
              new Intl.NumberFormat(undefined, { notation: 'compact' }).format(total))}
        </text>
      </svg>
      {segments.length > 0 ? (
        <ChartLegend
          items={segments.map((segment) => ({
            ...segment,
            id: segment.label,
            value: segment.display ?? segment.value.toLocaleString(),
          }))}
          selectedId={selected?.label ?? null}
          highlightedId={highlighted?.label ?? null}
          onHighlight={setHoveredLabel}
          onSelect={setSelectedLabel}
        />
      ) : (
        <p className='text-[var(--text-muted)] text-caption'>No activity</p>
      )}
    </div>
  )
}
