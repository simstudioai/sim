'use client'

import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react'
import { cn, Tooltip } from '@sim/emcn'
import { useParams } from 'next/navigation'
import { DashboardFeatureGate } from '@/components/dashboards/dashboard-feature-gate'
import { DashboardInteractionContext } from '@/components/dashboards/dashboard-interactions'
import { DashboardLayout } from '@/components/dashboards/dashboard-layout'
import {
  type DashboardTimeState,
  useDashboardTime,
} from '@/components/dashboards/use-dashboard-time'
import {
  type DashboardEmbedSpec,
  dashboardTableIds,
  parseDashboardEmbed,
} from '@/lib/dashboards/spec'
import {
  DASHBOARD_RANGE_LABELS,
  dashboardRangeText,
  dashboardTimeLabel,
} from '@/lib/dashboards/time'

interface EmbedMessageProps {
  children: ReactNode
  tone?: 'muted' | 'error'
}
interface DashboardEmbedProps {
  /** The fence body: dashboard YAML without text or tabs blocks. */
  source: string
  /** True while an agent is still writing the document, so the fence may be incomplete. */
  isStreaming: boolean
}
interface LiveDashboardEmbedProps {
  source: string
  workspaceId: string
}
interface EmbedViewProps {
  spec: DashboardEmbedSpec
  workspaceId: string
}

const NOTICE_CLASS = 'rounded-lg bg-[var(--surface-5)] p-4 dark:bg-[var(--surface-4)]'

function EmbedMessage({ children, tone = 'muted' }: EmbedMessageProps) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        NOTICE_CLASS,
        'overflow-auto whitespace-pre-wrap pr-16 text-caption',
        tone === 'error' ? 'text-[var(--text-error)]' : 'text-[var(--text-muted)]'
      )}
    >
      {children}
    </div>
  )
}

/**
 * A ```dashboard fence rendered as live panels. Data is read with the viewer's own session, so
 * the fence only renders inside its workspace; a public share shows a notice instead of querying.
 */
export function DashboardEmbed({ source, isStreaming }: DashboardEmbedProps) {
  const params = useParams()
  const workspaceId = typeof params.workspaceId === 'string' ? params.workspaceId : null
  if (isStreaming) return <EmbedMessage>The chart loads when Sim finishes writing.</EmbedMessage>
  if (!workspaceId)
    return <EmbedMessage>Open this document in its workspace to see live data.</EmbedMessage>
  return (
    <DashboardFeatureGate>
      <LiveDashboardEmbed source={source} workspaceId={workspaceId} />
    </DashboardFeatureGate>
  )
}

function LiveDashboardEmbed({ source, workspaceId }: LiveDashboardEmbedProps) {
  const parsed = useMemo(() => parseDashboardEmbed(source), [source])
  if (!parsed.spec) return <EmbedMessage tone='error'>{parsed.error}</EmbedMessage>
  return <EmbedView spec={parsed.spec} workspaceId={workspaceId} />
}

function EmbedView({ spec, workspaceId }: EmbedViewProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const embedId = useId()
  const [inView, setInView] = useState(false)
  const [state, setState] = useState<DashboardTimeState>({
    range: null,
    from: null,
    to: null,
    zone: 'local',
  })
  const time = useDashboardTime({
    state,
    setState: (update) => setState((current) => ({ ...current, ...update })),
    time: spec.time,
    workspaceId,
    tableIds: dashboardTableIds(spec.blocks, spec.source),
    live: inView,
  })
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting))
    observer.observe(root)
    return () => observer.disconnect()
  }, [])
  const zoomed = state.range !== null
  const { period } = time.controls
  const caption =
    period === 'custom'
      ? dashboardRangeText(time.range, time.interactions.timeZone)
      : DASHBOARD_RANGE_LABELS[period]
  return (
    <div
      ref={rootRef}
      className='@container/dashboard relative flex flex-col gap-3 pt-8 font-season'
    >
      {spec.title && (
        <p className='pr-40 font-medium text-[var(--text-primary)] text-base'>{spec.title}</p>
      )}
      <p className='absolute top-8 right-0 text-[var(--text-muted)] text-caption leading-6'>
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <span>{caption}</span>
          </Tooltip.Trigger>
          <Tooltip.Content>
            {dashboardTimeLabel(time.range.from, time.interactions.timeZone)} –{' '}
            {dashboardTimeLabel(time.range.to, time.interactions.timeZone)}
          </Tooltip.Content>
        </Tooltip.Root>
        {zoomed && (
          <>
            {' · '}
            <button
              type='button'
              className='text-[var(--text-muted)] underline-offset-2 transition-colors hover:text-[var(--text-body)] hover:underline'
              onClick={time.reset}
            >
              Reset
            </button>
          </>
        )}
      </p>
      {time.rangeError ? (
        <p role='status' className='text-[var(--text-muted)] text-caption'>
          {time.rangeError}
        </p>
      ) : (
        <DashboardInteractionContext value={time.interactions}>
          <DashboardLayout
            blocks={spec.blocks}
            defaults={spec.source}
            workspaceId={workspaceId}
            dashboardId={embedId}
            range={time.range}
            now={time.now}
            highlights={spec.highlights}
            embedded
          />
        </DashboardInteractionContext>
      )}
    </div>
  )
}
