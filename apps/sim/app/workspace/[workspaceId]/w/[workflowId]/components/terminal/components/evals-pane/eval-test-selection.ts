import type { WorkflowEvalSuite, WorkflowEvalTestRun } from '@/lib/api/contracts/workflow-evals'

export interface EvalTestSelectionKey {
  suiteId: string
  runId: string
  testId: string
}

export interface EvalTestSelection {
  suiteId: string
  runId: string
  testRun: WorkflowEvalTestRun
  description: string
}

export function getEvalTestSelectionKey(selection: EvalTestSelection): EvalTestSelectionKey {
  return {
    suiteId: selection.suiteId,
    runId: selection.runId,
    testId: selection.testRun.testId,
  }
}

export function getEvalTestRunDescription(testRun: WorkflowEvalTestRun): string {
  if (testRun.phase === 'error') return testRun.error?.message ?? `${testRun.name}: Error`
  if (testRun.reason) return testRun.reason
  if (testRun.phase === 'completed' && testRun.outcome === 'pass' && testRun.score !== null) {
    return `Passed with a score of ${testRun.score}/10.`
  }
  return `${testRun.name}: ${testRun.phase === 'completed' ? 'Result available' : 'Running'}`
}

export function resolveEvalTestSelection(
  suites: readonly WorkflowEvalSuite[],
  key: EvalTestSelectionKey | null
): EvalTestSelection | null {
  if (!key) return null
  const suite = suites.find((candidate) => candidate.id === key.suiteId)
  if (!suite) return null
  const run = [suite.latestRun, suite.latestSuiteRun].find(
    (candidate) => candidate?.id === key.runId
  )
  const testRun = run?.testRuns.find((candidate) => candidate.testId === key.testId)
  if (!testRun) return null
  return {
    suiteId: key.suiteId,
    runId: key.runId,
    testRun,
    description: getEvalTestRunDescription(testRun),
  }
}
