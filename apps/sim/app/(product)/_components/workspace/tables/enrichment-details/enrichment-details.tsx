'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@sim/emcn/icon'
import { OverflowText } from '@sim/emcn/overflow-text'
import { PropertyList } from '@sim/emcn/property-list'
import { FailureNotice, InlineNotice } from '@sim/emcn/status'
import { ContentTabs } from '@sim/emcn/tabs/content-tabs'
import { formatDuration } from '@sim/utils/formatting'
import styles from '@/app/(product)/_components/workspace/tables/enrichment-details/enrichment-details.module.css'
import {
  SidePanel,
  SidePanelNote,
} from '@/app/(product)/_components/workspace/tables/side-panel/side-panel'
import { useViewerTimeZone } from '@/app/(product)/_components/workspace/workspace-session/workspace-session'
import {
  type EnrichmentProviderOutcome,
  type EnrichmentRunDetail,
  formatCreditCost,
  useEnrichmentDetail,
} from '@/platform/lib/data/tables'
import { formatTimestamp } from '@/platform/shared/time'

type ResultStatus = 'matched' | 'no_match' | 'error' | 'not_run' | 'cancelled'

const RESULT_STATUS_LABEL: Record<ResultStatus, string> = {
  matched: 'Matched',
  no_match: 'No match',
  error: 'Error',
  not_run: 'Not run',
  cancelled: 'Cancelled',
}

const PROVIDER_STATUS_LABEL: Record<EnrichmentProviderOutcome['status'], string> = {
  matched: 'Matched',
  no_match: 'No match',
  skipped: 'Skipped',
  error: 'Error',
  not_run: 'Not run',
}

/** The narrowest bar, so a sub-millisecond provider still shows on the timeline. */
const MIN_BAR_PCT = 0.5

interface CascadeRow {
  outcome: EnrichmentProviderOutcome
  offsetPct: number
  widthPct: number
}

/**
 * The sequential provider attempts on one timeline, as the trace waterfall reads: each bar starts
 * after the attempts before it and spans its own duration. A skipped provider (0ms) has no bar.
 */
function buildCascadeRows(providers: EnrichmentProviderOutcome[]): CascadeRow[] {
  const total = Math.max(
    1,
    providers.reduce((sum, provider) => sum + provider.durationMs, 0)
  )
  let cursor = 0
  return providers.map((outcome) => {
    const offsetMs = cursor
    cursor += outcome.durationMs
    const offsetPct = Math.min(100 - MIN_BAR_PCT, (offsetMs / total) * 100)
    const rawWidth = (outcome.durationMs / total) * 100
    const widthPct =
      outcome.durationMs > 0 ? Math.max(MIN_BAR_PCT, Math.min(100 - offsetPct, rawWidth)) : 0
    return { outcome, offsetPct, widthPct }
  })
}

/** A provider that executed its tool, not one skipped or never reached. */
function didRun(provider: EnrichmentProviderOutcome): boolean {
  return provider.status !== 'skipped' && provider.status !== 'not_run'
}

/**
 * The cell's outcome, as the executor decides it: a cancelled run is cancelled however far it got;
 * otherwise an error only when every provider that ran failed, not run when none ran (missing
 * inputs), and otherwise no match.
 */
function deriveResultStatus(detail: EnrichmentRunDetail): ResultStatus {
  if (detail.aborted) return 'cancelled'
  if (detail.matchedProvider) return 'matched'
  const ran = detail.providers.filter(didRun)
  if (ran.length === 0) return 'not_run'
  if (ran.every((provider) => provider.status === 'error')) return 'error'
  return 'no_match'
}

function durationLabel(ms: number): string {
  return formatDuration(ms, { precision: 2 }) || '—'
}

function costLabel(dollars: number): string {
  return formatCreditCost(dollars) ?? '—'
}

interface ResultTabProps {
  detail: EnrichmentRunDetail
  groupName?: string
}

function ResultTab({ detail, groupName }: ResultTabProps) {
  const timeZone = useViewerTimeZone()
  const completedAt = Date.parse(detail.completedAt)
  const matchedLabel = detail.matchedProvider
    ? (detail.providers.find((provider) => provider.id === detail.matchedProvider)?.label ??
      detail.matchedProvider)
    : '—'
  const lastError = [...detail.providers]
    .reverse()
    .find((provider) => provider.status === 'error')?.error
  return (
    <div className={styles.tab}>
      <PropertyList
        title='Result'
        titleHidden
        properties={[
          {
            id: 'timestamp',
            label: 'Timestamp',
            kind: 'text',
            value: Number.isFinite(completedAt) ? formatTimestamp(completedAt, timeZone) : '—',
          },
          { id: 'enrichment', label: 'Enrichment', kind: 'text', value: groupName || 'Enrichment' },
          {
            id: 'status',
            label: 'Status',
            kind: 'text',
            value: RESULT_STATUS_LABEL[deriveResultStatus(detail)],
          },
          {
            id: 'duration',
            label: 'Duration',
            kind: 'text',
            value: durationLabel(detail.durationMs),
          },
          { id: 'cost', label: 'Total cost', kind: 'text', value: costLabel(detail.totalCost) },
          { id: 'matched', label: 'Matched provider', kind: 'text', value: matchedLabel },
          {
            id: 'ran',
            label: 'Providers ran',
            kind: 'text',
            value: String(detail.providers.filter(didRun).length),
          },
        ]}
      />
      {lastError && <InlineNotice intent='danger' title='Error' message={lastError} />}
    </div>
  )
}

