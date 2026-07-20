/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react'
import { sleep } from '@sim/utils/helpers'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  WorkflowEvalStreamEvent,
  WorkflowEvalStreamRun,
  WorkflowEvalSuitesResponse,
} from '@/lib/api/contracts/workflow-evals'

const { mockRequestJson } = vi.hoisted(() => ({
  mockRequestJson: vi.fn(),
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson: mockRequestJson,
}))

import {
  startWorkflowEvalSuiteRunContract,
  stopWorkflowEvalRunContract,
} from '@/lib/api/contracts/workflow-evals'
import {
  applyWorkflowEvalStreamEvent,
  getWorkflowEvalRefetchInterval,
  useStartWorkflowEvalSuiteRun,
  useStartWorkflowEvalTestRun,
  useStopWorkflowEvalRun,
  useWorkflowEvalSuites,
  WORKFLOW_EVAL_SUITES_POLL_INTERVAL,
  WORKFLOW_EVAL_SUITES_RECONCILIATION_INTERVAL,
  workflowEvalKeys,
} from '@/hooks/queries/evals'

class FakeEventSource {
  static instances: FakeEventSource[] = []

  readonly url: string
  readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
  onopen: ((event: Event) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  closed = false

  constructor(url: string | URL) {
    this.url = String(url)
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  close(): void {
    this.closed = true
  }

  open(): void {
    this.onopen?.(new Event('open'))
  }

  emit(type: string, data?: unknown): void {
    const event =
      data === undefined ? new Event(type) : new MessageEvent(type, { data: JSON.stringify(data) })
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === 'function') listener(event)
      else listener.handleEvent(event)
    }
  }
}

const ORIGINAL_EVENT_SOURCE = globalThis.EventSource
const CREATED_AT = new Date('2026-07-16T12:00:00.000Z')
const STARTED_AT = new Date('2026-07-16T12:00:01.000Z')
const UPDATED_AT = new Date('2026-07-16T12:00:05.000Z')

const ACTIVE_RESPONSE: WorkflowEvalSuitesResponse = {
  enabled: true,
  suites: [
    {
      id: 'suite-1',
      name: 'Regression',
      definitionRevision: 1,
      archivedAt: null,
      tests: [
        {
          id: 'current-test-1',
          name: 'Current code test',
          evaluatorType: 'code',
        },
        {
          id: 'current-test-2',
          name: 'Current agent test',
          evaluatorType: 'agent',
          criteria: [{ id: 'current-useful', name: 'Current useful' }],
        },
      ],
      testCount: 2,
      latestRun: {
        id: 'run-1',
        scope: 'suite',
        selectedTestId: null,
        suiteDefinitionRevision: 1,
        status: 'running',
        revision: 5,
        completedCount: 1,
        passedCount: 1,
        warningCount: 0,
        failedCount: 0,
        errorCount: 0,
        totalCount: 2,
        createdAt: CREATED_AT,
        updatedAt: UPDATED_AT,
        startedAt: STARTED_AT,
        completedAt: null,
        error: null,
        tests: [
          {
            id: 'test-1',
            name: 'Code test',
            evaluatorType: 'code',
          },
          {
            id: 'test-2',
            name: 'Agent test',
            evaluatorType: 'agent',
            criteria: [
              { id: 'useful', name: 'Useful' },
              { id: 'safe', name: 'Safe' },
            ],
          },
        ],
        testRuns: [
          {
            id: 'test-run-1',
            testId: 'test-1',
            name: 'Code test',
            ordinal: 0,
            evaluatorType: 'code',
            phase: 'completed',
            outcome: 'pass',
            score: 10,
            subjectExecutionId: 'subject-execution-1',
            judgeExecutionId: null,
            error: null,
            criteria: [],
          },
          {
            id: 'test-run-2',
            testId: 'test-2',
            name: 'Agent test',
            ordinal: 1,
            evaluatorType: 'agent',
            phase: 'running_evaluator',
            outcome: null,
            score: null,
            subjectExecutionId: 'subject-execution-2',
            judgeExecutionId: null,
            error: null,
            criteria: [
              {
                id: 'criterion-run-useful',
                criterionId: 'useful',
                name: 'Useful',
                ordinal: 0,
                phase: 'running',
                verdict: null,
                confidence: null,
                error: null,
              },
              {
                id: 'criterion-run-safe',
                criterionId: 'safe',
                name: 'Safe',
                ordinal: 1,
                phase: 'queued',
                verdict: null,
                confidence: null,
                error: null,
              },
            ],
          },
        ],
      },
      latestSuiteRun: null,
    },
    {
      id: 'suite-2',
      name: 'Safety',
      definitionRevision: 1,
      archivedAt: null,
      tests: [
        {
          id: 'safety-test-1',
          name: 'Safety test',
          evaluatorType: 'code',
        },
      ],
      testCount: 1,
      latestRun: null,
      latestSuiteRun: null,
    },
  ],
}

