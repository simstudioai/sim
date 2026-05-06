import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type CreateDataDrainBody,
  createDataDrainContract,
  type DataDrain,
  type DataDrainRun,
  deleteDataDrainContract,
  listDataDrainRunsContract,
  listDataDrainsContract,
  runDataDrainContract,
  testDataDrainContract,
  type UpdateDataDrainBody,
  updateDataDrainContract,
} from '@/lib/api/contracts/data-drains'

const logger = createLogger('DataDrainsQueries')

export const dataDrainKeys = {
  all: ['data-drains'] as const,
  lists: () => [...dataDrainKeys.all, 'list'] as const,
  list: (organizationId?: string) => [...dataDrainKeys.lists(), organizationId ?? ''] as const,
  runsAll: () => [...dataDrainKeys.all, 'runs'] as const,
  runs: (drainId?: string) => [...dataDrainKeys.runsAll(), drainId ?? ''] as const,
  runsList: (organizationId?: string, drainId?: string, limit?: number) =>
    [...dataDrainKeys.runs(drainId), organizationId ?? '', limit ?? 10] as const,
}

async function fetchDataDrains(organizationId: string, signal?: AbortSignal): Promise<DataDrain[]> {
  const { drains } = await requestJson(listDataDrainsContract, {
    params: { id: organizationId },
    signal,
  })
  return drains
}

async function fetchDataDrainRuns(
  organizationId: string,
  drainId: string,
  limit: number | undefined,
  signal?: AbortSignal
): Promise<DataDrainRun[]> {
  const { runs } = await requestJson(listDataDrainRunsContract, {
    params: { id: organizationId, drainId },
    query: limit ? { limit } : undefined,
    signal,
  })
  return runs
}

export function useDataDrains(organizationId?: string) {
  return useQuery<DataDrain[]>({
    queryKey: dataDrainKeys.list(organizationId),
    queryFn: ({ signal }) => fetchDataDrains(organizationId as string, signal),
    enabled: Boolean(organizationId),
    staleTime: 60 * 1000,
  })
}

export function useDataDrainRuns(organizationId?: string, drainId?: string, limit = 10) {
  return useQuery<DataDrainRun[]>({
    queryKey: dataDrainKeys.runsList(organizationId, drainId, limit),
    queryFn: ({ signal }) =>
      fetchDataDrainRuns(organizationId as string, drainId as string, limit, signal),
    enabled: Boolean(organizationId && drainId),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

interface CreateDataDrainParams {
  organizationId: string
  body: CreateDataDrainBody
}

export function useCreateDataDrain() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ organizationId, body }: CreateDataDrainParams) => {
      const { drain } = await requestJson(createDataDrainContract, {
        params: { id: organizationId },
        body,
      })
      logger.info('Created data drain', { drainId: drain.id, organizationId })
      return drain
    },
    onSuccess: (_drain, variables) => {
      queryClient.invalidateQueries({ queryKey: dataDrainKeys.list(variables.organizationId) })
    },
  })
}

interface UpdateDataDrainParams {
  organizationId: string
  drainId: string
  body: UpdateDataDrainBody
}

export function useUpdateDataDrain() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ organizationId, drainId, body }: UpdateDataDrainParams) => {
      const { drain } = await requestJson(updateDataDrainContract, {
        params: { id: organizationId, drainId },
        body,
      })
      logger.info('Updated data drain', { drainId, organizationId })
      return drain
    },
    onSuccess: (_drain, variables) => {
      queryClient.invalidateQueries({ queryKey: dataDrainKeys.list(variables.organizationId) })
    },
  })
}

interface DeleteDataDrainParams {
  organizationId: string
  drainId: string
}

export function useDeleteDataDrain() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ organizationId, drainId }: DeleteDataDrainParams) => {
      await requestJson(deleteDataDrainContract, {
        params: { id: organizationId, drainId },
      })
      logger.info('Deleted data drain', { drainId, organizationId })
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: dataDrainKeys.list(variables.organizationId) })
      queryClient.removeQueries({ queryKey: dataDrainKeys.runs(variables.drainId) })
    },
  })
}

interface RunDataDrainParams {
  organizationId: string
  drainId: string
}

export function useRunDataDrainNow() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ organizationId, drainId }: RunDataDrainParams) => {
      const data = await requestJson(runDataDrainContract, {
        params: { id: organizationId, drainId },
      })
      logger.info('Enqueued data drain run', { drainId, jobId: data.jobId })
      return data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: dataDrainKeys.runs(variables.drainId) })
      queryClient.invalidateQueries({ queryKey: dataDrainKeys.list(variables.organizationId) })
    },
  })
}

interface TestDataDrainParams {
  organizationId: string
  drainId: string
}

export function useTestDataDrain() {
  return useMutation({
    mutationFn: async ({ organizationId, drainId }: TestDataDrainParams) => {
      return await requestJson(testDataDrainContract, {
        params: { id: organizationId, drainId },
      })
    },
  })
}
