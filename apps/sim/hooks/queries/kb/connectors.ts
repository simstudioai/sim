import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type ConnectorData,
  type ConnectorDetailData,
  type ConnectorDocumentsData,
  createKnowledgeConnectorContract,
  deleteKnowledgeConnectorContract,
  getKnowledgeConnectorContract,
  listKnowledgeConnectorDocumentsContract,
  listKnowledgeConnectorsContract,
  patchKnowledgeConnectorDocumentsContract,
  type SyncLogData,
  triggerKnowledgeConnectorSyncContract,
  updateKnowledgeConnectorContract,
} from '@/lib/api/contracts/knowledge'
import { knowledgeKeys } from '@/hooks/queries/kb/knowledge'

const logger = createLogger('KnowledgeConnectorQueries')

export type { ConnectorData, ConnectorDetailData, SyncLogData }

export const connectorKeys = {
  all: (knowledgeBaseId: string) =>
    [...knowledgeKeys.detail(knowledgeBaseId), 'connectors'] as const,
  list: (knowledgeBaseId?: string) =>
    [...knowledgeKeys.detail(knowledgeBaseId), 'connectors', 'list'] as const,
  detail: (knowledgeBaseId?: string, connectorId?: string) =>
    [...knowledgeKeys.detail(knowledgeBaseId), 'connectors', 'detail', connectorId ?? ''] as const,
}

async function fetchConnectors(
  knowledgeBaseId: string,
  signal?: AbortSignal
): Promise<ConnectorData[]> {
  const result = await requestJson(listKnowledgeConnectorsContract, {
    params: { id: knowledgeBaseId },
    signal,
  })

  return result.data
}

async function fetchConnectorDetail(
  knowledgeBaseId: string,
  connectorId: string,
  signal?: AbortSignal
): Promise<ConnectorDetailData> {
  const result = await requestJson(getKnowledgeConnectorContract, {
    params: { id: knowledgeBaseId, connectorId },
    signal,
  })

  return result.data
}

/** Stop polling for initial sync after 2 minutes */
const PENDING_SYNC_WINDOW_MS = 2 * 60 * 1000

/**
 * Checks if a connector is syncing or awaiting its first sync within the allowed window
 */
export function isConnectorSyncingOrPending(connector: ConnectorData): boolean {
  if (connector.status === 'syncing') return true
  return (
    connector.status === 'active' &&
    !connector.lastSyncAt &&
    Date.now() - new Date(connector.createdAt).getTime() < PENDING_SYNC_WINDOW_MS
  )
}

export function useConnectorList(knowledgeBaseId?: string) {
  return useQuery({
    queryKey: connectorKeys.list(knowledgeBaseId),
    queryFn: ({ signal }) => fetchConnectors(knowledgeBaseId as string, signal),
    enabled: Boolean(knowledgeBaseId),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      const connectors = query.state.data
      if (!connectors?.length) return false
      return connectors.some(isConnectorSyncingOrPending) ? 3000 : false
    },
  })
}

export function useConnectorDetail(knowledgeBaseId?: string, connectorId?: string) {
  return useQuery({
    queryKey: connectorKeys.detail(knowledgeBaseId, connectorId),
    queryFn: ({ signal }) =>
      fetchConnectorDetail(knowledgeBaseId as string, connectorId as string, signal),
    enabled: Boolean(knowledgeBaseId && connectorId),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

interface CreateConnectorParams {
  knowledgeBaseId: string
  connectorType: string
  credentialId?: string
  apiKey?: string
  sourceConfig: Record<string, unknown>
  syncIntervalMinutes?: number
}

async function createConnector({
  knowledgeBaseId,
  ...body
}: CreateConnectorParams): Promise<ConnectorData> {
  const result = await requestJson(createKnowledgeConnectorContract, {
    params: { id: knowledgeBaseId },
    body,
  })

  return result.data
}

export function useCreateConnector() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createConnector,
    onSettled: (_data, _error, { knowledgeBaseId }) => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(knowledgeBaseId),
      })
    },
  })
}

interface UpdateConnectorParams {
  knowledgeBaseId: string
  connectorId: string
  updates: {
    sourceConfig?: Record<string, unknown>
    syncIntervalMinutes?: number
    status?: 'active' | 'paused'
  }
}

async function updateConnector({
  knowledgeBaseId,
  connectorId,
  updates,
}: UpdateConnectorParams): Promise<ConnectorData> {
  const result = await requestJson(updateKnowledgeConnectorContract, {
    params: { id: knowledgeBaseId, connectorId },
    body: updates,
  })

  return result.data
}

