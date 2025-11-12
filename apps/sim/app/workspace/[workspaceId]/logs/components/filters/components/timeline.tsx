import { Check, ChevronDown } from 'lucide-react'
import { Button } from '@/components/emcn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  commandListClass,
  dropdownContentClass,
  filterButtonClass,
  timelineDropdownListStyle,
} from '@/app/workspace/[workspaceId]/logs/components/filters/components/shared'
import { useFilterStore } from '@/stores/logs/filters/store'
import type { TimeRange } from '@/stores/logs/filters/types'

type TimelineProps = {
  variant?: 'default' | 'header'
}

export default function Timeline({ variant = 'default' }: TimelineProps = {}) {
  const { timeRange, setTimeRange } = useFilterStore()
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='outline' className={filterButtonClass}>
          {timeRange}
          <ChevronDown className='ml-2 h-4 w-4 text-muted-foreground' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={variant === 'header' ? 'end' : 'start'}
        side='bottom'
        avoidCollisions={false}
        sideOffset={4}
        className={dropdownContentClass}
      >
        <div
          className={`${commandListClass} py-1`}
          style={variant === 'header' ? undefined : timelineDropdownListStyle}
        >
          <DropdownMenuItem
            key='all'
            onSelect={() => {
              setTimeRange('All time')
            }}
            className='flex cursor-pointer items-center justify-between px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
          >
            <span>All time</span>
            {timeRange === 'All time' && <Check className='h-4 w-4 text-muted-foreground' />}
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {specificTimeRanges.map((range) => (
            <DropdownMenuItem
              key={range}
              onSelect={() => {
                setTimeRange(range)
              }}
              className='flex cursor-pointer items-center justify-between px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
            >
              <span>{range}</span>
              {timeRange === range && <Check className='h-4 w-4 text-muted-foreground' />}
            </DropdownMenuItem>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
