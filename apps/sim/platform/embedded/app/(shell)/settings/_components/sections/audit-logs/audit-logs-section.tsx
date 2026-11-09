'use client'

import { useId, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { Disclosure } from '@sim/emcn/disclosure'
import { EmptyState } from '@sim/emcn/empty-state'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { DateRangePicker } from '@sim/emcn/picker/date-picker'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { PropertyList } from '@sim/emcn/property-list'
import { LoadMoreFooter } from '@sim/emcn/scroll-area/load-more-footer'
import { SectionSearch } from '@sim/emcn/search-field/section-search'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice, StatusTag } from '@sim/emcn/status'
import { LoadingRows } from '@sim/emcn/status/query-boundary'
import { toast } from '@/lib/toast/sink'
import { RESOURCE_TYPE_OPTIONS } from '@/ee/audit-logs/constants'
import {
  AUDIT_TIME_RANGE_OPTIONS,
  describeMetadataValue,
  formatAuditAction,
  formatMetadataLabel,
  formatResourceType,
  getAuditMetadataEntries,
  isDestructiveAuditAction,
} from '@/ee/audit-logs/lib/format'
import { canExportAuditLogs } from '@/ee/audit-logs/lib/scope'
import {
  ActionRow,
  Muted,
  Preformatted,
  RowStack,
  SectionStack,
} from '@/platform/embedded/app/(shell)/_components/section-parts/section-parts'
import type { SettingsSectionProps } from '@/platform/embedded/app/(shell)/settings/_components/section-registry'
import styles from '@/platform/embedded/app/(shell)/settings/_components/sections/audit-logs/audit-logs-section.module.css'
import { useAuditLogFeed } from '@/platform/embedded/lib/data/audit-logs/feed'
import { formatTimestamp } from '@/platform/shared/time'

const ALL_TYPES = '__all_types__'

type AuditEntry = ReturnType<typeof useAuditLogFeed>['entries'][number]

