import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  Button,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverScrollArea,
  PopoverTrigger,
} from '@/components/emcn'
import { filterButtonClass } from '@/app/workspace/[workspaceId]/logs/components/filters/components/shared'
import { useFilterStore } from '@/stores/logs/filters/store'
import type { TimeRange } from '@/stores/logs/filters/types'

type TimelineProps = {
  variant?: 'default' | 'header'
}

export default function Timeline({ variant = 'default' }: TimelineProps = {}) {
  const { timeRange, setTimeRange } = useFilterStore()
  const [isPopoverOpen, setIsPopoverOpen] = useState(false)

  const specificTimeRanges: TimeRange[] = [
    'Past 30 minutes',
    'Past hour',
    'Past 6 hours',
    'Past 12 hours',
    'Past 24 hours',
    'Past 3 days',
    'Past 7 days',
    'Past 14 days',
    'Past 30 days',
  ]

  const handleTimeRangeSelect = (range: TimeRange) => {
    setTimeRange(range)
    setIsPopoverOpen(false)
  }

  return (
    <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen}>
      <PopoverTrigger asChild>
        <Button variant='outline' size='sm' className={filterButtonClass}>
          {timeRange}
          <ChevronDown className='ml-2 h-4 w-4 text-muted-foreground' />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={variant === 'header' ? 'end' : 'start'}
        side='bottom'
        sideOffset={4}
        maxHeight={144}
      >
        <PopoverScrollArea>
          <PopoverItem
            active={timeRange === 'All time'}
            showCheck
            onClick={() => handleTimeRangeSelect('All time')}
          >
            All time
          </PopoverItem>

          {/* Separator */}
          <div className='my-[2px] h-px bg-[var(--surface-11)]' />

          {specificTimeRanges.map((range) => (
            <PopoverItem
              key={range}
              active={timeRange === range}
              showCheck
              onClick={() => handleTimeRangeSelect(range)}
            >
              {range}
            </PopoverItem>
          ))}
        </PopoverScrollArea>
      </PopoverContent>
    </Popover>
  )
}