export function useUpdateConnector() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateConnector,
    onSettled: (_data, _error, { knowledgeBaseId }) => {
      queryClient.invalidateQueries({
        queryKey: connectorKeys.all(knowledgeBaseId),
      })
    },
  })
}

interface DeleteConnectorParams {
  knowledgeBaseId: string
  connectorId: string
  deleteDocuments?: boolean
}

async function deleteConnector({
  knowledgeBaseId,
  connectorId,
  deleteDocuments,
}: DeleteConnectorParams): Promise<void> {
  await requestJson(deleteKnowledgeConnectorContract, {
    params: { id: knowledgeBaseId, connectorId },
    query: { deleteDocuments },
  })
}

export function useDeleteConnector() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteConnector,
    onSettled: (_data, _error, { knowledgeBaseId }) => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(knowledgeBaseId),
      })
    },
  })
}

interface TriggerSyncParams {
  knowledgeBaseId: string
  connectorId: string
}

async function triggerSync({ knowledgeBaseId, connectorId }: TriggerSyncParams): Promise<void> {
  await requestJson(triggerKnowledgeConnectorSyncContract, {
    params: { id: knowledgeBaseId, connectorId },
  })
}

export function useTriggerSync() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: triggerSync,
    onSettled: (_data, _error, { knowledgeBaseId }) => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(knowledgeBaseId),
      })
    },
  })
}

export const connectorDocumentKeys = {
  list: (knowledgeBaseId?: string, connectorId?: string) =>
    [...connectorKeys.detail(knowledgeBaseId, connectorId), 'documents'] as const,
}

async function fetchConnectorDocuments(
  knowledgeBaseId: string,
  connectorId: string,
  includeExcluded: boolean,
  signal?: AbortSignal
): Promise<ConnectorDocumentsData> {
  const result = await requestJson(listKnowledgeConnectorDocumentsContract, {
    params: { id: knowledgeBaseId, connectorId },
    query: { includeExcluded },
    signal,
  })

  return result.data
}

export function useConnectorDocuments(
  knowledgeBaseId?: string,
  connectorId?: string,
  options?: { includeExcluded?: boolean }
) {
  return useQuery({
    queryKey: [
      ...connectorDocumentKeys.list(knowledgeBaseId, connectorId),
      options?.includeExcluded ?? false,
    ],
    queryFn: ({ signal }) =>
      fetchConnectorDocuments(
        knowledgeBaseId as string,
        connectorId as string,
        options?.includeExcluded ?? false,
        signal
      ),
    enabled: Boolean(knowledgeBaseId && connectorId),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

interface ConnectorDocumentMutationParams {
  knowledgeBaseId: string
  connectorId: string
  documentIds: string[]
}

async function excludeConnectorDocuments({
  knowledgeBaseId,
  connectorId,
  documentIds,
}: ConnectorDocumentMutationParams): Promise<{ excludedCount: number }> {
  const result = await requestJson(patchKnowledgeConnectorDocumentsContract, {
    params: { id: knowledgeBaseId, connectorId },
    body: { operation: 'exclude', documentIds },
  })

  return { excludedCount: result.data.excludedCount ?? 0 }
}

export function useExcludeConnectorDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: excludeConnectorDocuments,
    onSettled: (_data, _error, { knowledgeBaseId, connectorId }) => {
      queryClient.invalidateQueries({
        queryKey: connectorDocumentKeys.list(knowledgeBaseId, connectorId),
      })
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(knowledgeBaseId),
      })
    },
  })
}

async function restoreConnectorDocuments({
  knowledgeBaseId,
  connectorId,
  documentIds,
}: ConnectorDocumentMutationParams): Promise<{ restoredCount: number }> {
  const result = await requestJson(patchKnowledgeConnectorDocumentsContract, {
    params: { id: knowledgeBaseId, connectorId },
    body: { operation: 'restore', documentIds },
  })

  return { restoredCount: result.data.restoredCount ?? 0 }
}

export function useRestoreConnectorDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: restoreConnectorDocuments,
    onSettled: (_data, _error, { knowledgeBaseId, connectorId }) => {
      queryClient.invalidateQueries({
        queryKey: connectorDocumentKeys.list(knowledgeBaseId, connectorId),
      })
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(knowledgeBaseId),
      })
    },
  })
}
