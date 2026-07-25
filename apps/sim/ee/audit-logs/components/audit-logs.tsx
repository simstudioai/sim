'use client'

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Badge,
  Button,
  Calendar,
  ChipCombobox,
  ChipInput,
  ChipSelect,
  type ComboboxOption,
  Download,
  Popover,
  PopoverAnchor,
  PopoverContent,
  RefreshCw,
  Search,
  toast,
} from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { formatDateTime } from '@sim/utils/formatting'
import { isRecordLike } from '@sim/utils/object'
import { useQueryStates } from 'nuqs'
import { getEndDateFromTimeRange, getStartDateFromTimeRange } from '@/lib/logs/filters'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import type { EnterpriseAuditLogEntry } from '@/app/api/v1/audit-logs/format'
import { formatDateShort } from '@/app/workspace/[workspaceId]/logs/utils'
import {
  ActivityLog,
  type ActivityLogEntry,
} from '@/app/workspace/[workspaceId]/settings/components/activity-log'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
import { RESOURCE_TYPE_OPTIONS } from '@/ee/audit-logs/constants'
import { type AuditLogFilters, useAuditLogs } from '@/ee/audit-logs/hooks/audit-logs'
import {
  auditLogFilterParsers,
  auditLogFilterUrlKeys,
  DEFAULT_AUDIT_TIME_RANGE,
} from '@/ee/audit-logs/search-params'
import { useDebounce } from '@/hooks/use-debounce'
import type { TimeRange } from '@/stores/logs/filters/types'

const logger = createLogger('AuditLogs')

const REFRESH_SPINNER_DURATION_MS = 1000

/** Trimmed to the most commonly used granularities so the menu fits without scrolling. */
const TIME_RANGE_OPTIONS: ComboboxOption[] = [
  { value: 'All time', label: 'All time' },
  { value: 'Past hour', label: 'Past hour' },
  { value: 'Past 6 hours', label: 'Past 6 hours' },
  { value: 'Past 24 hours', label: 'Past 24 hours' },
  { value: 'Past 3 days', label: 'Past 3 days' },
  { value: 'Past 7 days', label: 'Past 7 days' },
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

/** The expanded detail box content for one audit entry (resource, actor, metadata). */
function auditLogDetails(entry: EnterpriseAuditLogEntry): ReactNode {
  const metadataEntries = getMetadataEntries(entry.metadata)
  return (
    <>
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
          <span className='w-[100px] flex-shrink-0 text-[var(--text-muted)]'>Description</span>
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
    </>
  )
}

/** Maps an audit entry to the shared {@link ActivityLog} row shape. */
function toActivityEntry(entry: EnterpriseAuditLogEntry): ActivityLogEntry {
  return {
    id: entry.id,
    timestamp: formatDateTime(new Date(entry.createdAt)),
    event: <ActionBadge action={entry.action} />,
    description: entry.description || entry.resourceName || entry.resourceId || '-',
    actor: entry.actorEmail || entry.actorName || 'System',
    details: auditLogDetails(entry),
  }
}

interface AuditLogsProps {
  organizationId: string
}

export function AuditLogs({ organizationId }: AuditLogsProps) {
  const [urlFilters, setUrlFilters] = useQueryStates(auditLogFilterParsers, auditLogFilterUrlKeys)
  const { types: selectedTypes } = urlFilters
  const customStartDate = urlFilters.startDate ?? ''
  const customEndDate = urlFilters.endDate ?? ''
  /**
   * 'Custom range' is only honored with both bounds present — a partial deep
   * link (`?time-range=custom` with a missing date) falls back to the default
   * preset window instead of silently querying unbounded.
   */
  const timeRange: TimeRange =
    urlFilters.timeRange === 'Custom range' && (!customStartDate || !customEndDate)
      ? DEFAULT_AUDIT_TIME_RANGE
      : urlFilters.timeRange
  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const dateRangeAppliedRef = useRef(false)
  const [searchTerm, setSearchTerm] = useSettingsSearch()
  const debouncedSearch = useDebounce(searchTerm, SEARCH_DEBOUNCE_MS).trim()
  const [isVisuallyRefreshing, setIsVisuallyRefreshing] = useState(false)
  const refreshTimersRef = useRef(new Set<number>())
  const [isExporting, setIsExporting] = useState(false)

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

  const {
    data,
    isLoading,
    isPlaceholderData,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useAuditLogs(organizationId, filters)

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
      setDatePickerOpen(true)
    } else {
      void setUrlFilters({ timeRange: value as TimeRange, startDate: null, endDate: null })
    }
  }

  const handleDateRangeApply = (start: string, end: string) => {
    dateRangeAppliedRef.current = true
    void setUrlFilters({ timeRange: 'Custom range', startDate: start, endDate: end })
    setDatePickerOpen(false)
  }

  /**
   * Cancel is a pure close: the URL only ever holds 'Custom range' after Apply
   * wrote both bounds atomically, so there is never a pending state to revert.
   */
  const handleDatePickerCancel = () => {
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

  const handleExportCsv = async () => {
    setIsExporting(true)
    try {
      const params = new URLSearchParams()
      params.set('organizationId', organizationId)
      if (filters.search) params.set('search', filters.search)
      if (filters.resourceType) params.set('resourceType', filters.resourceType)
      if (filters.startDate) params.set('startDate', filters.startDate)
      if (filters.endDate) params.set('endDate', filters.endDate)

      // boundary-raw-fetch: downloads a CSV blob and reads a response header before saving — a plain anchor navigation can't do either
      const response = await fetch(`/api/audit-logs/export?${params.toString()}`)
      if (!response.ok) {
        toast.error('Failed to export audit logs')
        return
      }
      if (response.headers.get('X-Export-Truncated') === '1') {
        toast.info('Export truncated — narrow the date range to see everything')
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <SettingsPanel
      actions={[
        {
          text: 'Export',
          icon: Download,
          onSelect: () => void handleExportCsv(),
          disabled: allEntries.length === 0 || isExporting || isPlaceholderData,
        },
      ]}
    >
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
          onMultiSelectChange={(values) => void setUrlFilters({ types: values })}
          placeholder='All types'
          displayLabel={typeDisplayLabel}
          searchable
          searchPlaceholder='Search types...'
          showAllOption
          allOptionLabel='All types'
          align='start'
        />
        <div className='relative'>
          {/* ChipCombobox (Radix Popover, non-modal), not ChipSelect (Radix
              DropdownMenu, modal by default) — a modal trigger closing in the
              same tick that opens the Calendar popover below traps it behind
              the modal's focus lock, so "Custom range" silently did nothing. */}
          <ChipCombobox
            options={TIME_RANGE_OPTIONS}
            value={timeRange}
            onChange={handleTimeRangeChange}
            placeholder='All time'
            overlayContent={
              <span className='truncate text-[var(--text-primary)]'>{timeDisplayLabel}</span>
            }
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

      <ActivityLog
        entries={allEntries.map(toActivityEntry)}
        emptyState={
          isLoading ? undefined : debouncedSearch ? (
            <SettingsEmptyState variant='inline'>
              No results for "{debouncedSearch}"
            </SettingsEmptyState>
          ) : (
            <SettingsEmptyState>No audit logs found</SettingsEmptyState>
          )
        }
        footer={
          hasNextPage ? (
            <div className='flex justify-center py-4'>
              <Button variant='ghost' onClick={handleLoadMore} disabled={isFetchingNextPage}>
                {isFetchingNextPage ? 'Loading...' : 'Load more'}
              </Button>
            </div>
          ) : undefined
        }
      />
    </SettingsPanel>
  )
}
