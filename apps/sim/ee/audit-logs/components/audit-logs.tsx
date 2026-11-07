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
  OverflowText,
  Popover,
  PopoverAnchor,
  PopoverContent,
  toast,
} from '@sim/emcn-legacy'
import { Download, RefreshCw, Search, X } from '@sim/emcn-legacy/icons'
import { createLogger } from '@sim/logger'
import { formatDateTime } from '@sim/utils/formatting'
import { useQueryStates } from 'nuqs'
import { downloadCsvExport } from '@/lib/core/utils/csv-download'
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
import { useOrganizationWorkspaces } from '@/ee/access-control/hooks/permission-groups'
import { RESOURCE_TYPE_OPTIONS } from '@/ee/audit-logs/constants'
import { type AuditLogFilters, useAuditLogs } from '@/ee/audit-logs/hooks/audit-logs'
import {
  AUDIT_TIME_RANGE_OPTIONS,
  auditLogExportUrl,
  describeMetadataValue,
  formatAuditAction,
  formatMetadataLabel,
  formatResourceType,
  getAuditMetadataEntries,
  isDestructiveAuditAction,
} from '@/ee/audit-logs/lib/format'
import {
  auditRefreshReads,
  canExportAuditLogs,
  presentableAuditEntries,
  resolveAuditTimeRange,
  resolveAuditWorkspaceScope,
} from '@/ee/audit-logs/lib/scope'
import {
  auditLogFilterParsers,
  auditLogFilterUrlKeys,
  DEFAULT_AUDIT_TIME_RANGE,
} from '@/ee/audit-logs/search-params'
import { useDebounce } from '@/hooks/use-debounce'
import { useSettingsSearch } from '@/hooks/use-settings-search'
import type { TimeRange } from '@/stores/logs/filters/types'

const logger = createLogger('AuditLogs')

const REFRESH_SPINNER_DURATION_MS = 1000

function renderMetadataValue(value: unknown) {
  const described = describeMetadataValue(value)
  if (described.kind === 'empty') {
    return <span className='text-[var(--text-muted)]'>{described.text}</span>
  }
  if (described.kind === 'text') {
    return <span className='text-[var(--text-primary)]'>{described.text}</span>
  }
  return (
    <pre className='min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all text-[var(--text-secondary)] text-xs'>
      {described.text}
    </pre>
  )
}

interface ActionBadgeProps {
  action: string
}

function ActionBadge({ action }: ActionBadgeProps) {
  const variant = isDestructiveAuditAction(action) ? 'red' : 'gray-secondary'
  return (
    <Badge variant={variant} size='sm' className='shrink-0'>
      {formatAuditAction(action)}
    </Badge>
  )
}

/** The expanded detail box content for one audit entry (resource, actor, metadata). */
function auditLogDetails(entry: EnterpriseAuditLogEntry): ReactNode {
  const metadataEntries = getAuditMetadataEntries(entry.metadata)
  return (
    <>
      <div className='flex gap-2'>
        <span className='w-[100px] shrink-0 text-[var(--text-muted)]'>Resource</span>
        <span className='text-[var(--text-primary)]'>
          {formatResourceType(entry.resourceType)}
          {entry.resourceId && (
            <span className='ml-1 text-[var(--text-muted)]'>({entry.resourceId})</span>
          )}
        </span>
      </div>
      {entry.resourceName && (
        <div className='flex gap-2'>
          <span className='w-[100px] shrink-0 text-[var(--text-muted)]'>Name</span>
          <span className='text-[var(--text-primary)]'>{entry.resourceName}</span>
        </div>
      )}
      <div className='flex gap-2'>
        <span className='w-[100px] shrink-0 text-[var(--text-muted)]'>Actor</span>
        <span className='text-[var(--text-primary)]'>
          {entry.actorName || 'Unknown'}
          {entry.actorEmail && (
            <span className='ml-1 text-[var(--text-muted)]'>({entry.actorEmail})</span>
          )}
        </span>
      </div>
      {entry.description && (
        <div className='flex gap-2'>
          <span className='w-[100px] shrink-0 text-[var(--text-muted)]'>Description</span>
          <span className='text-[var(--text-primary)]'>{entry.description}</span>
        </div>
      )}
      {metadataEntries.map(([key, value]) => (
        <div key={key} className='flex gap-2'>
          <span className='w-[100px] shrink-0 text-[var(--text-muted)]'>
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
  const {
    timeRange,
    customStart: customStartDate,
    customEnd: customEndDate,
  } = resolveAuditTimeRange(urlFilters, DEFAULT_AUDIT_TIME_RANGE)
  /**
   * Resolved, not merely present. Only the id lives in the URL, and the filter is
   * applied once it matches a workspace the organization actually owns — a stale id
   * from an old link would otherwise be shown under a chip labelled with a bare uuid.
   */
  const workspaceScope = urlFilters.workspace
  const orgWorkspaces = useOrganizationWorkspaces(organizationId, Boolean(workspaceScope))
  const scope = resolveAuditWorkspaceScope(workspaceScope, orgWorkspaces)
  const scopedWorkspace = scope.workspace

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

  const isWorkspaceScopePending = scope.isPending
  const isWorkspaceScopeUnavailable = scope.isUnavailable
  const isWorkspaceScopeUnresolved = scope.isUnresolved
  const isScopeAnswerable = scope.isAnswerable
  const {
    data,
    isLoading,
    isPlaceholderData,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    refetch,
  } = useAuditLogs(organizationId, filters, scope.feedEnabled)

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
    const pending: Promise<unknown>[] = []
    const reads = auditRefreshReads(scope, workspaceScope)
    if (reads.feed) pending.push(refetch())
    if (reads.workspaces) pending.push(orgWorkspaces.refetch())
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
      const result = await downloadCsvExport(
        auditLogExportUrl(organizationId, filters),
        `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`
      )
      if (!result.ok) {
        toast.error('Failed to export audit logs')
        return
      }
      if (result.truncated) {
        toast.info('Export truncated — narrow the date range to see everything')
      }
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
          disabled: !canExportAuditLogs({
            isScopeAnswerable,
            entryCount: allEntries.length,
            isExporting,
            isPlaceholderData,
          }),
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
            <OverflowText label={scope.chipLabel ?? ''} className='block min-w-0' />
          </Chip>
        )}
        <div className='relative'>
          {/* ChipCombobox (Radix Popover, non-modal), not ChipSelect (Radix
              DropdownMenu, modal by default) — a modal trigger closing in the
              same tick that opens the Calendar popover below traps it behind
              the modal's focus lock, so "Custom range" silently did nothing. */}
          <ChipCombobox
            options={AUDIT_TIME_RANGE_OPTIONS}
            value={timeRange}
            onChange={handleTimeRangeChange}
            placeholder='All time'
            overlayLabel={timeDisplayLabel}
            overlayContent={timeDisplayLabel}
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
            <SettingsEmptyState>
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
