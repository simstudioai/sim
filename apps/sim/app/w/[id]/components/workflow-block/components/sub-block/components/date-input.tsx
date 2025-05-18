'use client'

import * as React from 'react'
import { format } from 'date-fns'
import { Calendar as CalendarIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useNotificationStore } from '@/stores/notifications/store'
import { useSubBlockValue } from '../hooks/use-sub-block-value'


interface DateInputProps {
  blockId: string
  subBlockId: string
  placeholder?: string
  isPreview?: boolean
  value?: string
}

export function DateInput({ blockId, subBlockId, placeholder, isPreview = false, value: propValue }: DateInputProps) {
  const [value, setValue] = useSubBlockValue<string>(blockId, subBlockId, true, isPreview, propValue)
  const addNotification = useNotificationStore((state) => state.addNotification)
  const date = value ? new Date(value) : undefined

  const isPastDate = React.useMemo(() => {
    if (!date) return false
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return date < today
  }, [date])

  const handleDateSelect = (selectedDate: Date | undefined) => {
    if (selectedDate) {
      const today = new Date()
      today.setHours(0, 0, 0, 0)

      if (selectedDate < today) {
        addNotification('error', 'Cannot start at a date in the past', blockId)
      }
    }
    setValue(selectedDate?.toISOString() || '')
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          className={cn(
            'w-full justify-start text-left font-normal',
            !date && 'text-muted-foreground',
            isPastDate && 'border-red-500'
          )}
        >
          <CalendarIcon className='mr-1 h-4 w-4' />
          {date ? format(date, 'MMM d, yy') : <span>{placeholder || 'Pick a date'}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-auto p-0'>
        <Calendar mode='single' selected={date} onSelect={handleDateSelect} initialFocus />
      </PopoverContent>
    </Popover>
  )
}
