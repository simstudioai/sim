'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Badge,
  Button,
  Calendar,
  ChipInput,
  ChipSelect,
  type ComboboxOption,
  cn,
  Popover,
  PopoverAnchor,
  PopoverContent,
  RefreshCw,
  Search,
} from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { formatDateTime } from '@sim/utils/formatting'
import { isRecordLike } from '@sim/utils/object'
import { ChevronDown } from 'lucide-react'
import { getEndDateFromTimeRange, getStartDateFromTimeRange } from '@/lib/logs/filters'
import type { EnterpriseAuditLogEntry } from '@/app/api/v1/audit-logs/format'
import { formatDateShort } from '@/app/workspace/[workspaceId]/logs/utils'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { RESOURCE_TYPE_OPTIONS } from '@/ee/audit-logs/constants'
import { type AuditLogFilters, useAuditLogs } from '@/ee/audit-logs/hooks/audit-logs'
import type { TimeRange } from '@/stores/logs/filters/types'

const logger = createLogger('AuditLogs')

const REFRESH_SPINNER_DURATION_MS = 1000

const TIME_RANGE_OPTIONS: ComboboxOption[] = [
  { value: 'All time', label: 'All time' },
  { value: 'Past 30 minutes', label: 'Past 30 minutes' },
  { value: 'Past hour', label: 'Past hour' },
  { value: 'Past 6 hours', label: 'Past 6 hours' },
  { value: 'Past 12 hours', label: 'Past 12 hours' },
  { value: 'Past 24 hours', label: 'Past 24 hours' },
  { value: 'Past 3 days', label: 'Past 3 days' },
  { value: 'Past 7 days', label: 'Past 7 days' },
  { value: 'Past 14 days', label: 'Past 14 days' },
  { value: 'Past 30 days', label: 'Past 30 days' },
  { value: 'Custom range', label: 'Custom range' },
]

function formatResourceType(type: string): string {
  return type
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function formatAction(action: string): string {
  return action.replace(/[._]/g, ' ')
}

function formatMetadataLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function formatPrimitiveValue(value: string | number | boolean | null): string {
  if (value === null) return '-'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return value.toLocaleString()
  return value
}

function renderMetadataValue(value: unknown) {
  if (value == null) return <span className='text-[var(--text-muted)]'>-</span>

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return <span className='text-[var(--text-primary)]'>{formatPrimitiveValue(value)}</span>
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className='text-[var(--text-muted)]'>None</span>
    }

    const hasComplexValues = value.some((item) => typeof item === 'object' && item !== null)
    if (!hasComplexValues) {
      return (
        <span className='text-[var(--text-primary)]'>
          {value
            .map((item) => formatPrimitiveValue((item as string | number | boolean | null) ?? null))
            .join(', ')}
        </span>
      )
    }

    return (
      <pre className='min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all text-[var(--text-secondary)] text-xs'>
        {JSON.stringify(value, null, 2)}
      </pre>
    )
  }

  if (isRecordLike(value)) {
    const entries = Object.entries(value).filter(([, nestedValue]) => nestedValue !== undefined)
    if (entries.length === 0) {
      return <span className='text-[var(--text-muted)]'>None</span>
    }

    const hasComplexValues = entries.some(([, nestedValue]) => {
      return Array.isArray(nestedValue) || isRecordLike(nestedValue)
    })

    if (!hasComplexValues) {
      return (
        <span className='text-[var(--text-primary)]'>
          {entries
            .map(([nestedKey, nestedValue]) => {
              return `${formatMetadataLabel(nestedKey)}: ${formatPrimitiveValue((nestedValue as string | number | boolean | null) ?? null)}`
            })
            .join(' · ')}
        </span>
      )
    }

    return (
      <pre className='min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all text-[var(--text-secondary)] text-xs'>
        {JSON.stringify(value, null, 2)}
      </pre>
    )
  }

  return (
    <pre className='min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all text-[var(--text-secondary)] text-xs'>
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}

function getMetadataEntries(metadata: unknown) {
  if (!isRecordLike(metadata)) return []

  return Object.entries(metadata).filter(([key, value]) => {
    if (value === undefined) return false
    return !['name', 'description'].includes(key)
  })
}

interface ActionBadgeProps {
  action: string
}

function ActionBadge({ action }: ActionBadgeProps) {
  const [, verb] = action.split('.')
  const variant =
    verb === 'deleted' || verb === 'removed' || verb === 'revoked' ? 'red' : 'gray-secondary'
  return (
    <Badge variant={variant} size='sm' className='shrink-0'>
      {formatAction(action)}
    </Badge>
  )
}

interface AuditLogRowProps {
  entry: EnterpriseAuditLogEntry
}

