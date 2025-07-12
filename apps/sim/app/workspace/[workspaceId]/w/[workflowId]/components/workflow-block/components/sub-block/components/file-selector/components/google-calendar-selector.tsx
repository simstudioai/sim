'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronDown, RefreshCw, X } from 'lucide-react'
import { GoogleCalendarIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('GoogleCalendarSelector')

export interface GoogleCalendarInfo {
  id: string
  summary: string
  description?: string
  primary?: boolean
  accessRole: string
  backgroundColor?: string
  foregroundColor?: string
}

interface GoogleCalendarSelectorProps {
  value: string
  onChange: (value: string, calendarInfo?: GoogleCalendarInfo) => void
  label?: string
  disabled?: boolean
  showPreview?: boolean
  onCalendarInfoChange?: (info: GoogleCalendarInfo | null) => void
  credentialId: string
}

export function GoogleCalendarSelector({
  value,
  onChange,
  label = 'Select Google Calendar',
  disabled = false,
  showPreview = true,
  onCalendarInfoChange,
  credentialId,
}: GoogleCalendarSelectorProps) {
  const [open, setOpen] = useState(false)
  const [calendars, setCalendars] = useState<GoogleCalendarInfo[]>([])
  const [selectedCalendarId, setSelectedCalendarId] = useState(value)
  const [selectedCalendar, setSelectedCalendar] = useState<GoogleCalendarInfo | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [initialFetchDone, setInitialFetchDone] = useState(false)

  const fetchCalendarsFromAPI = useCallback(async (): Promise<GoogleCalendarInfo[]> => {
    if (!credentialId) {
      throw new Error('Google Calendar account is required')
    }

    const queryParams = new URLSearchParams({
      credentialId: credentialId,
    })

    const response = await fetch(`/api/tools/google_calendar/calendars?${queryParams.toString()}`)

    if (!response.ok) {
      const errorData = await response.json()
      throw new Error(errorData.error || 'Failed to fetch Google Calendar calendars')
    }

    const data = await response.json()
    return data.calendars || []
  }, [credentialId])

  const fetchCalendars = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const calendars = await fetchCalendarsFromAPI()
      setCalendars(calendars)

      const currentSelectedId = selectedCalendarId
      if (currentSelectedId) {
        const calendarInfo = calendars.find(
          (calendar: GoogleCalendarInfo) => calendar.id === currentSelectedId
        )
        if (calendarInfo) {
          setSelectedCalendar(calendarInfo)
          onCalendarInfoChange?.(calendarInfo)
        }
      }
    } catch (error) {
      logger.error('Error fetching calendars:', error)
      setError((error as Error).message)
      setCalendars([])
    } finally {
      setIsLoading(false)
      setInitialFetchDone(true)
    }
  }, [fetchCalendarsFromAPI, selectedCalendarId, onCalendarInfoChange])

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen)

    if (isOpen && credentialId && (!initialFetchDone || calendars.length === 0)) {
      fetchCalendars()
    }
  }

  const fetchSelectedCalendarInfo = useCallback(async () => {
    if (!selectedCalendarId) return

    setIsLoading(true)
    setError(null)

    try {
      const calendars = await fetchCalendarsFromAPI()

      if (calendars.length > 0) {
        const calendarInfo = calendars.find(
          (calendar: GoogleCalendarInfo) => calendar.id === selectedCalendarId
        )
        if (calendarInfo) {
          setSelectedCalendar(calendarInfo)
          onCalendarInfoChange?.(calendarInfo)
        }
      }
    } catch (error) {
      logger.error('Error fetching calendar info:', error)
      setError((error as Error).message)
    } finally {
      setIsLoading(false)
    }
  }, [fetchCalendarsFromAPI, selectedCalendarId, onCalendarInfoChange])

  // Fetch selected calendar info when component mounts or dependencies change
  useEffect(() => {
    if (value && credentialId && (!selectedCalendar || selectedCalendar.id !== value)) {
      fetchSelectedCalendarInfo()
    }
  }, [value, credentialId, selectedCalendar, fetchSelectedCalendarInfo])

  // Sync with external value
  useEffect(() => {
    if (value !== selectedCalendarId) {
      setSelectedCalendarId(value)

      // Find calendar info for the new value
      if (value && calendars.length > 0) {
        const calendarInfo = calendars.find((calendar) => calendar.id === value)
        setSelectedCalendar(calendarInfo || null)
        onCalendarInfoChange?.(calendarInfo || null)
      } else if (value) {
        // If we have a value but no calendar info, we might need to fetch it
        if (!selectedCalendar || selectedCalendar.id !== value) {
          fetchSelectedCalendarInfo()
        }
      } else {
        setSelectedCalendar(null)
        onCalendarInfoChange?.(null)
      }
    }
  }, [
    value,
    calendars,
    selectedCalendarId,
    selectedCalendar,
    fetchSelectedCalendarInfo,
    onCalendarInfoChange,
  ])

  // Handle calendar selection
  const handleSelectCalendar = (calendar: GoogleCalendarInfo) => {
    setSelectedCalendarId(calendar.id)
    setSelectedCalendar(calendar)
    onChange(calendar.id, calendar)
    onCalendarInfoChange?.(calendar)
    setOpen(false)
  }

  // Clear selection
  const handleClearSelection = () => {
    setSelectedCalendarId('')
    setSelectedCalendar(null)
    onChange('', undefined)
    onCalendarInfoChange?.(null)
    setError(null)
  }

  // Get calendar display name
  const getCalendarDisplayName = (calendar: GoogleCalendarInfo) => {
    if (calendar.primary) {
      return `${calendar.summary} (Primary)`
    }
    return calendar.summary
  }

  return (
    <div className='space-y-2'>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant='outline'
            role='combobox'
            aria-expanded={open}
            className='h-10 w-full min-w-0 justify-between'
            disabled={disabled || !credentialId}
          >
            <div className='flex min-w-0 items-center gap-2 overflow-hidden'>
              {selectedCalendar ? (
                <>
                  <div
                    className='h-3 w-3 flex-shrink-0 rounded-full'
                    style={{
                      backgroundColor: selectedCalendar.backgroundColor || '#4285f4',
                    }}
                  />
                  <span className='truncate font-normal'>
                    {getCalendarDisplayName(selectedCalendar)}
                  </span>
                </>
              ) : (
                <>
                  <GoogleCalendarIcon className='h-4 w-4' />
                  <span className='truncate text-muted-foreground'>{label}</span>
                </>
              )}
            </div>
            <ChevronDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
          </Button>
        </PopoverTrigger>
        <PopoverContent className='w-[300px] p-0' align='start'>
          <Command>
            <CommandInput placeholder='Search calendars...' />
            <CommandList>
              <CommandEmpty>
                {isLoading ? (
                  <div className='flex items-center justify-center p-4'>
                    <RefreshCw className='h-4 w-4 animate-spin' />
                    <span className='ml-2'>Loading calendars...</span>
                  </div>
                ) : error ? (
                  <div className='p-4 text-center'>
                    <p className='text-destructive text-sm'>{error}</p>
                  </div>
                ) : calendars.length === 0 ? (
                  <div className='p-4 text-center'>
                    <p className='font-medium text-sm'>No calendars found</p>
                    <p className='text-muted-foreground text-xs'>
                      Please check your Google Calendar account access
                    </p>
                  </div>
                ) : (
                  <div className='p-4 text-center'>
                    <p className='font-medium text-sm'>No matching calendars</p>
                  </div>
                )}
              </CommandEmpty>

              {calendars.length > 0 && (
                <CommandGroup>
                  <div className='px-2 py-1.5 font-medium text-muted-foreground text-xs'>
                    Calendars
                  </div>
                  {calendars.map((calendar) => (
                    <CommandItem
                      key={calendar.id}
                      value={`calendar-${calendar.id}-${calendar.summary}`}
                      onSelect={() => handleSelectCalendar(calendar)}
                      className='cursor-pointer'
                    >
                      <div className='flex items-center gap-2 overflow-hidden'>
                        <div
                          className='h-3 w-3 flex-shrink-0 rounded-full'
                          style={{
                            backgroundColor: calendar.backgroundColor || '#4285f4',
                          }}
                        />
                        <span className='truncate font-normal'>
                          {getCalendarDisplayName(calendar)}
                        </span>
                      </div>
                      {calendar.id === selectedCalendarId && <Check className='ml-auto h-4 w-4' />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Calendar preview */}
      {showPreview && selectedCalendar && (
        <div className='relative mt-2 rounded-md border border-muted bg-muted/10 p-2'>
          <div className='absolute top-2 right-2'>
            <Button
              variant='ghost'
              size='icon'
              className='h-5 w-5 hover:bg-muted'
              onClick={handleClearSelection}
            >
              <X className='h-3 w-3' />
            </Button>
          </div>
          <div className='flex items-center gap-3 pr-4'>
            <div className='flex h-6 w-6 flex-shrink-0 items-center justify-center rounded bg-muted/20'>
              <div
                className='h-3 w-3 rounded-full'
                style={{
                  backgroundColor: selectedCalendar.backgroundColor || '#4285f4',
                }}
              />
            </div>
            <div className='min-w-0 flex-1 overflow-hidden'>
              <h4 className='truncate font-medium text-xs'>
                {getCalendarDisplayName(selectedCalendar)}
              </h4>
              <div className='text-muted-foreground text-xs'>
                Access: {selectedCalendar.accessRole}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
