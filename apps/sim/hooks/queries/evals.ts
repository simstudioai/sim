import { useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getWorkflowEvalRunTestDefinitionContract,
  getWorkflowEvalSuitesContract,
  startWorkflowEvalSuiteRunContract,
  stopWorkflowEvalRunContract,
  type WorkflowEvalCompactCriterionRun,
  type WorkflowEvalCompactTestRun,
  type WorkflowEvalCriterionRun,
  type WorkflowEvalLatestRun,
  type WorkflowEvalRunTestDefinitionResponse,
  type WorkflowEvalStreamEvent,
  type WorkflowEvalStreamRun,
  type WorkflowEvalSuitesResponse,
  type WorkflowEvalTestRun,
  workflowEvalStreamEventSchema,
} from '@/lib/api/contracts/workflow-evals'

const logger = createLogger('WorkflowEvalQueries')

export const WORKFLOW_EVAL_SUITES_STALE_TIME = 30 * 1_000
export const WORKFLOW_EVAL_SUITES_POLL_INTERVAL = 2 * 1_000
export const WORKFLOW_EVAL_SUITES_RECONCILIATION_INTERVAL = 30 * 1_000
export const WORKFLOW_EVAL_RUN_TEST_DEFINITION_STALE_TIME = Number.POSITIVE_INFINITY

export const workflowEvalKeys = {
  all: ['workflow-evals'] as const,
  suites: () => [...workflowEvalKeys.all, 'suites'] as const,
  suiteList: (workflowId?: string) => [...workflowEvalKeys.suites(), workflowId ?? ''] as const,
  runTestDefinitions: () => [...workflowEvalKeys.all, 'run-test-definition'] as const,
  runTestDefinition: (workflowId?: string, suiteId?: string, runId?: string, testId?: string) =>
    [
      ...workflowEvalKeys.runTestDefinitions(),
      workflowId ?? '',
      suiteId ?? '',
      runId ?? '',
      testId ?? '',
    ] as const,
}

export function useWorkflowEvalRunTestDefinition({
  workflowId,
  suiteId,
  runId,
  testId,
  enabled = true,
}: {
  workflowId?: string
  suiteId?: string
  runId?: string
  testId?: string
  enabled?: boolean
}) {
  return useQuery({
    queryKey: workflowEvalKeys.runTestDefinition(workflowId, suiteId, runId, testId),
    queryFn: ({ signal }): Promise<WorkflowEvalRunTestDefinitionResponse> =>
      requestJson(getWorkflowEvalRunTestDefinitionContract, {
        params: {
          id: workflowId as string,
          suiteId: suiteId as string,
          runId: runId as string,
          testId: testId as string,
        },
        signal,
      }),
    enabled: Boolean(workflowId && suiteId && runId && testId) && enabled,
    staleTime: WORKFLOW_EVAL_RUN_TEST_DEFINITION_STALE_TIME,
  })
}

interface UseWorkflowEvalSuitesOptions {
  active: boolean
}

interface ApplyWorkflowEvalStreamEventResult {
  data: WorkflowEvalSuitesResponse | undefined
  requiresRefetch: boolean
}

function compareRunIdentity(
  incoming: Pick<WorkflowEvalStreamRun, 'id' | 'createdAt'>,
  current: Pick<WorkflowEvalLatestRun, 'id' | 'createdAt'>
): number {
  const createdAtDifference = incoming.createdAt.getTime() - current.createdAt.getTime()
  if (createdAtDifference !== 0) return createdAtDifference
  return incoming.id.localeCompare(current.id)
}

function mergeCompactCriterionRun(
  current: WorkflowEvalCriterionRun,
  incoming: WorkflowEvalCompactCriterionRun
): WorkflowEvalCriterionRun | null {
  if (
    current.id !== incoming.id ||
    current.criterionId !== incoming.criterionId ||
    current.ordinal !== incoming.ordinal
  ) {
    return null
  }
  return { ...incoming, name: current.name }
}

