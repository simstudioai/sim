import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type BenchmarkResponse,
  benchmarkAvailabilityContract,
  benchmarkOrganizationsContract,
  benchmarkUsersContract,
  benchmarkWorkspacesContract,
  type CreateBenchmarkBody,
  createBenchmarkContract,
  type DeleteBenchmarkBody,
  deleteBenchmarkContract,
  getBenchmarkContract,
  getBenchmarkRunContract,
  listBenchmarkRunsContract,
  listBenchmarksContract,
  type ReviewBenchmarkRunBody,
  type RunBenchmarkStageBody,
  reviewBenchmarkRunContract,
  runBenchmarkStageContract,
  type UpdateBenchmarkBody,
  updateBenchmarkContract,
} from '@/lib/api/contracts/benchmarks'

const benchmarkKeys = {
  all: ['benchmarks'] as const,
  lists: () => [...benchmarkKeys.all, 'list'] as const,
  list: (organizationId: string, runAsUserId?: string) =>
    [...benchmarkKeys.lists(), organizationId, ...(runAsUserId ? [runAsUserId] : [])] as const,
  selections: () => [...benchmarkKeys.all, 'selection'] as const,
  selection: (
    kind: string,
    organizationId: string,
    userId: string,
    search: string,
    selectedId = ''
  ) => [...benchmarkKeys.selections(), kind, organizationId, userId, search, selectedId] as const,
  availability: () => [...benchmarkKeys.all, 'availability'] as const,
  details: () => [...benchmarkKeys.all, 'detail'] as const,
  detail: (organizationId: string, benchmarkId: string) =>
    [...benchmarkKeys.details(), organizationId, benchmarkId] as const,
  runLists: () => [...benchmarkKeys.all, 'runs', 'list'] as const,
  runList: (organizationId: string, benchmarkId: string) =>
    [...benchmarkKeys.runLists(), organizationId, benchmarkId] as const,
  runPage: (organizationId: string, benchmarkId: string, cursor: string) =>
    [...benchmarkKeys.runList(organizationId, benchmarkId), cursor] as const,
  runs: () => [...benchmarkKeys.all, 'runs', 'detail'] as const,
  run: (organizationId: string, benchmarkId: string, runId: string) =>
    [...benchmarkKeys.runs(), organizationId, benchmarkId, runId] as const,
}

const BENCHMARK_STALE_TIME = 10_000
const BENCHMARK_POLL_INTERVAL = 2_000
const BENCHMARK_PAGE_SIZE = 20

