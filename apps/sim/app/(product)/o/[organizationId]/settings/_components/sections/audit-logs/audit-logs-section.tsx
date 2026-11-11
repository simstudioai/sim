'use client'

import { Fragment, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { Disclosure } from '@sim/emcn/disclosure'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { DateRangePicker } from '@sim/emcn/picker/date-picker'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { PropertyList } from '@sim/emcn/property-list'
import { LoadMoreFooter } from '@sim/emcn/scroll-area/load-more-footer'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice, StatusTag } from '@sim/emcn/status'
import { toast } from '@/lib/toast/sink'
import { SettingsList } from '@/app/(product)/_components/settings-parts/settings-list'
import { SettingsPageHeader } from '@/app/(product)/_components/settings-parts/settings-page'
import {
  ActionRow,
  Muted,
  Preformatted,
  RowStack,
  SectionStack,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import {
  useVirtualRows,
  VirtualSpacer,
} from '@/app/(product)/_components/workspace/resource-table/virtual-rows'
import type { SettingsSectionProps } from '@/app/(product)/o/[organizationId]/settings/_components/section-registry'
import styles from '@/app/(product)/o/[organizationId]/settings/_components/sections/audit-logs/audit-logs-section.module.css'
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
import { formatTimestamp } from '@/platform/shared/time'

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

/** The title is the event; a destructive one keeps a danger tag, the only thing its words can't say. */
function AuditEntryRow({ entry }: { entry: AuditEntry }) {
  const byline = (
    <Muted>
      {entry.actorEmail || entry.actorName || 'System'} ·{' '}
      {formatTimestamp(new Date(entry.createdAt).getTime())}
    </Muted>
  )
  return (
    <Disclosure
      variant='activity'
      label={entry.description || formatAuditAction(entry.action)}
      introduction={
        isDestructiveAuditAction(entry.action) ? (
          <ActionRow>
            <StatusTag label='Destructive' intent='danger' />
            {byline}
          </ActionRow>
        ) : (
          byline
        )
      }
    >
      <AuditEntryDetails entry={entry} />
    </Disclosure>
  )
}

interface AuditEntryListProps {
  entries: AuditEntry[]
}

/** Only the rows near the viewport mount, so a long feed stays light however many pages loaded. */
function AuditEntryList({ entries }: AuditEntryListProps) {
  const { listRef, virtualizer, entries: rows, spaceAfter } = useVirtualRows(entries)
  return (
    <ol ref={listRef} className={styles.rows} aria-label='Audit events'>
      {rows.map(({ key, index, row, spaceBefore }) => (
        <Fragment key={key}>
          <VirtualSpacer blockSize={spaceBefore} />
          <li ref={virtualizer.measureElement} data-index={index}>
            <AuditEntryRow entry={row} />
          </li>
        </Fragment>
      ))}
      <VirtualSpacer blockSize={spaceAfter} />
    </ol>
  )
}

export default function AuditLogsSection({ organization }: SettingsSectionProps) {
  const feed = useAuditLogFeed(organization.organization.id)
  /** Custom range was chosen: its picker shows, and stays until a preset replaces it. */
  const [choosingRange, setChoosingRange] = useState(false)
  const [rangeOpen, setRangeOpen] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [exporting, setExporting] = useState(false)
  const { scope } = feed

  async function retry() {
    setRetrying(true)
    try {
      await feed.refresh()
    } finally {
      setRetrying(false)
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

  const customRange = choosingRange || feed.timeRange === 'Custom range'
  const searchable = feed.entries.length > 0 || feed.search !== ''

  return (
    <SectionStack>
      <SettingsPageHeader />
      <SectionToolbar
        grow={
          searchable && (
            <SearchField
              label='Search audit logs'
              placeholder='Search audit logs…'
              value={feed.search}
              onValueChange={feed.setSearch}
            />
          )
        }
      >
        <MultiSelect
          variant='text'
          label='Type'
          options={RESOURCE_TYPE_OPTIONS}
          value={feed.types}
          onValueChange={feed.setTypes}
          placeholder='All types'
          searchLabel='Search types'
        />
        <ChoiceMenu
          label='Time range'
          options={AUDIT_TIME_RANGE_OPTIONS}
          value={choosingRange ? 'Custom range' : feed.timeRange}
          onValueChange={(value) => {
            const custom = value === 'Custom range'
            setChoosingRange(custom)
            setRangeOpen(custom)
            if (!custom) feed.selectPreset(value as Parameters<typeof feed.selectPreset>[0])
          }}
        />
        {customRange && (
          <DateRangePicker
            label='Custom time range'
            labelHidden
            withTime
            open={rangeOpen}
            onOpenChange={setRangeOpen}
            value={feed.customRange}
            onValueChange={(range) => {
              if (!range) return
              setChoosingRange(false)
              feed.applyCustomRange(range.start, range.end)
            }}
          />
        )}
        {scope.chipLabel && (
          <Button
            variant='quiet'
            size='compact'
            onClick={feed.clearWorkspaceScope}
            trailingIcon='I105'
          >
            {scope.chipLabel}
          </Button>
        )}
        <Button
          variant='quiet'
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
      </SectionToolbar>
      {feed.entries.length > 0 ? (
        <SettingsSection title='Audit events'>
          <AuditEntryList entries={feed.entries} />
          <LoadMoreFooter
            state={{
              hasMore: feed.hasNextPage,
              loading: feed.isFetchingNextPage,
              error: feed.nextPageError,
              onLoadMore: feed.fetchNextPage,
            }}
          />
        </SettingsSection>
      ) : feed.isLoading ? null : scope.isUnavailable ? (
        <FailureNotice
          message='Couldn’t check that workspace'
          retrying={retrying}
          onRetry={() => void retry()}
        />
      ) : feed.isError ? (
        <FailureNotice
          message={feed.errorMessage ?? 'Failed to load audit logs'}
          retrying={retrying}
          onRetry={() => void retry()}
        />
      ) : (
        <SettingsList
          title='Audit events'
          empty={{
            title: scope.isUnresolved
              ? 'That workspace is not part of this organization'
              : feed.debouncedSearch
                ? 'No matching audit logs'
                : 'No audit logs',
          }}
        />
      )}
    </SectionStack>
  )
}
