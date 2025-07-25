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
  const specificTimeRanges: TimeRange[] = ['Past 30 minutes', 'Past hour', 'Past 24 hours']

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          className='w-full justify-between rounded-[10px] border-[#E5E5E5] bg-[#FFFFFF] font-normal text-sm dark:border-[#414141] dark:bg-[#202020]'
        >
          {timeRange}
          <ChevronDown className='ml-2 h-4 w-4 text-muted-foreground' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='start'
        className='w-[180px] rounded-lg border-[#E5E5E5] bg-[#FFFFFF] shadow-xs dark:border-[#414141] dark:bg-[#202020]'
      >
        <DropdownMenuItem
          key='all'
          onSelect={(e) => {
            e.preventDefault()
            setTimeRange('All time')
          }}
          className='flex cursor-pointer items-center justify-between rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
        >
          <span>All time</span>
          {timeRange === 'All time' && <Check className='h-4 w-4 text-primary' />}
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        {specificTimeRanges.map((range) => (
          <DropdownMenuItem
            key={range}
            onSelect={(e) => {
              e.preventDefault()
              setTimeRange(range)
            }}
            className='flex cursor-pointer items-center justify-between rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
          >
            <span>{range}</span>
            {timeRange === range && <Check className='h-4 w-4 text-primary' />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