function nextRun(overrides: Partial<WorkflowEvalStreamRun> = {}): WorkflowEvalStreamRun {
  return {
    id: 'run-1',
    scope: 'suite',
    selectedTestId: null,
    suiteDefinitionRevision: 1,
    status: 'running',
    revision: 6,
    completedCount: 1,
    passedCount: 1,
    warningCount: 0,
    failedCount: 0,
    errorCount: 0,
    totalCount: 2,
    createdAt: CREATED_AT,
    updatedAt: new Date('2026-07-16T12:00:06.000Z'),
    startedAt: STARTED_AT,
    completedAt: null,
    error: null,
    ...overrides,
  }
}

function criterionEvent(
  overrides: Partial<Extract<WorkflowEvalStreamEvent, { type: 'eval.criterion.upsert' }>> = {}
): Extract<WorkflowEvalStreamEvent, { type: 'eval.criterion.upsert' }> {
  return {
    version: 2,
    type: 'eval.criterion.upsert',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    suiteId: 'suite-1',
    run: nextRun(),
    testRunId: 'test-run-2',
    testId: 'test-2',
    criterion: {
      id: 'criterion-run-useful',
      criterionId: 'useful',
      ordinal: 0,
      phase: 'completed',
      verdict: 'pass',
      confidence: 0.9,
      error: null,
    },
    ...overrides,
  }
}

function completedAgentTestEvent(
  revision = 6
): Extract<WorkflowEvalStreamEvent, { type: 'eval.test.upsert' }> {
  return {
    version: 2,
    type: 'eval.test.upsert',
    workspaceId: 'workspace-1',
    workflowId: 'workflow-1',
    suiteId: 'suite-1',
    run: nextRun({
      revision,
      completedCount: 2,
      warningCount: 1,
      updatedAt: new Date(`2026-07-16T12:00:0${revision}.000Z`),
    }),
    test: {
      id: 'test-run-2',
      testId: 'test-2',
      ordinal: 1,
      evaluatorType: 'agent',
      phase: 'completed',
      outcome: 'warning',
      score: 6,
      subjectExecutionId: 'subject-execution-2',
      judgeExecutionId: null,
      error: null,
      criteria: [
        {
          id: 'criterion-run-useful',
          criterionId: 'useful',
          ordinal: 0,
          phase: 'completed',
          verdict: 'pass',
          confidence: 0.9,
          error: null,
        },
        {
          id: 'criterion-run-safe',
          criterionId: 'safe',
          ordinal: 1,
          phase: 'completed',
          verdict: 'fail',
          confidence: 0.6,
          error: null,
        },
      ],
    },
  }
}

function renderHookWithClient<T>(useHook: () => T): {
  result: () => T
  queryClient: QueryClient
  unmount: () => void
} {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  const container = document.createElement('div')
  const root: Root = createRoot(container)
  let latest: T

  function Probe() {
    latest = useHook()
    return null
  }

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }

  act(() => {
    root.render(
      <Wrapper>
        <Probe />
      </Wrapper>
    )
  })

  return {
    result: () => latest,
    queryClient,
    unmount: () => act(() => root.unmount()),
  }
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
    await sleep(0)
  })
}

describe('useStartWorkflowEvalSuiteRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    FakeEventSource.instances = []
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource
  })

  afterEach(() => {
    vi.restoreAllMocks()
    globalThis.EventSource = ORIGINAL_EVENT_SOURCE
  })

  it('starts a suite without inventing canonical test-run ids in the cache', async () => {
    mockRequestJson.mockResolvedValueOnce({
      runId: 'run-2',
      suiteId: 'suite-1',
      status: 'queued',
      revision: 0,
      totalCount: 2,
      createdAt: new Date('2026-07-16T13:00:00.000Z'),
    })
    const { result, queryClient, unmount } = renderHookWithClient(() =>
      useStartWorkflowEvalSuiteRun('workflow-1')
    )
    const queryKey = workflowEvalKeys.suiteList('workflow-1')
    queryClient.setQueryData(queryKey, ACTIVE_RESPONSE)

    await act(async () => {
      await result().mutateAsync('suite-1')
    })
    await flush()

    expect(mockRequestJson).toHaveBeenCalledWith(startWorkflowEvalSuiteRunContract, {
      params: { id: 'workflow-1', suiteId: 'suite-1' },
      body: {},
    })
    expect(queryClient.getQueryData(queryKey)).toBe(ACTIVE_RESPONSE)

    unmount()
  })

  it('fails fast before making a request when the workflow id is missing', async () => {
    const { result, unmount } = renderHookWithClient(() => useStartWorkflowEvalSuiteRun(undefined))

    await expect(result().mutateAsync('suite-1')).rejects.toThrow(
      'A workflow id is required to start an eval suite'
    )
    expect(mockRequestJson).not.toHaveBeenCalled()

    unmount()
  })
})

describe('useStartWorkflowEvalTestRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts one test at the visible definition revision and reconciles the suite list', async () => {
    mockRequestJson.mockResolvedValueOnce({
      runId: 'run-test-2',
      suiteId: 'suite-1',
      scope: 'test',
      selectedTestId: 'test-2',
      status: 'queued',
    })
    const { result, queryClient, unmount } = renderHookWithClient(() =>
      useStartWorkflowEvalTestRun('workflow-1')
    )
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')

    await act(async () => {
      await result().mutateAsync({
        suiteId: 'suite-1',
        testId: 'test-2',
        expectedDefinitionRevision: 7,
      })
    })
    await flush()

    expect(mockRequestJson).toHaveBeenCalledWith(startWorkflowEvalSuiteRunContract, {
      params: { id: 'workflow-1', suiteId: 'suite-1' },
      body: { testId: 'test-2', expectedDefinitionRevision: 7 },
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: workflowEvalKeys.suiteList('workflow-1'),
    })

    unmount()
  })

  it('fails fast before retrying when the workflow id is missing', async () => {
    const { result, unmount } = renderHookWithClient(() => useStartWorkflowEvalTestRun(undefined))

    await expect(
      result().mutateAsync({
        suiteId: 'suite-1',
        testId: 'test-2',
        expectedDefinitionRevision: 7,
      })
    ).rejects.toThrow('A workflow id is required to retry an eval test')
    expect(mockRequestJson).not.toHaveBeenCalled()

    unmount()
  })
})

