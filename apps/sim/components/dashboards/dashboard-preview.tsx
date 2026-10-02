'use client'

import { Suspense, useMemo } from 'react'
import { useQueryStates } from 'nuqs'
import { DashboardControls } from '@/components/dashboards/dashboard-controls'
import { DashboardInteractionContext } from '@/components/dashboards/dashboard-interactions'
import { DashboardLayout } from '@/components/dashboards/dashboard-layout'
import {
  dashboardParsers,
  dashboardUrlKeys,
  dashboardUrlOptions,
} from '@/components/dashboards/search-params'
import { useDashboardTime } from '@/components/dashboards/use-dashboard-time'
import { type DashboardSpec, dashboardTableIds, parseDashboardSpec } from '@/lib/dashboards/spec'

interface DashboardPreviewProps {
  content: string
  workspaceId: string
  dashboardId: string
  isStreaming?: boolean
  readOnly?: boolean
}
interface DashboardViewProps {
  spec: DashboardSpec
  workspaceId: string
  dashboardId: string
}

function DashboardView({ spec, workspaceId, dashboardId }: DashboardViewProps) {
  const [state, setState] = useQueryStates(dashboardParsers, {
    ...dashboardUrlOptions,
    urlKeys: dashboardUrlKeys(dashboardId),
  })
  const time = useDashboardTime({
    state,
    setState: (update) => void setState(update),
    time: spec.time,
    workspaceId,
    tableIds: dashboardTableIds(spec.blocks, spec.source),
  })
  const firstBlock = spec.blocks[0]
  const description = firstBlock && 'text' in firstBlock ? firstBlock.text : null
  const startIndex = description === null ? 0 : 1
  return (
    <div className='mx-auto flex w-full max-w-[1120px] flex-col gap-6'>
      <header className='grid @min-[1000px]/dashboard:grid-cols-[minmax(0,1fr)_auto] grid-cols-1 items-start gap-4'>
        <div className='flex min-w-0 flex-col gap-1'>
          <h1 className='@min-[1000px]/dashboard:text-3xl text-2xl text-[var(--text-primary)] leading-tight tracking-[-0.02em]'>
            {spec.title}
          </h1>
          {description && (
            <p className='max-w-[72ch] whitespace-pre-wrap break-words text-[var(--text-muted)] text-md'>
              {description}
            </p>
          )}
        </div>
        <DashboardControls {...time.controls} />
      </header>
      {time.inputError && (
        <p role='alert' className='text-[var(--text-error)] text-caption'>
          {time.inputError}
        </p>
      )}
      {time.rangeError ? (
        <p role='status' className='text-[var(--text-muted)] text-caption'>
          {time.rangeError}
        </p>
      ) : (
        <DashboardInteractionContext value={time.interactions}>
          <DashboardLayout
            blocks={spec.blocks.slice(startIndex)}
            startIndex={startIndex}
            defaults={spec.source}
            workspaceId={workspaceId}
            dashboardId={dashboardId}
            range={time.range}
            now={time.now}
            highlights={spec.highlights}
          />
        </DashboardInteractionContext>
      )}
    </div>
  )
}

export function DashboardPreview({
  content,
  workspaceId,
  dashboardId,
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
            key={`${workspaceId}/${dashboardId}`}
            spec={parsed.spec}
            workspaceId={workspaceId}
            dashboardId={dashboardId}
          />
        </Suspense>
      </div>
    </div>
  )
}
