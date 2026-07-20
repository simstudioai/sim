/**
 * @vitest-environment jsdom
 */
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  WorkflowEvalCriterionPhase,
  WorkflowEvalEvaluatorType,
  WorkflowEvalOutcome,
  WorkflowEvalSuite,
  WorkflowEvalTestPhase,
  WorkflowEvalTestRun,
  WorkflowEvalTestSummary,
} from '@/lib/api/contracts/workflow-evals'
import type { EvalTestSelection } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/components/evals-pane/eval-test-details-modal'
import { TerminalEvalsPane } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/components/evals-pane/evals-pane'

const EVAL_SUITE_LIST_WIDTH_PX = 106

class ResizeObserverMock {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void {
    const entry = {
      target,
      contentRect: new DOMRect(0, 0, EVAL_SUITE_LIST_WIDTH_PX, 20),
    } as ResizeObserverEntry
    this.callback([entry], this as unknown as ResizeObserver)
  }

  disconnect(): void {}

  unobserve(): void {}
}

function criterionId(testId: string): string {
  return `criterion-${testId}`
}

function criterionName(testName: string): string {
  return `${testName} criterion`
}

function testSummary({
  testId,
  name,
  evaluatorType,
}: {
  testId: string
  name: string
  evaluatorType: WorkflowEvalEvaluatorType
}): WorkflowEvalTestSummary {
  if (evaluatorType === 'agent') {
    return {
      id: testId,
      name,
      evaluatorType,
      criteria: [{ id: criterionId(testId), name: criterionName(name) }],
    }
  }
  if (evaluatorType === 'code') return { id: testId, name, evaluatorType }
  return { id: testId, name, evaluatorType }
}

function criterionPhaseForTest(phase: WorkflowEvalTestPhase): WorkflowEvalCriterionPhase {
  if (phase === 'completed') return 'completed'
  if (phase === 'running_evaluator') return 'running'
  return 'queued'
}

function testRun({
  id,
  testId,
  name,
  evaluatorType,
  phase,
  outcome = null,
  score = null,
}: {
  id: string
  testId: string
  name: string
  evaluatorType: WorkflowEvalEvaluatorType
  phase: WorkflowEvalTestPhase
  outcome?: WorkflowEvalOutcome | null
  score?: number | null
}): WorkflowEvalTestRun {
  const error =
    phase === 'error'
      ? {
          kind: 'evaluator' as const,
          code: 'test_evaluator_error',
          message: `${name} evaluator failed`,
        }
      : null
  const base = {
    id,
    testId,
    ordinal: 0,
    name,
    phase,
    outcome,
    score,
    reason:
      outcome === 'fail' || outcome === 'warning' ? `${name} did not satisfy its assertion.` : null,
    errorBlockIds: [`block-${testId}`],
    subjectExecutionId: `execution-${testId}`,
    judgeExecutionId: evaluatorType === 'workflow' ? `judge-execution-${testId}` : null,
    error,
  }

  if (evaluatorType === 'agent') {
    const criterionPhase = criterionPhaseForTest(phase)
    return {
      ...base,
      evaluatorType,
      criteria: [
        {
          id: `criterion-run-${testId}`,
          criterionId: criterionId(testId),
          ordinal: 0,
          name: criterionName(name),
          phase: criterionPhase,
          verdict: criterionPhase === 'completed' ? outcome : null,
          confidence: criterionPhase === 'completed' ? 0.9 : null,
          reason: criterionPhase === 'completed' ? `${criterionName(name)} result.` : null,
          error: null,
        },
      ],
    }
  }
  if (evaluatorType === 'code') return { ...base, evaluatorType, criteria: [] }
  return { ...base, evaluatorType, criteria: [] }
}

const COMPLETED_TESTS = [
  testSummary({ testId: 'test-code-pass', name: 'Code pass', evaluatorType: 'code' }),
  testSummary({ testId: 'test-code-fail', name: 'Code fail', evaluatorType: 'code' }),
  testSummary({ testId: 'test-code-error', name: 'Code error', evaluatorType: 'code' }),
  testSummary({ testId: 'test-agent-pass', name: 'Agent pass', evaluatorType: 'agent' }),
  testSummary({ testId: 'test-agent-fail', name: 'Agent fail', evaluatorType: 'agent' }),
  testSummary({
    testId: 'test-workflow-pass',
    name: 'Workflow pass',
    evaluatorType: 'workflow',
  }),
]

