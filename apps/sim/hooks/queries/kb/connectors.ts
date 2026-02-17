import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { knowledgeKeys } from '@/hooks/queries/kb/knowledge'

const logger = createLogger('KnowledgeConnectorQueries')

export interface ConnectorData {
  id: string
  knowledgeBaseId: string
  connectorType: string
  credentialId: string
  sourceConfig: Record<string, unknown>
  syncMode: string
  syncIntervalMinutes: number
  status: 'active' | 'paused' | 'syncing' | 'error'
  lastSyncAt: string | null
  lastSyncError: string | null
  lastSyncDocCount: number | null
  nextSyncAt: string | null
  consecutiveFailures: number
  createdAt: string
  updatedAt: string
}

export interface SyncLogData {
  id: string
  connectorId: string
  status: string
  startedAt: string
  completedAt: string | null
  docsAdded: number
  docsUpdated: number
  docsDeleted: number
  docsUnchanged: number
  errorMessage: string | null
}

export interface ConnectorDetailData extends ConnectorData {
  syncLogs: SyncLogData[]
}

export const connectorKeys = {
  all: (knowledgeBaseId: string) =>
    [...knowledgeKeys.detail(knowledgeBaseId), 'connectors'] as const,
  list: (knowledgeBaseId?: string) =>
    [...knowledgeKeys.detail(knowledgeBaseId), 'connectors', 'list'] as const,
  detail: (knowledgeBaseId?: string, connectorId?: string) =>
    [...knowledgeKeys.detail(knowledgeBaseId), 'connectors', 'detail', connectorId ?? ''] as const,
}

async function fetchConnectors(knowledgeBaseId: string): Promise<ConnectorData[]> {
  const response = await fetch(`/api/knowledge/${knowledgeBaseId}/connectors`)

  if (!response.ok) {
    throw new Error(`Failed to fetch connectors: ${response.status}`)
  }

  const result = await response.json()
  if (!result?.success) {
    throw new Error(result?.error || 'Failed to fetch connectors')
  }

  return Array.isArray(result.data) ? result.data : []
}

async function fetchConnectorDetail(
  knowledgeBaseId: string,
  connectorId: string
): Promise<ConnectorDetailData> {
  const response = await fetch(`/api/knowledge/${knowledgeBaseId}/connectors/${connectorId}`)

  if (!response.ok) {
    throw new Error(`Failed to fetch connector: ${response.status}`)
  }

  const result = await response.json()
  if (!result?.success || !result?.data) {
    throw new Error(result?.error || 'Failed to fetch connector')
  }

  return result.data
}

export function useConnectorList(knowledgeBaseId?: string) {
  return useQuery({
    queryKey: connectorKeys.list(knowledgeBaseId),
    queryFn: () => fetchConnectors(knowledgeBaseId as string),
    enabled: Boolean(knowledgeBaseId),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
    refetchInterval: (query) => {
      const connectors = query.state.data
      const hasSyncing = connectors?.some((c) => c.status === 'syncing')
      return hasSyncing ? 3000 : false
    },
  })
}

export function useConnectorDetail(knowledgeBaseId?: string, connectorId?: string) {
  return useQuery({
    queryKey: connectorKeys.detail(knowledgeBaseId, connectorId),
    queryFn: () => fetchConnectorDetail(knowledgeBaseId as string, connectorId as string),
    enabled: Boolean(knowledgeBaseId && connectorId),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

export interface CreateConnectorParams {
  knowledgeBaseId: string
  connectorType: string
  credentialId: string
  sourceConfig: Record<string, unknown>
  syncIntervalMinutes?: number
}

async function createConnector({
  knowledgeBaseId,
  ...body
}: CreateConnectorParams): Promise<ConnectorData> {
  const response = await fetch(`/api/knowledge/${knowledgeBaseId}/connectors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const result = await response.json()
    throw new Error(result.error || 'Failed to create connector')
  }

  const result = await response.json()
  if (!result?.success || !result?.data) {
    throw new Error(result?.error || 'Failed to create connector')
  }

  return result.data
}

export function useCreateConnector() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createConnector,
    onSuccess: (_, { knowledgeBaseId }) => {
      queryClient.invalidateQueries({
        queryKey: connectorKeys.list(knowledgeBaseId),
      })
    },
  })
}

export interface UpdateConnectorParams {
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
  const response = await fetch(`/api/knowledge/${knowledgeBaseId}/connectors/${connectorId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })

  if (!response.ok) {
    const result = await response.json()
    throw new Error(result.error || 'Failed to update connector')
  }

  const result = await response.json()
  if (!result?.success) {
    throw new Error(result?.error || 'Failed to update connector')
  }

  return result.data
}

export function useUpdateConnector() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateConnector,
    onSuccess: (_, { knowledgeBaseId, connectorId }) => {
      queryClient.invalidateQueries({
        queryKey: connectorKeys.list(knowledgeBaseId),
      })
      queryClient.invalidateQueries({
        queryKey: connectorKeys.detail(knowledgeBaseId, connectorId),
      })
    },
  })
}

