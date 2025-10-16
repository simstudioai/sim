import type React from 'react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

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
}) {
  return (
    <TooltipProvider delayDuration={0}>
      <div className='flex select-none items-stretch gap-[2px]'>
        {segments.map((segment, i) => {
          let color: string
          let tooltipContent: React.ReactNode
          const isSelected = Array.isArray(selectedSegmentIndices)
            ? selectedSegmentIndices.includes(i)
            : false

          if (!segment.hasExecutions) {
            color = 'bg-gray-300/60 dark:bg-gray-500/40'
          } else {
            if (segment.successRate === 100) {
              color = 'bg-emerald-400/90'
            } else if (segment.successRate >= 95) {
              color = 'bg-amber-400/90'
            } else {
              color = 'bg-red-400/90'
            }

            const start = new Date(segment.timestamp)
            const end = new Date(start.getTime() + (segmentDurationMs || 0))
            const rangeLabel = Number.isNaN(start.getTime())
              ? ''
              : `${start.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric' })} – ${end.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' })}`

            tooltipContent = (
              <div className='text-center'>
                <div className='font-semibold'>{segment.successRate.toFixed(1)}%</div>
                <div className='mt-1 text-xs'>
                  {segment.successfulExecutions ?? 0}/{segment.totalExecutions ?? 0} succeeded
                </div>
                {rangeLabel && (
                  <div className='mt-1 text-[11px] text-muted-foreground'>{rangeLabel}</div>
                )}
              </div>
            )
          }

          // For empty segments: show a minimal tooltip with just the time range
          if (!segment.hasExecutions) {
            const start = new Date(segment.timestamp)
            const end = new Date(start.getTime() + (segmentDurationMs || 0))
            const rangeLabel = Number.isNaN(start.getTime())
              ? ''
              : `${start.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric' })} – ${end.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit' })}`

            return (
              <Tooltip key={i}>
                <TooltipTrigger asChild>
                  <div
                    className={`h-6 flex-1 rounded-[3px] ${color} cursor-pointer transition-[opacity,transform] hover:opacity-90 ${
                      isSelected
                        ? 'relative z-10 ring-2 ring-primary ring-offset-1'
                        : 'relative z-0'
                    }`}
                    aria-label={`Segment ${i + 1}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      const mode = e.shiftKey
                        ? 'range'
                        : e.metaKey || e.ctrlKey
                          ? 'toggle'
                          : 'single'
                      onSegmentClick(workflowId, i, segment.timestamp, mode)
                    }}
                    onMouseDown={(e) => {
                      // Avoid selecting surrounding text when shift-clicking
                      e.preventDefault()
                    }}
                  />
                </TooltipTrigger>
                <TooltipContent side='top' className='select-none px-3 py-2'>
                  {rangeLabel && (
                    <div className='text-[11px] text-muted-foreground'>{rangeLabel}</div>
                  )}
                </TooltipContent>
              </Tooltip>
            )
          }

          return (
            <Tooltip key={i}>
              <TooltipTrigger asChild>
                <div
                  className={`h-6 flex-1 rounded-[3px] ${color} cursor-pointer transition-[opacity,transform] hover:opacity-90 ${
                    isSelected ? 'relative z-10 ring-2 ring-primary ring-offset-1' : 'relative z-0'
                  }`}
                  aria-label={`Segment ${i + 1}`}
                  onMouseDown={(e) => {
                    // Avoid selecting surrounding text when shift-clicking
                    e.preventDefault()
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    const mode = e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'single'
                    onSegmentClick(workflowId, i, segment.timestamp, mode)
                  }}
                />
              </TooltipTrigger>
              <TooltipContent side='top' className='select-none px-3 py-2'>
                {tooltipContent}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </div>
    </TooltipProvider>
  )
}

export default StatusBar
