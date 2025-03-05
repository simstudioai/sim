import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export default function Timeline() {
  const [selectedTimeRange, setSelectedTimeRange] = useState('Past 30 minutes')
  const timeRanges = ['Past 30 minutes', 'Past hour', 'Past 24 hours', 'All time']

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-between text-sm font-normal">
          {selectedTimeRange}
          <ChevronDown className="h-4 w-4 ml-2 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="overflow-y-auto">
        {timeRanges.map((range) => (
          <DropdownMenuItem
            key={range}
            onClick={() => setSelectedTimeRange(range)}
            className="flex items-start p-2 cursor-pointer text-sm"
          >
            {range}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
