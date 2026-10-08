import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getWorkflowTestContract,
  getWorkflowTestRunContract,
  listWorkflowTestsContract,
  runWorkflowTestsContract,
} from '@/lib/api/contracts/workflow-tests'

export type WorkflowTestVersion = 'draft' | 'deployed'

const WORKFLOW_TEST_STALE_TIME = 15_000
/** While a run is in flight, so its result appears when it lands. */
const WORKFLOW_TEST_RUNNING_REFETCH_INTERVAL = 1_000

export const workflowTestKeys = {
  all: ['workflow-tests'] as const,
  lists: () => [...workflowTestKeys.all, 'list'] as const,
  list: (workspaceId: string) => [...workflowTestKeys.lists(), workspaceId] as const,
  details: () => [...workflowTestKeys.all, 'detail'] as const,
  test: (workspaceId: string, name: string) =>
    [...workflowTestKeys.details(), workspaceId, name] as const,
  detail: (workspaceId: string, name: string) =>
    [...workflowTestKeys.test(workspaceId, name), 'detail'] as const,
  run: (workspaceId: string, name: string, runId: string) =>
    [...workflowTestKeys.test(workspaceId, name), 'run', runId] as const,
}

/** Every test with its recent runs, draft and deployed alike. */
export function useWorkflowTests(workspaceId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: workflowTestKeys.list(workspaceId),
    queryFn: ({ signal }) =>
      requestJson(listWorkflowTestsContract, {
        params: { id: workspaceId },
        query: {},
        signal,
      }),
    enabled: Boolean(workspaceId) && (options?.enabled ?? true),
    staleTime: WORKFLOW_TEST_STALE_TIME,
    select: (data) => data.tests,
    refetchInterval: (query) =>
      query.state.data?.tests.some((test) => test.status === 'running')
        ? WORKFLOW_TEST_RUNNING_REFETCH_INTERVAL
        : false,
  })
}

/** One test with its latest run and history, draft and deployed alike. */
export function useWorkflowTest(workspaceId: string, name: string) {
  return useQuery({
    queryKey: workflowTestKeys.detail(workspaceId, name),
    queryFn: ({ signal }) =>
      requestJson(getWorkflowTestContract, {
        params: { id: workspaceId, name },
        query: {},
        signal,
      }),
    enabled: Boolean(workspaceId && name),
    staleTime: WORKFLOW_TEST_STALE_TIME,
    refetchInterval: (query) =>
      query.state.data?.latestRun?.status === 'running'
        ? WORKFLOW_TEST_RUNNING_REFETCH_INTERVAL
        : false,
  })
}

/** One earlier run with its report; null `runId` reads nothing. */
export function useWorkflowTestRun(workspaceId: string, name: string, runId: string | null) {
  return useQuery({
    queryKey: workflowTestKeys.run(workspaceId, name, runId ?? ''),
    queryFn: ({ signal }) =>
      requestJson(getWorkflowTestRunContract, {
        params: { id: workspaceId, name, runId: runId ?? '' },
        signal,
      }),
    enabled: Boolean(workspaceId && name && runId),
    staleTime: WORKFLOW_TEST_STALE_TIME,
    select: (data) => data.run,
  })
}

/** Refetches one test after its file changes, so its cases follow the edit. */
export function useRefreshWorkflowTest(workspaceId: string, name: string) {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: workflowTestKeys.lists() })
    queryClient.invalidateQueries({ queryKey: workflowTestKeys.test(workspaceId, name) })
  }
}

export function useRunWorkflowTests(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: { version: WorkflowTestVersion; names?: string[] }) =>
      requestJson(runWorkflowTestsContract, { params: { id: workspaceId }, body }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workflowTestKeys.lists() })
      queryClient.invalidateQueries({ queryKey: workflowTestKeys.details() })
    },
  })
}
