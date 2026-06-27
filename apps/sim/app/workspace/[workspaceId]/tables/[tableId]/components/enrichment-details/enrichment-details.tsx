'use client'

import { useEffect, useState } from 'react'
import { formatDuration } from '@sim/utils/formatting'
import { Badge, Button, ChipModalTabs, X } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import type { EnrichmentProviderOutcome, EnrichmentRunDetail } from '@/lib/table'
import {
  adjustBgForContrast,
  getBlockIconAndColor,
  iconColorClass,
} from '@/app/workspace/[workspaceId]/logs/components/log-details/utils'
import { useLogDetailsResize } from '@/app/workspace/[workspaceId]/logs/hooks'
import { formatDate } from '@/app/workspace/[workspaceId]/logs/utils'
import { useEnrichmentDetail } from '@/hooks/queries/tables'
import { formatCost } from '@/providers/utils'
import { useLogDetailsUIStore } from '@/stores/logs/store'
import { MAX_LOG_DETAILS_WIDTH_RATIO, MIN_LOG_DETAILS_WIDTH } from '@/stores/logs/utils'
import { useTranslations } from 'next-intl'

type EnrichmentDetailsTab = 'result' | 'cascade'

type ResultStatus = 'matched' | 'no_match' | 'error' | 'not_run' | 'cancelled'

const RESULT_STATUS_CONFIG: Record<
  ResultStatus,
  { variant: React.ComponentProps<typeof Badge>['variant']; label: string }
> = {
  matched: { variant: 'green', label: 'Matched' },
  no_match: { variant: 'gray', label: 'No match' },
  error: { variant: 'red', label: 'Error' },
  not_run: { variant: 'gray', label: 'Not run' },
  cancelled: { variant: 'orange', label: 'Cancelled' },
}

/** Minimum bar width so a sub-millisecond provider still shows on the timeline. */
const MIN_BAR_PCT = 0.5

const PROVIDER_STATUS_LABEL: Record<EnrichmentProviderOutcome['status'], string> = {
  matched: 'Matched',
  no_match: 'No match',
  skipped: 'Skipped',
  error: 'Error',
  not_run: 'Not run',
}

interface CascadeRow {
  outcome: EnrichmentProviderOutcome
  offsetPct: number
  widthPct: number
}

/**
 * Lays the (sequential) provider attempts on one timeline so the Cascade tab
 * reads like the execution trace waterfall: each bar's offset is the time before
 * it ran, its width its own duration. Skipped providers (0ms) get no bar.
 */