function AuditLogRow({ entry }: AuditLogRowProps) {
  const [expanded, setExpanded] = useState(false)
  const timestamp = formatDateTime(new Date(entry.createdAt))
  const metadataEntries = getMetadataEntries(entry.metadata)

  return (
    <div
      className={cn(
        'rounded-md transition-colors',
        'hover-hover:bg-[var(--surface-2)]',
        expanded && 'bg-[var(--surface-2)]'
      )}
    >
      <button
        type='button'
        className='flex w-full items-center gap-3 px-3 py-2 text-left'
        onClick={() => setExpanded(!expanded)}
      >
        <span className='w-[160px] flex-shrink-0 text-[var(--text-secondary)] text-small'>
          {timestamp}
        </span>
        <span className='w-[180px] flex-shrink-0'>
          <ActionBadge action={entry.action} />
        </span>
        <span className='min-w-0 flex-1 truncate text-[var(--text-primary)] text-small'>
          {entry.description || entry.resourceName || entry.resourceId || '-'}
        </span>
        <span className='flex w-[160px] flex-shrink-0 items-center justify-end gap-1.5 text-[var(--text-secondary)] text-small'>
          <span className='min-w-0 truncate'>
            {entry.actorEmail || entry.actorName || 'System'}
          </span>
          <ChevronDown
            className={cn(
              'size-[14px] flex-shrink-0 text-[var(--text-muted)] transition-transform duration-200',
              expanded && 'rotate-180'
            )}
          />
        </span>
      </button>
      {expanded && (
        <div className='px-3 pb-2'>
          <div className='flex flex-col gap-1.5 rounded-lg border border-[var(--border-1)] bg-[var(--surface-3)] p-3 text-small'>
            <div className='flex gap-2'>
              <span className='w-[100px] flex-shrink-0 text-[var(--text-muted)]'>Resource</span>
              <span className='text-[var(--text-primary)]'>
                {formatResourceType(entry.resourceType)}
                {entry.resourceId && (
                  <span className='ml-1 text-[var(--text-muted)]'>({entry.resourceId})</span>
                )}
              </span>
            </div>
            {entry.resourceName && (
              <div className='flex gap-2'>
                <span className='w-[100px] flex-shrink-0 text-[var(--text-muted)]'>Name</span>
                <span className='text-[var(--text-primary)]'>{entry.resourceName}</span>
              </div>
            )}
            <div className='flex gap-2'>
              <span className='w-[100px] flex-shrink-0 text-[var(--text-muted)]'>Actor</span>
              <span className='text-[var(--text-primary)]'>
                {entry.actorName || 'Unknown'}
                {entry.actorEmail && (
                  <span className='ml-1 text-[var(--text-muted)]'>({entry.actorEmail})</span>
                )}
              </span>
            </div>
            {entry.description && (
              <div className='flex gap-2'>
                <span className='w-[100px] flex-shrink-0 text-[var(--text-muted)]'>
                  Description
                </span>
                <span className='text-[var(--text-primary)]'>{entry.description}</span>
              </div>
            )}
            {metadataEntries.map(([key, value]) => (
              <div key={key} className='flex gap-2'>
                <span className='w-[100px] flex-shrink-0 text-[var(--text-muted)]'>
                  {formatMetadataLabel(key)}
                </span>
                <div className='min-w-0 flex-1'>{renderMetadataValue(value)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function AuditLogs() {
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [timeRange, setTimeRange] = useState<TimeRange>('Past 30 days')
  const [customStartDate, setCustomStartDate] = useState('')
  const [customEndDate, setCustomEndDate] = useState('')
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const previousTimeRangeRef = useRef<TimeRange>('Past 30 days')
  const dateRangeAppliedRef = useRef(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isVisuallyRefreshing, setIsVisuallyRefreshing] = useState(false)
  const refreshTimersRef = useRef(new Set<number>())

  useEffect(() => {
    const trimmed = searchTerm.trim()
    if (trimmed === debouncedSearch) return
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(trimmed)
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [searchTerm, debouncedSearch])

  useEffect(() => {
    const timers = refreshTimersRef.current
    return () => {
      for (const timerId of timers) window.clearTimeout(timerId)
    }
  }, [])

  const filters = useMemo<AuditLogFilters>(() => {
    return {
      search: debouncedSearch || undefined,
      resourceType: selectedTypes.length > 0 ? selectedTypes.join(',') : undefined,
      startDate: getStartDateFromTimeRange(timeRange, customStartDate)?.toISOString(),
      endDate: getEndDateFromTimeRange(timeRange, customEndDate)?.toISOString(),
    }
  }, [debouncedSearch, selectedTypes, timeRange, customStartDate, customEndDate])

  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, refetch } =
    useAuditLogs(filters)

  const allEntries = useMemo(() => {
    if (!data?.pages) return []
    return data.pages.flatMap((page) => page.data)
  }, [data])

  const typeDisplayLabel =
    selectedTypes.length === 0
      ? 'All types'
      : selectedTypes.length === 1
        ? RESOURCE_TYPE_OPTIONS.find((t) => t.value === selectedTypes[0])?.label || '1 selected'
        : `${selectedTypes.length} types`

  const timeDisplayLabel =
    timeRange === 'Custom range' && customStartDate && customEndDate
      ? `${formatDateShort(customStartDate)} - ${formatDateShort(customEndDate)}`
      : timeRange

  const handleTimeRangeChange = (value: string) => {
    if (value === 'Custom range') {
      previousTimeRangeRef.current = timeRange
      setDatePickerOpen(true)
    } else {
      setCustomStartDate('')
      setCustomEndDate('')
      setTimeRange(value as TimeRange)
    }
  }

  const handleDateRangeApply = (start: string, end: string) => {
    dateRangeAppliedRef.current = true
    setCustomStartDate(start)
    setCustomEndDate(end)
    setTimeRange('Custom range')
    setDatePickerOpen(false)
  }

  const handleDatePickerCancel = () => {
    if (timeRange === 'Custom range' && !customStartDate) {
      setTimeRange(previousTimeRangeRef.current)
    }
    setDatePickerOpen(false)
  }

  const handleRefresh = useCallback(() => {
    setIsVisuallyRefreshing(true)
    const timerId = window.setTimeout(() => {
      setIsVisuallyRefreshing(false)
      refreshTimersRef.current.delete(timerId)
    }, REFRESH_SPINNER_DURATION_MS)
    refreshTimersRef.current.add(timerId)
    refetch().catch((error: unknown) => {
      logger.error('Failed to refresh audit logs', { error })
    })
  }, [refetch])

  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage().catch((error: unknown) => {
        logger.error('Failed to load more audit logs', { error })
      })
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <SettingsPanel>
      <div className='flex items-center gap-2'>
        <ChipInput
          icon={Search}
          className='min-w-0 flex-1'
          placeholder='Search audit logs...'
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <ChipSelect
          options={RESOURCE_TYPE_OPTIONS}
          multiSelect
          multiSelectValues={selectedTypes}
          onMultiSelectChange={setSelectedTypes}
          placeholder='All types'
          displayLabel={typeDisplayLabel}
          searchable
          searchPlaceholder='Search types...'
          showAllOption
          allOptionLabel='All types'
          align='start'
        />
        <div className='relative'>
          <ChipSelect
            options={TIME_RANGE_OPTIONS}
            value={timeRange}
            onChange={handleTimeRangeChange}
            placeholder='All time'
            displayLabel={timeDisplayLabel}
            maxHeight={320}
            align='start'
          />
          <Popover
            open={datePickerOpen}
            onOpenChange={(isOpen) => {
              if (!isOpen) {
                if (dateRangeAppliedRef.current) {
                  dateRangeAppliedRef.current = false
                } else {
                  handleDatePickerCancel()
                }
              }
            }}
          >
            <PopoverAnchor className='pointer-events-none absolute inset-0' />
            <PopoverContent align='start' sideOffset={4} className='w-auto p-0'>
              <Calendar
                mode='range'
                showTime
                startDate={customStartDate}
                endDate={customEndDate}
                onRangeChange={handleDateRangeApply}
                onCancel={handleDatePickerCancel}
              />
            </PopoverContent>
          </Popover>
        </div>
        <Button variant='ghost' onClick={handleRefresh} disabled={isVisuallyRefreshing}>
          <RefreshCw animate={isVisuallyRefreshing} className='size-[14px]' />
        </Button>
      </div>

      <div className='flex flex-col'>
        <div className='flex items-center gap-3 px-3 pb-1 text-[var(--text-tertiary)] text-caption'>
          <span className='w-[160px] flex-shrink-0'>Timestamp</span>
          <span className='w-[180px] flex-shrink-0'>Event</span>
          <span className='min-w-0 flex-1'>Description</span>
          <span className='w-[160px] flex-shrink-0 text-right'>Actor</span>
        </div>

        {isLoading ? null : allEntries.length === 0 ? (
          debouncedSearch ? (
            <SettingsEmptyState variant='inline'>
              No results for "{debouncedSearch}"
            </SettingsEmptyState>
          ) : (
            <SettingsEmptyState>No audit logs found</SettingsEmptyState>
          )
        ) : (
          <div className='flex flex-col gap-0.5'>
            {allEntries.map((entry) => (
              <AuditLogRow key={entry.id} entry={entry} />
            ))}
            {hasNextPage && (
              <div className='flex justify-center py-4'>
                <Button variant='ghost' onClick={handleLoadMore} disabled={isFetchingNextPage}>
                  {isFetchingNextPage ? 'Loading...' : 'Load more'}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </SettingsPanel>
  )
}