describe('useStopWorkflowEvalRun', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('stops one canonical run and reconciles its suite list', async () => {
    const stoppedRun = {
      runId: 'run-1',
      suiteId: 'suite-1',
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      status: 'cancelled' as const,
      revision: 6,
      completedAt: new Date('2026-07-16T12:00:06.000Z'),
    }
    let releaseStopRequest: (() => void) | null = null
    mockRequestJson.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseStopRequest = resolve
      })
      return stoppedRun
    })
    const { result, queryClient, unmount } = renderHookWithClient(() =>
      useStopWorkflowEvalRun('workflow-1')
    )
    const queryKey = workflowEvalKeys.suiteList('workflow-1')
    queryClient.setQueryData(queryKey, ACTIVE_RESPONSE)
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    let stopMutation: Promise<unknown> | null = null

    act(() => {
      stopMutation = result().mutateAsync({ suiteId: 'suite-1', runId: 'run-1' })
    })
    await flush()

    const optimistic = queryClient.getQueryData<WorkflowEvalSuitesResponse>(queryKey)
    expect(optimistic?.suites[0].latestRun).toMatchObject({
      id: 'run-1',
      status: 'cancelled',
    })
    expect(optimistic?.suites[0].latestRun?.completedAt).toBeInstanceOf(Date)
    expect(optimistic?.suites[1]).toBe(ACTIVE_RESPONSE.suites[1])

    if (!releaseStopRequest || !stopMutation) {
      throw new Error('Stop request did not start')
    }
    releaseStopRequest()
    await act(async () => {
      await stopMutation
    })

    expect(mockRequestJson).toHaveBeenCalledWith(stopWorkflowEvalRunContract, {
      params: { id: 'workflow-1', suiteId: 'suite-1', runId: 'run-1' },
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: workflowEvalKeys.suiteList('workflow-1'),
    })

    unmount()
  })

  it('rolls back only the stopped run when the stop request fails', async () => {
    mockRequestJson.mockRejectedValueOnce(new Error('Stop failed'))
    const { result, queryClient, unmount } = renderHookWithClient(() =>
      useStopWorkflowEvalRun('workflow-1')
    )
    const queryKey = workflowEvalKeys.suiteList('workflow-1')
    queryClient.setQueryData(queryKey, ACTIVE_RESPONSE)

    let stopError: unknown
    await act(async () => {
      try {
        await result().mutateAsync({ suiteId: 'suite-1', runId: 'run-1' })
      } catch (error) {
        stopError = error
      }
    })

    expect(stopError).toEqual(new Error('Stop failed'))
    expect(
      queryClient.getQueryData<WorkflowEvalSuitesResponse>(queryKey)?.suites[0].latestRun
    ).toStrictEqual(ACTIVE_RESPONSE.suites[0].latestRun)

    unmount()
  })

  it('fails fast before making a stop request when the workflow id is missing', async () => {
    const { result, unmount } = renderHookWithClient(() => useStopWorkflowEvalRun(undefined))

    await expect(result().mutateAsync({ suiteId: 'suite-1', runId: 'run-1' })).rejects.toThrow(
      'A workflow id is required to stop an eval run'
    )
    expect(mockRequestJson).not.toHaveBeenCalled()

    unmount()
  })
})

