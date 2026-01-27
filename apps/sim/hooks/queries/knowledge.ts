import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  ChunkData,
  ChunksPagination,
  DocumentData,
  DocumentsPagination,
  KnowledgeBaseData,
} from '@/lib/knowledge/types'

const logger = createLogger('KnowledgeQueries')

export const knowledgeKeys = {
  all: ['knowledge'] as const,
  list: (workspaceId?: string) => [...knowledgeKeys.all, 'list', workspaceId ?? 'all'] as const,
  detail: (knowledgeBaseId?: string) =>
    [...knowledgeKeys.all, 'detail', knowledgeBaseId ?? ''] as const,
  tagDefinitions: (knowledgeBaseId: string) =>
    [...knowledgeKeys.detail(knowledgeBaseId), 'tagDefinitions'] as const,
  documents: (knowledgeBaseId: string, paramsKey: string) =>
    [...knowledgeKeys.detail(knowledgeBaseId), 'documents', paramsKey] as const,
  document: (knowledgeBaseId: string, documentId: string) =>
    [...knowledgeKeys.detail(knowledgeBaseId), 'document', documentId] as const,
  documentTagDefinitions: (knowledgeBaseId: string, documentId: string) =>
    [...knowledgeKeys.document(knowledgeBaseId, documentId), 'tagDefinitions'] as const,
  chunks: (knowledgeBaseId: string, documentId: string, paramsKey: string) =>
    [...knowledgeKeys.document(knowledgeBaseId, documentId), 'chunks', paramsKey] as const,
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

export async function fetchDocument(
  knowledgeBaseId: string,
  documentId: string
): Promise<DocumentData> {
  const response = await fetch(`/api/knowledge/${knowledgeBaseId}/documents/${documentId}`)

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Document not found')
    }
    throw new Error(`Failed to fetch document: ${response.status} ${response.statusText}`)
  }

  const result = await response.json()
  if (!result?.success || !result?.data) {
    throw new Error(result?.error || 'Failed to fetch document')
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
  enabledFilter?: 'all' | 'enabled' | 'disabled'
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
  enabledFilter,
}: KnowledgeDocumentsParams): Promise<KnowledgeDocumentsResponse> {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (sortBy) params.set('sortBy', sortBy)
  if (sortOrder) params.set('sortOrder', sortOrder)
  params.set('limit', limit.toString())
  params.set('offset', offset.toString())
  if (enabledFilter) params.set('enabledFilter', enabledFilter)

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

export function useDocumentQuery(knowledgeBaseId?: string, documentId?: string) {
  return useQuery({
    queryKey: knowledgeKeys.document(knowledgeBaseId ?? '', documentId ?? ''),
    queryFn: () => fetchDocument(knowledgeBaseId as string, documentId as string),
    enabled: Boolean(knowledgeBaseId && documentId),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })
}

export const serializeDocumentParams = (params: KnowledgeDocumentsParams) =>
  JSON.stringify({
    search: params.search ?? '',
    limit: params.limit ?? 50,
    offset: params.offset ?? 0,
    sortBy: params.sortBy ?? '',
    sortOrder: params.sortOrder ?? '',
    enabledFilter: params.enabledFilter ?? 'all',
  })

export function useKnowledgeDocumentsQuery(
  params: KnowledgeDocumentsParams,
  options?: {
    enabled?: boolean
    refetchInterval?:
      | number
      | false
      | ((query: { state: { data?: KnowledgeDocumentsResponse } }) => number | false)
  }
) {
  const paramsKey = serializeDocumentParams(params)
  return useQuery({
    queryKey: knowledgeKeys.documents(params.knowledgeBaseId, paramsKey),
    queryFn: () => fetchKnowledgeDocuments(params),
    enabled: (options?.enabled ?? true) && Boolean(params.knowledgeBaseId),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
    refetchInterval: options?.refetchInterval ?? false,
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
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })
}

export interface DocumentChunkSearchParams {
  knowledgeBaseId: string
  documentId: string
  search: string
}

/**
 * Fetches all chunks matching a search query by paginating through results.
 * This is used for search functionality where we need all matching chunks.
 */
export async function fetchAllDocumentChunks({
  knowledgeBaseId,
  documentId,
  search,
}: DocumentChunkSearchParams): Promise<ChunkData[]> {
  const allResults: ChunkData[] = []
  let hasMore = true
  let offset = 0
  const limit = 100

  while (hasMore) {
    const response = await fetchKnowledgeChunks({
      knowledgeBaseId,
      documentId,
      search,
      limit,
      offset,
    })

    allResults.push(...response.chunks)
    hasMore = response.pagination.hasMore
    offset += limit
  }

  return allResults
}

export const serializeSearchParams = (params: DocumentChunkSearchParams) =>
  JSON.stringify({
    search: params.search,
  })

/**
 * Hook to search for chunks in a document.
 * Fetches all matching chunks and returns them for client-side pagination.
 */
export function useDocumentChunkSearchQuery(
  params: DocumentChunkSearchParams,
  options?: {
    enabled?: boolean
  }
) {
  const searchKey = serializeSearchParams(params)
  return useQuery({
    queryKey: [
      ...knowledgeKeys.document(params.knowledgeBaseId, params.documentId),
      'search',
      searchKey,
    ],
    queryFn: () => fetchAllDocumentChunks(params),
    enabled:
      (options?.enabled ?? true) &&
      Boolean(params.knowledgeBaseId && params.documentId && params.search.trim()),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })
}

export interface UpdateChunkParams {
  knowledgeBaseId: string
  documentId: string
  chunkId: string
  content?: string
  enabled?: boolean
}

export async function updateChunk({
  knowledgeBaseId,
  documentId,
  chunkId,
  content,
  enabled,
}: UpdateChunkParams): Promise<ChunkData> {
  const body: Record<string, unknown> = {}
  if (content !== undefined) body.content = content
  if (enabled !== undefined) body.enabled = enabled

  const response = await fetch(
    `/api/knowledge/${knowledgeBaseId}/documents/${documentId}/chunks/${chunkId}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  )

  if (!response.ok) {
    const result = await response.json()
    throw new Error(result.error || 'Failed to update chunk')
  }

  const result = await response.json()
  if (!result?.success) {
    throw new Error(result?.error || 'Failed to update chunk')
  }

  return result.data
}

export function useUpdateChunk() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateChunk,
    onSuccess: (_, { knowledgeBaseId, documentId }) => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(knowledgeBaseId),
      })
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.document(knowledgeBaseId, documentId),
      })
    },
  })
}

export interface DeleteChunkParams {
  knowledgeBaseId: string
  documentId: string
  chunkId: string
}

export async function deleteChunk({
  knowledgeBaseId,
  documentId,
  chunkId,
}: DeleteChunkParams): Promise<void> {
  const response = await fetch(
    `/api/knowledge/${knowledgeBaseId}/documents/${documentId}/chunks/${chunkId}`,
    { method: 'DELETE' }
  )

  if (!response.ok) {
    const result = await response.json()
    throw new Error(result.error || 'Failed to delete chunk')
  }

  const result = await response.json()
  if (!result?.success) {
    throw new Error(result?.error || 'Failed to delete chunk')
  }
}

export function useDeleteChunk() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteChunk,
    onSuccess: (_, { knowledgeBaseId, documentId }) => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(knowledgeBaseId),
      })
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.document(knowledgeBaseId, documentId),
      })
    },
  })
}

export interface CreateChunkParams {
  knowledgeBaseId: string
  documentId: string
  content: string
  enabled?: boolean
}

export async function createChunk({
  knowledgeBaseId,
  documentId,
  content,
  enabled = true,
}: CreateChunkParams): Promise<ChunkData> {
  const response = await fetch(`/api/knowledge/${knowledgeBaseId}/documents/${documentId}/chunks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, enabled }),
  })

  if (!response.ok) {
    const result = await response.json()
    throw new Error(result.error || 'Failed to create chunk')
  }

  const result = await response.json()
  if (!result?.success || !result?.data) {
    throw new Error(result?.error || 'Failed to create chunk')
  }

  return result.data
}

