'use client'

import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import {
  Badge,
  Button,
  Calendar,
  Chip,
  ChipCombobox,
  ChipInput,
  ChipSelect,
  type ComboboxOption,
  OverflowText,
  Popover,
  PopoverAnchor,
  PopoverContent,
  toast,
} from '@sim/emcn'
import { Download, RefreshCw, Search, X } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { formatDateTime } from '@sim/utils/formatting'
import { isRecordLike } from '@sim/utils/object'
import { useQueryStates } from 'nuqs'
import type { AuditLogPage } from '@/lib/api/contracts/audit-logs'
import { formatDateShort } from '@/lib/core/utils/date-display'
import { getEndDateFromTimeRange, getStartDateFromTimeRange } from '@/lib/logs/filters'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import type { EnterpriseAuditLogEntry } from '@/app/api/v1/audit-logs/format'
import {
  ActivityLog,
  type ActivityLogEntry,
} from '@/app/workspace/[workspaceId]/settings/components/activity-log'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { useSettingsSearch } from '@/app/workspace/[workspaceId]/settings/components/use-settings-search'
import { useOrganizationWorkspaces } from '@/ee/access-control/hooks/permission-groups'
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

/** Already rendered as their own labelled rows, so the metadata block would repeat them. */
const HIDDEN_METADATA_KEYS = new Set(['name', 'description'])