function CascadeTab({ detail }: { detail: EnrichmentRunDetail }) {
  const status = deriveResultStatus(detail)
  const ranCount = detail.providers.filter(didRun).length
  return (
    <div className={styles.tab}>
      <p className={styles.summary} data-type='T052'>
        <span className={styles.summaryStatus} data-status={status}>
          {RESULT_STATUS_LABEL[status]}
        </span>
        <span>{durationLabel(detail.durationMs)}</span>
        <span>
          {ranCount} {ranCount === 1 ? 'provider' : 'providers'}
        </span>
        {detail.totalCost > 0 && <span>{costLabel(detail.totalCost)}</span>}
      </p>
      <ol className={styles.cascade} aria-label='Provider cascade'>
        {buildCascadeRows(detail.providers).map(({ outcome, offsetPct, widthPct }) => {
          const ran = didRun(outcome)
          return (
            <li
              key={outcome.id}
              className={styles.provider}
              data-matched={outcome.status === 'matched' || undefined}
              data-ran={ran || undefined}
            >
              <span className={styles.providerLine}>
                <span className={styles.providerMark} aria-hidden='true'>
                  <Icon providerId={outcome.id} />
                </span>
                <span className={styles.providerName} data-type='T060'>
                  <OverflowText text={outcome.label}>{outcome.label}</OverflowText>
                </span>
                <span className={styles.providerMeta} data-type='T052'>
                  <span>{PROVIDER_STATUS_LABEL[outcome.status]}</span>
                  {outcome.cost > 0 && <span>{costLabel(outcome.cost)}</span>}
                  {ran && <span>{durationLabel(outcome.durationMs)}</span>}
                </span>
              </span>
              <svg
                className={styles.timeline}
                role='img'
                aria-label={`${outcome.label}: ${durationLabel(outcome.durationMs)}`}
              >
                <line className={styles.track} x1='0' x2='100%' y1='50%' y2='50%' />
                {widthPct > 0 && (
                  <rect
                    className={styles.bar}
                    x={`${offsetPct}%`}
                    y='0'
                    width={`${widthPct}%`}
                    height='100%'
                    rx='2'
                  />
                )}
              </svg>
              {outcome.error && (
                <span className={styles.providerError} data-type='T052'>
                  {outcome.error}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

interface EnrichmentDetailsContentProps {
  tableId: string
  rowId: string
  groupId: string
  groupName?: string
}

function EnrichmentDetailsContent({
  tableId,
  rowId,
  groupId,
  groupName,
}: EnrichmentDetailsContentProps) {
  const [tab, setTab] = useState('result')
  const query = useEnrichmentDetail(tableId, rowId, groupId)
  if (query.isPending) return null
  if (query.isError)
    return (
      <FailureNotice
        message='The enrichment details could not be loaded.'
        retrying={query.isFetching}
        onRetry={() => void query.refetch()}
      />
    )
  const detail = query.data
  if (!detail) return <SidePanelNote>No enrichment details for this run</SidePanelNote>
  return (
    <ContentTabs
      label='Enrichment details'
      current={tab}
      onSelect={setTab}
      items={[
        {
          id: 'result',
          label: 'Result',
          content: <ResultTab detail={detail} groupName={groupName} />,
        },
        { id: 'cascade', label: 'Cascade', content: <CascadeTab detail={detail} /> },
      ]}
    />
  )
}

interface EnrichmentDetailsPanelProps {
  tableId: string
  rowId: string
  groupId: string
  groupName?: string
  onClose: () => void
}

/**
 * An enrichment cell's run: the Result (status, duration, cost, matched provider) and the Cascade,
 * every provider attempt on one timeline. Escape closes it.
 */
export function EnrichmentDetailsPanel({
  tableId,
  rowId,
  groupId,
  groupName,
  onClose,
}: EnrichmentDetailsPanelProps) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <SidePanel title='Enrichment details' onClose={onClose}>
      <EnrichmentDetailsContent
        key={`${rowId}:${groupId}`}
        tableId={tableId}
        rowId={rowId}
        groupId={groupId}
        groupName={groupName}
      />
    </SidePanel>
  )
}
