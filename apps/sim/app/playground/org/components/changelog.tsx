'use client'

import { useEffect, useState } from 'react'
import { Avatar, Chip, ChipTag, cn, DashboardMetric, toast } from '@sim/emcn'
import { CircleAlert, CircleCheck, Rocket } from '@sim/emcn/icons'
import Link from 'next/link'
import { EChartsView } from '@/components/charts/echarts-view'
import { SlackMonoIcon } from '@/components/icons'
import { RunningDot } from '@/app/playground/org/components/glyphs'
import {
  CHANGELOG,
  type ChangelogChart,
  type ChangelogEntry,
  type ChangelogMetric,
  DRAFTS,
  type DraftRelease,
} from '@/app/playground/org/lib/changelog-data'
import type { Project } from '@/app/playground/org/lib/project'
import { protoRoutes } from '@/app/playground/org/lib/routes'

const RELEASE_YEAR = 2026
const TODAY = 'Sep 28'
const BEFORE_COLOR = '#A4A9B1'
const AFTER_COLOR = '#5C7399'
const H2 =
  '@min-[1000px]/dashboard:text-[24px] text-[20px] text-[var(--text-primary)] leading-tight tracking-[-0.02em]'

/** Next release on top (what's ready, what's still running), shipped releases below. */
export function Changelog({ project }: { project: Project }) {
  const draft = DRAFTS.find((d) => d.workspaceId === project.mock.id)
  const [released, setReleased] = useState<ChangelogEntry | null>(null)
  const shipped = [
    ...(released ? [released] : []),
    ...CHANGELOG.filter((entry) => entry.workspaceId === project.mock.id),
  ]

  const release = (draftRelease: DraftRelease) => {
    const ready = draftRelease.changes.filter((change) => change.state === 'ready')
    const workflowsShipped = [...new Set(ready.map((change) => change.workflow))]
    setReleased({
      id: 'released-now',
      workspaceId: draftRelease.workspaceId,
      date: TODAY,
      version: draftRelease.versions
        .filter((v) => workflowsShipped.includes(v.workflow))
        .map((v) => v.to)
        .join(' · '),
      workflows: workflowsShipped,
      title: draftRelease.release.title,
      summary: draftRelease.release.summary,
      changes: ready,
      metrics: [],
      reporters: draftRelease.release.reporters,
      channel: draftRelease.release.channel,
      live: { label: 'runs since release', goodLabel: 'errors' },
    })
    toast.success(`Released ${ready.length} changes`)
  }

  return (
    <div className='@container/dashboard h-full overflow-y-auto font-season'>
      <div className='mx-auto flex max-w-[960px] flex-col gap-14 px-8 py-10'>
        <header className='flex flex-col gap-5'>
          <div className='flex flex-col gap-1'>
            <h1 className='@min-[1000px]/dashboard:text-[32px] text-[28px] text-[var(--text-primary)] leading-tight tracking-[-0.02em]'>
              Changelog
            </h1>
            <p className='max-w-[64ch] text-[var(--text-muted)] text-md'>
              What’s about to ship in {project.name}, what Sim is still working on, and what already
              changed.
            </p>
          </div>
        </header>

        {draft && (
          <NextRelease
            draft={draft}
            projectId={project.id}
            released={released !== null}
            onRelease={() => release(draft)}
          />
        )}

        {shipped.map((entry) => (
          <Release key={entry.id} entry={entry} projectId={project.id} />
        ))}

        {!draft && shipped.length === 0 && (
          <p className='text-[var(--text-muted)] text-md'>Nothing has shipped here yet.</p>
        )}
      </div>
    </div>
  )
}

interface NextReleaseProps {
  draft: DraftRelease
  projectId: string
  released: boolean
  onRelease: () => void
}