const COMPLETED_TEST_RUNS = [
  testRun({
    id: 'test-run-code-pass',
    testId: 'test-code-pass',
    name: 'Code pass',
    evaluatorType: 'code',
    phase: 'completed',
    outcome: 'pass',
    score: 10,
  }),
  testRun({
    id: 'test-run-code-fail',
    testId: 'test-code-fail',
    name: 'Code fail',
    evaluatorType: 'code',
    phase: 'completed',
    outcome: 'fail',
    score: 0,
  }),
  testRun({
    id: 'test-run-code-error',
    testId: 'test-code-error',
    name: 'Code error',
    evaluatorType: 'code',
    phase: 'error',
  }),
  testRun({
    id: 'test-run-agent-pass',
    testId: 'test-agent-pass',
    name: 'Agent pass',
    evaluatorType: 'agent',
    phase: 'completed',
    outcome: 'pass',
    score: 10,
  }),
  testRun({
    id: 'test-run-agent-fail',
    testId: 'test-agent-fail',
    name: 'Agent fail',
    evaluatorType: 'agent',
    phase: 'completed',
    outcome: 'fail',
    score: 0,
  }),
  testRun({
    id: 'test-run-workflow-pass',
    testId: 'test-workflow-pass',
    name: 'Workflow pass',
    evaluatorType: 'workflow',
    phase: 'completed',
    outcome: 'pass',
    score: 10,
  }),
].map((run, ordinal) => ({ ...run, ordinal }))

const COMPLETED_SUITE: WorkflowEvalSuite = {
  id: 'suite-completed',
  name: 'Customer support',
  definitionRevision: 1,
  archivedAt: null,
  tests: COMPLETED_TESTS,
  testCount: COMPLETED_TESTS.length,
  latestRun: {
    id: 'run-completed',
    scope: 'suite',
    selectedTestId: null,
    suiteDefinitionRevision: 1,
    status: 'completed',
    revision: 9,
    completedCount: COMPLETED_TESTS.length,
    passedCount: 3,
    warningCount: 0,
    failedCount: 2,
    errorCount: 1,
    totalCount: COMPLETED_TESTS.length,
    createdAt: new Date('2026-07-15T11:59:00.000Z'),
    updatedAt: new Date('2026-07-15T12:01:00.000Z'),
    startedAt: new Date('2026-07-15T12:00:00.000Z'),
    completedAt: new Date('2026-07-15T12:01:00.000Z'),
    error: null,
    tests: COMPLETED_TESTS,
    testRuns: COMPLETED_TEST_RUNS,
  },
  latestSuiteRun: null,
}

const RUNNING_TESTS = [
  testSummary({ testId: 'test-finished', name: 'Finished test', evaluatorType: 'code' }),
  testSummary({ testId: 'test-active', name: 'Active test', evaluatorType: 'agent' }),
  testSummary({ testId: 'test-waiting-1', name: 'Waiting test one', evaluatorType: 'agent' }),
  testSummary({
    testId: 'test-waiting-2',
    name: 'Waiting test two',
    evaluatorType: 'workflow',
  }),
]

const RUNNING_TEST_RUNS = [
  testRun({
    id: 'test-run-finished',
    testId: 'test-finished',
    name: 'Finished test',
    evaluatorType: 'code',
    phase: 'completed',
    outcome: 'pass',
    score: 10,
  }),
  testRun({
    id: 'test-run-active',
    testId: 'test-active',
    name: 'Active test',
    evaluatorType: 'agent',
    phase: 'running_evaluator',
  }),
  testRun({
    id: 'test-run-waiting-1',
    testId: 'test-waiting-1',
    name: 'Waiting test one',
    evaluatorType: 'agent',
    phase: 'queued',
  }),
  testRun({
    id: 'test-run-waiting-2',
    testId: 'test-waiting-2',
    name: 'Waiting test two',
    evaluatorType: 'workflow',
    phase: 'queued',
  }),
].map((run, ordinal) => ({ ...run, ordinal }))

const RUNNING_SUITE: WorkflowEvalSuite = {
  id: 'suite-running',
  name: 'Regression',
  definitionRevision: 1,
  archivedAt: null,
  tests: RUNNING_TESTS,
  testCount: RUNNING_TESTS.length,
  latestRun: {
    id: 'run-running',
    scope: 'suite',
    selectedTestId: null,
    suiteDefinitionRevision: 1,
    status: 'running',
    revision: 3,
    completedCount: 1,
    passedCount: 1,
    warningCount: 0,
    failedCount: 0,
    errorCount: 0,
    totalCount: RUNNING_TESTS.length,
    createdAt: new Date('2026-07-15T12:01:00.000Z'),
    updatedAt: new Date('2026-07-15T12:02:00.000Z'),
    startedAt: new Date('2026-07-15T12:02:00.000Z'),
    completedAt: null,
    error: null,
    tests: RUNNING_TESTS,
    testRuns: RUNNING_TEST_RUNS,
  },
  latestSuiteRun: null,
}

