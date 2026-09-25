'use client'

import { Suspense, useMemo, useRef, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { toRecord } from '@sim/utils/object'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { useQueryStates } from 'nuqs'
import { DashboardControls } from '@/components/dashboards/dashboard-controls'
import { DashboardInteractionContext } from '@/components/dashboards/dashboard-interactions'
import { DashboardLayout } from '@/components/dashboards/dashboard-layout'
import {
  dashboardParsers,
  dashboardUrlKeys,
  dashboardUrlOptions,
} from '@/components/dashboards/search-params'
import { getBrowserTimezone } from '@/lib/core/utils/timezone'
import {
  type DashboardBlock,
  type DashboardSpec,
  parseDashboardSpec,
  resolveDashboardSource,
} from '@/lib/dashboards/spec'
import {
  type DashboardTimeRange,
  dashboardRangeFromCalendar,
  parseDashboardCustomRange,
  relativeDashboardRange,
} from '@/lib/dashboards/time'
import { tableAnalyticsKeys } from '@/hooks/queries/table-analytics'
import { createDashboardCursorStore, type DashboardCursorStore } from '@/stores/dashboards/cursor'

interface DashboardPreviewProps {
  content: string
  workspaceId: string
  fileId: string
  isStreaming?: boolean
  readOnly?: boolean
}
interface DashboardViewProps {
  spec: DashboardSpec
  workspaceId: string
  fileId: string
}

function dashboardTableIds(spec: DashboardSpec): Set<string> {
  const ids = new Set<string>()
  const visit = (blocks: DashboardBlock[]) => {
    for (const block of blocks) {
      if ('row' in block) visit(block.row)
      else if ('tabs' in block) Object.values(block.tabs).forEach(visit)
      else if (!('text' in block))
        ids.add(resolveDashboardSource(spec.source, block.source).tableId)
    }
  }
  visit(spec.blocks)
  return ids
}

function DashboardView({ spec, workspaceId, fileId }: DashboardViewProps) {
  const cursorStoreRef = useRef<DashboardCursorStore | null>(null)
  cursorStoreRef.current ??= createDashboardCursorStore()
  const [state, setState] = useQueryStates(dashboardParsers, {
    ...dashboardUrlOptions,
    urlKeys: dashboardUrlKeys(fileId),
  })
  const [now, setNow] = useState(() => Date.now())
  const [inputError, setInputError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const tableIds = dashboardTableIds(spec)
  const queryFilter = {
    queryKey: tableAnalyticsKeys.queries(),
    predicate: (query: { queryKey: readonly unknown[] }) => {
      return (
        toRecord(query.queryKey[3]).workspaceId === workspaceId &&
        tableIds.has(String(query.queryKey[2]))
      )
    },
  }
  const isFetching = useIsFetching(queryFilter) > 0
  const localTimeZone = getBrowserTimezone()
  const timeZone = state.zone === 'local' ? localTimeZone : 'UTC'
  const period = state.range ?? spec.time ?? '7d'
  const firstBlock = spec.blocks[0]
  const description = firstBlock && 'text' in firstBlock ? firstBlock.text : null
  const startIndex = description === null ? 0 : 1
  let range = relativeDashboardRange(period === 'custom' ? '7d' : period, now)
  let rangeError: string | null = null
  if (period === 'custom') {
    try {
      range = parseDashboardCustomRange(state.from ?? '', state.to ?? '')
    } catch (error) {
      rangeError = getErrorMessage(error, 'Choose a custom range')
    }
  }
  const onZoom = (selected: DashboardTimeRange) => {
    setInputError(null)
    void setState({ range: 'custom', ...selected })
  }
  return (
    <div className='mx-auto flex w-full max-w-[1120px] flex-col gap-6'>
      <header className='grid @min-[1000px]/dashboard:grid-cols-[minmax(0,1fr)_auto] grid-cols-1 items-start gap-4'>
        <div className='flex min-w-0 flex-col gap-1'>
          <h1 className='@min-[1000px]/dashboard:text-[32px] text-[28px] text-[var(--text-primary)] leading-tight tracking-[-0.02em]'>
            {spec.title}
          </h1>
          {description && (
            <p className='max-w-[72ch] whitespace-pre-wrap break-words text-[var(--text-muted)] text-md'>
              {description}
            </p>
          )}
        </div>
        <DashboardControls
          period={period}
          range={range}
          timeZone={timeZone}
          zone={state.zone}
          isFetching={isFetching}
          rangeError={rangeError !== null}
          onPeriodChange={(value) => {
            setInputError(null)
            cursorStoreRef.current?.getState().clearCursor()
            setNow(Date.now())
            void setState({ range: value, from: null, to: null })
          }}
          onCalendarChange={(from, to) => {
            try {
              const selected = dashboardRangeFromCalendar(from, to, timeZone)
              setInputError(null)
              void setState({ range: 'custom', ...selected })
              return true
            } catch (error) {
              setInputError(getErrorMessage(error, 'Invalid range'))
              return false
            }
          }}
          onRefresh={() => {
            setNow(Date.now())
            cursorStoreRef.current?.getState().clearCursor()
            if (period === 'custom') void queryClient.invalidateQueries(queryFilter)
          }}
          onZoneChange={(zone) => void setState({ zone })}
        />
      </header>
      {inputError && (
        <p role='alert' className='text-[var(--text-error)] text-caption'>
          {inputError}
        </p>
      )}
      {rangeError ? (
        <p role='status' className='text-[var(--text-muted)] text-caption'>
          {rangeError}
        </p>
      ) : (
        <DashboardInteractionContext
          value={{ cursorStore: cursorStoreRef.current, timeZone, onZoom }}
        >
          <DashboardLayout
            blocks={spec.blocks.slice(startIndex)}
            startIndex={startIndex}
            defaults={spec.source}
            workspaceId={workspaceId}
            fileId={fileId}
            range={range}
            now={now}
          />
        </DashboardInteractionContext>
      )}
    </div>
  )
}

export function DashboardPreview({
  content,
  workspaceId,
  fileId,
  isStreaming,
  readOnly,
}: DashboardPreviewProps) {
  const parsed = useMemo(() => parseDashboardSpec(content), [content])
  const loading = (
    <p role='status' className='p-6 text-[var(--text-muted)] text-caption'>
      Loading dashboard…
    </p>
  )
  if (!parsed.spec)
    return isStreaming ? (
      loading
    ) : (
      <pre
        role='alert'
        className='overflow-auto whitespace-pre-wrap p-6 text-[var(--text-error)] text-caption'
      >
        {parsed.error}
      </pre>
    )
  if (readOnly)
    return (
      <p className='p-6 text-[var(--text-muted)] text-small'>
        Open this dashboard inside its workspace to view live table data.
      </p>
    )
  return (
    <div className='@container/dashboard min-h-0 flex-1 overflow-auto font-season'>
      <div className='@min-[640px]/dashboard:p-8 px-4 py-6'>
        <Suspense fallback={loading}>
          <DashboardView
            key={`${workspaceId}/${fileId}`}
            spec={parsed.spec}
            workspaceId={workspaceId}
            fileId={fileId}
          />
        </Suspense>
      </div>
    </div>
  )
}