function buildCascadeRows(providers: EnrichmentProviderOutcome[]): CascadeRow[] {
  const total = Math.max(
    1,
    providers.reduce((sum, p) => sum + p.durationMs, 0)
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

/** A provider that actually executed its tool (not skipped / never reached). */
function didRun(p: EnrichmentProviderOutcome): boolean {
  return p.status !== 'skipped' && p.status !== 'not_run'
}

/**
 * Derives the cell-level outcome from the cascade — mirrors the executor: a
 * cancelled run is `cancelled` regardless of how far the cascade got; otherwise
 * `error` only when every provider that ran errored, `not_run` when nothing
 * executed (missing inputs), else a clean `no_match`.
 */
function deriveResultStatus(detail: EnrichmentRunDetail): ResultStatus {
  if (detail.aborted) return 'cancelled'
  if (detail.matchedProvider) return 'matched'
  const ran = detail.providers.filter(didRun)
  if (ran.length === 0) return 'not_run'
  if (ran.every((p) => p.status === 'error')) return 'error'
  return 'no_match'
}

interface DetailRowProps {
  label: string
  children: React.ReactNode
}

function DetailRow({ label, children }: DetailRowProps) {
  return (
    <div className='flex h-10 items-center justify-between gap-4 px-3 transition-colors hover-hover:bg-[var(--surface-2)]'>
      <span className='flex-shrink-0 font-medium text-[var(--text-tertiary)] text-caption'>
        {label}
      </span>
      <span className='min-w-0 truncate text-right font-medium text-[var(--text-secondary)] text-caption tabular-nums'>
        {children}
      </span>
    </div>
  )
}

interface EnrichmentDetailsContentProps {
  tableId: string
  rowId: string
  groupId: string
  groupName?: string
  isOpen: boolean
}

function EnrichmentDetailsContent({
  tableId,
  rowId,
  groupId,
  groupName,
  isOpen,
}: EnrichmentDetailsContentProps) {
  const t = useTranslations('auto')
  const [activeTab, setActiveTab] = useState<EnrichmentDetailsTab>('result')
  const [prevKey, setPrevKey] = useState(`${rowId}:${groupId}`)

  const key = `${rowId}:${groupId}`
  if (prevKey !== key) {
    setPrevKey(key)
    setActiveTab('result')
  }

  const { data: detail, isLoading } = useEnrichmentDetail(tableId, rowId, groupId, {
    enabled: isOpen,
  })

  const matchedLabel = detail?.matchedProvider
    ? (detail.providers.find((p) => p.id === detail.matchedProvider)?.label ??
      detail.matchedProvider)
    : null
  const ranCount = detail ? detail.providers.filter(didRun).length : 0
  const lastError = detail
    ? [...detail.providers].reverse().find((p) => p.status === 'error')?.error
    : null
  const timestamp = detail ? formatDate(detail.completedAt) : null

  return (
    <div className='mt-4 flex min-h-0 flex-1 flex-col'>
      <ChipModalTabs
        tabs={[
          { value: 'result', label: 'Result' },
          { value: 'cascade', label: 'Cascade' },
        ]}
        value={activeTab}
        onChange={(v) => setActiveTab(v as EnrichmentDetailsTab)}
      />

      {isLoading ? (
        <div className='flex h-full items-center justify-center px-4 text-center'>
          <span className='font-medium text-[var(--text-tertiary)] text-sm'>{t('loading')}</span>
        </div>
      ) : !detail ? (
        <div className='flex h-full items-center justify-center px-4 text-center'>
          <span className='font-medium text-[var(--text-tertiary)] text-sm'>
            {t('no_enrichment_details_for_this_run')}
          </span>
        </div>
      ) : activeTab === 'result' ? (
        <div className='mt-4 min-h-0 flex-1 overflow-y-auto'>
          <div className='flex flex-col gap-2.5 pb-4'>
            <div className='grid grid-cols-2 gap-x-3 pb-0.5'>
              <div className='flex min-w-0 flex-col gap-0.5'>
                <span className='font-medium text-[var(--text-tertiary)] text-caption'>
                  {t('timestamp')}
                </span>
                <span className='font-medium text-[var(--text-secondary)] text-sm tabular-nums'>
                  {timestamp ? `${timestamp.compactDate} ${timestamp.compactTime}` : '—'}
                </span>
              </div>
              <div className='flex min-w-0 flex-col gap-0.5'>
                <span className='font-medium text-[var(--text-tertiary)] text-caption'>
                  {t('enrichment')}
                </span>
                <span className='min-w-0 truncate font-medium text-[var(--text-secondary)] text-sm'>
                  {groupName || 'Enrichment'}
                </span>
              </div>
            </div>

            <div className='divide-y divide-[var(--border)] overflow-hidden rounded-md border border-[var(--border)] bg-[var(--surface-2)] dark:bg-transparent'>
              <DetailRow label={t('status')}>
                <Badge
                  variant={RESULT_STATUS_CONFIG[deriveResultStatus(detail)].variant}
                  dot
                  size='sm'
                >
                  {RESULT_STATUS_CONFIG[deriveResultStatus(detail)].label}
                </Badge>
              </DetailRow>
              <DetailRow label={t('duration')}>
                {formatDuration(detail.durationMs, { precision: 2 }) || '—'}
              </DetailRow>
              <DetailRow label={t('total_cost')}>{formatCost(detail.totalCost)}</DetailRow>
              <DetailRow label={t('matched_provider')}>{matchedLabel || '—'}</DetailRow>
              <DetailRow label={t('providers_ran')}>{ranCount}</DetailRow>
            </div>

            {lastError && (
              <div className='flex flex-col gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2 dark:bg-transparent'>
                <span className='font-medium text-[var(--text-error)] text-caption'>{t('error')}</span>
                <p className='break-words text-[var(--text-secondary)] text-caption'>{lastError}</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className='mt-4 min-h-0 flex-1 overflow-y-auto'>
          {/* Summary strip — mirrors the trace header */}
          <div className='mb-2 flex items-center gap-2 px-[2px]'>
            <Badge variant={RESULT_STATUS_CONFIG[deriveResultStatus(detail)].variant} dot size='sm'>
              {RESULT_STATUS_CONFIG[deriveResultStatus(detail)].label}
            </Badge>
            <span className='font-medium text-[var(--text-secondary)] text-caption tabular-nums'>
              {formatDuration(detail.durationMs, { precision: 2 }) || '—'}
            </span>
            <span className='font-medium text-[var(--text-tertiary)] text-caption'>
              {ranCount} {ranCount === 1 ? 'provider' : 'providers'}
            </span>
            {detail.totalCost > 0 && (
              <span className='font-medium text-[var(--text-tertiary)] text-caption tabular-nums'>
                {formatCost(detail.totalCost)}
              </span>
            )}
          </div>

          {/* Provider waterfall — each row is one cascade attempt on a shared timeline */}
          <div className='flex flex-col pb-4'>
            {buildCascadeRows(detail.providers).map(({ outcome, offsetPct, widthPct }) => {
              const ran = didRun(outcome)
              const { icon: ProviderIcon, bgColor: rawBgColor } = getBlockIconAndColor(
                'tool',
                outcome.toolId
              )
              const bgColor = adjustBgForContrast(rawBgColor)
              return (
                <div
                  key={outcome.id}
                  className={cn(
                    'relative flex min-w-0 flex-col rounded-md transition-colors',
                    outcome.status === 'matched'
                      ? 'bg-[var(--surface-2)]'
                      : 'hover-hover:bg-[var(--surface-2)]',
                    !ran && 'opacity-60'
                  )}
                >
                  <div className='flex min-w-0 items-center gap-1.5 px-2 pt-1.5'>
                    <div
                      className='flex size-[16px] flex-shrink-0 items-center justify-center overflow-hidden rounded-sm'
                      style={{ background: bgColor }}
                    >
                      {ProviderIcon && (
                        <ProviderIcon className={cn('size-[11px]', iconColorClass(bgColor))} />
                      )}
                    </div>
                    <span className='min-w-0 flex-1 truncate font-medium text-[var(--text-secondary)] text-caption'>
                      {outcome.label}
                    </span>
                    <span className='flex-shrink-0 font-medium text-[var(--text-tertiary)] text-caption'>
                      {PROVIDER_STATUS_LABEL[outcome.status]}
                    </span>
                    {outcome.cost > 0 && (
                      <span className='flex-shrink-0 font-medium text-[var(--text-tertiary)] text-xs tabular-nums'>
                        {formatCost(outcome.cost)}
                      </span>
                    )}
                    {ran && (
                      <span className='flex-shrink-0 font-medium text-[var(--text-tertiary)] text-caption tabular-nums'>
                        {formatDuration(outcome.durationMs, { precision: 2 }) || '—'}
                      </span>
                    )}
                  </div>
                  <div className='px-2 pt-[3px] pb-1.5'>
                    <div className='relative h-[3px] w-full overflow-hidden rounded-full bg-[var(--border)]'>
                      {widthPct > 0 && (
                        <div
                          className='absolute h-full rounded-full bg-[var(--text-tertiary)]'
                          style={{ left: `${offsetPct}%`, width: `${widthPct}%` }}
                        />
                      )}
                    </div>
                  </div>
                  {outcome.error && (
                    <p className='break-words px-2 pb-1.5 text-[var(--text-tertiary)] text-xs'>
                      {outcome.error}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

interface EnrichmentDetailsProps {
  tableId: string
  rowId: string | null
  groupId: string | null
  groupName?: string
  isOpen: boolean
  onClose: () => void
}

/**
 * Right-edge slideout showing an enrichment cell's run: a Result tab (status,
 * duration, total cost, matched provider) and a Cascade tab (per-provider
 * outcomes). Mirrors the log-details shell — resizable with a shared persisted
 * width — minus the prev/next navigation, which is meaningless for a cell.
 */
export function EnrichmentDetails({
  tableId,
  rowId,
  groupId,
  groupName,
  isOpen,
  onClose,
}: EnrichmentDetailsProps) {
  const t = useTranslations('auto')
  const panelWidth = useLogDetailsUIStore((state) => state.panelWidth)
  const { handleMouseDown } = useLogDetailsResize()

  const maxVw = `${MAX_LOG_DETAILS_WIDTH_RATIO * 100}vw`
  const effectiveWidth = `clamp(min(${MIN_LOG_DETAILS_WIDTH}px, ${maxVw}), ${panelWidth}px, ${maxVw})`

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  return (
    <>
      {isOpen && (
        <div
          className='absolute top-0 bottom-0 z-[var(--z-dropdown)] w-[8px] cursor-ew-resize'
          style={{ right: `calc(${effectiveWidth} - 4px)` }}
          onMouseDown={handleMouseDown}
          role='separator'
          aria-label={t('resize_enrichment_details_panel')}
          aria-orientation='vertical'
        />
      )}

      <div
        className={cn(
          'absolute top-0 right-0 bottom-0 z-[var(--z-dropdown)] overflow-hidden border-l bg-[var(--bg)] shadow-md transition-transform duration-200 ease-out',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
        style={{ width: effectiveWidth }}
        aria-label={t('enrichment_details_sidebar')}
      >
        {rowId && groupId && (
          <div className='flex h-full flex-col px-3.5 pt-3'>
            <div className='flex items-center justify-between'>
              <h2 className='font-medium text-[var(--text-primary)] text-sm'>{t('enrichment_details')}</h2>
              <Button variant='ghost' className='!p-1' onClick={onClose} aria-label={t('close')}>
                <X className='size-[14px]' />
              </Button>
            </div>

            <EnrichmentDetailsContent
              tableId={tableId}
              rowId={rowId}
              groupId={groupId}
              groupName={groupName}
              isOpen={isOpen}
            />
          </div>
        )}
      </div>
    </>
  )
}
