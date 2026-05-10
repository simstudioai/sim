import { createLogger } from '@sim/logger'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '@/components/emcn'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import {
  type BulkChunkOperationData,
  type BulkDocumentOperationData,
  bulkKnowledgeChunksContract,
  bulkKnowledgeDocumentsContract,
  type ChunkData,
  type ChunksPagination,
  createKnowledgeBaseContract,
  createKnowledgeChunkContract,
  createTagDefinitionContract,
  type DocumentData,
  type DocumentTagDefinitionData,
  type DocumentTagFilter,
  deleteDocumentTagDefinitionsContract,
  deleteKnowledgeBaseContract,
  deleteKnowledgeChunkContract,
  deleteKnowledgeDocumentContract,
  deleteTagDefinitionContract,
  getKnowledgeBaseContract,
  getKnowledgeDocumentContract,
  type KnowledgeBaseData,
  type KnowledgeChunksResponse,
  type KnowledgeDocumentsResponse,
  type KnowledgeScope,
  listDocumentTagDefinitionsContract,
  listKnowledgeBasesContract,
  listKnowledgeChunksContract,
  listKnowledgeDocumentsContract,
  listTagDefinitionsContract,
  type NextAvailableSlotData,
  nextAvailableSlotContract,
  restoreKnowledgeBaseContract,
  type SaveDocumentTagDefinitionsResult,
  saveDocumentTagDefinitionsContract,
  type TagDefinitionData,
  updateKnowledgeBaseContract,
  updateKnowledgeChunkContract,
  updateKnowledgeDocumentContract,
  updateKnowledgeDocumentTagsContract,
} from '@/lib/api/contracts/knowledge'
import type { ChunkingStrategy, StrategyOptions } from '@/lib/chunkers/types'
import type { DocumentSortField, SortOrder } from '@/lib/knowledge/documents/types'

const logger = createLogger('KnowledgeQueries')

type KnowledgeQueryScope = KnowledgeScope

export type {
  DocumentTagDefinitionData,
  DocumentTagFilter,
  KnowledgeChunksResponse,
  KnowledgeDocumentsResponse,
  TagDefinitionData,
}

export const knowledgeKeys = {
  all: ['knowledge'] as const,
  lists: () => [...knowledgeKeys.all, 'list'] as const,
  list: (workspaceId?: string, scope: KnowledgeQueryScope = 'active') =>
    [...knowledgeKeys.lists(), workspaceId ?? 'all', scope] as const,
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

export async function fetchKnowledgeBases(
  workspaceId?: string,
  scope: KnowledgeQueryScope = 'active',
  signal?: AbortSignal
): Promise<KnowledgeBaseData[]> {
  const result = await requestJson(listKnowledgeBasesContract, {
    query: { workspaceId, scope },
    signal,
  })

  return result.data
}

export async function fetchKnowledgeBase(
  knowledgeBaseId: string,
  signal?: AbortSignal
): Promise<KnowledgeBaseData> {
  const result = await requestJson(getKnowledgeBaseContract, {
    params: { id: knowledgeBaseId },
    signal,
  })

  return result.data
}

async function fetchDocument(
  knowledgeBaseId: string,
  documentId: string,
  signal?: AbortSignal
): Promise<DocumentData> {
  try {
    const result = await requestJson(getKnowledgeDocumentContract, {
      params: { id: knowledgeBaseId, documentId },
      signal,
    })
    return result.data
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) {
      throw new Error('Document not found')
    }
    throw error
  }
}

export interface KnowledgeDocumentsParams {
  knowledgeBaseId: string
  search?: string
  limit?: number
  offset?: number
  sortBy?: DocumentSortField
  sortOrder?: SortOrder
  enabledFilter?: 'all' | 'enabled' | 'disabled'
  tagFilters?: DocumentTagFilter[]
}

async function fetchKnowledgeDocuments(
  {
    knowledgeBaseId,
    search,
    limit = 50,
    offset = 0,
    sortBy,
    sortOrder,
    enabledFilter,
    tagFilters,
  }: KnowledgeDocumentsParams,
  signal?: AbortSignal
): Promise<KnowledgeDocumentsResponse> {
  const result = await requestJson(listKnowledgeDocumentsContract, {
    params: { id: knowledgeBaseId },
    query: {
      search,
      sortBy,
      sortOrder,
      limit,
      offset,
      enabledFilter,
      tagFilters: tagFilters && tagFilters.length > 0 ? JSON.stringify(tagFilters) : undefined,
    },
    signal,
  })

  return result.data
}

