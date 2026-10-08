'use client'

import { lazy, type ReactNode, Suspense, useEffect, useState } from 'react'
import {
  Badge,
  Chip,
  cn,
  DashboardMetric,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@sim/emcn'
import { CircleCheck, CircleX, Loader, Minus } from '@sim/emcn/icons'
import { formatDuration, formatRelativeTime } from '@sim/utils/formatting'
import type { WorkflowTestDetail } from '@/lib/api/contracts/workflow-tests'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useWorkflowTestRun } from '@/hooks/queries/workflow-tests'

const WorkflowVersionPreview = lazy(() =>
  import('@/app/workspace/[workspaceId]/tests/components/workflow-version-preview').then(
    (module) => ({ default: module.WorkflowVersionPreview })
  )
)

type RunDetail = NonNullable<WorkflowTestDetail['latestRun']>
type Run = WorkflowTestDetail['history'][number]
type CaseResult = NonNullable<RunDetail['report']>['tests'][number]
type CaseState = 'queued' | 'running' | 'pass' | 'fail' | 'skip' | 'none'

const RUNS_SHOWN = 5

const RUN_BADGE: Record<Run['status'], 'green' | 'red' | 'amber'> = {
  passed: 'green',
  failed: 'red',
  error: 'red',
  running: 'amber',
}

const CASE_STATE: Record<CaseState, { label: string; icon: ReactNode }> = {
  queued: {
    label: 'Queued',
    icon: <Minus className='size-[14px] shrink-0 text-[var(--text-icon)]' />,
  },
  running: {
    label: 'Running',
    icon: <Loader animate className='size-[14px] shrink-0 text-[var(--brand-blue)]' />,
  },
  pass: {
    label: 'Passed',
    icon: <CircleCheck className='size-[14px] shrink-0 text-[var(--text-success)]' />,
  },
  fail: {
    label: 'Failed',
    icon: <CircleX className='size-[14px] shrink-0 text-[var(--text-error)]' />,
  },
  skip: {
    label: 'Skipped',
    icon: <Minus className='size-[14px] shrink-0 text-[var(--text-icon)]' />,
  },
  none: {
    label: 'Not run',
    icon: <Minus className='size-[14px] shrink-0 text-[var(--text-icon)]' />,
  },
}

interface TestDashboardProps {
  workspaceId: string
  name: string
  detail: WorkflowTestDetail
}

/**
 * How the test is doing: totals and freshness for one run (the latest unless a row in Runs is
 * chosen), what failed in it, and every recent run. A latest run still going shows live.
 */
