'use client'

import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { Tooltip } from '@sim/emcn/tooltip'
import { getErrorMessage } from '@sim/utils/errors'
import { useParams } from 'next/navigation'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/rich-markdown-editor/dashboard-embed.module.css'
import { DashboardPanel } from '@/platform/app/(shell)/workspace/[workspaceId]/files/_components/file-viewer/rich-markdown-editor/dashboard-panel'
import {
  createDashboardCursorStore,
  DASHBOARD_RANGE_LABELS,
  type DashboardCursorStore,
  type DashboardEmbedSpec,
  type DashboardRange,
  type DashboardTimeRange,
  dashboardRangeText,
  dashboardTimeLabel,
  getBrowserTimezone,
  parseDashboardCustomRange,
  parseDashboardEmbed,
  relativeDashboardRange,
  useFeatureFlag,
} from '@/platform/lib/data/files/dashboards'

/** How often a relative range advances to the present while the embed is on screen. */
const LIVE_TICK_MS = 60_000

interface EmbedTime {
  /** A zoomed selection on a time-series chart; null is the fence's own range. */
  zoom: DashboardTimeRange | null
}

interface EmbedTimeResult {
  range: DashboardTimeRange
  now: number
  period: DashboardRange | 'custom'
  rangeError: string | null
  zoomed: boolean
  cursorStore: DashboardCursorStore
  timeZone: string
  onZoom: (range: DashboardTimeRange) => void
  reset: () => void
}

/**
 * The embed's time range: the fence's preset or fixed range, re-anchored to the present every
 * minute while on screen, until a reader zooms into a chart. The selection is the embed's own.
 */
function useEmbedTime(spec: DashboardEmbedSpec, live: boolean): EmbedTimeResult {
  const cursorStoreRef = useRef<DashboardCursorStore | null>(null)
  cursorStoreRef.current ??= createDashboardCursorStore()
  const cursorStore = cursorStoreRef.current
  const [now, setNow] = useState(() => Date.now())
  const [{ zoom }, setTime] = useState<EmbedTime>({ zoom: null })
  const timeZone = getBrowserTimezone()
  const fixed = typeof spec.time === 'object' ? spec.time : null
  const preset = typeof spec.time === 'string' ? spec.time : '7d'
  const period = zoom || fixed ? 'custom' : preset

  let range = relativeDashboardRange(period === 'custom' ? '7d' : period, now)
  let rangeError: string | null = null
  if (zoom) range = zoom
  else if (fixed) {
    try {
      range = parseDashboardCustomRange(fixed.from, fixed.to)
    } catch (error) {
      rangeError = getErrorMessage(error, 'Choose a custom range')
    }
  }

  const tick = useEffectEvent(() => {
    if (document.visibilityState === 'visible') setNow(Date.now())
  })
  const catchUp = useEffectEvent(() => {
    if (Date.now() - now >= LIVE_TICK_MS) tick()
  })
  useEffect(() => {
    if (!live) return
    catchUp()
    const interval = setInterval(tick, LIVE_TICK_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [live])

  return {
    range,
    now,
    period,
    rangeError,
    zoomed: zoom !== null,
    cursorStore,
    timeZone,
    onZoom: (selected) => setTime({ zoom: selected }),
    reset: () => {
      cursorStore.getState().clearCursor()
      setNow(Date.now())
      setTime({ zoom: null })
    },
  }
}

interface DashboardRowsProps {
  blocks: DashboardEmbedSpec['blocks']
  spec: DashboardEmbedSpec
  time: EmbedTimeResult
  workspaceId: string
}

/** Panels top to bottom; a row lays its panels side by side by their `flex` weights. */
function DashboardRows({ blocks, spec, time, workspaceId }: DashboardRowsProps) {
  return (
    <div className={styles.rows}>
      {blocks.map((block, index) =>
        'row' in block ? (
          <div
            key={index}
            className={styles.row}
            data-metrics={block.row.every((child) => 'stat' in child) || undefined}
          >
            {block.row.map((child, childIndex) => (
              <div key={childIndex} className={styles.cell} data-flex={child.flex ?? 1}>
                <DashboardRows blocks={[child]} spec={spec} time={time} workspaceId={workspaceId} />
              </div>
            ))}
          </div>
        ) : (
          <DashboardPanel
            key={index}
            block={block}
            defaults={spec.source}
            workspaceId={workspaceId}
            range={time.range}
            now={time.now}
            highlights={spec.highlights}
            cursorStore={time.cursorStore}
            timeZone={time.timeZone}
            onZoom={time.onZoom}
          />
        )
      )}
    </div>
  )
}

function EmbedView({ spec, workspaceId }: { spec: DashboardEmbedSpec; workspaceId: string }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)
  const time = useEmbedTime(spec, inView)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting))
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  const caption =
    time.period === 'custom'
      ? dashboardRangeText(time.range, time.timeZone)
      : DASHBOARD_RANGE_LABELS[time.period]
  const span = `${dashboardTimeLabel(time.range.from, time.timeZone)} – ${dashboardTimeLabel(time.range.to, time.timeZone)}`
  return (
    <div ref={rootRef} className={styles.embed} data-embed=''>
      <div className={styles.heading}>
        {spec.title && (
          <p className={styles.title} data-type='T060'>
            {spec.title}
          </p>
        )}
        <div className={styles.range} data-type='T052'>
          <Tooltip label={span}>
            <span>{caption}</span>
          </Tooltip>
          {time.zoomed && (
            <Button variant='quiet' size='compact' onClick={time.reset}>
              Reset
            </Button>
          )}
        </div>
      </div>
      {time.rangeError ? (
        <p className={styles.notice} role='status' data-type='T052'>
          {time.rangeError}
        </p>
      ) : (
        <DashboardRows blocks={spec.blocks} spec={spec} time={time} workspaceId={workspaceId} />
      )}
    </div>
  )
}

function EmbedMessage({ message, failed = false }: { message: string; failed?: boolean }) {
  return (
    <p
      className={styles.message}
      role={failed ? 'alert' : 'status'}
      data-failed={failed || undefined}
      data-type='T052'
    >
      {message}
    </p>
  )
}

/**
 * A ```dashboard fence as live panels, read with the viewer's own session inside its workspace,
 * as legacy draws it. The fence's YAML is parsed on each change; a fence that does not parse says
 * why instead of querying.
 */
export function DashboardEmbed({ source }: { source: string }) {
  const params = useParams()
  const workspaceId = typeof params.workspaceId === 'string' ? params.workspaceId : null
  const enabled = useFeatureFlag('dashboards')
  const parsed = useMemo(() => parseDashboardEmbed(source), [source])
  if (!enabled) return <EmbedMessage message='Dashboards are not enabled' />
  if (!workspaceId)
    return <EmbedMessage message='Open this document in its workspace to see live data.' />
  if (!parsed.spec) return <EmbedMessage message={parsed.error} failed />
  return <EmbedView spec={parsed.spec} workspaceId={workspaceId} />
}