function mergeCompactTestRun(
  current: WorkflowEvalTestRun,
  incoming: WorkflowEvalCompactTestRun
): WorkflowEvalTestRun | null {
  if (
    current.id !== incoming.id ||
    current.testId !== incoming.testId ||
    current.ordinal !== incoming.ordinal ||
    current.evaluatorType !== incoming.evaluatorType
  ) {
    return null
  }

  if (current.evaluatorType === 'code' && incoming.evaluatorType === 'code') {
    return { ...incoming, name: current.name }
  }
  if (current.evaluatorType === 'workflow' && incoming.evaluatorType === 'workflow') {
    return { ...incoming, name: current.name }
  }
  if (current.evaluatorType !== 'agent' || incoming.evaluatorType !== 'agent') return null
  if (current.criteria.length !== incoming.criteria.length) return null

  const criteria: WorkflowEvalCriterionRun[] = []
  for (let ordinal = 0; ordinal < current.criteria.length; ordinal += 1) {
    const merged = mergeCompactCriterionRun(current.criteria[ordinal], incoming.criteria[ordinal])
    if (!merged) return null
    criteria.push(merged)
  }
  return { ...incoming, name: current.name, criteria }
}

function applyTestUpsert(
  testRuns: WorkflowEvalTestRun[],
  incoming: WorkflowEvalCompactTestRun
): WorkflowEvalTestRun[] | null {
  const index = testRuns.findIndex((testRun) => testRun.id === incoming.id)
  if (index === -1) return null
  const merged = mergeCompactTestRun(testRuns[index], incoming)
  if (!merged) return null
  const next = testRuns.slice()
  next[index] = merged
  return next
}

function applyCriterionUpsert(
  testRuns: WorkflowEvalTestRun[],
  event: Extract<WorkflowEvalStreamEvent, { type: 'eval.criterion.upsert' }>
): WorkflowEvalTestRun[] | null {
  const testIndex = testRuns.findIndex((testRun) => testRun.id === event.testRunId)
  if (testIndex === -1) return null
  const testRun = testRuns[testIndex]
  if (testRun.testId !== event.testId || testRun.evaluatorType !== 'agent') return null

  const criterionIndex = testRun.criteria.findIndex(
    (criterion) => criterion.id === event.criterion.id
  )
  if (criterionIndex === -1) return null
  const merged = mergeCompactCriterionRun(testRun.criteria[criterionIndex], event.criterion)
  if (!merged) return null

  const criteria = testRun.criteria.slice()
  criteria[criterionIndex] = merged
  const next = testRuns.slice()
  next[testIndex] = { ...testRun, criteria }
  return next
}

function runMetadataIsCompatible(
  current: WorkflowEvalLatestRun,
  incoming: WorkflowEvalStreamRun
): boolean {
  return (
    current.createdAt.getTime() === incoming.createdAt.getTime() &&
    current.totalCount === incoming.totalCount &&
    current.tests.length === incoming.totalCount &&
    current.testRuns.length === incoming.totalCount &&
    incoming.updatedAt.getTime() >= current.updatedAt.getTime() &&
    incoming.completedCount >= current.completedCount &&
    incoming.passedCount >= current.passedCount &&
    incoming.warningCount >= current.warningCount &&
    incoming.failedCount >= current.failedCount &&
    incoming.errorCount >= current.errorCount
  )
}

function isTerminalRun(run: WorkflowEvalStreamRun): boolean {
  return run.status === 'completed' || run.status === 'error' || run.status === 'cancelled'
}

export function getWorkflowEvalRefetchInterval(
  active: boolean,
  isStreamConnected: boolean,
  data: WorkflowEvalSuitesResponse | undefined
): number | false {
  if (!active) return false
  const hasActiveRun = data?.suites.some(
    (suite) => suite.latestRun?.status === 'queued' || suite.latestRun?.status === 'running'
  )
  if (!hasActiveRun) return false
  return isStreamConnected
    ? WORKFLOW_EVAL_SUITES_RECONCILIATION_INTERVAL
    : WORKFLOW_EVAL_SUITES_POLL_INTERVAL
}

