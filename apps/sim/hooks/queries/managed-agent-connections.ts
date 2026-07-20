import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  createManagedAgentConnectionContract,
  deleteManagedAgentConnectionContract,
  listManagedAgentAgentsContract,
  listManagedAgentConnectionsContract,
  listManagedAgentEnvironmentsContract,
  listManagedAgentMemoryStoresContract,
  listManagedAgentVaultsContract,
  type ManagedAgentAgent,
  type ManagedAgentConnection,
  type ManagedAgentEnvironment,
  type ManagedAgentMemoryStore,
  type ManagedAgentVault,
  rotateManagedAgentConnectionContract,
} from '@/lib/api/contracts'

const logger = createLogger('ManagedAgentConnectionsQueries')

export const MANAGED_AGENT_CONNECTION_LIST_STALE_TIME = 60 * 1000
export const MANAGED_AGENT_RESOURCE_STALE_TIME = 5 * 60 * 1000

export const managedAgentConnectionsKeys = {
  all: ['managed-agent-connections'] as const,
  lists: () => [...managedAgentConnectionsKeys.all, 'list'] as const,
  list: (workspaceId: string) =>
    [...managedAgentConnectionsKeys.lists(), workspaceId] as const,
  agents: (connectionId: string, workspaceId: string) =>
    [...managedAgentConnectionsKeys.all, 'agents', workspaceId, connectionId] as const,
  environments: (connectionId: string, workspaceId: string) =>
    [
      ...managedAgentConnectionsKeys.all,
      'environments',
      workspaceId,
      connectionId,
    ] as const,
  vaults: (connectionId: string, workspaceId: string) =>
    [...managedAgentConnectionsKeys.all, 'vaults', workspaceId, connectionId] as const,
  memoryStores: (connectionId: string, workspaceId: string) =>
    [
      ...managedAgentConnectionsKeys.all,
      'memory-stores',
      workspaceId,
      connectionId,
    ] as const,
}

async function fetchConnections(
  workspaceId: string,
  signal?: AbortSignal
): Promise<ManagedAgentConnection[]> {
  const { data } = await requestJson(listManagedAgentConnectionsContract, {
    query: { workspaceId },
    signal,
  })
  return data
}

export function useManagedAgentConnections(workspaceId: string) {
  return useQuery<ManagedAgentConnection[]>({
    queryKey: managedAgentConnectionsKeys.list(workspaceId),
    queryFn: ({ signal }) => fetchConnections(workspaceId, signal),
    enabled: !!workspaceId,
    staleTime: MANAGED_AGENT_CONNECTION_LIST_STALE_TIME,
    placeholderData: keepPreviousData,
  })
}

interface CreateConnectionParams {
  workspaceId: string
  name: string
  apiKey: string
}

export function useCreateManagedAgentConnection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ workspaceId, name, apiKey }: CreateConnectionParams) => {
      logger.info(`Creating managed-agent connection: ${name}`)
      const { data } = await requestJson(createManagedAgentConnectionContract, {
        body: { workspaceId, name, apiKey },
      })
      return data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: managedAgentConnectionsKeys.list(variables.workspaceId),
      })
    },
  })
}

interface DeleteConnectionParams {
  workspaceId: string
  id: string
}

export function useDeleteManagedAgentConnection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ workspaceId, id }: DeleteConnectionParams) => {
      logger.info(`Deleting managed-agent connection ${id}`)
      const data = await requestJson(deleteManagedAgentConnectionContract, {
        query: { id, workspaceId },
      })
      return data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: managedAgentConnectionsKeys.list(variables.workspaceId),
      })
    },
  })
}

interface RotateKeyParams {
  workspaceId: string
  id: string
  apiKey: string
}

export function useRotateManagedAgentConnection() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ workspaceId, id, apiKey }: RotateKeyParams) => {
      logger.info(`Rotating managed-agent connection ${id}`)
      const { data } = await requestJson(rotateManagedAgentConnectionContract, {
        params: { id },
        body: { workspaceId, apiKey },
      })
      return data
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: managedAgentConnectionsKeys.list(variables.workspaceId),
      })
    },
  })
}

async function fetchAgents(
  connectionId: string,
  workspaceId: string,
  signal?: AbortSignal
): Promise<ManagedAgentAgent[]> {
  const { data } = await requestJson(listManagedAgentAgentsContract, {
    params: { id: connectionId },
    query: { workspaceId },
    signal,
  })
  return data
}

/**
 * Loads agents from the linked Claude workspace tied to `connectionId`.
 * Empty `connectionId` disables the query so the block editor doesn't
 * fire a bad request while the user hasn't picked a connection yet.
 */
export function useManagedAgentAgents(connectionId: string | null, workspaceId: string) {
  return useQuery<ManagedAgentAgent[]>({
    queryKey: managedAgentConnectionsKeys.agents(connectionId ?? '', workspaceId),
    queryFn: ({ signal }) => fetchAgents(connectionId as string, workspaceId, signal),
    enabled: !!connectionId && !!workspaceId,
    staleTime: MANAGED_AGENT_RESOURCE_STALE_TIME,
  })
}

async function fetchEnvironments(
  connectionId: string,
  workspaceId: string,
  signal?: AbortSignal
): Promise<ManagedAgentEnvironment[]> {
  const { data } = await requestJson(listManagedAgentEnvironmentsContract, {
    params: { id: connectionId },
    query: { workspaceId },
    signal,
  })
  return data
}

export function useManagedAgentEnvironments(
  connectionId: string | null,
  workspaceId: string
) {
  return useQuery<ManagedAgentEnvironment[]>({
    queryKey: managedAgentConnectionsKeys.environments(connectionId ?? '', workspaceId),
    queryFn: ({ signal }) => fetchEnvironments(connectionId as string, workspaceId, signal),
    enabled: !!connectionId && !!workspaceId,
    staleTime: MANAGED_AGENT_RESOURCE_STALE_TIME,
  })
}

async function fetchVaults(
  connectionId: string,
  workspaceId: string,
  signal?: AbortSignal
): Promise<ManagedAgentVault[]> {
  const { data } = await requestJson(listManagedAgentVaultsContract, {
    params: { id: connectionId },
    query: { workspaceId },
    signal,
  })
  return data
}

export function useManagedAgentVaults(connectionId: string | null, workspaceId: string) {
  return useQuery<ManagedAgentVault[]>({
    queryKey: managedAgentConnectionsKeys.vaults(connectionId ?? '', workspaceId),
    queryFn: ({ signal }) => fetchVaults(connectionId as string, workspaceId, signal),
    enabled: !!connectionId && !!workspaceId,
    staleTime: MANAGED_AGENT_RESOURCE_STALE_TIME,
  })
}

async function fetchMemoryStores(
  connectionId: string,
  workspaceId: string,
  signal?: AbortSignal
): Promise<ManagedAgentMemoryStore[]> {
  const { data } = await requestJson(listManagedAgentMemoryStoresContract, {
    params: { id: connectionId },
    query: { workspaceId },
    signal,
  })
  return data
}

export function useManagedAgentMemoryStores(
  connectionId: string | null,
  workspaceId: string
) {
  return useQuery<ManagedAgentMemoryStore[]>({
    queryKey: managedAgentConnectionsKeys.memoryStores(connectionId ?? '', workspaceId),
    queryFn: ({ signal }) => fetchMemoryStores(connectionId as string, workspaceId, signal),
    enabled: !!connectionId && !!workspaceId,
    staleTime: MANAGED_AGENT_RESOURCE_STALE_TIME,
  })
}
