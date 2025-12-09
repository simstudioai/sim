import { type ReactNode, useState } from 'react'
import { ArrowUp, Bell, ChevronDown, Loader2, RefreshCw, Search } from 'lucide-react'
import {
  Button,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverScrollArea,
  PopoverTrigger,
  Tooltip,
} from '@/components/emcn'
import { MoreHorizontal } from '@/components/emcn/icons'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/core/utils/cn'
import { soehne } from '@/app/_styles/fonts/soehne/soehne'
import { useFilterStore } from '@/stores/logs/filters/store'
import type { TimeRange } from '@/stores/logs/filters/types'

const FILTER_BUTTON_CLASS =
  'w-full justify-between rounded-[10px] border-[#E5E5E5] bg-[var(--white)] font-normal text-sm dark:border-[#414141] dark:bg-[var(--surface-elevated)]'

type TimelineProps = {
  variant?: 'default' | 'header'
}

/**
 * Timeline component for time range selection.
 * Displays a dropdown with predefined time ranges.
 * @param props - The component props
 * @returns Time range selector dropdown
 */
function Timeline({ variant = 'default' }: TimelineProps = {}) {
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
        <Button variant='outline' className={FILTER_BUTTON_CLASS}>
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

interface ControlsProps {
  searchQuery?: string
  setSearchQuery?: (v: string) => void
  isRefetching: boolean
  resetToNow: () => void
  live: boolean
  setLive: (v: (prev: boolean) => boolean) => void
  viewMode: string
  setViewMode: (mode: 'logs' | 'dashboard') => void
  searchComponent?: ReactNode
  showExport?: boolean
  onExport?: () => void
  canConfigureNotifications?: boolean
  onConfigureNotifications?: () => void
}

export function Controls({
  searchQuery,
  setSearchQuery,
  isRefetching,
  resetToNow,
  live,
  setLive,
  viewMode,
  setViewMode,
  searchComponent,
  onExport,
  canConfigureNotifications,
  onConfigureNotifications,
}: ControlsProps) {
  return (
    <div
      className={cn(
        'mb-8 flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-start',
        soehne.className
      )}
    >
      {searchComponent ? (
        searchComponent
      ) : (
        <div className='relative w-full max-w-md'>
          <Search className='-translate-y-1/2 absolute top-1/2 left-3 h-[18px] w-[18px] text-muted-foreground' />
          <Input
            type='text'
            placeholder='Search workflows...'
            value={searchQuery}
            onChange={(e) => setSearchQuery?.(e.target.value)}
            className='h-9 w-full border-[#E5E5E5] bg-[var(--white)] pr-10 pl-9 dark:border-[#414141] dark:bg-[var(--surface-elevated)]'
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery?.('')}
              className='-translate-y-1/2 absolute top-1/2 right-3 text-muted-foreground hover:text-foreground'
            >
              <svg
                width='14'
                height='14'
                viewBox='0 0 16 16'
                fill='none'
                stroke='currentColor'
                strokeWidth='2'
                strokeLinecap='round'
              >
                <path d='M12 4L4 12M4 4l8 8' />
              </svg>
            </button>
          )}
        </div>
      )}

      <div className='ml-auto flex flex-shrink-0 items-center gap-3'>
        {viewMode !== 'dashboard' && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant='ghost' className='h-9 w-9 p-0 hover:bg-secondary'>
                <MoreHorizontal className='h-4 w-4' />
                <span className='sr-only'>More options</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align='end' sideOffset={4}>
              <PopoverScrollArea>
                <PopoverItem onClick={onExport}>
                  <ArrowUp className='h-3 w-3' />
                  <span>Export as CSV</span>
                </PopoverItem>
                <PopoverItem
                  onClick={canConfigureNotifications ? onConfigureNotifications : undefined}
                  disabled={!canConfigureNotifications}
                >
                  <Bell className='h-3 w-3' />
                  <span>Configure Notifications</span>
                </PopoverItem>
              </PopoverScrollArea>
            </PopoverContent>
          </Popover>
        )}

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              variant='ghost'
              onClick={resetToNow}
              className='h-9 w-9 p-0 hover:bg-secondary'
              disabled={isRefetching}
            >
              {isRefetching ? (
                <Loader2 className='h-4 w-4 animate-spin' />
              ) : (
                <RefreshCw className='h-4 w-4' />
              )}
              <span className='sr-only'>Refresh</span>
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>{isRefetching ? 'Refreshing...' : 'Refresh'}</Tooltip.Content>
        </Tooltip.Root>

        <div className='inline-flex h-9 items-center rounded-[11px] border bg-card p-1 shadow-sm'>
          <Button
            variant='ghost'
            onClick={() => setLive((v) => !v)}
            className={cn(
              'h-7 rounded-[8px] px-3 font-normal text-xs',
              live
                ? 'bg-[var(--brand-primary-hex)] text-white shadow-[0_0_0_0_var(--brand-primary-hex)] hover:bg-[var(--brand-primary-hover-hex)] hover:text-white hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]'
                : 'text-muted-foreground hover:text-foreground'
            )}
            aria-pressed={live}
          >
            Live
          </Button>
        </div>

        <div className='inline-flex h-9 items-center rounded-[11px] border bg-card p-1 shadow-sm'>
          <Button
            variant='ghost'
            onClick={() => setViewMode('logs')}
            className={cn(
              'h-7 rounded-[8px] px-3 font-normal text-xs',
              (viewMode as string) !== 'dashboard'
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
            aria-pressed={(viewMode as string) !== 'dashboard'}
          >
            Logs
          </Button>
          <Button
            variant='ghost'
            onClick={() => setViewMode('dashboard')}
            className={cn(
              'h-7 rounded-[8px] px-3 font-normal text-xs',
              (viewMode as string) === 'dashboard'
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            )}
            aria-pressed={(viewMode as string) === 'dashboard'}
          >
            Dashboard
          </Button>
        </div>
      </div>

      <div className='sm:hidden'>
        <Timeline />
      </div>
    </div>
  )
}

export default Controls
