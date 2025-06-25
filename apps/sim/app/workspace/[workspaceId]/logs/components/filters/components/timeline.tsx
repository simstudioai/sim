import { Check, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useFilterStore } from '@/app/workspace/[workspaceId]/logs/stores/store'
import type { TimeRange } from '@/app/workspace/[workspaceId]/logs/stores/types'

export default function Timeline() {
  const { timeRange, setTimeRange } = useFilterStore()
  const timeRanges: TimeRange[] = ['All time', 'Past 30 minutes', 'Past hour', 'Past 24 hours']

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='outline' size='sm' className='w-full justify-between font-normal text-sm'>
          {timeRange}
          <ChevronDown className='ml-2 h-4 w-4 text-muted-foreground' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='w-[180px]'>
        {timeRanges.map((range) => (
          <DropdownMenuItem
            key={range}
            onSelect={(e) => {
              e.preventDefault()
              setTimeRange(range)
            }}
            className='flex cursor-pointer items-center justify-between p-2 text-sm'
          >
            <span>{range}</span>
            {timeRange === range && <Check className='h-4 w-4 text-primary' />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
