/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowEvalTestRun } from '@/lib/api/contracts/workflow-evals'

const { mockUseDefinition, mockUseLog } = vi.hoisted(() => ({
  mockUseDefinition: vi.fn(),
  mockUseLog: vi.fn(),
}))

vi.mock('@sim/emcn', () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  ChipModal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChipModalBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChipModalError: ({ children }: { children: ReactNode }) => <div role='alert'>{children}</div>,
  ChipModalField: ({
    title,
    value,
    children,
  }: {
    title: ReactNode
    value?: string
    children?: ReactNode
  }) => (
    <section>
      <h2>{title}</h2>
      {value === undefined ? children : <pre>{value}</pre>}
    </section>
  ),
  ChipModalFooter: () => <div />,
  ChipModalHeader: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
  ChipModalTabs: ({
    tabs,
    onChange,
  }: {
    tabs: ReadonlyArray<{ value: string; label: ReactNode }>
    onChange: (value: string) => void
  }) => (
    <nav>
      {tabs.map((tab) => (
        <button type='button' key={tab.value} onClick={() => onChange(tab.value)}>
          {tab.label}
        </button>
      ))}
    </nav>
  ),
  ChipTag: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Skeleton: () => <div />,
}))
vi.mock('@/hooks/queries/evals', () => ({
  useWorkflowEvalRunTestDefinition: mockUseDefinition,
}))
vi.mock('@/hooks/queries/logs', () => ({ useLogByExecutionId: mockUseLog }))

import { EvalTestDetailsModal } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/terminal/components/evals-pane/eval-test-details-modal'

const TEST_RUN: WorkflowEvalTestRun = {
  id: 'test-run-1',
  testId: 'test-1',
  ordinal: 0,
  name: 'Routes billing requests',
  evaluatorType: 'code',
  phase: 'completed',
  outcome: 'fail',
  score: 0,
  reason: 'The router selected general support instead of billing.',
  errorBlockIds: ['router'],
  subjectExecutionId: 'execution-1',
  judgeExecutionId: null,
  error: null,
  criteria: [],
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  mockUseDefinition.mockReturnValue({
    data: {
      runId: 'run-1',
      suiteId: 'suite-1',
      suiteDefinitionRevision: 4,
      test: {
        id: 'test-1',
        name: 'Routes billing requests',
        input: { message: 'I was charged twice' },
        errorBlockIds: ['router'],
        evaluator: {
          type: 'code',
          code: "return { passed: blockOutputs[0].value === 'billing' }",
          outputSelectors: [{ blockId: 'router', path: 'route' }],
        },
      },
    },
    isPending: false,
    error: null,
  })
  mockUseLog.mockReturnValue({
    data: {
      executionData: {
        totalDuration: 1250,
        finalOutput: { reply: 'General support can help.' },
        blockExecutions: [
          {
            blockId: 'router',
            outputData: { route: 'general' },
          },
          {
            blockId: 'unselected-block',
            outputData: { ignored: true },
          },
        ],
      },
    },
    isPending: false,
    error: null,
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

describe('EvalTestDetailsModal', () => {
  it('shows the immutable definition, subject result, selected evidence, and outcome', () => {
    act(() =>
      root.render(
        <EvalTestDetailsModal
          workflowId='workflow-1'
          workspaceId='workspace-1'
          selection={{
            suiteId: 'suite-1',
            runId: 'run-1',
            testRun: TEST_RUN,
            description: 'The router selected general support instead of billing.',
          }}
          onClose={vi.fn()}
        />
      )
    )

    expect(mockUseDefinition).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      suiteId: 'suite-1',
      runId: 'run-1',
      testId: 'test-1',
    })
    expect(mockUseLog).toHaveBeenCalledWith('workspace-1', 'execution-1')
    expect(container.textContent).toContain(
      'The router selected general support instead of billing.'
    )
    expect(container.textContent).toContain('Failed')
    expect(container.textContent).toContain('0/10')
    expect(container.textContent).toContain('1.25s')
    expect(container.textContent).toContain('Code')

    const inputTab = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Input'
    )
    if (!inputTab) throw new Error('Input tab was not rendered')
    act(() => inputTab.click())
    expect(container.textContent).toContain('I was charged twice')
    expect(container.textContent).toContain('passingScore')

    const outputTab = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Output'
    )
    if (!outputTab) throw new Error('Output tab was not rendered')
    act(() => outputTab.click())
    expect(container.textContent).toContain('General support can help.')
    expect(container.textContent).toContain('"blockId": "router"')
    expect(container.textContent).not.toContain('unselected-block')
    expect(container.textContent).toContain('"outcome": "fail"')
  })
})