export function useCreateChunk() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createChunk,
    onSuccess: (_, { knowledgeBaseId, documentId }) => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(knowledgeBaseId),
      })
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.document(knowledgeBaseId, documentId),
      })
    },
  })
}

export interface UpdateDocumentParams {
  knowledgeBaseId: string
  documentId: string
  updates: {
    enabled?: boolean
    filename?: string
    retryProcessing?: boolean
    markFailedDueToTimeout?: boolean
  }
}

export async function updateDocument({
  knowledgeBaseId,
  documentId,
  updates,
}: UpdateDocumentParams): Promise<DocumentData> {
  const response = await fetch(`/api/knowledge/${knowledgeBaseId}/documents/${documentId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })

  if (!response.ok) {
    const result = await response.json()
    throw new Error(result.error || 'Failed to update document')
  }

  const result = await response.json()
  if (!result?.success) {
    throw new Error(result?.error || 'Failed to update document')
  }

  return result.data
}

export function useUpdateDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateDocument,
    onSuccess: (_, { knowledgeBaseId, documentId }) => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(knowledgeBaseId),
      })
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.document(knowledgeBaseId, documentId),
      })
    },
  })
}

export interface DeleteDocumentParams {
  knowledgeBaseId: string
  documentId: string
}

export async function deleteDocument({
  knowledgeBaseId,
  documentId,
}: DeleteDocumentParams): Promise<void> {
  const response = await fetch(`/api/knowledge/${knowledgeBaseId}/documents/${documentId}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    const result = await response.json()
    throw new Error(result.error || 'Failed to delete document')
  }

  const result = await response.json()
  if (!result?.success) {
    throw new Error(result?.error || 'Failed to delete document')
  }
}

