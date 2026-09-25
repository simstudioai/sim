'use client'

import { useState } from 'react'
import {
  Calendar,
  Chip,
  ChipDropdown,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
} from '@sim/emcn'
import { Check, ChevronDown, ChevronLeft, Clock, RefreshCw } from '@sim/emcn/icons'
import { getBrowserTimezone, zonedWallClock } from '@/lib/core/utils/timezone'
import type { DashboardRange } from '@/lib/dashboards/spec'
import { type DashboardTimeRange, dashboardTimeLabel } from '@/lib/dashboards/time'

interface DashboardControlsProps {
  period: DashboardRange | 'custom'
  range: DashboardTimeRange
  timeZone: string
  zone: 'utc' | 'local'
  isFetching: boolean
  rangeError: boolean
  onPeriodChange: (period: DashboardRange | 'custom') => void
  onCalendarChange: (from: string, to: string) => boolean
  onZoneChange: (zone: 'utc' | 'local') => void
  onRefresh: () => void
}
const RANGE_OPTIONS = [
  { value: '1h', label: 'Last hour' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
] as const

export function DashboardControls({
  period,
  range,
  timeZone,
  zone,
  isFetching,
  rangeError,
  onPeriodChange,
  onCalendarChange,
  onZoneChange,
  onRefresh,
}: DashboardControlsProps) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState(false)
  const localTimeZone = getBrowserTimezone()
  const zoneLabel =
    new Intl.DateTimeFormat('en-US', { timeZone: localTimeZone, timeZoneName: 'short' })
      .formatToParts(new Date(range.to))
      .find((part) => part.type === 'timeZoneName')?.value ?? localTimeZone
  const from = new Date(range.from)
  const to = new Date(Date.parse(range.to) - 1)
  const fromLocal = zonedWallClock(from, timeZone)
  const toLocal = zonedWallClock(to, timeZone)
  const sameDay = fromLocal.slice(0, 10) === toLocal.slice(0, 10)
  const dates = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: fromLocal.slice(0, 4) === toLocal.slice(0, 4) ? undefined : 'numeric',
    hour: sameDay ? '2-digit' : undefined,
    minute: sameDay ? '2-digit' : undefined,
    hourCycle: 'h23',
  })
  const label =
    period === 'custom'
      ? rangeError
        ? 'Custom: choose range'
        : `Custom: ${dates.formatRange(from, to)}`
      : RANGE_OPTIONS.find((option) => option.value === period)!.label
  return (
    <div className='flex w-[360px] max-w-full shrink-0 items-center gap-2'>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) setCustom(period === 'custom')
        }}
      >
        <PopoverTrigger asChild>
          <Chip
            variant='outline'
            rightIcon={ChevronDown}
            className='min-w-0 flex-1'
            aria-label='Dashboard time range'
            title={`${dashboardTimeLabel(range.from, timeZone)} – ${dashboardTimeLabel(range.to, timeZone)} (end excluded)`}
          >
            {label}
          </Chip>
        </PopoverTrigger>
        <PopoverContent align='end' sideOffset={6} border className='w-[280px]' maxHeight={620}>
          {custom ? (
            <div>
              <Chip leftIcon={ChevronLeft} onClick={() => setCustom(false)}>
                Time ranges
              </Chip>
              <Calendar
                mode='range'
                className='w-full'
                showTime
                startDate={fromLocal}
                endDate={toLocal}
                onRangeChange={(from, to) => {
                  if (onCalendarChange(from, to)) setOpen(false)
                }}
                onCancel={() => setOpen(false)}
              />
            </div>
          ) : (
            <div className='flex flex-col gap-1'>
              {RANGE_OPTIONS.map((option) => (
                <Chip
                  key={option.value}
                  fullWidth
                  active={period === option.value}
                  rightIcon={period === option.value ? Check : undefined}
                  onClick={() => {
                    onPeriodChange(option.value)
                    setOpen(false)
                  }}
                >
                  {option.label}
                </Chip>
              ))}
              <Chip fullWidth onClick={() => setCustom(true)}>
                Custom range…
              </Chip>
            </div>
          )}
        </PopoverContent>
      </Popover>
      <ChipDropdown
        aria-label='Dashboard timezone'
        variant='outline'
        leftIcon={Clock}
        className='shrink-0'
        value={zone}
        matchTriggerWidth={false}
        options={[
          { value: 'local', label: zoneLabel },
          { value: 'utc', label: 'UTC' },
        ]}
        onChange={(value) => {
          if (value !== 'utc' && value !== 'local') throw new Error('Invalid dashboard timezone')
          onZoneChange(value)
        }}
      />
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Chip
            leftIcon={RefreshCw}
            disabled={isFetching}
            aria-label={isFetching ? 'Refreshing dashboard' : 'Refresh dashboard'}
            onClick={onRefresh}
          />
        </Tooltip.Trigger>
        <Tooltip.Content>Refresh dashboard</Tooltip.Content>
      </Tooltip.Root>
    </div>
  )
}