describe('workflow eval stream cache updates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    FakeEventSource.instances = []
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource
  })

  afterEach(() => {
    vi.restoreAllMocks()
    globalThis.EventSource = ORIGINAL_EVENT_SOURCE
  })

  it('applies exactly the next criterion revision while preserving canonical names', () => {
    const updated = applyWorkflowEvalStreamEvent(ACTIVE_RESPONSE, 'workflow-1', criterionEvent())

    expect(updated.requiresRefetch).toBe(false)
    expect(updated.data?.suites[0].latestRun?.revision).toBe(6)
    expect(updated.data?.suites[1]).toBe(ACTIVE_RESPONSE.suites[1])
    const testRun = updated.data?.suites[0].latestRun?.testRuns[1]
    expect(testRun).toMatchObject({
      id: 'test-run-2',
      name: 'Agent test',
      criteria: [
        {
          criterionId: 'useful',
          name: 'Useful',
          phase: 'completed',
          verdict: 'pass',
          confidence: 0.9,
        },
        { criterionId: 'safe', name: 'Safe', phase: 'queued' },
      ],
    })
  })

  it('applies a self-contained agent test update and preserves criterion display names', () => {
    const updated = applyWorkflowEvalStreamEvent(
      ACTIVE_RESPONSE,
      'workflow-1',
      completedAgentTestEvent()
    )

    expect(updated.requiresRefetch).toBe(false)
    expect(updated.data?.suites[0].latestRun).toMatchObject({
      revision: 6,
      completedCount: 2,
      warningCount: 1,
      testRuns: [
        expect.objectContaining({ testId: 'test-1' }),
        expect.objectContaining({
          testId: 'test-2',
          name: 'Agent test',
          phase: 'completed',
          outcome: 'warning',
          score: 6,
          criteria: [
            expect.objectContaining({ criterionId: 'useful', name: 'Useful' }),
            expect.objectContaining({ criterionId: 'safe', name: 'Safe' }),
          ],
        }),
      ],
    })
  })

  it('ignores duplicate and stale revisions without cloning the cache', () => {
    const duplicate = criterionEvent({ run: nextRun({ revision: 5 }) })
    const stale = criterionEvent({ run: nextRun({ revision: 4 }) })

    expect(applyWorkflowEvalStreamEvent(ACTIVE_RESPONSE, 'workflow-1', duplicate)).toEqual({
      data: ACTIVE_RESPONSE,
      requiresRefetch: false,
    })
    expect(applyWorkflowEvalStreamEvent(ACTIVE_RESPONSE, 'workflow-1', stale)).toEqual({
      data: ACTIVE_RESPONSE,
      requiresRefetch: false,
    })
  })

  it('requires a canonical refetch for revision gaps or unknown row identities', () => {
    const gap = criterionEvent({ run: nextRun({ revision: 7 }) })
    expect(applyWorkflowEvalStreamEvent(ACTIVE_RESPONSE, 'workflow-1', gap)).toEqual({
      data: ACTIVE_RESPONSE,
      requiresRefetch: true,
    })

    const unknownCriterion = criterionEvent({
      criterion: {
        ...criterionEvent().criterion,
        id: 'unknown-criterion-run',
      },
    })
    expect(applyWorkflowEvalStreamEvent(ACTIVE_RESPONSE, 'workflow-1', unknownCriterion)).toEqual({
      data: ACTIVE_RESPONSE,
      requiresRefetch: true,
    })
  })

  it('never constructs a newer run from mutable suite definitions', () => {
    const newerRunEvent: WorkflowEvalStreamEvent = {
      version: 2,
      type: 'eval.run.upsert',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      suiteId: 'suite-1',
      run: nextRun({
        id: 'run-2',
        status: 'queued',
        revision: 0,
        completedCount: 0,
        passedCount: 0,
        createdAt: new Date('2026-07-16T13:00:00.000Z'),
        updatedAt: new Date('2026-07-16T13:00:00.000Z'),
        startedAt: null,
      }),
    }

    expect(applyWorkflowEvalStreamEvent(ACTIVE_RESPONSE, 'workflow-1', newerRunEvent)).toEqual({
      data: ACTIVE_RESPONSE,
      requiresRefetch: true,
    })
  })

  it('ignores events for older runs and refetches unknown suites', () => {
    const olderRunEvent: WorkflowEvalStreamEvent = {
      version: 2,
      type: 'eval.run.upsert',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      suiteId: 'suite-1',
      run: nextRun({
        id: 'run-older',
        createdAt: new Date('2026-07-15T12:00:00.000Z'),
        updatedAt: new Date('2026-07-15T12:00:01.000Z'),
      }),
    }
    expect(applyWorkflowEvalStreamEvent(ACTIVE_RESPONSE, 'workflow-1', olderRunEvent)).toEqual({
      data: ACTIVE_RESPONSE,
      requiresRefetch: false,
    })

    const unknownSuite = criterionEvent({ suiteId: 'missing-suite' })
    expect(applyWorkflowEvalStreamEvent(ACTIVE_RESPONSE, 'workflow-1', unknownSuite)).toEqual({
      data: ACTIVE_RESPONSE,
      requiresRefetch: true,
    })
  })

  it('applies a terminal run revision and immediately requests reconciliation', () => {
    const completedTest = applyWorkflowEvalStreamEvent(
      ACTIVE_RESPONSE,
      'workflow-1',
      completedAgentTestEvent()
    )
    const terminalEvent: WorkflowEvalStreamEvent = {
      version: 2,
      type: 'eval.run.upsert',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      suiteId: 'suite-1',
      run: nextRun({
        status: 'completed',
        revision: 7,
        completedCount: 2,
        warningCount: 1,
        updatedAt: new Date('2026-07-16T12:00:07.000Z'),
        completedAt: new Date('2026-07-16T12:00:07.000Z'),
      }),
    }

    const terminal = applyWorkflowEvalStreamEvent(completedTest.data, 'workflow-1', terminalEvent)

    expect(terminal.data?.suites[0].latestRun?.status).toBe('completed')
    expect(terminal.data?.suites[0].latestRun?.revision).toBe(7)
    expect(terminal.requiresRefetch).toBe(true)
  })

  it('uses live streaming as the fast path and polling for reconciliation or disconnects', () => {
    expect(getWorkflowEvalRefetchInterval(true, true, ACTIVE_RESPONSE)).toBe(
      WORKFLOW_EVAL_SUITES_RECONCILIATION_INTERVAL
    )
    expect(getWorkflowEvalRefetchInterval(true, false, ACTIVE_RESPONSE)).toBe(
      WORKFLOW_EVAL_SUITES_POLL_INTERVAL
    )
    expect(getWorkflowEvalRefetchInterval(false, false, ACTIVE_RESPONSE)).toBe(false)

    const terminalResponse: WorkflowEvalSuitesResponse = {
      ...ACTIVE_RESPONSE,
      suites: ACTIVE_RESPONSE.suites.map((suite) =>
        suite.latestRun
          ? {
              ...suite,
              latestRun: {
                ...suite.latestRun,
                status: 'error',
                completedAt: new Date('2026-07-16T12:00:06.000Z'),
                error: {
                  kind: 'infrastructure',
                  code: 'coordinator_failed',
                  message: 'Coordinator failed',
                },
              },
            }
          : suite
      ),
    }
    expect(getWorkflowEvalRefetchInterval(true, true, terminalResponse)).toBe(false)
  })

  it('connects only while active, reconciles on ready, and applies updates immediately', async () => {
    mockRequestJson.mockResolvedValue(ACTIVE_RESPONSE)
    const activeHook = renderHookWithClient(() =>
      useWorkflowEvalSuites('workflow-1', { active: true })
    )

    await flush()
    await flush()

    expect(FakeEventSource.instances).toHaveLength(1)
    const source = FakeEventSource.instances[0]
    expect(source.url).toBe('/api/workflows/workflow-1/evals/stream')

    act(() => source.open())
    act(() => source.emit('workflow_eval_ready'))
    await flush()
    expect(mockRequestJson).toHaveBeenCalledTimes(2)

    act(() => source.emit('workflow_eval_update', criterionEvent()))
    await flush()

    const cached = activeHook.queryClient.getQueryData<WorkflowEvalSuitesResponse>(
      workflowEvalKeys.suiteList('workflow-1')
    )
    expect(cached?.suites[0].latestRun?.revision).toBe(6)
    const agentTestRun = cached?.suites[0].latestRun?.testRuns[1]
    expect(agentTestRun?.criteria[0]).toMatchObject({
      criterionId: 'useful',
      phase: 'completed',
    })

    activeHook.unmount()
    expect(source.closed).toBe(true)

    FakeEventSource.instances = []
    const inactiveHook = renderHookWithClient(() =>
      useWorkflowEvalSuites('workflow-1', { active: false })
    )
    await flush()
    await flush()
    expect(FakeEventSource.instances).toHaveLength(0)
    inactiveHook.unmount()
  })
})