export function useDeleteDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteDocument,
    onSuccess: (_, { knowledgeBaseId }) => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(knowledgeBaseId),
      })
    },
  })
}

export interface BulkDocumentOperationParams {
  knowledgeBaseId: string
  operation: 'enable' | 'disable' | 'delete'
  documentIds?: string[]
  selectAll?: boolean
  enabledFilter?: 'all' | 'enabled' | 'disabled'
}

export interface BulkDocumentOperationResult {
  successCount: number
  failedCount: number
  updatedDocuments?: Array<{ id: string; enabled: boolean }>
}

export async function bulkDocumentOperation({
  knowledgeBaseId,
  operation,
  documentIds,
  selectAll,
  enabledFilter,
}: BulkDocumentOperationParams): Promise<BulkDocumentOperationResult> {
  const body: Record<string, unknown> = { operation }
  if (selectAll) {
    body.selectAll = true
    if (enabledFilter) body.enabledFilter = enabledFilter
  } else {
    body.documentIds = documentIds
  }

  const response = await fetch(`/api/knowledge/${knowledgeBaseId}/documents`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const result = await response.json()
    throw new Error(result.error || `Failed to ${operation} documents`)
  }

  const result = await response.json()
  if (!result?.success) {
    throw new Error(result?.error || `Failed to ${operation} documents`)
  }

  return result.data
}

export function useBulkDocumentOperation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: bulkDocumentOperation,
    onSuccess: (_, { knowledgeBaseId }) => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(knowledgeBaseId),
      })
    },
  })
}

export interface CreateKnowledgeBaseParams {
  name: string
  description?: string
  workspaceId: string
  chunkingConfig: {
    maxSize: number
    minSize: number
    overlap: number
  }
}

export async function createKnowledgeBase(
  params: CreateKnowledgeBaseParams
): Promise<KnowledgeBaseData> {
  const response = await fetch('/api/knowledge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })

  if (!response.ok) {
    const result = await response.json()
    throw new Error(result.error || 'Failed to create knowledge base')
  }

  const result = await response.json()
  if (!result?.success || !result?.data) {
    throw new Error(result?.error || 'Failed to create knowledge base')
  }

  return result.data
}

export function useCreateKnowledgeBase(workspaceId?: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createKnowledgeBase,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.list(workspaceId),
      })
    },
  })
}

export interface UpdateKnowledgeBaseParams {
  knowledgeBaseId: string
  updates: {
    name?: string
    description?: string
    workspaceId?: string | null
  }
}