export interface DeleteConnectorParams {
  knowledgeBaseId: string
  connectorId: string
}

async function deleteConnector({
  knowledgeBaseId,
  connectorId,
}: DeleteConnectorParams): Promise<void> {
  const response = await fetch(`/api/knowledge/${knowledgeBaseId}/connectors/${connectorId}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    const result = await response.json()
    throw new Error(result.error || 'Failed to delete connector')
  }

  const result = await response.json()
  if (!result?.success) {
    throw new Error(result?.error || 'Failed to delete connector')
  }
}

export function useDeleteConnector() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteConnector,
    onSuccess: (_, { knowledgeBaseId }) => {
      queryClient.invalidateQueries({
        queryKey: connectorKeys.list(knowledgeBaseId),
      })
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(knowledgeBaseId),
      })
    },
  })
}

export interface TriggerSyncParams {
  knowledgeBaseId: string
  connectorId: string
}

async function triggerSync({ knowledgeBaseId, connectorId }: TriggerSyncParams): Promise<void> {
  const response = await fetch(`/api/knowledge/${knowledgeBaseId}/connectors/${connectorId}/sync`, {
    method: 'POST',
  })

  if (!response.ok) {
    const result = await response.json()
    throw new Error(result.error || 'Failed to trigger sync')
  }
}

export function useTriggerSync() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: triggerSync,
    onSuccess: (_, { knowledgeBaseId, connectorId }) => {
      queryClient.invalidateQueries({
        queryKey: connectorKeys.list(knowledgeBaseId),
      })
      queryClient.invalidateQueries({
        queryKey: connectorKeys.detail(knowledgeBaseId, connectorId),
      })
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(knowledgeBaseId),
      })
    },
  })
}

export interface ConnectorDocumentData {
  id: string
  filename: string
  externalId: string | null
  sourceUrl: string | null
  enabled: boolean
  deletedAt: string | null
  userExcluded: boolean
  uploadedAt: string
  processingStatus: string
}

export interface ConnectorDocumentsResponse {
  documents: ConnectorDocumentData[]
  counts: { active: number; excluded: number }
}

export const connectorDocumentKeys = {
  list: (knowledgeBaseId?: string, connectorId?: string) =>
    [...connectorKeys.detail(knowledgeBaseId, connectorId), 'documents'] as const,
}

async function fetchConnectorDocuments(
  knowledgeBaseId: string,
  connectorId: string,
  includeExcluded: boolean
): Promise<ConnectorDocumentsResponse> {
  const params = includeExcluded ? '?includeExcluded=true' : ''
  const response = await fetch(
    `/api/knowledge/${knowledgeBaseId}/connectors/${connectorId}/documents${params}`
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch connector documents: ${response.status}`)
  }

  const result = await response.json()
  if (!result?.success) {
    throw new Error(result?.error || 'Failed to fetch connector documents')
  }

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
    queryFn: () =>
      fetchConnectorDocuments(
        knowledgeBaseId as string,
        connectorId as string,
        options?.includeExcluded ?? false
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
  const response = await fetch(
    `/api/knowledge/${knowledgeBaseId}/connectors/${connectorId}/documents`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'exclude', documentIds }),
    }
  )

  if (!response.ok) {
    const result = await response.json()
    throw new Error(result.error || 'Failed to exclude documents')
  }

  const result = await response.json()
  return result.data
}

export function useExcludeConnectorDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: excludeConnectorDocuments,
    onSuccess: (_, { knowledgeBaseId, connectorId }) => {
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
  const response = await fetch(
    `/api/knowledge/${knowledgeBaseId}/connectors/${connectorId}/documents`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'restore', documentIds }),
    }
  )

  if (!response.ok) {
    const result = await response.json()
    throw new Error(result.error || 'Failed to restore documents')
  }

  const result = await response.json()
  return result.data
}

export function useRestoreConnectorDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: restoreConnectorDocuments,
    onSuccess: (_, { knowledgeBaseId, connectorId }) => {
      queryClient.invalidateQueries({
        queryKey: connectorDocumentKeys.list(knowledgeBaseId, connectorId),
      })
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(knowledgeBaseId),
      })
    },
  })
}