function getMetadataEntries(metadata: unknown) {
  if (!isRecordLike(metadata)) return []

  return Object.entries(metadata).filter(([key, value]) => {
    if (value === undefined) return false
    return !HIDDEN_METADATA_KEYS.has(key)
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

/**
 * Entries the feed is allowed to present.
 *
 * A disabled query still serves whatever is cached under its key, and an unresolved
 * workspace scope resolves to the same key as the unscoped feed — so an admin looking
 * at the organization-wide feed who then followed a stale scoped link kept those rows
 * on screen, with Export still armed against them. The scope a link asks for is a
 * ceiling, so when it cannot be honoured the feed presents nothing rather than
 * whatever it happens to be holding.
 */
export function presentableAuditEntries(
  pages: AuditLogPage[] | undefined,
  isScopeAnswerable: boolean
): EnterpriseAuditLogEntry[] {
  if (!isScopeAnswerable || !pages) return []
  return pages.flatMap((page) => page.data)
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
  /**
   * Resolved, not merely present. Only the id lives in the URL, and the filter is
   * applied once it matches a workspace the organization actually owns — a stale id
   * from an old link would otherwise be shown under a chip labelled with a bare uuid.
   */
  const workspaceScope = urlFilters.workspace
  const orgWorkspaces = useOrganizationWorkspaces(organizationId, Boolean(workspaceScope))
  const scopedWorkspace = workspaceScope
    ? orgWorkspaces.data?.find((entry) => entry.id === workspaceScope)
    : undefined

  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const dateRangeAppliedRef = useRef(false)
  const [searchTerm, setSearchTerm] = useSettingsSearch()
  const debouncedSearch = useDebounce(searchTerm, SEARCH_DEBOUNCE_MS).trim()
  const [isVisuallyRefreshing, setIsVisuallyRefreshing] = useState(false)
  const refreshTimersRef = useRef<Set<number> | null>(null)
  refreshTimersRef.current ??= new Set<number>()
  const refreshTimers = refreshTimersRef.current
  const [isExporting, setIsExporting] = useState(false)

  useEffect(() => {
    return () => {
      for (const timerId of refreshTimers) window.clearTimeout(timerId)
    }
  }, [refreshTimers])

  /*
    Not memoized: this object is only ever hashed, never compared by identity — React
    Query hashes a query key structurally, and the export handler reads its fields
    directly. The same rule `useUsageWindow` applies to its window object.
  */
  const filters: AuditLogFilters = {
    search: debouncedSearch || undefined,
    resourceType: selectedTypes.length > 0 ? selectedTypes.join(',') : undefined,
    workspaceId: scopedWorkspace?.id,
    startDate: getStartDateFromTimeRange(timeRange, customStartDate)?.toISOString(),
    endDate: getEndDateFromTimeRange(timeRange, customEndDate)?.toISOString(),
  }

  /**
   * A deep-linked workspace scope is only resolvable once the organization's workspace
   * list has loaded. Querying before then fetches the whole organization's feed and
   * immediately refetches it narrowed — two requests, with a flash of rows the link
   * did not ask for in between.
   */
  const isWorkspaceScopePending = Boolean(workspaceScope) && orgWorkspaces.isPending

  /**
   * The lookup itself failed, so whether the workspace exists is simply unknown.
   *
   * Kept apart from {@link isWorkspaceScopeUnresolved}: telling an admin their
   * workspace is not part of the organization because a request timed out is a wrong
   * answer, not a cautious one, and it offers nothing to do about it. Refresh retries
   * this lookup alongside the feed.
   */
  const isWorkspaceScopeUnavailable = Boolean(workspaceScope) && orgWorkspaces.isError

  /**
   * The link named a workspace this organization does not have — deleted since, or
   * never one of ours.
   *
   * The feed stays closed rather than falling back to the organization. Every other
   * deep-linked id in the app degrades to the unfiltered view, but an audit feed is
   * the one place where widening is the dangerous direction: dropping the filter
   * would answer a request for one workspace's history with everybody's, under a URL
   * that still claims to be scoped, and the CSV export would follow.
   */
  const isWorkspaceScopeUnresolved =
    Boolean(workspaceScope) &&
    !isWorkspaceScopePending &&
    !isWorkspaceScopeUnavailable &&
    !scopedWorkspace

  /** The feed can answer the scope the URL asks for — the gate on reading or exporting. */
  const isScopeAnswerable =
    !isWorkspaceScopePending && !isWorkspaceScopeUnresolved && !isWorkspaceScopeUnavailable
  const {
    data,
    isLoading,
    isPlaceholderData,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useAuditLogs(organizationId, filters, !isWorkspaceScopePending && !isWorkspaceScopeUnresolved)

  const allEntries = useMemo(
    () => presentableAuditEntries(data?.pages, isScopeAnswerable),
    [data, isScopeAnswerable]
  )

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

  const handleRefresh = () => {
    setIsVisuallyRefreshing(true)
    const timerId = window.setTimeout(() => {
      setIsVisuallyRefreshing(false)
      refreshTimers.delete(timerId)
    }, REFRESH_SPINNER_DURATION_MS)
    refreshTimers.add(timerId)
    /*
      The workspace lookup too, but only when a scope asked for it: a failed lookup
      closes the feed, so refreshing only the feed would leave the one control on
      screen unable to clear the state it is showing. `refetch` ignores `enabled`, so
      an unconditional call would fire a request the unscoped feed has no use for and
      could fail a refresh that otherwise succeeded.
    */
    const pending = workspaceScope ? [refetch(), orgWorkspaces.refetch()] : [refetch()]
    Promise.all(pending).catch((error: unknown) => {
      logger.error('Failed to refresh audit logs', { error })
    })
  }

  const handleLoadMore = () => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage().catch((error: unknown) => {
        logger.error('Failed to load more audit logs', { error })
      })
    }
  }

  const handleExportCsv = async () => {
    setIsExporting(true)
    try {
      const params = new URLSearchParams()
      params.set('organizationId', organizationId)
      if (filters.search) params.set('search', filters.search)
      if (filters.resourceType) params.set('resourceType', filters.resourceType)
      if (filters.workspaceId) params.set('workspaceId', filters.workspaceId)
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
          /*
            `isScopeAnswerable` explicitly, not just via the empty `allEntries` it
            implies: the export is the action that leaves the building, so the
            condition that makes it safe belongs where it is read.
          */
          disabled:
            !isScopeAnswerable || allEntries.length === 0 || isExporting || isPlaceholderData,
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
        {workspaceScope && (
          /*
            A deep-linked scope, not a picker: the organization can hold hundreds of
            workspaces, so this narrows the feed only when a link asks it to and
            offers exactly one action — take it back off. Trailing `X` and a bounded
            width, matching the app's other removable filter chips; the label names
            the dimension because a bare workspace name gives no clue what it scopes.
          */
          <Chip
            rightIcon={X}
            onClick={() => void setUrlFilters({ workspace: null })}
            aria-label='Clear the workspace filter'
            className='max-w-[280px] shrink-0'
          >
            {/* Rendered for an unresolved scope too, or a bad link would leave the
                feed closed with no control to reopen it. */}
            <OverflowText
              label={`Workspace: ${scopedWorkspace?.name ?? (isWorkspaceScopeUnavailable ? 'unavailable' : 'not found')}`}
              className='block min-w-0'
            />
          </Chip>
        )}
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
            overlayLabel={timeDisplayLabel}
            overlayContent={
              <OverflowText
                label={timeDisplayLabel}
                className='block w-full text-[var(--text-primary)]'
                tooltipEnabled={false}
              />
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
        <Button
          variant='ghost'
          onClick={handleRefresh}
          disabled={isVisuallyRefreshing}
          aria-label='Refresh audit logs'
        >
          <RefreshCw animate={isVisuallyRefreshing} className='size-[14px]' />
        </Button>
      </div>

      <ActivityLog
        entries={allEntries.map(toActivityEntry)}
        emptyState={
          isLoading || isWorkspaceScopePending ? undefined : isWorkspaceScopeUnavailable ? (
            <SettingsEmptyState tone='error'>
              Couldn't check that workspace. Refresh to try again.
            </SettingsEmptyState>
          ) : isWorkspaceScopeUnresolved ? (
            <SettingsEmptyState>
              That workspace is not part of this organization.
            </SettingsEmptyState>
          ) : debouncedSearch ? (
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