export async function updateKnowledgeBase({
  knowledgeBaseId,
  updates,
}: UpdateKnowledgeBaseParams): Promise<KnowledgeBaseData> {
  const response = await fetch(`/api/knowledge/${knowledgeBaseId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })

  if (!response.ok) {
    const result = await response.json()
    throw new Error(result.error || 'Failed to update knowledge base')
  }

  const result = await response.json()
  if (!result?.success) {
    throw new Error(result?.error || 'Failed to update knowledge base')
  }

  return result.data
}

export function useUpdateKnowledgeBase(workspaceId?: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateKnowledgeBase,
    onSuccess: (_, { knowledgeBaseId }) => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(knowledgeBaseId),
      })
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.list(workspaceId),
      })
    },
  })
}

export interface DeleteKnowledgeBaseParams {
  knowledgeBaseId: string
}

export async function deleteKnowledgeBase({
  knowledgeBaseId,
}: DeleteKnowledgeBaseParams): Promise<void> {
  const response = await fetch(`/api/knowledge/${knowledgeBaseId}`, {
    method: 'DELETE',
  })

  if (!response.ok) {
    const result = await response.json()
    throw new Error(result.error || 'Failed to delete knowledge base')
  }

  const result = await response.json()
  if (!result?.success) {
    throw new Error(result?.error || 'Failed to delete knowledge base')
  }
}

export function useDeleteKnowledgeBase(workspaceId?: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteKnowledgeBase,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.list(workspaceId),
      })
    },
  })
}

export interface BulkChunkOperationParams {
  knowledgeBaseId: string
  documentId: string
  operation: 'enable' | 'disable' | 'delete'
  chunkIds: string[]
}

export interface BulkChunkOperationResult {
  operation: string
  successCount: number
  errorCount: number
  processed: number
  errors: string[]
}

export async function bulkChunkOperation({
  knowledgeBaseId,
  documentId,
  operation,
  chunkIds,
}: BulkChunkOperationParams): Promise<BulkChunkOperationResult> {
  const response = await fetch(`/api/knowledge/${knowledgeBaseId}/documents/${documentId}/chunks`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation, chunkIds }),
  })

  if (!response.ok) {
    const result = await response.json()
    throw new Error(result.error || `Failed to ${operation} chunks`)
  }

  const result = await response.json()
  if (!result?.success) {
    throw new Error(result?.error || `Failed to ${operation} chunks`)
  }

  return result.data
}

export function useBulkChunkOperation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: bulkChunkOperation,
    onSuccess: (_, { knowledgeBaseId, documentId }) => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(knowledgeBaseId),
      })
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.document(knowledgeBaseId, documentId),
      })
    },
  })
}

export interface UpdateDocumentTagsParams {
  knowledgeBaseId: string
  documentId: string
  tags: Record<string, string>
}

export async function updateDocumentTags({
  knowledgeBaseId,
  documentId,
  tags,
}: UpdateDocumentTagsParams): Promise<DocumentData> {
  const response = await fetch(`/api/knowledge/${knowledgeBaseId}/documents/${documentId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tags),
  })

  if (!response.ok) {
    const result = await response.json()
    throw new Error(result.error || 'Failed to update document tags')
  }

  const result = await response.json()
  if (!result?.success) {
    throw new Error(result?.error || 'Failed to update document tags')
  }

  return result.data
}

export function useUpdateDocumentTags() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateDocumentTags,
    onSuccess: (_, { knowledgeBaseId, documentId }) => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(knowledgeBaseId),
      })
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.document(knowledgeBaseId, documentId),
      })
    },
  })
}

export interface TagDefinitionData {
  id: string
  tagSlot: string
  displayName: string
  fieldType: string
  createdAt: string
  updatedAt: string
}

export async function fetchTagDefinitions(knowledgeBaseId: string): Promise<TagDefinitionData[]> {
  const response = await fetch(`/api/knowledge/${knowledgeBaseId}/tag-definitions`)

  if (!response.ok) {
    throw new Error(`Failed to fetch tag definitions: ${response.status} ${response.statusText}`)
  }

  const result = await response.json()
  if (!result?.success) {
    throw new Error(result?.error || 'Failed to fetch tag definitions')
  }

  return Array.isArray(result.data) ? result.data : []
}

export function useTagDefinitionsQuery(knowledgeBaseId?: string | null) {
  return useQuery({
    queryKey: knowledgeKeys.tagDefinitions(knowledgeBaseId ?? ''),
    queryFn: () => fetchTagDefinitions(knowledgeBaseId as string),
    enabled: Boolean(knowledgeBaseId),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })
}

export interface CreateTagDefinitionParams {
  knowledgeBaseId: string
  displayName: string
  fieldType: string
}

async function fetchNextAvailableSlot(knowledgeBaseId: string, fieldType: string): Promise<string> {
  const response = await fetch(
    `/api/knowledge/${knowledgeBaseId}/next-available-slot?fieldType=${fieldType}`
  )

  if (!response.ok) {
    throw new Error('Failed to get available slot')
  }

  const result = await response.json()
  if (!result.success || !result.data?.nextAvailableSlot) {
    throw new Error('No available tag slots for this field type')
  }

  return result.data.nextAvailableSlot
}

