import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createLogger } from '@/lib/logs/console/logger'
import type {
  ChunkData,
  ChunksPagination,
  DocumentData,
  DocumentsPagination,
  KnowledgeBaseData,
} from '@/stores/knowledge/store'

const logger = createLogger('KnowledgeQueries')

export const knowledgeKeys = {
  all: ['knowledge'] as const,
  list: (workspaceId?: string) => [...knowledgeKeys.all, 'list', workspaceId ?? 'all'] as const,
  detail: (knowledgeBaseId?: string) =>
    [...knowledgeKeys.all, 'detail', knowledgeBaseId ?? ''] as const,
  documents: (knowledgeBaseId: string, paramsKey: string) =>
    [...knowledgeKeys.detail(knowledgeBaseId), 'documents', paramsKey] as const,
  chunks: (knowledgeBaseId: string, documentId: string, paramsKey: string) =>
    [
      ...knowledgeKeys.detail(knowledgeBaseId),
      'document',
      documentId,
      'chunks',
      paramsKey,
    ] as const,
}

export async function fetchKnowledgeBases(workspaceId?: string): Promise<KnowledgeBaseData[]> {
  const url = workspaceId ? `/api/knowledge?workspaceId=${workspaceId}` : '/api/knowledge'
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Failed to fetch knowledge bases: ${response.status} ${response.statusText}`)
  }

  const result = await response.json()
  if (result?.success === false) {
    throw new Error(result.error || 'Failed to fetch knowledge bases')
  }

  return Array.isArray(result?.data) ? result.data : []
}

export async function fetchKnowledgeBase(knowledgeBaseId: string): Promise<KnowledgeBaseData> {
  const response = await fetch(`/api/knowledge/${knowledgeBaseId}`)

  if (!response.ok) {
    throw new Error(`Failed to fetch knowledge base: ${response.status} ${response.statusText}`)
  }

  const result = await response.json()
  if (!result?.success || !result?.data) {
    throw new Error(result?.error || 'Failed to fetch knowledge base')
  }

  return result.data
}

export interface KnowledgeDocumentsParams {
  knowledgeBaseId: string
  search?: string
  limit?: number
  offset?: number
  sortBy?: string
  sortOrder?: string
}

export interface KnowledgeDocumentsResponse {
  documents: DocumentData[]
  pagination: DocumentsPagination
}

export async function fetchKnowledgeDocuments({
  knowledgeBaseId,
  search,
  limit = 50,
  offset = 0,
  sortBy,
  sortOrder,
}: KnowledgeDocumentsParams): Promise<KnowledgeDocumentsResponse> {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (sortBy) params.set('sortBy', sortBy)
  if (sortOrder) params.set('sortOrder', sortOrder)
  params.set('limit', limit.toString())
  params.set('offset', offset.toString())

  const url = `/api/knowledge/${knowledgeBaseId}/documents${params.toString() ? `?${params.toString()}` : ''}`
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Failed to fetch documents: ${response.status} ${response.statusText}`)
  }

  const result = await response.json()
  if (!result?.success) {
    throw new Error(result?.error || 'Failed to fetch documents')
  }

  const documents: DocumentData[] = result.data?.documents ?? result.data ?? []
  const pagination: DocumentsPagination = result.data?.pagination ??
    result.pagination ?? {
      total: documents.length,
      limit,
      offset,
      hasMore: false,
    }

  return {
    documents,
    pagination: {
      total: pagination.total ?? documents.length,
      limit: pagination.limit ?? limit,
      offset: pagination.offset ?? offset,
      hasMore: Boolean(pagination.hasMore),
    },
  }
}

export interface KnowledgeChunksParams {
  knowledgeBaseId: string
  documentId: string
  search?: string
  limit?: number
  offset?: number
}

export interface KnowledgeChunksResponse {
  chunks: ChunkData[]
  pagination: ChunksPagination
}

