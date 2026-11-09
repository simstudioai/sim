'use client'

import { useEffect, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { DataTable, MetricGroup } from '@sim/emcn/data-display'
import { EmptyState } from '@sim/emcn/empty-state'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { InlineNotice, StatusText } from '@sim/emcn/status'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import type { PreviewMode } from '@/components/file-viewer/types'
import { workspacePath } from '@/lib/navigation/paths'
import { toast } from '@/lib/toast/sink'
import { DirectoryHeading } from '@/app/(product)/_components/resource-directory/resource-directory'
import {
  DetailSection,
  DetailSplit,
} from '@/app/(product)/workspace/[workspaceId]/_components/detail-split/detail-split'
import { useMinuteClock } from '@/app/(product)/workspace/[workspaceId]/_components/resource-table/rename-dialog'
import { formatDuration } from '@/app/(product)/workspace/[workspaceId]/_components/workspace-session/format'
import type { WorkspaceRead } from '@/app/(product)/workspace/[workspaceId]/_components/workspace-session/model'
import {
  type CaseState,
  CaseStatus,
} from '@/app/(product)/workspace/[workspaceId]/tests/_components/test-status/test-status'
import {
  testDetailParsers,
  useRunWorkflowTests,
  useWorkflowTest,
  useWorkflowTestRun,
  useWorkflowTestsAccess,
  type WorkflowTestDetail,
} from '@/platform/lib/data/workflow-tests'
import { platformHref } from '@/platform/lib/navigation'
import { TEST_RETURN_PARAM } from '@/platform/shared/test-return'
import { formatRelativeTime } from '@/platform/shared/time'

type RunDetail = NonNullable<WorkflowTestDetail['latestRun']>
type RunSummary = WorkflowTestDetail['history'][number]
type CaseResult = NonNullable<RunDetail['report']>['tests'][number]

/** How often a running clock advances. */
const ELAPSED_TICK_MS = 1000

const TestSource = dynamic(
  () =>
    import(
      '@/app/(product)/workspace/[workspaceId]/tests/_components/test-source/test-source'
    ).then((module) => module.TestSource),
  { ssr: false }
)

/**
 * The layout one press of the layout action moves to, as legacy's test page cycled: results, then
 * the source alone, then the source beside the results, then back to the results.
 */
function nextLayoutAction(layout: PreviewMode, canEdit: boolean) {
  if (layout === 'editor') return { label: 'Split', icon: 'I038' as const, next: 'split' as const }
  if (layout === 'split')
    return { label: 'Preview', icon: 'eye' as const, next: 'preview' as const }
  return {
    label: canEdit ? 'Edit' : 'View source',
    icon: 'I036' as const,
    next: 'editor' as const,
  }
}

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

/**
 * The workflow frozen as the run executed it, returning here: a deployed version as deployed, a
 * draft as the run snapshot recorded it. A deleted workflow, or a draft run with no recorded
 * execution, has nothing to open.
 */
function frozenWorkflowHref(
  workspaceId: string,
  testName: string,
  workflow: RunDetail['ranAgainst'][number],
  search: Parameters<typeof platformHref>[1]
) {
  if (workflow.name === null) return undefined
  const path = workflow.draft
    ? workflow.executionId === null
      ? null
      : `workflows/runs/${encodeURIComponent(workflow.executionId)}`
    : workflow.version === null
      ? null
      : `workflows/${encodeURIComponent(workflow.workflowId)}/versions/${workflow.version}`
  if (path === null) return undefined
  return platformHref(
    `${workspacePath(workspaceId, path)}?${TEST_RETURN_PARAM}=${encodeURIComponent(testName)}`,
    search
  )
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
 * against the deployed workflows. The layout action cycles the results, the test's source alone in
 * the Files editor, and the source beside the results; the layout lasts while the page is open, and
 * Run waits while the open source holds unsaved edits. A workflow it ran against opens frozen at
 * that version.
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
  const [layout, setLayout] = useState<PreviewMode>('preview')
  const [sourceDirty, setSourceDirty] = useState(false)
  const unsaved = layout !== 'preview' && sourceDirty

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
      <DetailSplit back={back} label={`${name} results`} railLabel='Test source' read={read}>
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
  const layoutAction = nextLayoutAction(layout, canEdit)

  const actions = (
    <>
      {layout !== 'editor' && runOptions.length > 0 && (
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
        icon={layoutAction.icon}
        onClick={() => {
          setLayout(layoutAction.next)
          setSourceDirty(false)
        }}
      >
        {layoutAction.label}
      </Button>
      <Button
        variant='secondary'
        size='compact'
        icon='play'
        disabled={!canEdit || busy || unsaved}
        disabledReason={unsaved && !busy ? 'The test has unsaved changes.' : undefined}
        onClick={() =>
          runTests.mutate(
            { version: 'deployed', names: [name] },
            { onError: (error) => toast.error(error.message) }
          )
        }
      >
        {busy ? 'Running…' : unsaved ? 'Unsaved' : 'Run'}
      </Button>
    </>
  )

  const heading = (
    <DirectoryHeading
      title={detail.test.title}
      description={detail.test.description ?? undefined}
    />
  )

  if (layout === 'editor')
    return (
      <DetailSplit
        back={back}
        actions={actions}
        label={`${detail.test.title} source`}
        railLabel='Test source'
        read={read}
        content='editor'
      >
        {heading}
        <TestSource
          workspaceId={workspaceId}
          name={name}
          fileId={detail.test.fileId}
          canEdit={canEdit}
          placement='page'
          onDirtyChange={setSourceDirty}
        />
      </DetailSplit>
    )

  return (
    <DetailSplit
      back={back}
      actions={actions}
      label={`${detail.test.title} results`}
      rail={
        layout === 'split' && (
          <TestSource
            workspaceId={workspaceId}
            name={name}
            fileId={detail.test.fileId}
            canEdit={canEdit}
            placement='rail'
            onDirtyChange={setSourceDirty}
          />
        )
      }
      railKind='inspector'
      railLabel='Test source'
      read={read}
    >
      {heading}
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
                state: workflow.stale ? <StatusText label='Out of date' intent='warning' /> : null,
              },
              href: frozenWorkflowHref(workspaceId, name, workflow, searchParams),
            }))}
          />
        </DetailSection>
      )}
    </DetailSplit>
  )
}
