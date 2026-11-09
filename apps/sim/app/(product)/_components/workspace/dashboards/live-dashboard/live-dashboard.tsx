'use client'

import { useMemo, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { DateRangePicker } from '@sim/emcn/picker/date-picker'
import { InlineNotice } from '@sim/emcn/status'
import { ContentTabs } from '@sim/emcn/tabs/content-tabs'
import { useQueryState, useQueryStates } from 'nuqs'
import {
  DashboardPanel,
  DashboardRow,
  DashboardStack,
} from '@/components/dashboard-panel/dashboard-panel'
import { ControlBar } from '@/app/(product)/_components/control-bar/control-bar'
import styles from '@/app/(product)/_components/workspace/dashboards/live-dashboard/live-dashboard.module.css'
import {
  LiveWorkspacePage,
  useNewChatHref,
  WorkspaceEmpty,
} from '@/app/(product)/_components/workspace/workspace-page/workspace-page'
import type { WorkspaceRead } from '@/app/(product)/_components/workspace/workspace-session/model'
import {
  DASHBOARD_RANGES,
  type DashboardBlock,
  type DashboardSpec,
  type DashboardTabs,
  dashboardParsers,
  dashboardTableIds,
  dashboardTabParser,
  dashboardUrlKeys,
  dashboardUrlOptions,
  parseDashboardSpec,
  useDashboardTime,
  useWorkspaceDashboard,
  zonedWallClock,
} from '@/platform/lib/data/dashboards'
import { useWorkspaceFilesRoom } from '@/platform/lib/data/files'
import { DASHBOARD_RANGE_LABELS, getBrowserTimezone } from '@/platform/lib/data/files/dashboards'

interface DashboardContext {
  workspaceId: string
  dashboardId: string
  spec: DashboardSpec
  time: ReturnType<typeof useDashboardTime>
}

interface BlockProps {
  block: DashboardBlock
  path: string
  context: DashboardContext
}

/** A tab group, its selection in the URL as legacy keeps it. */
function BlockTabs({ block, path, context }: Omit<BlockProps, 'block'> & { block: DashboardTabs }) {
  const { tabs } = block
  const [selected, setSelected] = useQueryState(
    `dash-${context.dashboardId}-tab-${path}`,
    dashboardTabParser.withOptions(dashboardUrlOptions)
  )
  const names = Object.keys(tabs)
  const active = names.find((name) => name === selected) ?? names[0] ?? ''
  return (
    <ContentTabs
      label='Dashboard sections'
      current={active}
      onSelect={(name) => void setSelected(name)}
      items={Object.entries(tabs).map(([name, blocks], index) => ({
        id: name,
        label: name,
        content: name === active && (
          <Blocks blocks={blocks} path={`${path}.${index}`} context={context} />
        ),
      }))}
    />
  )
}

function Block({ block, path, context }: BlockProps) {
  if ('text' in block)
    return (
      <p className={styles.text} data-type='T048'>
        {block.text}
      </p>
    )
  if ('tabs' in block) return <BlockTabs block={block} path={path} context={context} />
  if ('row' in block)
    return (
      <DashboardRow
        metrics={block.row.every((child) => 'stat' in child)}
        cells={block.row.map((child, index) => ({
          key: String(index),
          flex: child.flex ?? 1,
          content: <Block block={child} path={`${path}.${index}`} context={context} />,
        }))}
      />
    )
  const { time } = context
  return (
    <DashboardPanel
      block={block}
      defaults={context.spec.source}
      workspaceId={context.workspaceId}
      range={time.range}
      now={time.now}
      highlights={context.spec.highlights}
      cursorStore={time.interactions.cursorStore}
      timeZone={time.interactions.timeZone}
      onZoom={time.interactions.onZoom}
    />
  )
}

function Blocks({
  blocks,
  path,
  context,
  startIndex = 0,
}: {
  blocks: readonly DashboardBlock[]
  path: string
  context: DashboardContext
  startIndex?: number
}) {
  return (
    <DashboardStack>
      {blocks.map((block, index) => {
        const key = `${path}.${index + startIndex}`
        return <Block key={key} block={block} path={key} context={context} />
      })}
    </DashboardStack>
  )
}

interface DashboardDocumentProps {
  workspaceId: string
  dashboardId: string
  spec: DashboardSpec
}

/**
 * The dashboard Sim built: its panels read their tables for the chosen range, which rolls forward
 * every minute while the page is visible. The range and time zone live in the URL under legacy's
 * keys; dragging across a time-series chart zooms every panel to that span until Reset.
 */
function DashboardDocument({ workspaceId, dashboardId, spec }: DashboardDocumentProps) {
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
    live: true,
  })
  const { controls } = time
  const [choosingRange, setChoosingRange] = useState(false)
  const custom = choosingRange || controls.period === 'custom'
  const first = spec.blocks[0]
  const description = first && 'text' in first ? first.text : null
  const startIndex = description === null ? 0 : 1
  const context: DashboardContext = { workspaceId, dashboardId, spec, time }
  return (
    <LiveWorkspacePage
      workspaceId={workspaceId}
      current='dashboards'
      controls={
        <ControlBar
          leading={
            <>
              <ChoiceMenu
                label='Period'
                options={[
                  ...DASHBOARD_RANGES.map((range) => ({
                    value: range,
                    label: DASHBOARD_RANGE_LABELS[range],
                  })),
                  { value: 'custom', label: 'Custom range' },
                ]}
                value={custom ? 'custom' : controls.period}
                onValueChange={(value) => {
                  const range = DASHBOARD_RANGES.find((option) => option === value)
                  setChoosingRange(!range)
                  if (range) controls.onPeriodChange(range)
                }}
              />
              {custom && (
                <DateRangePicker
                  label='Custom range'
                  labelHidden
                  withTime
                  open={choosingRange}
                  onOpenChange={setChoosingRange}
                  value={
                    controls.period === 'custom' && !controls.rangeError
                      ? {
                          start: zonedWallClock(new Date(controls.range.from), controls.timeZone),
                          end: zonedWallClock(
                            new Date(Date.parse(controls.range.to) - 1),
                            controls.timeZone
                          ),
                        }
                      : null
                  }
                  onValueChange={(range) =>
                    range !== null &&
                    controls.onCalendarChange(`${range.start}:00`, `${range.end}:59`)
                  }
                />
              )}
              <ChoiceMenu
                label='Time zone'
                options={[
                  { value: 'local', label: getBrowserTimezone() },
                  { value: 'utc', label: 'UTC' },
                ]}
                value={controls.zone}
                onValueChange={(zone) => controls.onZoneChange(zone === 'utc' ? 'utc' : 'local')}
              />
            </>
          }
        >
          {state.range !== null && (
            <Button variant='quiet' size='compact' onClick={time.reset}>
              Reset
            </Button>
          )}
        </ControlBar>
      }
    >
      <div className={styles.document}>
        <header className={styles.heading}>
          <h2 className={styles.title} data-type='T093'>
            {spec.title}
          </h2>
          {description && (
            <p className={styles.text} data-type='T048'>
              {description}
            </p>
          )}
        </header>
        {time.inputError && <InlineNotice intent='danger' message={time.inputError} />}
        {time.rangeError ? (
          <InlineNotice message={time.rangeError} />
        ) : (
          <Blocks
            blocks={spec.blocks.slice(startIndex)}
            path='root'
            startIndex={startIndex}
            context={context}
          />
        )}
      </div>
    </LiveWorkspacePage>
  )
}