/** Sentence-cases the stored action for reading; the stored value and filters stay as they are. */
function auditActionLabel(action: string) {
  const label = formatAuditAction(action)
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function AuditEntryDetails({ entry }: { entry: AuditEntry }) {
  const metadata = getAuditMetadataEntries(entry.metadata).map(
    ([key, value]) => [key, describeMetadataValue(value)] as const
  )
  const resource = entry.resourceId
    ? `${formatResourceType(entry.resourceType)} (${entry.resourceId})`
    : formatResourceType(entry.resourceType)
  const actor = entry.actorEmail
    ? `${entry.actorName || 'Unknown'} (${entry.actorEmail})`
    : entry.actorName || 'Unknown'
  return (
    <>
      <PropertyList
        title='Details'
        properties={[
          { id: 'resource', label: 'Resource', kind: 'text', value: resource },
          ...(entry.resourceName
            ? [{ id: 'name', label: 'Name', kind: 'text' as const, value: entry.resourceName }]
            : []),
          { id: 'actor', label: 'Actor', kind: 'text', value: actor },
          ...(entry.description
            ? [
                {
                  id: 'description',
                  label: 'Description',
                  kind: 'text' as const,
                  value: entry.description,
                },
              ]
            : []),
          ...metadata
            .filter(([, value]) => value.kind !== 'json')
            .map(([key, value]) => ({
              id: `metadata-${key}`,
              label: formatMetadataLabel(key),
              kind: 'text' as const,
              value: value.text,
            })),
        ]}
      />
      {metadata
        .filter(([, value]) => value.kind === 'json')
        .map(([key, value]) => (
          <RowStack key={key}>
            <Muted>{formatMetadataLabel(key)}</Muted>
            <Preformatted>{value.text}</Preformatted>
          </RowStack>
        ))}
    </>
  )
}

function AuditEntryRow({ entry }: { entry: AuditEntry }) {
  return (
    <Disclosure
      variant='activity'
      label={entry.description || entry.resourceName || entry.resourceId || '-'}
      introduction={
        <ActionRow>
          <StatusTag
            label={auditActionLabel(entry.action)}
            intent={isDestructiveAuditAction(entry.action) ? 'danger' : 'neutral'}
          />
          <Muted>
            {entry.actorEmail || entry.actorName || 'System'} ·{' '}
            {formatTimestamp(new Date(entry.createdAt).getTime())}
          </Muted>
        </ActionRow>
      }
    >
      <AuditEntryDetails entry={entry} />
    </Disclosure>
  )
}

export default function AuditLogsSection({ organization }: SettingsSectionProps) {
  const feed = useAuditLogFeed(organization.organization.id)
  const [choosingCustomRange, setChoosingCustomRange] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const timeRangeId = useId()
  const { scope } = feed

  async function refresh() {
    setRefreshing(true)
    try {
      await feed.refresh()
    } finally {
      setRefreshing(false)
    }
  }

  async function exportCsv() {
    setExporting(true)
    try {
      const result = await feed.exportCsv()
      if (!result.ok) {
        toast.error('Failed to export audit logs')
        return
      }
      if (result.truncated) {
        toast.info('Export truncated — narrow the date range to see everything')
      }
    } catch {
      toast.error('Failed to export audit logs')
    } finally {
      setExporting(false)
    }
  }

  const showCustomRange = choosingCustomRange || feed.timeRange === 'Custom range'

  return (
    <SectionStack>
      <div className={styles.toolbar}>
        <span className={styles.search}>
          <SectionSearch subject='audit logs' value={feed.search} onValueChange={feed.setSearch} />
        </span>
        <span className={styles.filter}>
          <MultiSelect
            variant='text'
            label='Resource type'
            labelHidden
            options={[{ value: ALL_TYPES, label: 'All types' }, ...RESOURCE_TYPE_OPTIONS]}
            value={feed.types}
            onValueChange={(types) => feed.setTypes(types.includes(ALL_TYPES) ? [] : types)}
            placeholder='All types'
            searchLabel='Search types'
          />
        </span>
        <span className={styles.filter}>
          <ChoiceMenu
            id={timeRangeId}
            label='Time range'
            options={AUDIT_TIME_RANGE_OPTIONS}
            value={choosingCustomRange ? 'Custom range' : feed.timeRange}
            onValueChange={(value) => {
              if (value === 'Custom range') {
                setChoosingCustomRange(true)
                return
              }
              setChoosingCustomRange(false)
              feed.selectPreset(value as Parameters<typeof feed.selectPreset>[0])
            }}
          />
        </span>
        {showCustomRange && (
          <span className={styles.filter}>
            <DateRangePicker
              label='Custom time range'
              labelHidden
              open={choosingCustomRange}
              onOpenChange={(open) => {
                setChoosingCustomRange(open)
                if (!open && !feed.customRange) document.getElementById(timeRangeId)?.focus()
              }}
              withTime
              value={feed.customRange}
              onValueChange={(range) => {
                if (!range) return
                feed.applyCustomRange(range.start, range.end)
              }}
            />
          </span>
        )}
        {scope.chipLabel && (
          <Button
            variant='secondary'
            size='compact'
            onClick={feed.clearWorkspaceScope}
            trailingIcon='I105'
          >
            {scope.chipLabel}
          </Button>
        )}
      </div>

      <SettingsSection title='Audit events'>
        <SettingsRow label='Filtered events'>
          <ActionRow>
            <Button
              variant='quiet'
              size='compact'
              disabled={refreshing}
              onClick={() => void refresh()}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </Button>
            <Button
              size='compact'
              disabled={
                !canExportAuditLogs({
                  isScopeAnswerable: scope.isAnswerable,
                  entryCount: feed.entries.length,
                  isExporting: exporting,
                  isPlaceholderData: feed.isPlaceholderData,
                })
              }
              onClick={() => void exportCsv()}
            >
              {exporting ? 'Exporting…' : 'Export'}
            </Button>
          </ActionRow>
        </SettingsRow>
        {feed.entries.length > 0 ? (
          <>
            <div className={styles.rows}>
              {feed.entries.map((entry) => (
                <AuditEntryRow key={entry.id} entry={entry} />
              ))}
            </div>
            <LoadMoreFooter
              state={{
                hasMore: feed.hasNextPage,
                loading: feed.isFetchingNextPage,
                error: feed.nextPageError,
                onLoadMore: feed.fetchNextPage,
              }}
            />
          </>
        ) : /* The feed has scope states and paging one query's boundary cannot express. */ feed.isLoading ? (
          <LoadingRows label='Loading audit logs…' />
        ) : scope.isUnavailable ? (
          <FailureNotice
            message="Couldn't check that workspace."
            retrying={refreshing}
            onRetry={() => void refresh()}
          />
        ) : scope.isUnresolved ? (
          <EmptyState title='That workspace is not part of this organization.' />
        ) : feed.isError ? (
          <FailureNotice
            message={feed.errorMessage ?? 'Failed to load audit logs'}
            retrying={refreshing}
            onRetry={() => void refresh()}
          />
        ) : feed.debouncedSearch ? (
          <EmptyState title={`No results for "${feed.debouncedSearch}"`} />
        ) : (
          <EmptyState title='No audit logs found' />
        )}
      </SettingsSection>
    </SectionStack>
  )
}