export async function fetchKnowledgeChunks({
  knowledgeBaseId,
  documentId,
  search,
  limit = 50,
  offset = 0,
}: KnowledgeChunksParams): Promise<KnowledgeChunksResponse> {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (limit) params.set('limit', limit.toString())
  if (offset) params.set('offset', offset.toString())

  const response = await fetch(
    `/api/knowledge/${knowledgeBaseId}/documents/${documentId}/chunks${params.toString() ? `?${params.toString()}` : ''}`
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch chunks: ${response.status} ${response.statusText}`)
  }

  const result = await response.json()
  if (!result?.success) {
    throw new Error(result?.error || 'Failed to fetch chunks')
  }

  const chunks: ChunkData[] = result.data ?? []
  const pagination: ChunksPagination = {
    total: result.pagination?.total ?? chunks.length,
    limit: result.pagination?.limit ?? limit,
    offset: result.pagination?.offset ?? offset,
    hasMore: Boolean(result.pagination?.hasMore),
  }

  return { chunks, pagination }
}

export function useKnowledgeBasesQuery(
  workspaceId?: string,
  options?: {
    enabled?: boolean
  }
) {
  return useQuery({
    queryKey: knowledgeKeys.list(workspaceId),
    queryFn: () => fetchKnowledgeBases(workspaceId),
    enabled: options?.enabled ?? true,
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useKnowledgeBaseQuery(knowledgeBaseId?: string) {
  return useQuery({
    queryKey: knowledgeKeys.detail(knowledgeBaseId),
    queryFn: () => fetchKnowledgeBase(knowledgeBaseId as string),
    enabled: Boolean(knowledgeBaseId),
    staleTime: 60 * 1000,
  })
}

export const serializeDocumentParams = (params: KnowledgeDocumentsParams) =>
  JSON.stringify({
    search: params.search ?? '',
    limit: params.limit ?? 50,
    offset: params.offset ?? 0,
    sortBy: params.sortBy ?? '',
    sortOrder: params.sortOrder ?? '',
  })

export function useKnowledgeDocumentsQuery(
  params: KnowledgeDocumentsParams,
  options?: {
    enabled?: boolean
  }
) {
  const paramsKey = serializeDocumentParams(params)
  return useQuery({
    queryKey: knowledgeKeys.documents(params.knowledgeBaseId, paramsKey),
    queryFn: () => fetchKnowledgeDocuments(params),
    enabled: (options?.enabled ?? true) && Boolean(params.knowledgeBaseId),
    placeholderData: keepPreviousData,
  })
}

export const serializeChunkParams = (params: KnowledgeChunksParams) =>
  JSON.stringify({
    search: params.search ?? '',
    limit: params.limit ?? 50,
    offset: params.offset ?? 0,
  })

export function useKnowledgeChunksQuery(
  params: KnowledgeChunksParams,
  options?: {
    enabled?: boolean
  }
) {
  const paramsKey = serializeChunkParams(params)
  return useQuery({
    queryKey: knowledgeKeys.chunks(params.knowledgeBaseId, params.documentId, paramsKey),
    queryFn: () => fetchKnowledgeChunks(params),
    enabled: (options?.enabled ?? true) && Boolean(params.knowledgeBaseId && params.documentId),
    placeholderData: keepPreviousData,
  })
}

interface UpdateDocumentPayload {
  knowledgeBaseId: string
  documentId: string
  updates: Partial<DocumentData>
}

export function useMutateKnowledgeDocument() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ knowledgeBaseId, documentId, updates }: UpdateDocumentPayload) => {
      const response = await fetch(`/api/knowledge/${knowledgeBaseId}/documents/${documentId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to update document')
      }

      const result = await response.json()
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to update document')
      }

      return result
    },
    onMutate: async ({ knowledgeBaseId, documentId, updates }) => {
      await queryClient.cancelQueries({ queryKey: knowledgeKeys.detail(knowledgeBaseId) })

      const documentQueries = queryClient
        .getQueriesData<KnowledgeDocumentsResponse>({
          queryKey: knowledgeKeys.detail(knowledgeBaseId),
        })
        .filter(([key]) => Array.isArray(key) && key.includes('documents'))

      documentQueries.forEach(([key, data]) => {
        if (!data) return
        queryClient.setQueryData(key, {
          ...data,
          documents: data.documents.map((doc) =>
            doc.id === documentId ? { ...doc, ...updates } : doc
          ),
        })
      })
    },
    onError: (error) => {
      logger.error('Failed to mutate document', error)
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: knowledgeKeys.detail(variables.knowledgeBaseId) })
    },
  })
}