export interface KnowledgeChunksParams {
  knowledgeBaseId: string
  documentId: string
  search?: string
  enabledFilter?: 'all' | 'enabled' | 'disabled'
  limit?: number
  offset?: number
  sortBy?: 'chunkIndex' | 'tokenCount' | 'enabled'
  sortOrder?: 'asc' | 'desc'
}

async function fetchKnowledgeChunks(
  {
    knowledgeBaseId,
    documentId,
    search,
    enabledFilter,
    limit = 50,
    offset = 0,
    sortBy,
    sortOrder,
  }: KnowledgeChunksParams,
  signal?: AbortSignal
): Promise<KnowledgeChunksResponse> {
  const result = await requestJson(listKnowledgeChunksContract, {
    params: { id: knowledgeBaseId, documentId },
    query: {
      search,
      enabled:
        enabledFilter && enabledFilter !== 'all'
          ? enabledFilter === 'enabled'
            ? 'true'
            : 'false'
          : undefined,
      limit,
      offset,
      sortBy,
      sortOrder,
    },
    signal,
  })

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
    scope?: KnowledgeQueryScope
  }
) {
  const scope = options?.scope ?? 'active'
  return useQuery({
    queryKey: knowledgeKeys.list(workspaceId, scope),
    queryFn: ({ signal }) => fetchKnowledgeBases(workspaceId, scope, signal),
    enabled: options?.enabled ?? true,
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useKnowledgeBaseQuery(knowledgeBaseId?: string) {
  return useQuery({
    queryKey: knowledgeKeys.detail(knowledgeBaseId),
    queryFn: ({ signal }) => fetchKnowledgeBase(knowledgeBaseId as string, signal),
    enabled: Boolean(knowledgeBaseId),
    staleTime: 60 * 1000,
  })
}

export function useDocumentQuery(knowledgeBaseId?: string, documentId?: string) {
  return useQuery({
    queryKey: knowledgeKeys.document(knowledgeBaseId ?? '', documentId ?? ''),
    queryFn: ({ signal }) => fetchDocument(knowledgeBaseId as string, documentId as string, signal),
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
    tagFilters: params.tagFilters ?? [],
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
    queryFn: ({ signal }) => fetchKnowledgeDocuments(params, signal),
    enabled: (options?.enabled ?? true) && Boolean(params.knowledgeBaseId),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
    refetchInterval: options?.refetchInterval ?? false,
  })
}

export const serializeChunkParams = (params: KnowledgeChunksParams) =>
  JSON.stringify({
    search: params.search ?? '',
    enabledFilter: params.enabledFilter ?? 'all',
    limit: params.limit ?? 50,
    offset: params.offset ?? 0,
    sortBy: params.sortBy ?? 'chunkIndex',
    sortOrder: params.sortOrder ?? 'asc',
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
    queryFn: ({ signal }) => fetchKnowledgeChunks(params, signal),
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

/** Paginates through all matching chunks rather than returning a single page. */
async function fetchAllDocumentChunks(
  { knowledgeBaseId, documentId, search }: DocumentChunkSearchParams,
  signal?: AbortSignal
): Promise<ChunkData[]> {
  const allResults: ChunkData[] = []
  let hasMore = true
  let offset = 0
  const limit = 100

  while (hasMore) {
    const response = await fetchKnowledgeChunks(
      {
        knowledgeBaseId,
        documentId,
        search,
        limit,
        offset,
      },
      signal
    )

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
    queryFn: ({ signal }) => fetchAllDocumentChunks(params, signal),
    enabled:
      (options?.enabled ?? true) &&
      Boolean(params.knowledgeBaseId && params.documentId && params.search.trim()),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })
}

interface UpdateChunkParams {
  knowledgeBaseId: string
  documentId: string
  chunkId: string
  content?: string
  enabled?: boolean
}

async function updateChunk({
  knowledgeBaseId,
  documentId,
  chunkId,
  content,
  enabled,
}: UpdateChunkParams): Promise<ChunkData> {
  const body: { content?: string; enabled?: boolean } = {}
  if (content !== undefined) body.content = content
  if (enabled !== undefined) body.enabled = enabled

  const result = await requestJson(updateKnowledgeChunkContract, {
    params: { id: knowledgeBaseId, documentId, chunkId },
    body,
  })

  return result.data
}

export function useUpdateChunk() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateChunk,
    onSettled: (_data, _error, { knowledgeBaseId, documentId }) => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(knowledgeBaseId),
      })
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.document(knowledgeBaseId, documentId),
      })
    },
  })
}

