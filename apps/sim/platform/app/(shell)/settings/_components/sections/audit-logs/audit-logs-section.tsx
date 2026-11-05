'use client'

import { useId, useState } from 'react'
import { toast } from '@sim/emcn'
import {
  ActionRow,
  LoadingState,
  Muted,
  Preformatted,
  RowStack,
  SectionStack,
  SectionToolbar,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import type { SettingsSectionProps } from '@/platform/app/(shell)/settings/_components/section-registry'
import {
  Button,
  DateRangePicker,
  Disclosure,
  EmptyState,
  FailureNotice,
  MultiSelect,
  PropertyList,
  SearchField,
  Select,
  StatusTag,
} from '@/platform/design-system/components'
import { LoadMoreFooter } from '@/platform/design-system/components/scroll-area/load-more-footer'
import {
  SettingsRow,
  SettingsSection,
} from '@/platform/design-system/components/settings-section/settings-section'
import {
  AUDIT_TIME_RANGE_OPTIONS,
  canExportAuditLogs,
  describeMetadataValue,
  formatAuditAction,
  formatMetadataLabel,
  formatResourceType,
  getAuditMetadataEntries,
  isDestructiveAuditAction,
  RESOURCE_TYPE_OPTIONS,
  useAuditLogFeed,
} from '@/platform/lib/data/audit-logs'
import { formatTimestamp } from '@/platform/lib/time'

type AuditEntry = ReturnType<typeof useAuditLogFeed>['entries'][number]

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
            label={formatAuditAction(entry.action)}
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
      <SectionToolbar
        grow={
          <SearchField
            label='Search audit logs'
            placeholder='Search audit logs...'
            value={feed.search}
            onValueChange={feed.setSearch}
          />
        }
      />
      <SettingsSection title='Filters'>
        <SettingsRow label='Resource type' field>
          <MultiSelect
            label='Type'
            labelHidden
            options={RESOURCE_TYPE_OPTIONS}
            value={feed.types}
            onValueChange={feed.setTypes}
            placeholder='All types'
            searchLabel='Search types'
          />
        </SettingsRow>
        <SettingsRow label='Time range' field>
          <Select
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
        </SettingsRow>
        {showCustomRange && (
          <SettingsRow label='Custom time range' field>
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
          </SettingsRow>
        )}
        {scope.chipLabel && (
          <SettingsRow label='Workspace'>
            <Button
              variant='secondary'
              size='compact'
              onClick={feed.clearWorkspaceScope}
              trailingIcon='I105'
            >
              {scope.chipLabel}
            </Button>
          </SettingsRow>
        )}
      </SettingsSection>

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
            <RowStack>
              {feed.entries.map((entry) => (
                <AuditEntryRow key={entry.id} entry={entry} />
              ))}
            </RowStack>
            <LoadMoreFooter
              state={{
                hasMore: feed.hasNextPage,
                loading: feed.isFetchingNextPage,
                error: feed.nextPageError,
                onLoadMore: feed.fetchNextPage,
              }}
            />
          </>
        ) : feed.isLoading ? (
          <LoadingState label='Loading audit logs…' />
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
