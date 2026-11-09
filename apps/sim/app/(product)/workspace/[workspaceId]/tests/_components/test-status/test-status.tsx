import { StatusTag } from '@sim/emcn/status'
import type { WorkflowTestRecord } from '@/platform/lib/data/workflow-tests'

type Intent = 'neutral' | 'warning' | 'success' | 'danger'

const TEST_STATUS: Record<WorkflowTestRecord['status'], { label: string; intent: Intent }> = {
  passing: { label: 'Passed', intent: 'success' },
  failing: { label: 'Failed', intent: 'danger' },
  error: { label: 'Didn’t run', intent: 'danger' },
  running: { label: 'Running', intent: 'warning' },
  changed: { label: 'Changed', intent: 'neutral' },
  not_run: { label: 'Not run', intent: 'neutral' },
}

/** A test's latest outcome, as legacy's badge named it. */
export function TestStatus({ status }: { status: WorkflowTestRecord['status'] }) {
  const config = TEST_STATUS[status]
  return <StatusTag label={config.label} intent={config.intent} live={status === 'running'} />
}

export type CaseState = 'queued' | 'running' | 'pass' | 'fail' | 'skip' | 'none'

const CASE_STATE: Record<CaseState, { label: string; intent: Intent }> = {
  queued: { label: 'Queued', intent: 'neutral' },
  running: { label: 'Running', intent: 'warning' },
  pass: { label: 'Passed', intent: 'success' },
  fail: { label: 'Failed', intent: 'danger' },
  skip: { label: 'Skipped', intent: 'neutral' },
  none: { label: 'Not run', intent: 'neutral' },
}

/** One case's outcome in the run on screen. */
export function CaseStatus({ state }: { state: CaseState }) {
  const config = CASE_STATE[state]
  return <StatusTag label={config.label} intent={config.intent} />
}