/**
 * The workspace's dashboard on live data, read again whenever the workspace's files room reports Sim
 * rewrote it, as legacy does. The page answers 404 while the `dashboards` flag is off.
 */
export function LiveDashboard({ workspaceId }: { workspaceId: string }) {
  useWorkspaceFilesRoom(workspaceId)
  const newChat = useNewChatHref()
  const query = useWorkspaceDashboard(workspaceId)
  const content = query.data?.content ?? null
  const parsed = useMemo(() => (content === null ? null : parseDashboardSpec(content)), [content])
  const dashboard = query.data?.dashboard
  if (dashboard && parsed?.spec)
    return (
      <DashboardDocument
        key={dashboard.id}
        workspaceId={workspaceId}
        dashboardId={dashboard.id}
        spec={parsed.spec}
      />
    )
  const read: WorkspaceRead = query.data
    ? { status: 'ready' }
    : query.status === 'error'
      ? {
          status: 'error',
          message: query.error.message,
          retrying: query.isFetching,
          onRetry: () => void query.refetch(),
        }
      : { status: 'pending' }
  return (
    <LiveWorkspacePage workspaceId={workspaceId} current='dashboards' read={read}>
      {parsed?.error !== undefined ? (
        <InlineNotice
          intent='danger'
          title='This dashboard could not be read'
          message={parsed.error}
        />
      ) : (
        <WorkspaceEmpty
          title='No dashboard yet'
          description='Start a chat to create a dashboard for this workspace.'
          action={{ label: 'New chat', href: newChat }}
        />
      )}
    </LiveWorkspacePage>
  )
}
