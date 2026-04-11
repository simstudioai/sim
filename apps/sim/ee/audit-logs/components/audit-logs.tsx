'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { RefreshCw, Search } from 'lucide-react'
import { Badge, Button, Combobox, type ComboboxOption, Skeleton } from '@/components/emcn'
import { Input } from '@/components/ui'
import { cn } from '@/lib/core/utils/cn'
import { formatDateTime } from '@/lib/core/utils/formatting'
import type { EnterpriseAuditLogEntry } from '@/app/api/v1/audit-logs/format'
import { RESOURCE_TYPE_OPTIONS } from '@/ee/audit-logs/constants'
import { type AuditLogFilters, useAuditLogs } from '@/ee/audit-logs/hooks/audit-logs'

const logger = createLogger('AuditLogs')

const DATE_RANGE_OPTIONS: ComboboxOption[] = [
  { label: 'Last 7 days', value: '7' },
  { label: 'Last 30 days', value: '30' },
  { label: 'Last 90 days', value: '90' },
  { label: 'All time', value: '' },
]

function formatResourceType(type: string): string {
  return type
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function getStartOfDay(daysAgo: number): string {
  const start = new Date()
  start.setDate(start.getDate() - daysAgo)
  start.setHours(0, 0, 0, 0)
  return start.toISOString()
}

function formatAction(action: string): string {
  return action.replace(/[._]/g, ' ')
}

interface ActionBadgeProps {
  action: string
}

function ActionBadge({ action }: ActionBadgeProps) {
  const [, verb] = action.split('.')
  const variant = verb === 'deleted' || verb === 'removed' || verb === 'revoked' ? 'red' : 'default'
  return (
    <Badge variant={variant} size='sm'>
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

  return (
    <div className='border-[var(--border)] border-b last:border-b-0'>
      <button
        type='button'
        className='flex w-full items-center gap-4 px-0 py-2.5 text-left transition-colors hover-hover:bg-[var(--surface-4)]'
        onClick={() => setExpanded(!expanded)}
      >
        <span className='w-[160px] flex-shrink-0 text-[var(--text-secondary)] text-sm'>
          {timestamp}
        </span>
        <span className='w-[180px] flex-shrink-0'>
          <ActionBadge action={entry.action} />
        </span>
        <span className='min-w-0 flex-1 truncate text-[var(--text-primary)] text-sm'>
          {entry.description || entry.resourceName || entry.resourceId || '-'}
        </span>
        <span className='w-[160px] flex-shrink-0 truncate text-right text-[var(--text-secondary)] text-sm'>
          {entry.actorEmail || entry.actorName || 'System'}
        </span>
      </button>
      {expanded && (
        <div className='mb-2 ml-0 flex flex-col gap-1.5 rounded-md bg-[var(--surface-4)] p-3 text-sm'>
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
          {entry.metadata != null &&
          Object.keys(entry.metadata as Record<string, unknown>).length > 0 ? (
            <div className='flex gap-2'>
              <span className='w-[100px] flex-shrink-0 text-[var(--text-muted)]'>Details</span>
              <pre className='min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all text-[var(--text-secondary)] text-xs'>
                {JSON.stringify(entry.metadata, null, 2)}
              </pre>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

export function AuditLogs() {
  const [resourceType, setResourceType] = useState('')
  const [dateRange, setDateRange] = useState('30')
  const [searchTerm, setSearchTerm] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  const filters = useMemo<AuditLogFilters>(() => {
    return {
      search: debouncedSearch || undefined,
      resourceType: resourceType || undefined,
      startDate: dateRange ? getStartOfDay(Number(dateRange)) : undefined,
    }
  }, [debouncedSearch, resourceType, dateRange])

  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, refetch, isRefetching } =
    useAuditLogs(filters)

  const allEntries = useMemo(() => {
    if (!data?.pages) return []
    return data.pages.flatMap((page) => page.data)
  }, [data])

  const handleRefresh = useCallback(() => {
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
    <div className='flex h-full flex-col gap-4.5'>
      <div className='flex items-center gap-2'>
        <div className='flex flex-1 items-center gap-2 rounded-lg border border-[var(--border)] bg-transparent px-2 py-2 transition-colors duration-100 dark:bg-[var(--surface-4)] dark:hover-hover:border-[var(--border-1)] dark:hover-hover:bg-[var(--surface-5)]'>
          <Search
            className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-tertiary)]'
            strokeWidth={2}
          />
          <Input
            placeholder='Search audit logs...'
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className='h-auto flex-1 border-0 bg-transparent p-0 font-base leading-none placeholder:text-[var(--text-tertiary)] focus-visible:ring-0 focus-visible:ring-offset-0'
          />
        </div>
        <div className='w-[160px]'>
          <Combobox
            options={RESOURCE_TYPE_OPTIONS}
            value={resourceType}
            onChange={setResourceType}
            placeholder='Resource type'
            size='md'
          />
        </div>
        <div className='w-[140px]'>
          <Combobox
            options={DATE_RANGE_OPTIONS}
            value={dateRange}
            onChange={setDateRange}
            placeholder='Date range'
            size='md'
          />
        </div>
        <Button variant='ghost' onClick={handleRefresh} disabled={isRefetching}>
          <RefreshCw
            className={cn('h-[14px] w-[14px]', isRefetching && 'animate-spin')}
            strokeWidth={2}
          />
        </Button>
      </div>

      <div className='flex items-center gap-4 border-[var(--border)] border-b pb-2'>
        <span className='w-[160px] flex-shrink-0 font-medium text-[var(--text-muted)] text-xs uppercase tracking-wide'>
          Timestamp
        </span>
        <span className='w-[180px] flex-shrink-0 font-medium text-[var(--text-muted)] text-xs uppercase tracking-wide'>
          Event
        </span>
        <span className='min-w-0 flex-1 font-medium text-[var(--text-muted)] text-xs uppercase tracking-wide'>
          Description
        </span>
        <span className='w-[160px] flex-shrink-0 text-right font-medium text-[var(--text-muted)] text-xs uppercase tracking-wide'>
          Actor
        </span>
      </div>

      <div className='min-h-0 flex-1 overflow-y-auto'>
        {isLoading ? (
          <div className='flex flex-col gap-3'>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className='flex items-center gap-4 py-2.5'>
                <Skeleton className='h-4 w-[140px]' />
                <Skeleton className='h-5 w-[120px] rounded-full' />
                <Skeleton className='h-4 flex-1' />
                <Skeleton className='h-4 w-[140px]' />
              </div>
            ))}
          </div>
        ) : allEntries.length === 0 ? (
          <div className='flex h-full items-center justify-center py-12 text-[var(--text-muted)] text-sm'>
            {debouncedSearch ? `No results for "${debouncedSearch}"` : 'No audit logs found'}
          </div>
        ) : (
          <div className='flex flex-col'>
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
    </div>
  )
}