interface DeleteChunkParams {
  knowledgeBaseId: string
  documentId: string
  chunkId: string
}

async function deleteChunk({
  knowledgeBaseId,
  documentId,
  chunkId,
}: DeleteChunkParams): Promise<void> {
  await requestJson(deleteKnowledgeChunkContract, {
    params: { id: knowledgeBaseId, documentId, chunkId },
  })
}

export function useDeleteChunk() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteChunk,
    onSettled: (_data, _error, { knowledgeBaseId, documentId }) => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(knowledgeBaseId),
      })
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.document(knowledgeBaseId, documentId),
      })
    },
  })
}

interface CreateChunkParams {
  knowledgeBaseId: string
  documentId: string
  content: string
  enabled?: boolean
}

async function createChunk({
  knowledgeBaseId,
  documentId,
  content,
  enabled = true,
}: CreateChunkParams): Promise<ChunkData> {
  const result = await requestJson(createKnowledgeChunkContract, {
    params: { id: knowledgeBaseId, documentId },
    body: { content, enabled },
  })

  return result.data
}

export function useCreateChunk() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createChunk,
    onSettled: (_data, _error, { knowledgeBaseId, documentId }) => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(knowledgeBaseId),
      })
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.document(knowledgeBaseId, documentId),
      })
    },
  })
}

interface UpdateDocumentParams {
  knowledgeBaseId: string
  documentId: string
  updates: {
    enabled?: boolean
    filename?: string
    retryProcessing?: boolean
    markFailedDueToTimeout?: boolean
  }
}

async function updateDocument({
  knowledgeBaseId,
  documentId,
  updates,
}: UpdateDocumentParams): Promise<DocumentData> {
  const result = await requestJson(updateKnowledgeDocumentContract, {
    params: { id: knowledgeBaseId, documentId },
    body: updates,
  })

  return result.data
}

export function useUpdateDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateDocument,
    onSettled: (_data, _error, { knowledgeBaseId, documentId }) => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(knowledgeBaseId),
      })
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.document(knowledgeBaseId, documentId),
      })
    },
  })
}

interface DeleteDocumentParams {
  knowledgeBaseId: string
  documentId: string
}

async function deleteDocument({
  knowledgeBaseId,
  documentId,
}: DeleteDocumentParams): Promise<void> {
  await requestJson(deleteKnowledgeDocumentContract, {
    params: { id: knowledgeBaseId, documentId },
  })
}

export function useDeleteDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteDocument,
    onSettled: (_data, _error, { knowledgeBaseId }) => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(knowledgeBaseId),
      })
    },
  })
}

interface BulkDocumentOperationParams {
  knowledgeBaseId: string
  operation: 'enable' | 'disable' | 'delete'
  documentIds?: string[]
  selectAll?: boolean
  enabledFilter?: 'all' | 'enabled' | 'disabled'
}

async function bulkDocumentOperation({
  knowledgeBaseId,
  operation,
  documentIds,
  selectAll,
  enabledFilter,
}: BulkDocumentOperationParams): Promise<BulkDocumentOperationData> {
  const result = await requestJson(bulkKnowledgeDocumentsContract, {
    params: { id: knowledgeBaseId },
    body: selectAll
      ? { operation, selectAll: true, enabledFilter }
      : { operation, documentIds: documentIds ?? [] },
  })

  return result.data
}

export function useBulkDocumentOperation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: bulkDocumentOperation,
    onSettled: (_data, _error, { knowledgeBaseId }) => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(knowledgeBaseId),
      })
    },
  })
}

interface CreateKnowledgeBaseParams {
  name: string
  description?: string
  workspaceId: string
  chunkingConfig: {
    maxSize: number
    minSize: number
    overlap: number
    strategy?: ChunkingStrategy
    strategyOptions?: StrategyOptions
  }
}

async function createKnowledgeBase(params: CreateKnowledgeBaseParams): Promise<KnowledgeBaseData> {
  const result = await requestJson(createKnowledgeBaseContract, {
    body: params,
  })

  return result.data
}