export function applyWorkflowEvalStreamEvent(
  current: WorkflowEvalSuitesResponse | undefined,
  workflowId: string,
  event: WorkflowEvalStreamEvent
): ApplyWorkflowEvalStreamEventResult {
  if (!current || event.workflowId !== workflowId) {
    return { data: current, requiresRefetch: true }
  }

  const suiteIndex = current.suites.findIndex((suite) => suite.id === event.suiteId)
  if (suiteIndex === -1) {
    return { data: current, requiresRefetch: true }
  }

  const suite = current.suites[suiteIndex]
  const currentRun = suite.latestRun
  if (!currentRun) return { data: current, requiresRefetch: true }

  if (currentRun.id !== event.run.id) {
    const identityComparison = compareRunIdentity(event.run, currentRun)
    if (identityComparison < 0) {
      return { data: current, requiresRefetch: false }
    }
    return { data: current, requiresRefetch: true }
  }

  if (event.run.revision <= currentRun.revision) {
    return { data: current, requiresRefetch: false }
  }
  if (event.run.revision !== currentRun.revision + 1) {
    return { data: current, requiresRefetch: true }
  }
  if (isTerminalRun(currentRun) || !runMetadataIsCompatible(currentRun, event.run)) {
    return { data: current, requiresRefetch: true }
  }

  let testRuns = currentRun.testRuns
  if (event.type === 'eval.test.upsert') {
    const updated = applyTestUpsert(testRuns, event.test)
    if (!updated) return { data: current, requiresRefetch: true }
    testRuns = updated
  } else if (event.type === 'eval.criterion.upsert') {
    const updated = applyCriterionUpsert(testRuns, event)
    if (!updated) return { data: current, requiresRefetch: true }
    testRuns = updated
  }

  const nextRun: WorkflowEvalLatestRun = {
    ...event.run,
    tests: currentRun.tests,
    testRuns,
  }
  const suites = current.suites.slice()
  suites[suiteIndex] = { ...suite, latestRun: nextRun }
  const requiresRefetch = event.type === 'eval.run.upsert' && isTerminalRun(event.run)
  return { data: { ...current, suites }, requiresRefetch }
}

function fetchWorkflowEvalSuites(
  workflowId: string,
  signal?: AbortSignal
): Promise<WorkflowEvalSuitesResponse> {
  return requestJson(getWorkflowEvalSuitesContract, {
    params: { id: workflowId },
    signal,
  })
}

interface UseWorkflowEvalEventStreamArgs {
  workflowId: string | undefined
  enabled: boolean
  onConnectionChange: (connected: boolean) => void
}

function useWorkflowEvalEventStream({
  workflowId,
  enabled,
  onConnectionChange,
}: UseWorkflowEvalEventStreamArgs): void {
  const queryClient = useQueryClient()
  const onConnectionChangeRef = useRef(onConnectionChange)
  onConnectionChangeRef.current = onConnectionChange

  useEffect(() => {
    onConnectionChangeRef.current(false)
    if (!enabled || !workflowId) return

    const queryKey = workflowEvalKeys.suiteList(workflowId)
    const eventSource = new EventSource(
      `/api/workflows/${encodeURIComponent(workflowId)}/evals/stream`
    )
    let cancelled = false
    let eventQueue = Promise.resolve()

    const enqueue = (operation: () => Promise<void>): void => {
      eventQueue = eventQueue.then(operation).catch((error) => {
        logger.error('Workflow eval stream reconciliation failed', {
          workflowId,
          error,
        })
      })
    }

    const refetchCanonicalSnapshot = async (): Promise<void> => {
      await queryClient.invalidateQueries({ queryKey })
    }

    eventSource.addEventListener('workflow_eval_ready', () => {
      if (!cancelled) onConnectionChangeRef.current(false)
      enqueue(refetchCanonicalSnapshot)
    })

    eventSource.addEventListener('workflow_eval_update', (message) => {
      if (!(message instanceof MessageEvent)) {
        enqueue(refetchCanonicalSnapshot)
        return
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(message.data)
      } catch (error) {
        logger.warn('Received malformed workflow eval stream JSON', { workflowId, error })
        enqueue(refetchCanonicalSnapshot)
        return
      }

      const validation = workflowEvalStreamEventSchema.safeParse(parsed)
      if (!validation.success) {
        logger.warn('Received invalid workflow eval stream event', {
          workflowId,
          error: validation.error.message,
        })
        enqueue(refetchCanonicalSnapshot)
        return
      }

      if (!cancelled && validation.data.run.status !== 'queued') {
        onConnectionChangeRef.current(true)
      }

      enqueue(async () => {
        await queryClient.cancelQueries({ queryKey })
        let requiresRefetch = false
        queryClient.setQueryData<WorkflowEvalSuitesResponse>(queryKey, (current) => {
          const applied = applyWorkflowEvalStreamEvent(current, workflowId, validation.data)
          requiresRefetch = applied.requiresRefetch
          return applied.data
        })
        if (requiresRefetch) {
          await refetchCanonicalSnapshot()
        }
      })
    })

    eventSource.onerror = () => {
      if (!cancelled) onConnectionChangeRef.current(false)
    }

    return () => {
      cancelled = true
      eventSource.close()
    }
  }, [enabled, queryClient, workflowId])
}

