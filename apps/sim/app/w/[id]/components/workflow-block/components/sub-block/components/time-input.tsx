'use client'

import * as React from 'react'
import { Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useSubBlockValue } from '../hooks/use-sub-block-value'


interface TimeInputProps {
  blockId: string
  subBlockId: string
  placeholder?: string
  isPreview?: boolean
  previewValue?: string | null
  className?: string
}

export function TimeInput({ 
  blockId, 
  subBlockId, 
  placeholder,
  isPreview = false,
  previewValue,
  className,  
}: TimeInputProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<string>(blockId, subBlockId)
  
  // Use preview value when in preview mode, otherwise use store value
  const value = isPreview ? previewValue : storeValue
  const [isOpen, setIsOpen] = React.useState(false)

  // Convert 24h time string to display format (12h with AM/PM)
  const formatDisplayTime = (time: string) => {
    if (!time) return ''
    const [hours, minutes] = time.split(':')
    const hour = Number.parseInt(hours, 10)
    const ampm = hour >= 12 ? 'PM' : 'AM'
    const displayHour = hour % 12 || 12
    return `${displayHour}:${minutes} ${ampm}`
  }

  // Convert display time to 24h format for storage
  const formatStorageTime = (hour: number, minute: number, ampm: string) => {
    const hours24 = ampm === 'PM' ? (hour === 12 ? 12 : hour + 12) : hour === 12 ? 0 : hour
    return `${hours24.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
  }

  const [hour, setHour] = React.useState<string>('12')
  const [minute, setMinute] = React.useState<string>('00')
  const [ampm, setAmpm] = React.useState<'AM' | 'PM'>('AM')

  // Update the time when any component changes
  const updateTime = (newHour?: string, newMinute?: string, newAmpm?: 'AM' | 'PM') => {
    if (isPreview) return
    const h = parseInt(newHour ?? hour) || 12
    const m = parseInt(newMinute ?? minute) || 0
    const p = newAmpm ?? ampm
    setStoreValue(formatStorageTime(h, m, p))
  }

  // Initialize from existing value
  React.useEffect(() => {
    if (value) {
      const [hours, minutes] = value.split(':')
      const hour24 = Number.parseInt(hours, 10)
      const _minute = Number.parseInt(minutes, 10)
      const isAM = hour24 < 12
      setHour((hour24 % 12 || 12).toString())
      setMinute(minutes)
      setAmpm(isAM ? 'AM' : 'PM')
    }
  }, [value])

  const handleBlur = () => {
    updateTime()
    setIsOpen(false)
  }

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open)
        if (!open) {
          handleBlur()
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={isPreview}
          className={cn(
            'w-full justify-start text-left font-normal',
            !value && 'text-muted-foreground',
            className
          )}
        >
          <Clock className='mr-1 h-4 w-4' />
          {value ? formatDisplayTime(value) : <span>{placeholder || 'Select time'}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-auto p-4'>
        <div className='flex items-center space-x-2'>
          <Input
            className='w-[4rem]'
            value={hour}
            onChange={(e) => {
              const val = e.target.value.replace(/[^0-9]/g, '')
              if (val === '') {
                setHour('')
                return
              }
              const numVal = Number.parseInt(val)
              if (!Number.isNaN(numVal)) {
                const newHour = Math.min(12, Math.max(1, numVal)).toString()
                setHour(newHour)
                updateTime(newHour)
              }
            }}
            onBlur={() => {
              const numVal = Number.parseInt(hour) || 12
              setHour(numVal.toString())
              updateTime(numVal.toString())
            }}
            type='text'
          />
          <span>:</span>
          <Input
            className='w-[4rem]'
            value={minute}
            onChange={(e) => {
              const val = e.target.value.replace(/[^0-9]/g, '')
              if (val === '') {
                setMinute('')
                return
              }
              const numVal = Number.parseInt(val)
              if (!Number.isNaN(numVal)) {
                const newMinute = Math.min(59, Math.max(0, numVal)).toString().padStart(2, '0')
                setMinute(newMinute)
                updateTime(undefined, newMinute)
              }
            }}
            onBlur={() => {
              const numVal = Number.parseInt(minute) || 0
              setMinute(numVal.toString().padStart(2, '0'))
              updateTime(undefined, numVal.toString())
            }}
            type='text'
          />
          <Button
            variant='outline'
            className='w-[4rem]'
            onClick={() => {
              const newAmpm = ampm === 'AM' ? 'PM' : 'AM'
              setAmpm(newAmpm)
              updateTime(undefined, undefined, newAmpm)
            }}
          >
            {ampm}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
