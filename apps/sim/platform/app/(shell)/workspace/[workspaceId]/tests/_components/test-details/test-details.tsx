'use client'

import { useEffect, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { DataTable, MetricGroup } from '@sim/emcn/data-display'
import { EmptyState } from '@sim/emcn/empty-state'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { InlineNotice, StatusTag } from '@sim/emcn/status'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { toast } from '@/lib/toast/sink'
import { DirectoryHeading } from '@/platform/app/(shell)/_components/resource-directory/resource-directory'
import {
  DetailSection,
  DetailSplit,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/detail-split/detail-split'
import { useMinuteClock } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/resource-table/rename-dialog'
import { formatDuration } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/format'
import type { WorkspaceRead } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/model'
import {
  type CaseState,
  CaseStatus,
} from '@/platform/app/(shell)/workspace/[workspaceId]/tests/_components/test-status/test-status'
import {
  testDetailParsers,
  useRunWorkflowTests,
  useWorkflowTest,
  useWorkflowTestRun,
  useWorkflowTestsAccess,
  type WorkflowTestDetail,
} from '@/platform/lib/data/workflow-tests'
import { platformHref } from '@/platform/lib/navigation'
import { workspacePath } from '@/platform/lib/workspace-navigation'
import { formatRelativeTime } from '@/platform/shared/time'

type RunDetail = NonNullable<WorkflowTestDetail['latestRun']>
type RunSummary = WorkflowTestDetail['history'][number]
type CaseResult = NonNullable<RunDetail['report']>['tests'][number]

/** How often a running clock advances. */
const ELAPSED_TICK_MS = 1000

/** A case's name under its file's one top-level describe. */
function caseName(path: readonly string[]) {
  return path.slice(1).join(' › ')
}

/** A case with no status yet is queued while the run goes, and not run once it ended. */
function caseState(status: CaseState | undefined, running: boolean): CaseState {
  return status ?? (running ? 'queued' : 'none')
}

/** Why a case failed, in the words a reader can act on: the judge's reason, else the message. */
function failureReason(result: CaseResult) {
  const check = result.checks.find((candidate) => candidate.status === 'fail')
  return check?.judge ?? check?.message ?? result.error?.message ?? 'Failed'
}

function runResult(run: RunSummary) {
  if (run.status === 'passed' || run.status === 'failed')
    return `${run.passed}/${run.passed + run.failed}`
  return run.status === 'error' ? 'Didn’t finish' : 'Running'
}

/** What is off about the run on screen; a finished, current run needs no notice. */
function freshness(
  run: RunDetail | null,
  now: number
): { title: string; message: string; intent: 'neutral' | 'warning' | 'danger' } | null {
  if (!run)
    return { title: 'Not run yet', message: 'Run this test to see its results.', intent: 'neutral' }
  if (run.status === 'running')
    return { title: 'Running', message: 'Against the latest workflows', intent: 'warning' }
  const when = formatRelativeTime(Date.parse(run.completedAt ?? run.startedAt), now)
  if (run.status === 'error')
    return {
      title: 'Didn’t finish',
      message: `${when}: ${run.error ?? 'the run failed'}`,
      intent: 'danger',
    }
  if (run.current) return null
  const changed = run.ranAgainst
    .filter((workflow) => workflow.stale)
    .map((workflow) => workflow.name ?? 'A deleted workflow')
  return {
    title: 'Out of date',
    message:
      changed.length > 0
        ? `${changed.join(', ')} changed after this run ${when}`
        : `The test changed after this run ${when}`,
    intent: 'warning',
  }
}

/** The time since a run started, advancing while it goes. */
function useElapsed(startedAt: string | null) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!startedAt) return
    const timer = setInterval(() => setNow(Date.now()), ELAPSED_TICK_MS)
    return () => clearInterval(timer)
  }, [startedAt])
  return startedAt ? Math.max(0, now - Date.parse(startedAt)) : null
}

interface TestDetailsProps {
  workspaceId: string
  name: string
}

/**
 * One test's results in one run, the latest unless the run menu chose another: totals, freshness,
 * every case and the workflows it ran against. A running latest run shows live. Run runs it again
 * against the deployed workflows; the test's source opens in Files, which edits it.
 */