export function useWorkflowEvalSuites(
  workflowId: string | undefined,
  { active }: UseWorkflowEvalSuitesOptions
) {
  const [isStreamConnected, setIsStreamConnected] = useState(false)
  const query = useQuery({
    queryKey: workflowEvalKeys.suiteList(workflowId),
    queryFn: ({ signal }) => fetchWorkflowEvalSuites(workflowId as string, signal),
    enabled: Boolean(workflowId),
    staleTime: WORKFLOW_EVAL_SUITES_STALE_TIME,
    refetchInterval: (queryState) =>
      getWorkflowEvalRefetchInterval(active, isStreamConnected, queryState.state.data),
  })

  useWorkflowEvalEventStream({
    workflowId,
    enabled: active && query.data?.enabled === true,
    onConnectionChange: setIsStreamConnected,
  })

  return query
}

export function useStartWorkflowEvalSuiteRun(workflowId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (suiteId: string) => {
      if (!workflowId) {
        throw new Error('A workflow id is required to start an eval suite')
      }

      return requestJson(startWorkflowEvalSuiteRunContract, {
        params: { id: workflowId, suiteId },
        body: {},
      })
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: workflowEvalKeys.suiteList(workflowId) }),
  })
}

interface StartWorkflowEvalTestRunVariables {
  suiteId: string
  testId: string
  expectedDefinitionRevision: number
}

export function useStartWorkflowEvalTestRun(workflowId: string | undefined) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      suiteId,
      testId,
      expectedDefinitionRevision,
    }: StartWorkflowEvalTestRunVariables) => {
      if (!workflowId) {
        throw new Error('A workflow id is required to retry an eval test')
      }

      return requestJson(startWorkflowEvalSuiteRunContract, {
        params: { id: workflowId, suiteId },
        body: { testId, expectedDefinitionRevision },
      })
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: workflowEvalKeys.suiteList(workflowId) }),
  })
}

export function useStopWorkflowEvalRun(workflowId: string | undefined) {
  const queryClient = useQueryClient()
  const queryKey = workflowEvalKeys.suiteList(workflowId)

  return useMutation({
    mutationFn: ({ suiteId, runId }: { suiteId: string; runId: string }) => {
      if (!workflowId) {
        throw new Error('A workflow id is required to stop an eval run')
      }

      return requestJson(stopWorkflowEvalRunContract, {
        params: { id: workflowId, suiteId, runId },
      })
    },
    onMutate: async ({ suiteId, runId }) => {
      await queryClient.cancelQueries({ queryKey })

      const current = queryClient.getQueryData<WorkflowEvalSuitesResponse>(queryKey)
      const previousRun = current?.suites.find((suite) => suite.id === suiteId)?.latestRun ?? null
      const canOptimisticallyCancel =
        previousRun?.id === runId &&
        (previousRun.status === 'queued' || previousRun.status === 'running')

      if (!canOptimisticallyCancel) return { previousRun: null, suiteId, runId }

      queryClient.setQueryData<WorkflowEvalSuitesResponse>(queryKey, (current) => {
        if (!current) return current

        const suiteIndex = current.suites.findIndex((suite) => suite.id === suiteId)
        if (suiteIndex === -1) return current

        const suite = current.suites[suiteIndex]
        const run = suite.latestRun
        if (!run || run.id !== runId || (run.status !== 'queued' && run.status !== 'running')) {
          return current
        }

        const suites = current.suites.slice()
        suites[suiteIndex] = {
          ...suite,
          latestRun: {
            ...run,
            status: 'cancelled',
            completedAt: new Date(),
          },
        }
        return { ...current, suites }
      })

      return { previousRun, suiteId, runId }
    },
    onError: (_error, _variables, context) => {
      if (!context?.previousRun) return
      const previousRun = context.previousRun

      queryClient.setQueryData<WorkflowEvalSuitesResponse>(queryKey, (current) => {
        if (!current) return current

        const suiteIndex = current.suites.findIndex((suite) => suite.id === context.suiteId)
        if (suiteIndex === -1) return current

        const suite = current.suites[suiteIndex]
        const run = suite.latestRun
        if (
          !run ||
          run.id !== context.runId ||
          run.status !== 'cancelled' ||
          run.revision !== previousRun.revision
        ) {
          return current
        }

        const suites = current.suites.slice()
        suites[suiteIndex] = { ...suite, latestRun: previousRun }
        return { ...current, suites }
      })
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  })
}