const CANCELLED_SUITE: WorkflowEvalSuite = {
  ...RUNNING_SUITE,
  latestRun: {
    ...RUNNING_SUITE.latestRun!,
    status: 'cancelled',
    completedAt: new Date('2026-07-15T12:02:30.000Z'),
  },
}

const ERRORED_SUITE: WorkflowEvalSuite = {
  ...RUNNING_SUITE,
  latestRun: {
    ...RUNNING_SUITE.latestRun!,
    status: 'error',
    completedAt: new Date('2026-07-15T12:02:30.000Z'),
    error: {
      kind: 'infrastructure',
      code: 'eval_run_failed',
      message: 'The Eval coordinator failed',
    },
  },
}

const NOT_RUN_SUITE: WorkflowEvalSuite = {
  id: 'suite-not-run',
  name: 'Fresh suite',
  definitionRevision: 1,
  archivedAt: null,
  tests: RUNNING_TESTS,
  testCount: RUNNING_TESTS.length,
  latestRun: null,
  latestSuiteRun: null,
}

const WARNING_TEST = testSummary({
  testId: 'test-agent-warning',
  name: 'Agent warning',
  evaluatorType: 'agent',
})

const WARNING_SUITE: WorkflowEvalSuite = {
  id: 'suite-warning',
  name: 'Warning suite',
  definitionRevision: 1,
  archivedAt: null,
  tests: [WARNING_TEST],
  testCount: 1,
  latestRun: {
    id: 'run-warning',
    scope: 'suite',
    selectedTestId: null,
    suiteDefinitionRevision: 1,
    status: 'completed',
    revision: 2,
    completedCount: 1,
    passedCount: 0,
    warningCount: 1,
    failedCount: 0,
    errorCount: 0,
    totalCount: 1,
    createdAt: new Date('2026-07-15T12:00:00.000Z'),
    updatedAt: new Date('2026-07-15T12:01:00.000Z'),
    startedAt: new Date('2026-07-15T12:00:00.000Z'),
    completedAt: new Date('2026-07-15T12:01:00.000Z'),
    error: null,
    tests: [WARNING_TEST],
    testRuns: [
      testRun({
        id: 'test-run-agent-warning',
        testId: 'test-agent-warning',
        name: 'Agent warning',
        evaluatorType: 'agent',
        phase: 'completed',
        outcome: 'warning',
        score: 7,
      }),
    ],
  },
  latestSuiteRun: null,
}

interface HarnessProps {
  suites: WorkflowEvalSuite[]
  startingSuiteId?: string | null
  isRetryingTest?: boolean
  onRunSuite?: (suiteId: string) => void
  onStopRun?: (suiteId: string, runId: string) => void
  onRetryTest?: (suiteId: string, testId: string, expectedDefinitionRevision: number) => void
  onShowDetails?: (selection: EvalTestSelection) => void
  onFocusErrorBlocks?: (blockIds: readonly string[]) => void
}

function Harness({
  suites,
  startingSuiteId = null,
  isRetryingTest = false,
  onRunSuite = vi.fn(),
  onStopRun = vi.fn(),
  onRetryTest = vi.fn(),
  onShowDetails = vi.fn(),
  onFocusErrorBlocks = vi.fn(),
}: HarnessProps) {
  const [selectedTest, setSelectedTest] = useState<EvalTestSelection | null>(null)

  return (
    <TerminalEvalsPane
      suites={suites}
      isLoading={false}
      error={null}
      startingSuiteId={startingSuiteId}
      stoppingRunId={null}
      selectedTest={selectedTest}
      isRetryingTest={isRetryingTest}
      onRunSuite={onRunSuite}
      onStopRun={onStopRun}
      onRetryTest={onRetryTest}
      onShowDetails={onShowDetails}
      onSelectionChange={setSelectedTest}
      onFocusErrorBlocks={onFocusErrorBlocks}
    />
  )
}

function getStatusGroup(suiteName: string): HTMLElement {
  const group = container.querySelector<HTMLElement>(
    `[role="group"][aria-label="${suiteName} test statuses"]`
  )
  if (!group) throw new Error(`Missing status group for ${suiteName}`)
  return group
}

