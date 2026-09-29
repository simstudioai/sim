import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type BenchmarkResponse,
  type CreateBenchmarkBody,
  createBenchmarkContract,
  type DeleteBenchmarkBody,
  deleteBenchmarkContract,
  getBenchmarkContract,
  listBenchmarksContract,
  type RunBenchmarkStageBody,
  runBenchmarkStageContract,
  type UpdateBenchmarkBody,
  updateBenchmarkContract,
} from '@/lib/api/contracts/benchmarks'

export const benchmarkKeys = {
  all: ['benchmarks'] as const,
  lists: () => [...benchmarkKeys.all, 'list'] as const,
  list: (organizationId: string) => [...benchmarkKeys.lists(), organizationId] as const,
  details: () => [...benchmarkKeys.all, 'detail'] as const,
  detail: (organizationId: string, benchmarkId: string) =>
    [...benchmarkKeys.details(), organizationId, benchmarkId] as const,
}

export const BENCHMARK_STALE_TIME = 10_000
const BENCHMARK_POLL_INTERVAL = 2_000
const BENCHMARK_PAGE_SIZE = 20

export function useBenchmarks(organizationId: string) {
  return useInfiniteQuery({
    queryKey: benchmarkKeys.list(organizationId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      requestJson(listBenchmarksContract, {
        params: { id: organizationId },
        query: { cursor: pageParam, limit: BENCHMARK_PAGE_SIZE },
        signal,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
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
      queryClient.setQueryData<BenchmarkResponse>(queryKey, (current) =>
        current
          ? { ...current, benchmark: { ...current.benchmark, runningStage: stage, error: null } }
          : current
      )
    },
    onSuccess: (data) => queryClient.setQueryData(queryKey, data),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey })
      queryClient.invalidateQueries({ queryKey: benchmarkKeys.list(organizationId) })
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
