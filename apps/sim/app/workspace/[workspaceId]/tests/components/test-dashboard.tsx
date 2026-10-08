'use client'

import { lazy, type ReactNode, Suspense, useEffect, useRef, useState } from 'react'
import {
  Badge,
  cn,
  DashboardMetric,
  scrollFadeAttributes,
  scrollFadeClass,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useScrollEdges,
} from '@sim/emcn'
import { Loader } from '@sim/emcn/icons'
import { formatDuration, formatRelativeTime } from '@sim/utils/formatting'
import type { WorkflowTestDetail } from '@/lib/api/contracts/workflow-tests'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { TestRunPicker } from '@/app/workspace/[workspaceId]/tests/components/test-run-picker'
import { useWorkflowTestRun } from '@/hooks/queries/workflow-tests'
import { testRunSelectionKey, useTestRunSelectionStore } from '@/stores/workflow-tests/store'

const WorkflowVersionPreview = lazy(() =>
  import('@/app/workspace/[workspaceId]/tests/components/workflow-version-preview').then(
    (module) => ({ default: module.WorkflowVersionPreview })
  )
)

const ExecutionSnapshot = lazy(() =>
  import(
    '@/app/workspace/[workspaceId]/logs/components/log-details/components/execution-snapshot/execution-snapshot'
  ).then((module) => ({ default: module.ExecutionSnapshot }))
)

type RunDetail = NonNullable<WorkflowTestDetail['latestRun']>
type CaseResult = NonNullable<RunDetail['report']>['tests'][number]
type CaseState = 'queued' | 'running' | 'pass' | 'fail' | 'skip' | 'none'

const CASE_STATE: Record<
  CaseState,
  { label: string; variant: 'green' | 'red' | 'amber' | 'gray' }
> = {
  queued: { label: 'Queued', variant: 'gray' },
  running: { label: 'Running', variant: 'amber' },
  pass: { label: 'Passed', variant: 'green' },
  fail: { label: 'Failed', variant: 'red' },
  skip: { label: 'Skipped', variant: 'gray' },
  none: { label: 'Not run', variant: 'gray' },
}

interface TestDashboardProps {
  workspaceId: string
  name: string
  detail: WorkflowTestDetail
}

/**
 * How the test is doing in one run (the latest unless the run picker chose another): totals,
 * freshness, every case, and what it ran against. A latest run still going shows live.
 */
export function TestDashboard({ workspaceId, name, detail }: TestDashboardProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const edges = useScrollEdges(scrollRef)
  const selectedRunId =
    useTestRunSelectionStore(
      (state) => state.selectedRunIds[testRunSelectionKey(workspaceId, name)]
    ) ?? null
  const latestRunning = detail.latestRun?.status === 'running'
  const viewedRunId = latestRunning ? null : selectedRunId
  const selected = useWorkflowTestRun(workspaceId, name, viewedRunId)
  const run = viewedRunId ? (selected.data ?? null) : detail.latestRun
  const running = run?.status === 'running'

  const progress = run?.progress ?? {}
  const results = new Map<string, CaseResult>()
  for (const result of run?.report?.tests ?? []) results.set(result.path.join(' > '), result)
  /** A finished run lists the cases it ran; a running or missing one, the file's current cases. */
  const casePaths =
    !running && run?.report
      ? run.report.tests.map((result) => result.path)
      : detail.test.cases.map((testCase) => testCase.path)
  const cases = casePaths.map((path) => {
    const key = path.join(' > ')
    const result = results.get(key)
    const state = caseState(running ? progress[key] : result?.status, running)
    return { key, name: caseName(path), state, result }
  })
  const finished = cases.filter((c) => c.state !== 'queued' && c.state !== 'running').length
  const hasResults = running || Boolean(run?.report)
  const count = (state: CaseState) => cases.filter((testCase) => testCase.state === state).length
  const durationMs = run?.report?.tests.reduce((total, result) => total + result.durationMs, 0)

  return (
    <div
      ref={scrollRef}
      className={cn('@container/dashboard min-h-0 flex-1 overflow-y-auto', scrollFadeClass)}
      {...scrollFadeAttributes(edges)}
    >
      <div className='flex flex-col gap-8 @min-[640px]/dashboard:px-8 px-4 py-6'>
        <div className='flex flex-col gap-4'>
          <div className='-ml-2'>
            <TestRunPicker workspaceId={workspaceId} name={name} detail={detail} />
          </div>
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
                    <Badge variant={CASE_STATE[testCase.state].variant} dot size='sm'>
                      {CASE_STATE[testCase.state].label}
                    </Badge>
                  </TableCell>
                  <TableCell className='text-right align-top tabular-nums'>
                    {testCase.result ? formatDuration(testCase.result.durationMs) : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
      lead: (
        <Badge variant='amber' dot size='sm'>
          Running
        </Badge>
      ),
      text: 'Against the latest workflows',
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

type Previewing =
  | { kind: 'version'; workflowId: string; version: number; title: string }
  | { kind: 'snapshot'; executionId: string }

/**
 * Each workflow the run executed and the version it ran, marked when that version is no longer
 * live. A deployed version opens on a read-only canvas; a draft opens as it was when the run used it.
 */
function WorkflowsSection({ workflows }: WorkflowsSectionProps) {
  const [previewing, setPreviewing] = useState<Previewing | null>(null)
  return (
    <SettingsSection label='Ran against'>
      <Table>
        <TableBody>
          {workflows.map((workflow) => {
            const name = workflow.name ?? 'Deleted workflow'
            const { executionId, version } = workflow
            const preview =
              workflow.name === null
                ? undefined
                : workflow.draft
                  ? executionId === null
                    ? undefined
                    : () => setPreviewing({ kind: 'snapshot', executionId })
                  : version !== null
                    ? () =>
                        setPreviewing({
                          kind: 'version',
                          workflowId: workflow.workflowId,
                          version,
                          title: `${name} · v${version}`,
                        })
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
                <TableCell>
                  <span className='flex items-center gap-2'>
                    {name}
                    {workflow.draft ? (
                      <Badge variant='gray-secondary' size='sm'>
                        Draft
                      </Badge>
                    ) : (
                      version !== null && (
                        <span className='text-[var(--text-muted)]'>v{version}</span>
                      )
                    )}
                  </span>
                </TableCell>
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
      {previewing?.kind === 'version' && (
        <Suspense fallback={null}>
          <WorkflowVersionPreview
            workflowId={previewing.workflowId}
            version={previewing.version}
            title={previewing.title}
            onClose={() => setPreviewing(null)}
          />
        </Suspense>
      )}
      {previewing?.kind === 'snapshot' && (
        <Suspense fallback={null}>
          <ExecutionSnapshot
            executionId={previewing.executionId}
            isModal
            isOpen
            onClose={() => setPreviewing(null)}
          />
        </Suspense>
      )}
    </SettingsSection>
  )
}

/** A case with no status yet is queued while the run goes, and not run once it ended. */
function caseState(status: CaseState | undefined, running: boolean): CaseState {
  return status ?? (running ? 'queued' : 'none')
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