export function TestDetails({ workspaceId, name }: TestDetailsProps) {
  const searchParams = useSearchParams()
  const now = useMinuteClock()
  const { canEdit } = useWorkflowTestsAccess(workspaceId)
  const query = useWorkflowTest(workspaceId, name)
  const runTests = useRunWorkflowTests(workspaceId)
  const [{ run: chosenRunId }, setView] = useQueryStates(testDetailParsers, {
    history: 'replace',
  })
  const detail = query.data
  const latestRunning = detail?.latestRun?.status === 'running'
  const viewedRunId = latestRunning ? null : chosenRunId
  const chosen = useWorkflowTestRun(workspaceId, name, viewedRunId)
  const run = viewedRunId ? (chosen.data ?? null) : (detail?.latestRun ?? null)
  const running = run?.status === 'running'
  const elapsed = useElapsed(running && run ? run.startedAt : null)

  const back = {
    href: platformHref(workspacePath(workspaceId, 'tests'), searchParams),
    label: 'Tests',
  }
  const read: WorkspaceRead = query.isError
    ? {
        status: 'error',
        message: query.error.message,
        retrying: query.isFetching,
        onRetry: () => void query.refetch(),
      }
    : !detail || (viewedRunId && chosen.isPending)
      ? { status: 'pending' }
      : { status: 'ready' }

  if (!detail)
    return (
      <DetailSplit back={back} label={`${name} results`} railLabel='Test facts' read={read}>
        {null}
      </DetailSplit>
    )

  const busy = latestRunning || runTests.isPending
  const latestId = detail.latestRun?.id
  const shownId = latestRunning ? latestId : (chosenRunId ?? latestId)
  const runOptions = detail.history.map((entry) => {
    const when = formatRelativeTime(Date.parse(entry.completedAt ?? entry.startedAt), now)
    const parts = [
      entry.id === latestId ? `Latest · ${when}` : when,
      runResult(entry),
      ...(entry.version === 'draft' ? ['Draft'] : []),
      ...(entry.current ? [] : ['Out of date']),
    ]
    return { value: entry.id, label: parts.join(' · ') }
  })

  const progress = run?.progress ?? {}
  const results = new Map<string, CaseResult>()
  for (const result of run?.report?.tests ?? []) results.set(result.path.join(' > '), result)
  const casePaths =
    !running && run?.report
      ? run.report.tests.map((result) => result.path)
      : detail.test.cases.map((testCase) => testCase.path)
  const cases = casePaths.map((path) => {
    const key = path.join(' > ')
    const result = results.get(key)
    return {
      key,
      name: caseName(path),
      state: caseState(running ? progress[key] : result?.status, running),
      result,
    }
  })
  const hasResults = running || Boolean(run?.report)
  const count = (state: CaseState) =>
    hasResults ? cases.filter((testCase) => testCase.state === state).length.toLocaleString() : '—'
  const durationMs = run?.report?.tests.reduce((total, result) => total + result.durationMs, 0)
  const notice = freshness(run, now)

  const actions = (
    <>
      {runOptions.length > 0 && (
        <ChoiceMenu
          label='Run shown'
          options={runOptions}
          value={shownId}
          disabled={latestRunning}
          disabledReason={latestRunning ? 'The latest run is still going.' : undefined}
          onValueChange={(id) => void setView({ run: id === latestId ? null : id })}
        />
      )}
      <Button
        variant='quiet'
        size='compact'
        icon='I036'
        render={
          <Link
            href={platformHref(
              `${workspacePath(workspaceId, 'files')}/${encodeURIComponent(detail.test.fileId)}`,
              searchParams
            )}
          />
        }
      >
        {canEdit ? 'Edit' : 'View source'}
      </Button>
      <Button
        variant='secondary'
        size='compact'
        icon='play'
        disabled={!canEdit || busy}
        onClick={() =>
          runTests.mutate(
            { version: 'deployed', names: [name] },
            { onError: (error) => toast.error(error.message) }
          )
        }
      >
        {busy ? 'Running…' : 'Run'}
      </Button>
    </>
  )

  return (
    <DetailSplit
      back={back}
      actions={actions}
      label={`${detail.test.title} results`}
      railLabel='Test facts'
      read={read}
    >
      <DirectoryHeading
        title={detail.test.title}
        description={detail.test.description ?? undefined}
      />
      <MetricGroup
        metrics={[
          { label: 'Passing', value: count('pass') },
          { label: 'Failing', value: count('fail') },
          {
            label: 'Duration',
            value: running ? formatDuration(elapsed) : formatDuration(durationMs),
          },
        ]}
      />
      {notice && (
        <InlineNotice title={notice.title} message={notice.message} intent={notice.intent} />
      )}
      <DetailSection title='Cases'>
        {cases.length === 0 ? (
          <EmptyState title='No cases yet' />
        ) : (
          <DataTable
            title='Cases'
            titleHidden
            columns={[
              { key: 'name', label: 'Test', kind: 'text', primary: true },
              { key: 'status', label: 'Status', kind: 'status', width: 'compact' },
              { key: 'reason', label: 'Reason', kind: 'text', showFrom: 'compact' },
              { key: 'duration', label: 'Duration', kind: 'text', width: 'compact' },
            ]}
            rows={cases.map((testCase) => {
              const reason =
                testCase.state === 'fail' && testCase.result ? failureReason(testCase.result) : null
              return {
                id: testCase.key,
                values: {
                  name: testCase.name,
                  reason,
                  duration: testCase.result ? formatDuration(testCase.result.durationMs) : null,
                },
                cells: { status: <CaseStatus state={testCase.state} /> },
              }
            })}
          />
        )}
      </DetailSection>
      {!running && run && run.ranAgainst.length > 0 && (
        <DetailSection title='Ran against'>
          <DataTable
            title='Ran against'
            titleHidden
            rowChevron
            columns={[
              { key: 'name', label: 'Workflow', kind: 'text', primary: true },
              { key: 'version', label: 'Version', kind: 'text', width: 'compact' },
              { key: 'state', label: 'State', kind: 'status', width: 'compact' },
            ]}
            rows={run.ranAgainst.map((workflow) => ({
              id: workflow.workflowId,
              values: {
                name: workflow.name ?? 'Deleted workflow',
                version: workflow.draft
                  ? 'Draft'
                  : workflow.version === null
                    ? null
                    : `v${workflow.version}`,
              },
              cells: {
                state: workflow.stale ? <StatusTag label='Out of date' intent='warning' /> : null,
              },
              href:
                workflow.name === null
                  ? undefined
                  : platformHref(
                      `${workspacePath(workspaceId, 'workflows')}/${encodeURIComponent(workflow.workflowId)}`,
                      searchParams
                    ),
            }))}
          />
        </DetailSection>
      )}
    </DetailSplit>
  )
}