export async function createTagDefinition({
  knowledgeBaseId,
  displayName,
  fieldType,
}: CreateTagDefinitionParams): Promise<TagDefinitionData> {
  const tagSlot = await fetchNextAvailableSlot(knowledgeBaseId, fieldType)

  const response = await fetch(`/api/knowledge/${knowledgeBaseId}/tag-definitions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tagSlot, displayName, fieldType }),
  })

  if (!response.ok) {
    const result = await response.json()
    throw new Error(result.error || 'Failed to create tag definition')
  }

  const result = await response.json()
  if (!result?.success || !result?.data) {
    throw new Error(result?.error || 'Failed to create tag definition')
  }

  return result.data
}

export function useCreateTagDefinition() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createTagDefinition,
    onSuccess: (_, { knowledgeBaseId }) => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.tagDefinitions(knowledgeBaseId),
      })
    },
  })
}

export interface DeleteTagDefinitionParams {
  knowledgeBaseId: string
  tagDefinitionId: string
}

export async function deleteTagDefinition({
  knowledgeBaseId,
  tagDefinitionId,
}: DeleteTagDefinitionParams): Promise<void> {
  const response = await fetch(
    `/api/knowledge/${knowledgeBaseId}/tag-definitions/${tagDefinitionId}`,
    { method: 'DELETE' }
  )

  if (!response.ok) {
    const result = await response.json()
    throw new Error(result.error || 'Failed to delete tag definition')
  }

  const result = await response.json()
  if (!result?.success) {
    throw new Error(result?.error || 'Failed to delete tag definition')
  }
}

export function useDeleteTagDefinition() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteTagDefinition,
    onSuccess: (_, { knowledgeBaseId }) => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.tagDefinitions(knowledgeBaseId),
      })
    },
  })
}

export interface DocumentTagDefinitionData {
  id: string
  tagSlot: string
  displayName: string
  fieldType: string
  createdAt: string
  updatedAt: string
}

export async function fetchDocumentTagDefinitions(
  knowledgeBaseId: string,
  documentId: string
): Promise<DocumentTagDefinitionData[]> {
  const response = await fetch(
    `/api/knowledge/${knowledgeBaseId}/documents/${documentId}/tag-definitions`
  )

  if (!response.ok) {
    throw new Error(
      `Failed to fetch document tag definitions: ${response.status} ${response.statusText}`
    )
  }

  const result = await response.json()
  if (!result?.success) {
    throw new Error(result?.error || 'Failed to fetch document tag definitions')
  }

  return Array.isArray(result.data) ? result.data : []
}

export function useDocumentTagDefinitionsQuery(
  knowledgeBaseId?: string | null,
  documentId?: string | null
) {
  return useQuery({
    queryKey: knowledgeKeys.documentTagDefinitions(knowledgeBaseId ?? '', documentId ?? ''),
    queryFn: () => fetchDocumentTagDefinitions(knowledgeBaseId as string, documentId as string),
    enabled: Boolean(knowledgeBaseId && documentId),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })
}

export interface DocumentTagDefinitionInput {
  tagSlot: string
  displayName: string
  fieldType: string
}

export interface SaveDocumentTagDefinitionsParams {
  knowledgeBaseId: string
  documentId: string
  definitions: DocumentTagDefinitionInput[]
}

export async function saveDocumentTagDefinitions({
  knowledgeBaseId,
  documentId,
  definitions,
}: SaveDocumentTagDefinitionsParams): Promise<DocumentTagDefinitionData[]> {
  const validDefinitions = (definitions || []).filter(
    (def) => def?.tagSlot && def.displayName && def.displayName.trim()
  )

  const response = await fetch(
    `/api/knowledge/${knowledgeBaseId}/documents/${documentId}/tag-definitions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ definitions: validDefinitions }),
    }
  )

  if (!response.ok) {
    const result = await response.json()
    throw new Error(result.error || 'Failed to save document tag definitions')
  }

  const result = await response.json()
  if (!result?.success) {
    throw new Error(result?.error || 'Failed to save document tag definitions')
  }

  return result.data
}

export function useSaveDocumentTagDefinitions() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: saveDocumentTagDefinitions,
    onSuccess: (_, { knowledgeBaseId, documentId }) => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.documentTagDefinitions(knowledgeBaseId, documentId),
      })
    },
    onError: (error) => {
      logger.error('Failed to save document tag definitions:', error)
    },
  })
}

export interface DeleteDocumentTagDefinitionsParams {
  knowledgeBaseId: string
  documentId: string
}

export async function deleteDocumentTagDefinitions({
  knowledgeBaseId,
  documentId,
}: DeleteDocumentTagDefinitionsParams): Promise<void> {
  const response = await fetch(
    `/api/knowledge/${knowledgeBaseId}/documents/${documentId}/tag-definitions`,
    { method: 'DELETE' }
  )

  if (!response.ok) {
    const result = await response.json()
    throw new Error(result.error || 'Failed to delete document tag definitions')
  }

  const result = await response.json()
  if (!result?.success) {
    throw new Error(result?.error || 'Failed to delete document tag definitions')
  }
}

export function useDeleteDocumentTagDefinitions() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteDocumentTagDefinitions,
    onSuccess: (_, { knowledgeBaseId, documentId }) => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.documentTagDefinitions(knowledgeBaseId, documentId),
      })
    },
    onError: (error) => {
      logger.error('Failed to delete document tag definitions:', error)
    },
  })
}