export function useCreateKnowledgeBase(workspaceId?: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createKnowledgeBase,
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.lists(),
      })
    },
  })
}

interface UpdateKnowledgeBaseParams {
  knowledgeBaseId: string
  updates: {
    name?: string
    description?: string
    workspaceId?: string | null
  }
}

async function updateKnowledgeBase({
  knowledgeBaseId,
  updates,
}: UpdateKnowledgeBaseParams): Promise<KnowledgeBaseData> {
  const result = await requestJson(updateKnowledgeBaseContract, {
    params: { id: knowledgeBaseId },
    body: updates,
  })

  return result.data
}

export function useUpdateKnowledgeBase(workspaceId?: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateKnowledgeBase,
    onError: (error) => {
      toast.error(error.message, { duration: 5000 })
    },
    onSettled: (_data, _error, { knowledgeBaseId }) => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.lists(),
      })
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(knowledgeBaseId),
      })
    },
  })
}

interface DeleteKnowledgeBaseParams {
  knowledgeBaseId: string
}

async function deleteKnowledgeBase({ knowledgeBaseId }: DeleteKnowledgeBaseParams): Promise<void> {
  await requestJson(deleteKnowledgeBaseContract, {
    params: { id: knowledgeBaseId },
  })
}

export function useDeleteKnowledgeBase(workspaceId?: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteKnowledgeBase,
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.lists(),
      })
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(variables.knowledgeBaseId),
      })
    },
  })
}

interface BulkChunkOperationParams {
  knowledgeBaseId: string
  documentId: string
  operation: 'enable' | 'disable' | 'delete'
  chunkIds: string[]
}

async function bulkChunkOperation({
  knowledgeBaseId,
  documentId,
  operation,
  chunkIds,
}: BulkChunkOperationParams): Promise<BulkChunkOperationData> {
  const result = await requestJson(bulkKnowledgeChunksContract, {
    params: { id: knowledgeBaseId, documentId },
    body: { operation, chunkIds },
  })

  return result.data
}

export function useBulkChunkOperation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: bulkChunkOperation,
    onSettled: (_data, _error, { knowledgeBaseId, documentId }) => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(knowledgeBaseId),
      })
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.document(knowledgeBaseId, documentId),
      })
    },
  })
}

interface UpdateDocumentTagsParams {
  knowledgeBaseId: string
  documentId: string
  tags: Record<string, string>
}

async function updateDocumentTags({
  knowledgeBaseId,
  documentId,
  tags,
}: UpdateDocumentTagsParams): Promise<DocumentData> {
  const result = await requestJson(updateKnowledgeDocumentTagsContract, {
    params: { id: knowledgeBaseId, documentId },
    body: tags,
  })

  return result.data
}

export function useUpdateDocumentTags() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateDocumentTags,
    onSettled: (_data, _error, { knowledgeBaseId, documentId }) => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(knowledgeBaseId),
      })
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.document(knowledgeBaseId, documentId),
      })
    },
  })
}

async function fetchTagDefinitions(
  knowledgeBaseId: string,
  signal?: AbortSignal
): Promise<TagDefinitionData[]> {
  const result = await requestJson(listTagDefinitionsContract, {
    params: { id: knowledgeBaseId },
    signal,
  })

  return result.data
}

export function useTagDefinitionsQuery(knowledgeBaseId?: string | null) {
  return useQuery({
    queryKey: knowledgeKeys.tagDefinitions(knowledgeBaseId ?? ''),
    queryFn: ({ signal }) => fetchTagDefinitions(knowledgeBaseId as string, signal),
    enabled: Boolean(knowledgeBaseId),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })
}

interface CreateTagDefinitionParams {
  knowledgeBaseId: string
  displayName: string
  fieldType: string
}

async function fetchNextAvailableSlotData(
  knowledgeBaseId: string,
  fieldType: string
): Promise<NextAvailableSlotData> {
  const result = await requestJson(nextAvailableSlotContract, {
    params: { id: knowledgeBaseId },
    query: { fieldType },
  })
  return result.data
}

async function fetchNextAvailableSlot(knowledgeBaseId: string, fieldType: string): Promise<string> {
  const data = await fetchNextAvailableSlotData(knowledgeBaseId, fieldType)
  if (!data.nextAvailableSlot) {
    throw new Error('No available tag slots for this field type')
  }
  return data.nextAvailableSlot
}

interface NextAvailableSlotParams {
  knowledgeBaseId: string
  fieldType: string
}