export function useBenchmarks(organizationId: string, runAsUserId?: string) {
  return useInfiniteQuery({
    queryKey: benchmarkKeys.list(organizationId, runAsUserId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      requestJson(listBenchmarksContract, {
        params: { id: organizationId },
        query: { cursor: pageParam, limit: BENCHMARK_PAGE_SIZE, runAsUserId },
        signal,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: BENCHMARK_STALE_TIME,
  })
}

export function useBenchmarkAvailability(enabled = true) {
  return useQuery({
    queryKey: benchmarkKeys.availability(),
    queryFn: ({ signal }) => requestJson(benchmarkAvailabilityContract, { signal }),
    enabled,
    staleTime: BENCHMARK_STALE_TIME,
  })
}

export function useBenchmarkOrganizations(search: string, selectedId = '') {
  return useInfiniteQuery({
    queryKey: benchmarkKeys.selection('organizations', '', '', search, selectedId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      requestJson(benchmarkOrganizationsContract, {
        query: { search, cursor: pageParam, selectedId: selectedId || undefined },
        signal,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: BENCHMARK_STALE_TIME,
  })
}

export function useBenchmarkUsers(organizationId: string, search: string, selectedId = '') {
  return useInfiniteQuery({
    queryKey: benchmarkKeys.selection('users', organizationId, '', search, selectedId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      requestJson(benchmarkUsersContract, {
        params: { id: organizationId },
        query: { search, cursor: pageParam, selectedId: selectedId || undefined },
        signal,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: Boolean(organizationId),
    staleTime: BENCHMARK_STALE_TIME,
  })
}

export function useBenchmarkWorkspaces(organizationId: string, runAsUserId: string, search = '') {
  return useInfiniteQuery({
    queryKey: benchmarkKeys.selection('workspaces', organizationId, runAsUserId, search),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      requestJson(benchmarkWorkspacesContract, {
        params: { id: organizationId },
        query: { runAsUserId, search, cursor: pageParam },
        signal,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: Boolean(organizationId && runAsUserId),
    staleTime: BENCHMARK_STALE_TIME,
  })
}

export function useBenchmark(organizationId: string, benchmarkId: string) {
  return useQuery({
    queryKey: benchmarkKeys.detail(organizationId, benchmarkId),
    queryFn: ({ signal }) =>
      requestJson(getBenchmarkContract, {
        params: { id: organizationId, benchmarkId },
        signal,
      }),
    enabled: Boolean(benchmarkId),
    staleTime: BENCHMARK_STALE_TIME,
    refetchInterval: (query) => {
      const benchmark = query.state.data?.benchmark
      if (!benchmark?.runningStage || !benchmark.leaseExpiresAt) return false
      return Date.parse(benchmark.leaseExpiresAt) > Date.now() ? BENCHMARK_POLL_INTERVAL : false
    },
  })
}

export function useBenchmarkRuns(organizationId: string, benchmarkId: string, cursor: string) {
  return useQuery({
    queryKey: benchmarkKeys.runPage(organizationId, benchmarkId, cursor),
    queryFn: ({ signal }) =>
      requestJson(listBenchmarkRunsContract, {
        params: { id: organizationId, benchmarkId },
        query: { cursor: cursor || undefined, limit: BENCHMARK_PAGE_SIZE },
        signal,
      }),
    staleTime: BENCHMARK_STALE_TIME,
  })
}

export function useBenchmarkRun(organizationId: string, benchmarkId: string, runId: string) {
  return useQuery({
    queryKey: benchmarkKeys.run(organizationId, benchmarkId, runId),
    queryFn: ({ signal }) =>
      requestJson(getBenchmarkRunContract, {
        params: { id: organizationId, benchmarkId, runId },
        signal,
      }),
    enabled: Boolean(runId),
    staleTime: BENCHMARK_STALE_TIME,
  })
}

export function useReviewBenchmarkRun(organizationId: string, benchmarkId: string, runId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: ReviewBenchmarkRunBody) =>
      requestJson(reviewBenchmarkRunContract, {
        params: { id: organizationId, benchmarkId, runId },
        body,
      }),
    onSuccess: (data) =>
      queryClient.setQueryData(benchmarkKeys.run(organizationId, benchmarkId, runId), data),
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: benchmarkKeys.run(organizationId, benchmarkId, runId),
      })
      queryClient.invalidateQueries({
        queryKey: benchmarkKeys.runList(organizationId, benchmarkId),
      })
    },
  })
}

export function useCreateBenchmark(organizationId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateBenchmarkBody) =>
      requestJson(createBenchmarkContract, { params: { id: organizationId }, body }),
    onSuccess: (data) => {
      queryClient.setQueryData(benchmarkKeys.detail(organizationId, data.benchmark.id), data)
      queryClient.invalidateQueries({ queryKey: benchmarkKeys.list(organizationId) })
    },
  })
}

export function useUpdateBenchmark(organizationId: string, benchmarkId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: UpdateBenchmarkBody) =>
      requestJson(updateBenchmarkContract, {
        params: { id: organizationId, benchmarkId },
        body,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(benchmarkKeys.detail(organizationId, benchmarkId), data)
      queryClient.invalidateQueries({ queryKey: benchmarkKeys.list(organizationId) })
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: benchmarkKeys.detail(organizationId, benchmarkId) })
    },
  })
}

export function useRunBenchmarkStage(organizationId: string, benchmarkId: string) {
  const queryClient = useQueryClient()
  const queryKey = benchmarkKeys.detail(organizationId, benchmarkId)
  return useMutation({
    mutationFn: (body: RunBenchmarkStageBody) =>
      requestJson(runBenchmarkStageContract, {
        params: { id: organizationId, benchmarkId },
        body,
      }),
    onMutate: async ({ stage }) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<BenchmarkResponse>(queryKey)
      queryClient.setQueryData<BenchmarkResponse>(queryKey, (current) =>
        current
          ? { ...current, benchmark: { ...current.benchmark, runningStage: stage, error: null } }
          : current
      )
      return { previous }
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous)
    },
    onSuccess: (data) => queryClient.setQueryData(queryKey, data),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey })
      queryClient.invalidateQueries({ queryKey: benchmarkKeys.list(organizationId) })
      queryClient.invalidateQueries({
        queryKey: benchmarkKeys.runList(organizationId, benchmarkId),
      })
    },
  })
}

export function useDeleteBenchmark(organizationId: string, benchmarkId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: DeleteBenchmarkBody) =>
      requestJson(deleteBenchmarkContract, {
        params: { id: organizationId, benchmarkId },
        body,
      }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: benchmarkKeys.detail(organizationId, benchmarkId) })
      queryClient.invalidateQueries({ queryKey: benchmarkKeys.list(organizationId) })
    },
    onError: () => {
      queryClient.invalidateQueries({ queryKey: benchmarkKeys.detail(organizationId, benchmarkId) })
    },
  })
}