function NextRelease({ draft, projectId, released, onRelease }: NextReleaseProps) {
  const changes = draft.changes.filter((change) => !released || change.state === 'approval')
  const readyCount = released ? 0 : draft.changes.filter((c) => c.state === 'ready').length
  const held = draft.changes.filter((change) => change.state === 'approval')
  return (
    <section className='flex flex-col gap-8 rounded-xl border border-[var(--border)] px-7 py-7'>
      <div className='flex flex-wrap items-start gap-4'>
        <div className='flex min-w-0 flex-1 flex-col gap-2'>
          <div className='flex items-center gap-2'>
            <h2 className={H2}>Next release</h2>
            <ChipTag variant='gray'>Draft</ChipTag>
          </div>
          <p className='text-[var(--text-muted)] text-md'>
            {draft.versions.map((v) => `${v.workflow} ${v.from} → ${v.to}`).join('  ·  ')}
          </p>
        </div>
        <Chip variant='primary' leftIcon={Rocket} disabled={readyCount === 0} onClick={onRelease}>
          {readyCount === 0 ? 'Nothing ready' : `Release ${readyCount} changes`}
        </Chip>
      </div>

      <div className='flex flex-col gap-3'>
        <SubHeading
          title='Ready to ship'
          aside={
            held.length > 0
              ? `${held.length} held until approved, the rest ship together`
              : undefined
          }
        />
        {changes.length === 0 ? (
          <p className='text-[var(--text-muted)] text-md'>Everything ready has shipped.</p>
        ) : (
          <ul className='flex flex-col'>
            {changes.map((change) => (
              <DraftChangeRow key={change.text} change={change} workspaceId={projectId} />
            ))}
          </ul>
        )}
      </div>

      <div className='flex flex-col gap-3'>
        <SubHeading title='Running now' aside='Joins this release when it finishes' />
        <ul className='flex flex-col'>
          {draft.running.map((work) => (
            <li key={work.issue}>
              <Link
                href={protoRoutes.issue(projectId, work.issue)}
                className='flex w-full items-center gap-3 border-[var(--border)] border-b py-3 text-left last:border-b-0 hover-hover:opacity-80'
              >
                <RunningDot />
                <span className='min-w-0 flex-1 text-[var(--text-body)] text-md'>{work.task}</span>
                <span className='shrink-0 text-[var(--text-muted)] text-small'>{work.step}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <ReleaseChart chart={draft.chart} date={TODAY} marker={draft.marker} shaded={false} />
    </section>
  )
}

function SubHeading({ title, aside }: { title: string; aside?: string }) {
  return (
    <div className='flex items-baseline gap-3'>
      <span className='text-[var(--text-primary)] text-md'>{title}</span>
      {aside && <span className='text-[var(--text-muted)] text-small'>{aside}</span>}
    </div>
  )
}

interface DraftChangeRowProps {
  change: DraftRelease['changes'][number]
  workspaceId: string
}

function DraftChangeRow({ change, workspaceId }: DraftChangeRowProps) {
  const needsApproval = change.state === 'approval'
  return (
    <li className='border-[var(--border)] border-b last:border-b-0'>
      <Link
        href={protoRoutes.issue(workspaceId, change.issues[0])}
        className='flex items-center gap-3 py-3 hover-hover:opacity-80'
      >
        {needsApproval ? (
          <CircleAlert className='size-[16px] shrink-0 text-[var(--caution)]' />
        ) : (
          <CircleCheck className='size-[16px] shrink-0 text-[var(--success)]' />
        )}
        <span className='min-w-0 flex-1 text-[var(--text-body)] text-md'>{change.text}</span>
        {needsApproval && (
          <span className='shrink-0 text-[var(--caution)] text-small'>Needs approval</span>
        )}
      </Link>
    </li>
  )
}

function Release({ entry, projectId }: { entry: ChangelogEntry; projectId: string }) {
  const fresh = entry.id === 'released-now'
  return (
    <article className='grid @min-[760px]/dashboard:grid-cols-[132px_minmax(0,1fr)] grid-cols-1 gap-x-10 gap-y-3 border-[var(--border)] border-t pt-14'>
      <aside className='@min-[760px]/dashboard:sticky top-8 flex h-fit flex-col gap-2'>
        <span className='text-[var(--text-primary)] text-md'>{fresh ? 'Today' : entry.date}</span>
        <div className='flex flex-wrap items-center gap-1.5'>
          <ChipTag variant='gray'>{entry.version}</ChipTag>
        </div>
        {entry.workflows.map((name) => (
          <span key={name} className='text-[var(--text-muted)] text-small'>
            {name}
          </span>
        ))}
      </aside>

      <div className='flex min-w-0 flex-col gap-7'>
        <div className='flex flex-col gap-3'>
          <h2 className={H2}>{entry.title}</h2>
          <p className='max-w-[68ch] text-[var(--text-muted)] text-md leading-relaxed'>
            {entry.summary}
          </p>
        </div>

        <ul className='flex flex-col gap-3'>
          {entry.changes.map((change) => (
            <li key={change.text} className='flex gap-3'>
              <span className='mt-[9px] size-[5px] shrink-0 rounded-full bg-[var(--text-icon)]' />
              <Link
                href={protoRoutes.issue(projectId, change.issues[0])}
                className='min-w-0 flex-1 text-[var(--text-body)] text-md underline-offset-4 hover:underline'
              >
                {change.text}
              </Link>
            </li>
          ))}
        </ul>

        {entry.metrics.length > 0 && (
          <div className='grid @min-[640px]/dashboard:grid-cols-3 grid-cols-2 gap-6'>
            {entry.metrics.map((metric) => (
              <Metric key={metric.label} metric={metric} />
            ))}
          </div>
        )}

        {entry.chart ? (
          <ReleaseChart chart={entry.chart} date={entry.date} marker={entry.version} shaded />
        ) : (
          <p className='text-[var(--text-muted)] text-small'>
            Impact charts appear after a day of runs.
          </p>
        )}

        {entry.live && <LiveSinceRelease live={entry.live} start={fresh ? 0 : 214} />}

        {entry.reporters.length > 0 && (
          <div className='flex items-center gap-2 text-[var(--text-muted)] text-small'>
            <div className='-space-x-1.5 flex'>
              {entry.reporters.map((name) => (
                <Avatar key={name} size='xs' name={name} className='ring-2 ring-[var(--bg)]' />
              ))}
            </div>
            <span>{`Replied to ${entry.reporters.join(', ')} in`}</span>
            <span className='flex items-center gap-1'>
              <SlackMonoIcon className='size-[12px]' />
              {entry.channel}
            </span>
          </div>
        )}
      </div>
    </article>
  )
}

function Metric({ metric }: { metric: ChangelogMetric }) {
  const change =
    metric.before === 0 ? null : Math.round(((metric.after - metric.before) / metric.before) * 100)
  const improved =
    change === null || change === 0 ? null : metric.lowerIsBetter ? change < 0 : change > 0
  return (
    <div className='flex flex-col gap-1'>
      <DashboardMetric
        label={metric.label}
        value={metric.after}
        unit={metric.unit}
        size='large'
        animated
        maximumFractionDigits={1}
      />
      <span
        className={cn(
          'text-small',
          improved === null
            ? 'text-[var(--text-muted)]'
            : improved
              ? 'text-[var(--success)]'
              : 'text-[var(--text-error)]'
        )}
      >
        {change === null || change === 0
          ? 'unchanged'
          : `${change > 0 ? '+' : ''}${change}% · was ${metric.before}${metric.unit ?? ''}`}
      </span>
    </div>
  )
}

function dayLabel(date: string, offset: number): string {
  const day = new Date(`${date} ${RELEASE_YEAR} 00:00:00 UTC`)
  day.setUTCDate(day.getUTCDate() + offset)
  return day.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

interface ReleaseChartProps {
  chart: ChangelogChart
  date: string
  marker: string
  shaded: boolean
}

function ReleaseChart({ chart, date, marker, shaded }: ReleaseChartProps) {
  const labels = chart.values.map((_, index) => dayLabel(date, index - chart.releaseIndex))
  const releaseLabel = labels[chart.releaseIndex]
  const data = chart.values.map((value, index) =>
    chart.kind === 'bar'
      ? {
          value,
          itemStyle: { color: shaded && index >= chart.releaseIndex ? AFTER_COLOR : BEFORE_COLOR },
        }
      : value
  )
  const option = {
    grid: { left: 8, right: 56, top: 28, bottom: 4, containLabel: true },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: labels,
      axisTick: { show: false },
      axisLabel: { interval: 3 },
      boundaryGap: chart.kind === 'bar',
    },
    yAxis: {
      type: 'value',
      splitNumber: 3,
      axisLabel: chart.unit ? { formatter: `{value}${chart.unit}` } : undefined,
    },
    series: [
      {
        type: chart.kind,
        name: chart.title,
        data,
        barWidth: '56%',
        smooth: 0.25,
        showSymbol: false,
        lineStyle: { width: 2, color: AFTER_COLOR },
        itemStyle: { color: AFTER_COLOR },
        areaStyle: chart.kind === 'line' ? { opacity: 0.06, color: AFTER_COLOR } : undefined,
        markLine: {
          symbol: 'none',
          silent: true,
          lineStyle: { type: 'dashed', color: BEFORE_COLOR },
          label: { formatter: marker, position: 'end', color: BEFORE_COLOR },
          data: [{ xAxis: releaseLabel }],
        },
        markArea: shaded
          ? {
              silent: true,
              itemStyle: { color: AFTER_COLOR, opacity: 0.07 },
              label: {
                show: true,
                position: 'insideTop',
                color: AFTER_COLOR,
                formatter: 'After release',
              },
              data: [[{ xAxis: releaseLabel }, { xAxis: labels[labels.length - 1] }]],
            }
          : undefined,
      },
    ],
  }
  return (
    <figure className='flex flex-col gap-3'>
      <figcaption className='flex items-baseline gap-2'>
        <span className='text-[var(--text-primary)] text-md'>{chart.title}</span>
        <span className='text-[var(--text-muted)] text-small'>
          {shaded ? 'two weeks around the release' : 'last two weeks'}
        </span>
      </figcaption>
      <div className='relative h-[220px]'>
        <EChartsView label={chart.title} option={option} className='h-full' />
      </div>
    </figure>
  )
}

interface LiveSinceReleaseProps {
  live: NonNullable<ChangelogEntry['live']>
  start: number
}

/** Ticks while the page is open, standing in for a live query against the run log. */
function LiveSinceRelease({ live, start }: LiveSinceReleaseProps) {
  const [runs, setRuns] = useState(start)
  useEffect(() => {
    const timer = window.setInterval(() => setRuns((count) => count + 1), 2400)
    return () => window.clearInterval(timer)
  }, [])
  return (
    <div className='flex items-center gap-3 rounded-lg bg-[var(--surface-2)] px-4 py-3 text-md'>
      <span className='relative flex size-[8px]'>
        <span className='absolute inline-flex size-full animate-ping rounded-full bg-[var(--success)] opacity-60' />
        <span className='relative inline-flex size-[8px] rounded-full bg-[var(--success)]' />
      </span>
      <span className='text-[var(--text-body)]'>{`${runs.toLocaleString()} ${live.label}`}</span>
      <span className='text-[var(--text-muted)]'>·</span>
      <span className='text-[var(--text-body)]'>{`0 ${live.goodLabel}`}</span>
      <span className='ml-auto text-[var(--text-muted)] text-small'>Live</span>
    </div>
  )
}