export function useNextAvailableSlotMutation() {
  return useMutation({
    mutationFn: async ({ knowledgeBaseId, fieldType }: NextAvailableSlotParams) =>
      fetchNextAvailableSlot(knowledgeBaseId, fieldType),
  })
}

async function createTagDefinition({
  knowledgeBaseId,
  displayName,
  fieldType,
}: CreateTagDefinitionParams): Promise<TagDefinitionData> {
  const tagSlot = await fetchNextAvailableSlot(knowledgeBaseId, fieldType)

  const result = await requestJson(createTagDefinitionContract, {
    params: { id: knowledgeBaseId },
    body: { tagSlot, displayName, fieldType },
  })
  return result.data
}

export function useCreateTagDefinition() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createTagDefinition,
    onSettled: (_data, _error, { knowledgeBaseId }) => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.tagDefinitions(knowledgeBaseId),
      })
    },
  })
}

interface DeleteTagDefinitionParams {
  knowledgeBaseId: string
  tagDefinitionId: string
}

async function deleteTagDefinition({
  knowledgeBaseId,
  tagDefinitionId,
}: DeleteTagDefinitionParams): Promise<void> {
  await requestJson(deleteTagDefinitionContract, {
    params: { id: knowledgeBaseId, tagId: tagDefinitionId },
  })
}

export function useDeleteTagDefinition() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteTagDefinition,
    onSettled: (_data, _error, { knowledgeBaseId }) => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.tagDefinitions(knowledgeBaseId),
      })
    },
  })
}

async function fetchDocumentTagDefinitions(
  knowledgeBaseId: string,
  documentId: string,
  signal?: AbortSignal
): Promise<DocumentTagDefinitionData[]> {
  const result = await requestJson(listDocumentTagDefinitionsContract, {
    params: { id: knowledgeBaseId, documentId },
    signal,
  })

  return result.data
}

export function useDocumentTagDefinitionsQuery(
  knowledgeBaseId?: string | null,
  documentId?: string | null
) {
  return useQuery({
    queryKey: knowledgeKeys.documentTagDefinitions(knowledgeBaseId ?? '', documentId ?? ''),
    queryFn: ({ signal }) =>
      fetchDocumentTagDefinitions(knowledgeBaseId as string, documentId as string, signal),
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

interface SaveDocumentTagDefinitionsParams {
  knowledgeBaseId: string
  documentId: string
  definitions: DocumentTagDefinitionInput[]
}

async function saveDocumentTagDefinitions({
  knowledgeBaseId,
  documentId,
  definitions,
}: SaveDocumentTagDefinitionsParams): Promise<SaveDocumentTagDefinitionsResult> {
  const validDefinitions = (definitions || []).filter(
    (def) => def?.tagSlot && def.displayName && def.displayName.trim()
  )

  const result = await requestJson(saveDocumentTagDefinitionsContract, {
    params: { id: knowledgeBaseId, documentId },
    body: { definitions: validDefinitions },
  })
  return result.data
}

export function useSaveDocumentTagDefinitions() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: saveDocumentTagDefinitions,
    onSettled: (_data, _error, { knowledgeBaseId, documentId }) => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.documentTagDefinitions(knowledgeBaseId, documentId),
      })
    },
    onError: (error) => {
      logger.error('Failed to save document tag definitions:', error)
    },
  })
}

interface DeleteDocumentTagDefinitionsParams {
  knowledgeBaseId: string
  documentId: string
}

async function deleteDocumentTagDefinitions({
  knowledgeBaseId,
  documentId,
}: DeleteDocumentTagDefinitionsParams): Promise<void> {
  await requestJson(deleteDocumentTagDefinitionsContract, {
    params: { id: knowledgeBaseId, documentId },
  })
}

export function useRestoreKnowledgeBase() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (knowledgeBaseId: string) => {
      return requestJson(restoreKnowledgeBaseContract, {
        params: { id: knowledgeBaseId },
      })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: knowledgeKeys.lists() })
    },
  })
}

export function useDeleteDocumentTagDefinitions() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteDocumentTagDefinitions,
    onSettled: (_data, _error, { knowledgeBaseId, documentId }) => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.documentTagDefinitions(knowledgeBaseId, documentId),
      })
    },
    onError: (error) => {
      logger.error('Failed to delete document tag definitions:', error)
    },
  })
}