function getIndicator(group: HTMLElement, testId: string): SVGSVGElement {
  const wrapper = group.querySelector<HTMLElement>(`[data-test-id="${testId}"]`)
  if (!wrapper) throw new Error(`Missing status wrapper for ${testId}`)
  const indicator = wrapper.querySelector<SVGSVGElement>('svg[data-eval-status]')
  if (!indicator) throw new Error(`Missing status indicator for ${testId}`)
  return indicator
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 0, EVAL_SUITE_LIST_WIDTH_PX, 20)
  )
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('TerminalEvalsPane', () => {
  it('renders suite summaries with the running shimmer on the suite name only', () => {
    act(() => root.render(<Harness suites={[COMPLETED_SUITE, RUNNING_SUITE]} />))

    expect(container.textContent).toContain('Customer support')
    expect(container.textContent).toContain('3/6')
    expect(container.textContent).toContain('Regression')
    expect(container.textContent).toContain('1/4')
    expect(container.textContent).not.toContain('Running…')
    expect(container.querySelector('[data-eval-suite-name-running="true"]')?.textContent).toBe(
      'Regression'
    )
    expect(
      container.querySelector<HTMLButtonElement>('[aria-label="Stop Regression"]')?.disabled
    ).toBe(false)
    const runningControls = container.querySelector<HTMLElement>(
      '[data-eval-suite-controls="suite-running"]'
    )
    const runningSummary = container.querySelector<HTMLElement>(
      '[data-eval-suite-summary="suite-running"]'
    )
    const runningStopButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Stop Regression"]'
    )
    const runningCollapseButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Collapse Regression"]'
    )
    expect(runningStopButton?.parentElement).toBe(runningControls)
    expect(runningCollapseButton?.parentElement).toBe(runningControls)
    expect(runningControls?.children[0]).toBe(runningStopButton)
    expect(runningControls?.children[1]?.textContent).toBe('Regression')
    expect(runningControls?.children[2]).toBe(runningCollapseButton)
    expect(runningControls?.nextElementSibling).toBe(runningSummary)
    expect(runningSummary?.className).toContain('ml-auto')
    expect(container.querySelectorAll('[aria-expanded="true"]')).toHaveLength(4)
    expect(container.querySelectorAll('[aria-controls]')).toHaveLength(4)

    const completedGroup = getStatusGroup('Customer support')
    const runningGroup = getStatusGroup('Regression')
    expect(completedGroup.querySelectorAll('[data-test-id] svg[data-eval-status]')).toHaveLength(
      COMPLETED_TESTS.length
    )
    expect(runningGroup.querySelectorAll('[data-test-id] svg[data-eval-status]')).toHaveLength(
      RUNNING_TESTS.length
    )
    expect(completedGroup.querySelectorAll('[data-eval-status-filler]')).toHaveLength(4)
    expect(runningGroup.querySelectorAll('[data-eval-status-filler]')).toHaveLength(1)
    expect(completedGroup.querySelectorAll('[data-eval-status-filler-spacer]')).toHaveLength(1)
    expect(runningGroup.querySelectorAll('[data-eval-status-filler-spacer]')).toHaveLength(4)
    expect(completedGroup.querySelectorAll('filter')).toHaveLength(0)
    expect(runningGroup.querySelectorAll('filter')).toHaveLength(1)
    expect(completedGroup.querySelectorAll('[data-test-id]')).toHaveLength(COMPLETED_TESTS.length)
    expect(runningGroup.querySelectorAll('[data-test-id]')).toHaveLength(RUNNING_TESTS.length)
  })

  it('maps code, workflow, and agent results to their visual states', () => {
    act(() => root.render(<Harness suites={[COMPLETED_SUITE, WARNING_SUITE]} />))

    const group = getStatusGroup('Customer support')
    expect(getIndicator(group, 'test-code-pass').dataset.evalStatus).toBe('complete')
    expect(getIndicator(group, 'test-code-fail').dataset.evalStatus).toBe('failed')
    expect(getIndicator(group, 'test-code-error').dataset.evalStatus).toBe('failed')
    expect(getIndicator(group, 'test-agent-pass').dataset.evalStatus).toBe('complete')
    expect(getIndicator(group, 'test-agent-fail').dataset.evalStatus).toBe('failed')
    expect(getIndicator(group, 'test-workflow-pass').dataset.evalStatus).toBe('complete')
    const agentWarning = getIndicator(getStatusGroup('Warning suite'), 'test-agent-warning')
    expect(agentWarning.dataset.evalStatus).toBe('partial-success')
    expect(agentWarning.querySelectorAll('circle')).toHaveLength(2)
    expect(agentWarning.querySelectorAll('path')).toHaveLength(0)
  })

  it('shows only the test name in a tooltip', () => {
    act(() => root.render(<Harness suites={[COMPLETED_SUITE]} />))

    const group = getStatusGroup('Customer support')
    const trigger = group.querySelector<HTMLElement>('[data-test-id="test-code-pass"]')
    if (!trigger) throw new Error('Missing tooltip trigger for test-code-pass')

    act(() =>
      trigger.dispatchEvent(
        new MouseEvent('pointerover', { bubbles: true, clientX: 20, clientY: 20 })
      )
    )

    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')
    expect(tooltip?.textContent).toBe('Code pass')
  })

  it('shows the failure reason and carries the affected block ids', () => {
    act(() => root.render(<Harness suites={[COMPLETED_SUITE]} />))

    const group = getStatusGroup('Customer support')
    const trigger = group.querySelector<HTMLElement>('[data-test-id="test-code-fail"]')
    if (!trigger) throw new Error('Missing tooltip trigger for test-code-fail')

    act(() =>
      trigger.dispatchEvent(
        new MouseEvent('pointerover', { bubbles: true, clientX: 20, clientY: 20 })
      )
    )

    const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')
    expect(tooltip?.textContent).toBe('Code fail')
    expect(trigger.dataset.errorBlockIds).toBe('block-test-code-fail')
  })

  it('lifts and enlarges a hovered dot above its neighbors', () => {
    act(() => root.render(<Harness suites={[COMPLETED_SUITE]} />))

    const group = getStatusGroup('Customer support')
    const trigger = group.querySelector<HTMLElement>('[data-test-id="test-code-pass"]')
    if (!trigger) throw new Error('Missing hover target for test-code-pass')
    const indicator = getIndicator(group, 'test-code-pass')

    expect(group.className).toContain('isolate')
    expect(trigger.className).toContain('hover:z-10')
    expect(trigger.className).toContain('bg-[var(--eval-status-mask)]')
    expect(indicator.getAttribute('class')).toContain('group-hover/dot:-translate-y-px')
    expect(indicator.getAttribute('class')).toContain('group-hover/dot:scale-[1.2]')
    expect(indicator.getAttribute('class')).toContain('transition-transform')
  })

  it('pads the fixed-spacing strip with decorative outlines before and after wrapping', () => {
    act(() => root.render(<Harness suites={[NOT_RUN_SUITE]} />))

    const group = getStatusGroup('Fresh suite')
    expect(group.className).toContain('w-full')
    expect(group.className).toContain('flex-wrap')
    expect(group.className).not.toContain('justify-between')
    expect(group.querySelectorAll('[data-test-id] [data-eval-status="pending"]')).toHaveLength(
      RUNNING_TESTS.length
    )
    const fillers = group.querySelectorAll('[data-eval-status-filler]')
    expect(fillers).toHaveLength(1)
    const fillerViewport = group.querySelector<HTMLElement>('[data-eval-status-filler-viewport]')
    const fillerRail = group.querySelector<HTMLElement>('[data-eval-status-filler-rail]')
    expect(fillerViewport?.getAttribute('aria-hidden')).toBe('true')
    expect(fillerViewport?.className).toContain('absolute')
    expect(fillerViewport?.className).toContain('overflow-hidden')
    expect(fillerRail?.className).toContain('absolute')
    expect(fillerRail?.className).toContain('left-0')
    expect(fillerRail?.className).not.toContain('right-0')
    expect(group.querySelectorAll('[data-eval-status-filler-spacer]')).toHaveLength(
      RUNNING_TESTS.length
    )
    expect(fillers[0].querySelector('svg')?.getAttribute('role')).toBeNull()
  })

  it('runs only the first unresolved test and leaves later tests pending', () => {
    act(() => root.render(<Harness suites={[RUNNING_SUITE]} />))

    const group = getStatusGroup('Regression')
    expect(getIndicator(group, 'test-finished').dataset.evalStatus).toBe('complete')
    expect(getIndicator(group, 'test-active').dataset.evalStatus).toBe('progress')
    expect(getIndicator(group, 'test-waiting-1').dataset.evalStatus).toBe('pending')
    expect(getIndicator(group, 'test-waiting-2').dataset.evalStatus).toBe('pending')
    expect(group.querySelectorAll('[data-eval-status="progress"]')).toHaveLength(1)
    expect(group.querySelectorAll('filter')).toHaveLength(1)
    expect(getIndicator(group, 'test-active').querySelectorAll('rect')).toHaveLength(2)
  })

  it('immediately removes every running animation from a cancelled suite', () => {
    act(() => root.render(<Harness suites={[CANCELLED_SUITE]} />))

    const group = getStatusGroup('Regression')
    expect(container.querySelector('[data-eval-suite-name-running="true"]')).toBeNull()
    expect(container.querySelector('[data-eval-suite-summary="suite-running"]')?.textContent).toBe(
      'Cancelled'
    )
    expect(container.querySelector('[aria-label="Run Regression"]')).not.toBeNull()
    expect(group.querySelectorAll('[data-eval-status="progress"]')).toHaveLength(0)
    expect(group.querySelectorAll('filter')).toHaveLength(0)
    expect(getIndicator(group, 'test-active').dataset.evalStatus).toBe('pending')
    expect(getIndicator(group, 'test-waiting-1').dataset.evalStatus).toBe('pending')
    expect(getIndicator(group, 'test-waiting-2').dataset.evalStatus).toBe('pending')
  })

  it('immediately removes every running animation when the run fails', () => {
    act(() => root.render(<Harness suites={[ERRORED_SUITE]} />))

    const group = getStatusGroup('Regression')
    expect(container.querySelector('[data-eval-suite-name-running="true"]')).toBeNull()
    expect(container.querySelector('[data-eval-suite-summary="suite-running"]')?.textContent).toBe(
      'Run failed'
    )
    expect(container.querySelector('[aria-label="Run Regression"]')).not.toBeNull()
    expect(group.querySelectorAll('[data-eval-status="progress"]')).toHaveLength(0)
    expect(group.querySelectorAll('filter')).toHaveLength(0)
    expect(getIndicator(group, 'test-active').dataset.evalStatus).toBe('partial-failure')
    expect(getIndicator(group, 'test-waiting-1').dataset.evalStatus).toBe('pending')
    expect(getIndicator(group, 'test-waiting-2').dataset.evalStatus).toBe('pending')
  })

  it('overlays a test-scoped run without replacing the complete-suite baseline', () => {
    const selectedTest = COMPLETED_TESTS[1]
    const partialSuite = {
      ...COMPLETED_SUITE,
      latestSuiteRun: COMPLETED_SUITE.latestRun,
      latestRun: {
        id: 'run-single-test',
        scope: 'test' as const,
        selectedTestId: selectedTest.id,
        suiteDefinitionRevision: 1,
        status: 'running' as const,
        revision: 1,
        completedCount: 0,
        passedCount: 0,
        warningCount: 0,
        failedCount: 0,
        errorCount: 0,
        totalCount: 1,
        createdAt: new Date('2026-07-15T12:02:00.000Z'),
        updatedAt: new Date('2026-07-15T12:02:01.000Z'),
        startedAt: new Date('2026-07-15T12:02:01.000Z'),
        completedAt: null,
        error: null,
        tests: [selectedTest],
        testRuns: [
          testRun({
            id: 'test-run-single',
            testId: selectedTest.id,
            name: selectedTest.name,
            evaluatorType: selectedTest.evaluatorType,
            phase: 'running_subject',
          }),
        ],
      },
    } satisfies WorkflowEvalSuite

    act(() => root.render(<Harness suites={[partialSuite]} />))

    const group = getStatusGroup('Customer support')
    expect(group.querySelectorAll('[data-test-id]')).toHaveLength(COMPLETED_TESTS.length)
    expect(
      container.querySelector('[data-eval-suite-summary="suite-completed"]')?.textContent
    ).toBe('3/6')
    expect(getIndicator(group, 'test-code-pass').dataset.evalStatus).toBe('complete')
    expect(getIndicator(group, selectedTest.id).dataset.evalStatus).toBe('progress')
    expect(getIndicator(group, 'test-agent-pass').dataset.evalStatus).toBe('complete')
  })

  it('makes settled dots selectable while pending and running dots stay informational', () => {
    act(() => root.render(<Harness suites={[COMPLETED_SUITE, RUNNING_SUITE]} />))

    expect(
      getStatusGroup('Customer support').querySelectorAll('button[data-test-id]')
    ).toHaveLength(COMPLETED_TESTS.length)
    expect(getStatusGroup('Regression').querySelectorAll('button[data-test-id]')).toHaveLength(1)
    expect(
      getStatusGroup('Regression').querySelector('[data-test-id="test-active"]')?.tagName
    ).toBe('SPAN')
  })

  it('offers Retry and Details from a settled dot context menu', () => {
    const onRetryTest = vi.fn()
    const onShowDetails = vi.fn()
    act(() =>
      root.render(
        <Harness
          suites={[COMPLETED_SUITE]}
          onRetryTest={onRetryTest}
          onShowDetails={onShowDetails}
        />
      )
    )

    const trigger = getStatusGroup('Customer support').querySelector<HTMLButtonElement>(
      '[data-test-id="test-code-fail"]'
    )
    if (!trigger) throw new Error('Missing settled Eval status button')

    act(() =>
      trigger.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 30, clientY: 40 })
      )
    )

    const detailsButton = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')
    ).find((item) => item.textContent === 'Details')
    const retryButton = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')
    ).find((item) => item.textContent === 'Retry')
    if (!detailsButton || !retryButton) throw new Error('Missing Eval test context menu actions')
    expect(retryButton.getAttribute('aria-disabled')).toBe('false')

    act(() => detailsButton.click())

    expect(onShowDetails).toHaveBeenCalledOnce()
    expect(onShowDetails.mock.calls[0][0]).toMatchObject({
      suiteId: 'suite-completed',
      runId: 'run-completed',
      testRun: { testId: 'test-code-fail' },
    })

    act(() =>
      trigger.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 35, clientY: 45 })
      )
    )
    const reopenedRetryButton = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')
    ).find((item) => item.textContent === 'Retry')
    if (!reopenedRetryButton) throw new Error('Missing reopened Eval test Retry action')

    act(() => reopenedRetryButton.click())

    expect(onRetryTest).toHaveBeenCalledWith('suite-completed', 'test-code-fail', 1)
  })

  it('persists the selected treatment, toggles it off, and focuses only non-passing blocks', () => {
    const onFocusErrorBlocks = vi.fn()
    act(() =>
      root.render(<Harness suites={[COMPLETED_SUITE]} onFocusErrorBlocks={onFocusErrorBlocks} />)
    )

    const group = getStatusGroup('Customer support')
    const failed = group.querySelector<HTMLButtonElement>('[data-test-id="test-code-fail"]')
    const passed = group.querySelector<HTMLButtonElement>('[data-test-id="test-code-pass"]')
    if (!failed || !passed) throw new Error('Missing settled Eval status buttons')

    act(() => failed.click())

    expect(failed.getAttribute('aria-pressed')).toBe('true')
    expect(getIndicator(group, 'test-code-fail').getAttribute('class')).toContain('scale-[1.2]')
    expect(
      getIndicator(group, 'test-code-fail').querySelector('[data-eval-selection-ring]')
    ).not.toBeNull()
    expect(onFocusErrorBlocks).toHaveBeenCalledWith(['block-test-code-fail'])

    act(() => failed.click())

    expect(failed.getAttribute('aria-pressed')).toBe('false')
    expect(onFocusErrorBlocks).toHaveBeenCalledOnce()

    act(() => passed.click())

    expect(failed.getAttribute('aria-pressed')).toBe('false')
    expect(passed.getAttribute('aria-pressed')).toBe('true')
    expect(onFocusErrorBlocks).toHaveBeenCalledOnce()
  })

  it('starts expanded and collapses or restores every dot from the hover chevron', () => {
    act(() => root.render(<Harness suites={[COMPLETED_SUITE]} />))

    const collapseButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Collapse Customer support"]'
    )
    if (!collapseButton) throw new Error('Missing collapse suite button')
    const titleButton = container.querySelector<HTMLButtonElement>(
      '[data-eval-suite-title="suite-completed"]'
    )
    if (!titleButton) throw new Error('Missing eval suite title button')
    const chevron = collapseButton.querySelector<SVGSVGElement>('svg')
    if (!chevron) throw new Error('Missing collapse chevron')
    const suiteRow = collapseButton.closest<HTMLElement>('[data-eval-suite-row="suite-completed"]')
    if (!suiteRow) throw new Error('Missing eval suite row')

    expect(collapseButton.getAttribute('aria-expanded')).toBe('true')
    expect(titleButton.getAttribute('aria-expanded')).toBe('true')
    expect(titleButton.getAttribute('aria-controls')).toBe(
      collapseButton.getAttribute('aria-controls')
    )
    expect(collapseButton.className).toContain('group-hover:opacity-100')
    expect(collapseButton.className).not.toContain('group-focus-within:opacity-100')
    expect(suiteRow.className).not.toContain('focus-within:bg-')
    expect(suiteRow.className).not.toContain('focus-within:[--eval-status-mask:')
    expect(collapseButton.className).not.toContain('ghost-secondary')
    expect(chevron.getAttribute('class')).toContain('h-[7px]')
    expect(chevron.getAttribute('class')).toContain('w-[9px]')
    expect(chevron.getAttribute('class')).not.toContain('-rotate-90')
    expect(getStatusGroup('Customer support')).toBeDefined()

    act(() => titleButton.click())

    expect(collapseButton.getAttribute('aria-expanded')).toBe('false')
    expect(titleButton.getAttribute('aria-expanded')).toBe('false')
    expect(collapseButton.getAttribute('aria-label')).toBe('Expand Customer support')
    expect(chevron.getAttribute('class')).toContain('-rotate-90')
    expect(
      container.querySelector('[role="group"][aria-label="Customer support test statuses"]')
    ).toBeNull()

    act(() => collapseButton.click())

    expect(collapseButton.getAttribute('aria-expanded')).toBe('true')
    expect(titleButton.getAttribute('aria-expanded')).toBe('true')
    expect(getStatusGroup('Customer support')).toBeDefined()
  })

  it('keeps the play button visible and runs an inactive suite', () => {
    const onRunSuite = vi.fn()
    act(() => root.render(<Harness suites={[COMPLETED_SUITE]} onRunSuite={onRunSuite} />))

    const runButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="Run Customer support"]'
    )
    if (!runButton) throw new Error('Missing run suite button')
    expect(runButton.className).not.toContain('opacity-0')

    act(() => runButton.click())

    expect(onRunSuite).toHaveBeenCalledOnce()
    expect(onRunSuite).toHaveBeenCalledWith('suite-completed')
    expect(container.querySelectorAll('[aria-expanded="true"]')).toHaveLength(2)
  })

  it('clears stale results while a new suite run is being admitted', () => {
    act(() =>
      root.render(<Harness suites={[COMPLETED_SUITE]} startingSuiteId={COMPLETED_SUITE.id} />)
    )

    const group = getStatusGroup('Customer support')
    expect(group.querySelectorAll('[data-test-id] [data-eval-status="progress"]')).toHaveLength(1)
    expect(group.querySelectorAll('[data-test-id] [data-eval-status="pending"]')).toHaveLength(
      COMPLETED_TESTS.length - 1
    )
    expect(group.querySelectorAll('[data-eval-status="complete"]')).toHaveLength(0)
    expect(group.querySelectorAll('[data-eval-status="failed"]')).toHaveLength(0)
    expect(
      container.querySelector('[data-eval-suite-summary="suite-completed"]')?.textContent
    ).toBe('0/6')
    expect(container.querySelector('[data-eval-suite-name-running="true"]')?.textContent).toBe(
      'Customer support'
    )
    expect(
      container.querySelector<HTMLButtonElement>('[aria-label="Stop Customer support"]')?.disabled
    ).toBe(true)
    expect(container.querySelector('[aria-label="Run Customer support"]')).toBeNull()
  })

  it('shows Stop for an active suite and stops its canonical run', () => {
    const onStopRun = vi.fn()
    act(() => root.render(<Harness suites={[RUNNING_SUITE]} onStopRun={onStopRun} />))

    const stopButton = container.querySelector<HTMLButtonElement>('[aria-label="Stop Regression"]')
    if (!stopButton) throw new Error('Missing stop Eval run button')

    act(() => stopButton.click())

    expect(onStopRun).toHaveBeenCalledOnce()
    expect(onStopRun).toHaveBeenCalledWith('suite-running', 'run-running')
  })

  it('renders one lightweight indicator per test with one active progress state at 1,000 tests', () => {
    const tests = Array.from({ length: 1_000 }, (_, index) =>
      testSummary({
        testId: `large-test-${index}`,
        name: `Large test ${index}`,
        evaluatorType: 'code',
      })
    )
    const testRuns = tests.map((test, ordinal) => ({
      ...testRun({
        id: `large-test-run-${ordinal}`,
        testId: test.id,
        name: test.name,
        evaluatorType: 'code',
        phase: ordinal === 0 ? 'running_subject' : 'queued',
      }),
      ordinal,
    }))
    const largeSuite: WorkflowEvalSuite = {
      id: 'suite-large',
      name: 'Large regression',
      definitionRevision: 1,
      archivedAt: null,
      tests,
      testCount: tests.length,
      latestRun: {
        id: 'run-large',
        scope: 'suite',
        selectedTestId: null,
        suiteDefinitionRevision: 1,
        status: 'running',
        revision: 1,
        completedCount: 0,
        passedCount: 0,
        warningCount: 0,
        failedCount: 0,
        errorCount: 0,
        totalCount: tests.length,
        createdAt: new Date('2026-07-15T12:01:00.000Z'),
        updatedAt: new Date('2026-07-15T12:02:00.000Z'),
        startedAt: new Date('2026-07-15T12:02:00.000Z'),
        completedAt: null,
        error: null,
        tests,
        testRuns,
      },
      latestSuiteRun: null,
    }

    act(() => root.render(<Harness suites={[largeSuite]} />))

    const group = getStatusGroup('Large regression')
    expect(group.querySelectorAll('[data-test-id]')).toHaveLength(1_000)
    expect(group.querySelectorAll('svg[data-eval-status]')).toHaveLength(1_000)
    expect(group.querySelectorAll('[data-eval-status-filler]')).toHaveLength(0)
    expect(group.querySelectorAll('filter')).toHaveLength(1)
    expect(group.querySelectorAll('[data-eval-status="progress"]')).toHaveLength(1)
    expect(group.querySelectorAll('[data-eval-status="pending"]')).toHaveLength(999)
  })
})