export function TestDashboard({ workspaceId, name, detail }: TestDashboardProps) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const latestRunning = detail.latestRun?.status === 'running'
  const viewedRunId = latestRunning ? null : selectedRunId
  const selected = useWorkflowTestRun(workspaceId, name, viewedRunId)
  const run = viewedRunId ? (selected.data ?? null) : detail.latestRun
  const running = run?.status === 'running'

  const progress = run?.progress ?? {}
  const results = new Map<string, CaseResult>()
  for (const result of run?.report?.tests ?? []) results.set(result.path.join(' > '), result)
  /** An earlier run lists the cases it ran; otherwise the file's current cases, as they stand. */
  const casePaths = viewedRunId
    ? (run?.report?.tests ?? []).map((result) => result.path)
    : detail.test.cases.map((testCase) => testCase.path)
  const cases = casePaths.map((path) => {
    const key = path.join(' > ')
    const result = results.get(key)
    const state: CaseState = running ? (progress[key] ?? 'queued') : (result?.status ?? 'none')
    return { key, name: caseName(path), state, result }
  })
  const finished = cases.filter((c) => c.state !== 'queued' && c.state !== 'running').length
  const hasResults = running || Boolean(run?.report)
  const count = (state: CaseState) => cases.filter((testCase) => testCase.state === state).length
  const durationMs = run?.report?.tests.reduce((total, result) => total + result.durationMs, 0)

  return (
    <div className='@container/dashboard min-h-0 flex-1 overflow-y-auto'>
      <div className='flex flex-col gap-8 @min-[640px]/dashboard:px-8 px-4 py-6'>
        <div className='flex flex-col gap-4'>
          <div className='flex min-w-0 flex-wrap gap-6'>
            <Metric label='Passing' value={hasResults ? count('pass') : '—'} />
            <Metric label='Failing' value={hasResults ? count('fail') : '—'} />
            {running && run ? (
              <ElapsedMetric startedAt={run.startedAt} />
            ) : (
              <Metric
                label='Duration'
                value={durationMs === undefined ? '—' : (formatDuration(durationMs) ?? '—')}
              />
            )}
          </div>
          {running && (
            <div
              role='progressbar'
              aria-valuemin={0}
              aria-valuemax={cases.length}
              aria-valuenow={finished}
              className='h-1 overflow-hidden rounded-full bg-[var(--surface-active)]'
            >
              <div
                className='h-full rounded-full bg-[var(--brand-blue)] transition-[width] duration-500 ease-out'
                style={{ width: `${cases.length === 0 ? 0 : (finished / cases.length) * 100}%` }}
              />
            </div>
          )}
          <Freshness run={run} loading={Boolean(viewedRunId) && selected.isPending} />
        </div>

        <SettingsSection
          label={running ? `Tests · ${finished} of ${cases.length}` : `Tests · ${cases.length}`}
        >
          {cases.length === 0 ? (
            <p className='text-[var(--text-muted)] text-small'>No tests yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Test</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className='text-right'>Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cases.map((testCase) => (
                  <TableRow key={testCase.key}>
                    <TableCell className='max-w-[420px] align-top'>
                      <span className='whitespace-pre-wrap break-words'>{testCase.name}</span>
                      {testCase.state === 'fail' && testCase.result && (
                        <p className='mt-1 whitespace-pre-wrap break-words text-[var(--text-error)] text-caption'>
                          {failureReason(testCase.result)}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className='align-top'>
                      <span className='flex items-center gap-2'>
                        {CASE_STATE[testCase.state].icon}
                        {CASE_STATE[testCase.state].label}
                      </span>
                    </TableCell>
                    <TableCell className='text-right align-top tabular-nums'>
                      {testCase.result ? formatDuration(testCase.result.durationMs) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SettingsSection>

        {detail.history.length > 0 && (
          <RunsSection
            runs={detail.history}
            latestRunId={detail.latestRun?.id ?? null}
            selectedRunId={viewedRunId ?? detail.latestRun?.id ?? null}
            onSelect={(runId) => setSelectedRunId(runId === detail.latestRun?.id ? null : runId)}
          />
        )}

        {!running && run && run.ranAgainst.length > 0 && (
          <WorkflowsSection workflows={run.ranAgainst} />
        )}
      </div>
    </div>
  )
}

interface FreshnessProps {
  run: RunDetail | null
  loading: boolean
}

/** Says what is off about the run on screen; a finished, current run needs no line. */
function Freshness({ run, loading }: FreshnessProps) {
  const line = loading
    ? {
        lead: <Loader animate className='size-[14px] text-[var(--text-icon)]' />,
        text: 'Loading run…',
      }
    : freshnessLine(run)
  if (!line) return null
  return (
    <p className='flex flex-wrap items-center gap-x-2 gap-y-1 text-[var(--text-muted)] text-small'>
      {line.lead}
      <span>{line.text}</span>
    </p>
  )
}

function freshnessLine(run: RunDetail | null): { lead: ReactNode; text: string } | null {
  if (!run) return { lead: null, text: 'Not run yet' }
  if (run.status === 'running') {
    return {
      lead: <Loader animate className='size-[14px] text-[var(--brand-blue)]' />,
      text: 'Running against the latest workflows…',
    }
  }
  const when = formatRelativeTime(run.completedAt ?? run.startedAt)
  if (run.status === 'error') {
    return {
      lead: (
        <Badge variant='red' size='sm'>
          Didn’t finish
        </Badge>
      ),
      text: `${when}: ${run.error ?? 'the run failed'}`,
    }
  }
  if (!run.current) {
    const changed = run.ranAgainst
      .filter((workflow) => workflow.stale)
      .map((workflow) => workflow.name ?? 'A deleted workflow')
    return {
      lead: (
        <Badge variant='amber' size='sm'>
          Out of date
        </Badge>
      ),
      text:
        changed.length > 0
          ? `${changed.join(', ')} changed after this run ${when}`
          : `The test changed after this run ${when}`,
    }
  }
  return null
}

interface WorkflowsSectionProps {
  workflows: RunDetail['ranAgainst']
}

/**
 * Each workflow the run executed and the version it ran, marked when that version is no longer
 * live. A deployed version opens on a read-only canvas.
 */
function WorkflowsSection({ workflows }: WorkflowsSectionProps) {
  const [previewing, setPreviewing] = useState<{
    workflowId: string
    version: number
    title: string
  } | null>(null)
  return (
    <SettingsSection label='Ran against'>
      <Table>
        <TableBody>
          {workflows.map((workflow) => {
            const label = `${workflow.name ?? 'Deleted workflow'}${
              workflow.draft ? ' · Draft' : workflow.version ? ` · v${workflow.version}` : ''
            }`
            const version = workflow.version
            const preview =
              workflow.name !== null && !workflow.draft && version !== null
                ? () => setPreviewing({ workflowId: workflow.workflowId, version, title: label })
                : undefined
            return (
              <TableRow
                key={workflow.workflowId}
                tabIndex={preview ? 0 : undefined}
                onClick={preview}
                onKeyDown={(event) => {
                  if (preview && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault()
                    preview()
                  }
                }}
                className={cn(
                  preview && 'cursor-pointer transition-colors hover:bg-[var(--surface-active)]'
                )}
              >
                <TableCell>{label}</TableCell>
                <TableCell className='text-right'>
                  {workflow.stale && (
                    <Badge variant='amber' size='sm'>
                      Out of date
                    </Badge>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      {previewing && (
        <Suspense fallback={null}>
          <WorkflowVersionPreview {...previewing} onClose={() => setPreviewing(null)} />
        </Suspense>
      )}
    </SettingsSection>
  )
}

interface RunsSectionProps {
  runs: Run[]
  latestRunId: string | null
  selectedRunId: string | null
  onSelect: (runId: string) => void
}

function RunsSection({ runs, latestRunId, selectedRunId, onSelect }: RunsSectionProps) {
  const [showAll, setShowAll] = useState(false)
  const shown = showAll ? runs : runs.slice(0, RUNS_SHOWN)
  return (
    <SettingsSection
      label='Runs'
      action={
        latestRunId !== null && selectedRunId !== latestRunId ? (
          <Chip onClick={() => onSelect(latestRunId)}>View latest</Chip>
        ) : null
      }
    >
      <Table>
        <TableBody>
          {shown.map((run) => (
            <RunRow
              key={run.id}
              run={run}
              latest={run.id === latestRunId}
              selected={run.id === selectedRunId}
              onSelect={() => onSelect(run.id)}
            />
          ))}
        </TableBody>
      </Table>
      {runs.length > RUNS_SHOWN && (
        <Chip className='mt-2 self-start' onClick={() => setShowAll((value) => !value)}>
          {showAll ? 'Show fewer' : `Show all ${runs.length}`}
        </Chip>
      )}
    </SettingsSection>
  )
}

interface RunRowProps {
  run: Run
  latest: boolean
  selected: boolean
  onSelect: () => void
}

/** One run: how it went, how long it took, and when. Opens its results on the page. */
function RunRow({ run, latest, selected, onSelect }: RunRowProps) {
  const result =
    run.status === 'passed' || run.status === 'failed'
      ? `${run.passed} of ${run.passed + run.failed} passed`
      : run.status === 'error'
        ? 'Didn’t finish'
        : 'Running'
  const durationMs = run.completedAt
    ? Date.parse(run.completedAt) - Date.parse(run.startedAt)
    : null
  return (
    <TableRow
      tabIndex={0}
      aria-selected={selected}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        'cursor-pointer transition-colors hover:bg-[var(--surface-active)]',
        selected && 'bg-[var(--surface-active)]',
        !run.current && run.status !== 'running' && 'text-[var(--text-muted)]'
      )}
    >
      <TableCell>
        <span className='flex items-center gap-2'>
          <Badge variant={RUN_BADGE[run.status]} dot size='sm'>
            {result}
          </Badge>
          {latest && (
            <Badge variant='gray-secondary' size='sm'>
              Latest
            </Badge>
          )}
          {run.version === 'draft' && (
            <Badge variant='gray-secondary' size='sm'>
              Draft
            </Badge>
          )}
        </span>
      </TableCell>
      <TableCell className='w-[80px] text-right tabular-nums'>
        {durationMs === null ? '—' : formatDuration(durationMs)}
      </TableCell>
      <TableCell className='w-[100px] text-right tabular-nums'>
        {formatRelativeTime(run.completedAt ?? run.startedAt)}
      </TableCell>
    </TableRow>
  )
}

/** A case's name under its file's one top-level describe. */
function caseName(path: string[]): string {
  return path.slice(1).join(' › ')
}

/** Why a case failed, in the words a reader can act on: the judge's reason, else the message. */
function failureReason(result: CaseResult): string {
  const check = result.checks.find((candidate) => candidate.status === 'fail')
  return check?.judge ?? check?.message ?? result.error?.message ?? 'Failed'
}

interface ElapsedMetricProps {
  startedAt: string
}

/** The running clock: time since the run started, ticking while it goes. */
function ElapsedMetric({ startedAt }: ElapsedMetricProps) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(timer)
  }, [])
  return (
    <Metric
      label='Duration'
      value={formatDuration(Math.max(0, now - Date.parse(startedAt))) ?? '—'}
    />
  )
}

interface MetricProps {
  label: string
  value: string | number
}

function Metric({ label, value }: MetricProps) {
  return (
    <div className='min-w-[min(100%,160px)] flex-1 basis-0'>
      <DashboardMetric
        size='large'
        animated
        maximumFractionDigits={0}
        label={label}
        value={value}
      />
    </div>
  )
}
