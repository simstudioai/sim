import { Check, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useFilterStore } from '@/stores/logs/filters/store'
import type { TimeRange } from '@/stores/logs/filters/types'

export default function Timeline() {
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
        <Button
          variant='outline'
          size='sm'
          className='w-full justify-between rounded-[10px] border-[#E5E5E5] bg-[#FFFFFF] font-normal text-sm dark:border-[#414141] dark:bg-[var(--surface-elevated)]'
        >
          {timeRange}
          <ChevronDown className='ml-2 h-4 w-4 text-muted-foreground' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side='bottom'
        align='end'
        sideOffset={6}
        collisionPadding={8}
        className='w-[220px] rounded-lg border-[#E5E5E5] bg-[#FFFFFF] shadow-xs dark:border-[#414141] dark:bg-[var(--surface-elevated)]'
      >
        <DropdownMenuItem
          key='all'
          onSelect={() => {
            setTimeRange('All time')
          }}
          className='flex cursor-pointer items-center justify-between rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
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
            className='flex cursor-pointer items-center justify-between rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
          >
            <span>{range}</span>
            {timeRange === range && <Check className='h-4 w-4 text-muted-foreground' />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
