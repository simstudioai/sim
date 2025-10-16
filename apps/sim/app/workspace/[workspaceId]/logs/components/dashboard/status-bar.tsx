import { memo, useMemo, useState } from 'react'

export interface StatusBarSegment {
  successRate: number
  hasExecutions: boolean
  totalExecutions: number
  successfulExecutions: number
  timestamp: string
}

export function StatusBar({
  segments,
  selectedSegmentIndices,
  onSegmentClick,
  workflowId,
  segmentDurationMs,
  preferBelow = false,
}: {
  segments: StatusBarSegment[]
  selectedSegmentIndices: number[] | null
  onSegmentClick: (
    workflowId: string,
    index: number,
    timestamp: string,
    mode: 'single' | 'toggle' | 'range'
  ) => void
  workflowId: string
  segmentDurationMs: number
  preferBelow?: boolean
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const labels = useMemo(() => {
    return segments.map((segment) => {
      const start = new Date(segment.timestamp)
      const end = new Date(start.getTime() + (segmentDurationMs || 0))
      const rangeLabel = Number.isNaN(start.getTime())
        ? ''
        : `${start.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric' })} – ${end.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' })}`
      return {
        rangeLabel,
        successLabel: `${segment.successRate.toFixed(1)}%`,
        countsLabel: `${segment.successfulExecutions ?? 0}/${segment.totalExecutions ?? 0} succeeded`,
      }
    })
  }, [segments, segmentDurationMs])

  return (
    <div className='relative'>
      <div
        className='flex select-none items-stretch gap-[2px]'
        onMouseLeave={() => setHoverIndex(null)}
      >
        {segments.map((segment, i) => {
          const isSelected = Array.isArray(selectedSegmentIndices)
            ? selectedSegmentIndices.includes(i)
            : false

          let color: string
          if (!segment.hasExecutions) {
            color = 'bg-gray-300/60 dark:bg-gray-500/40'
          } else if (segment.successRate === 100) {
            color = 'bg-emerald-400/90'
          } else if (segment.successRate >= 95) {
            color = 'bg-amber-400/90'
          } else {
            color = 'bg-red-400/90'
          }

          return (
            <div
              key={i}
              className={`h-6 flex-1 rounded-[3px] ${color} cursor-pointer transition-[opacity,transform] hover:opacity-90 ${
                isSelected ? 'relative z-10 ring-2 ring-primary ring-offset-1' : 'relative z-0'
              }`}
              aria-label={`Segment ${i + 1}`}
              onMouseEnter={() => setHoverIndex(i)}
              onMouseDown={(e) => {
                e.preventDefault()
              }}
              onClick={(e) => {
                e.stopPropagation()
                const mode = e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'single'
                onSegmentClick(workflowId, i, segment.timestamp, mode)
              }}
            />
          )
        })}
      </div>

      {hoverIndex !== null && segments[hoverIndex] && (
        <div
          className={`-translate-x-1/2 pointer-events-none absolute z-20 w-max whitespace-nowrap rounded-md bg-background/90 px-2 py-1 text-center text-[11px] shadow-sm ring-1 ring-border backdrop-blur ${
            preferBelow ? '' : '-translate-y-full'
          }`}
          style={{
            left: `${((hoverIndex + 0.5) / (segments.length || 1)) * 100}%`,
            top: preferBelow ? '100%' : 0,
            marginTop: preferBelow ? 8 : -8,
          }}
        >
          {segments[hoverIndex].hasExecutions ? (
            <div>
              <div className='font-semibold'>{labels[hoverIndex].successLabel}</div>
              <div className='text-muted-foreground'>{labels[hoverIndex].countsLabel}</div>
              {labels[hoverIndex].rangeLabel && (
                <div className='mt-0.5 text-muted-foreground'>{labels[hoverIndex].rangeLabel}</div>
              )}
            </div>
          ) : (
            <div className='text-muted-foreground'>{labels[hoverIndex].rangeLabel}</div>
          )}
        </div>
      )}
    </div>
  )
}

export default memo(StatusBar)
