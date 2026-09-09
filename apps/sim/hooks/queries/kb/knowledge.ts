import { toast } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiClientError } from '@/lib/api/client/errors'
import { contractUrl, requestJson } from '@/lib/api/client/request'
import {
  type BulkChunkOperationData,
  type BulkDeleteKnowledgeItemsBody,
  type BulkDocumentOperationData,
  type BulkMoveKnowledgeItemsBody,
  bulkDeleteKnowledgeItemsContract,
  bulkKnowledgeChunksContract,
  bulkKnowledgeDocumentsContract,
  bulkMoveKnowledgeItemsContract,
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
  exportKnowledgeBaseContract,
  getKnowledgeBaseContract,
  getKnowledgeDocumentContract,
  getTagUsageContract,
  type KnowledgeBaseData,
  type KnowledgeChunksResponse,
  type KnowledgeDocumentsResponse,
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
  searchWorkspaceKnowledgeContract,
  type TagDefinitionData,
  type TagUsageData,
  type UpdateKnowledgeBaseBody,
  type UpdateKnowledgeDocumentResponseData,
  updateKnowledgeBaseContract,
  updateKnowledgeChunkContract,
  updateKnowledgeDocumentContract,
  updateKnowledgeDocumentTagsContract,
  type WorkspaceKnowledgeSearchBody,
  type WorkspaceKnowledgeSearchResult,
} from '@/lib/api/contracts/knowledge'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge/search'
import type { ChunkingStrategy, StrategyOptions } from '@/lib/chunkers/types'
import {
  type ResourceScope,
  resourceScopeFields,
  resourceScopeKey,
} from '@/lib/core/resource-scope'
import type { DocumentSortField, SortOrder } from '@/lib/knowledge/documents/types'
import { connectorKeys, searchSourceKeys } from '@/hooks/queries/kb/connectors'
import { folderKeys } from '@/hooks/queries/utils/folder-keys'
import {
  KNOWLEDGE_BASE_LIST_STALE_TIME,
  type KnowledgeQueryScope,
  knowledgeKeys,
} from '@/hooks/queries/utils/knowledge-keys'

const logger = createLogger('KnowledgeQueries')

export type {
  DocumentTagDefinitionData,
  DocumentTagFilter,
  KnowledgeChunksResponse,
  KnowledgeDocumentsResponse,
  TagDefinitionData,
  TagUsageData,
}

export const KNOWLEDGE_BASE_DETAIL_STALE_TIME = 60 * 1000
export const KNOWLEDGE_DOCUMENT_DETAIL_STALE_TIME = 60 * 1000
export const KNOWLEDGE_DOCUMENT_LIST_STALE_TIME = 60 * 1000
export const KNOWLEDGE_CHUNK_LIST_STALE_TIME = 60 * 1000
export const KNOWLEDGE_CHUNK_SEARCH_STALE_TIME = 60 * 1000
export const WORKSPACE_KNOWLEDGE_SEARCH_STALE_TIME = 60 * 1000
export const KNOWLEDGE_TAG_DEFINITION_LIST_STALE_TIME = 60 * 1000
export const KNOWLEDGE_TAG_USAGE_STALE_TIME = 60 * 1000
export const KNOWLEDGE_DOCUMENT_TAG_DEFINITION_LIST_STALE_TIME = 60 * 1000

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
    staleTime: KNOWLEDGE_BASE_LIST_STALE_TIME,
  })
}

export function useKnowledgeBaseQuery(knowledgeBaseId?: string) {
  return useQuery({
    queryKey: knowledgeKeys.detail(knowledgeBaseId),
    queryFn: ({ signal }) => fetchKnowledgeBase(knowledgeBaseId as string, signal),
    enabled: Boolean(knowledgeBaseId),
    staleTime: KNOWLEDGE_BASE_DETAIL_STALE_TIME,
  })
}

export function useDocumentQuery(knowledgeBaseId?: string, documentId?: string) {
  return useQuery({
    queryKey: knowledgeKeys.document(knowledgeBaseId ?? '', documentId ?? ''),
    queryFn: ({ signal }) => fetchDocument(knowledgeBaseId as string, documentId as string, signal),
    enabled: Boolean(knowledgeBaseId && documentId),
    staleTime: KNOWLEDGE_DOCUMENT_DETAIL_STALE_TIME,
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
    staleTime: KNOWLEDGE_DOCUMENT_LIST_STALE_TIME,
    placeholderData: (previous, previousQuery) =>
      knowledgeKeys
        .documentLists(params.knowledgeBaseId)
        .every((part, index) => previousQuery?.queryKey[index] === part)
        ? previous
        : undefined,
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
    staleTime: KNOWLEDGE_CHUNK_LIST_STALE_TIME,
    placeholderData: (previous, previousQuery) =>
      knowledgeKeys
        .document(params.knowledgeBaseId, params.documentId)
        .every((part, index) => previousQuery?.queryKey[index] === part)
        ? previous
        : undefined,
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
    /** Throw rather than break: a short list returned here would cache as the complete one. */
    signal?.throwIfAborted()
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
    queryKey: knowledgeKeys.chunkSearch(params.knowledgeBaseId, params.documentId, searchKey),
    queryFn: ({ signal }) => fetchAllDocumentChunks(params, signal),
    enabled:
      (options?.enabled ?? true) &&
      Boolean(params.knowledgeBaseId && params.documentId && params.search.trim()),
    staleTime: KNOWLEDGE_CHUNK_SEARCH_STALE_TIME,
    placeholderData: (previous, previousQuery) =>
      knowledgeKeys
        .document(params.knowledgeBaseId, params.documentId)
        .every((part, index) => previousQuery?.queryKey[index] === part)
        ? previous
        : undefined,
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
        queryKey: knowledgeKeys.document(knowledgeBaseId, documentId),
      })
      /** The document list renders this row's filename, status, tags, and counts. */
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.documentLists(knowledgeBaseId),
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
        queryKey: knowledgeKeys.document(knowledgeBaseId, documentId),
      })
      /** The document list renders this row's filename, status, tags, and counts. */
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.documentLists(knowledgeBaseId),
      })
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(knowledgeBaseId),
        exact: true,
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
        queryKey: knowledgeKeys.document(knowledgeBaseId, documentId),
      })
      /** The document list renders this row's filename, status, tags, and counts. */
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.documentLists(knowledgeBaseId),
      })
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(knowledgeBaseId),
        exact: true,
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
}: UpdateDocumentParams): Promise<UpdateKnowledgeDocumentResponseData> {
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
        queryKey: knowledgeKeys.document(knowledgeBaseId, documentId),
      })
      /** The document list renders this row's filename, status, tags, and counts. */
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.documentLists(knowledgeBaseId),
      })
      queryClient.invalidateQueries({ queryKey: connectorKeys.all(knowledgeBaseId) })
      queryClient.invalidateQueries({ queryKey: searchSourceKeys.lists() })
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
      /** The knowledge-base list rows carry `docCount`, so removing a document changes them too. */
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.lists(),
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
    onSettled: (_data, _error, { knowledgeBaseId, operation }) => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(knowledgeBaseId),
      })
      /** Only a bulk delete changes the `docCount` the knowledge-base list rows render. */
      if (operation === 'delete') {
        queryClient.invalidateQueries({
          queryKey: knowledgeKeys.lists(),
        })
      }
    },
  })
}

interface CreateKnowledgeBaseParams {
  name: string
  description?: string
  workspaceId: string
  /** Folder to create the knowledge base in; `null`/omitted creates it at the workspace root. */
  folderId?: string | null
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

export function useCreateKnowledgeBase() {
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
  updates: UpdateKnowledgeBaseBody
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

export function useUpdateKnowledgeBase() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: updateKnowledgeBase,
    /**
     * A folder move re-parents a row the user is looking at, so the list is patched up
     * front — otherwise the base lingers in the folder it just left until the refetch
     * lands. Only the folder is applied optimistically; name/description edits already
     * happen behind a modal that closes on success.
     */
    onMutate: async ({ knowledgeBaseId, updates }) => {
      if (updates.folderId === undefined) return
      await queryClient.cancelQueries({ queryKey: knowledgeKeys.lists() })
      const previous = queryClient.getQueriesData<KnowledgeBaseData[]>({
        queryKey: knowledgeKeys.lists(),
      })
      queryClient.setQueriesData<KnowledgeBaseData[]>({ queryKey: knowledgeKeys.lists() }, (old) =>
        old?.map((kb) =>
          kb.id === knowledgeBaseId ? { ...kb, folderId: updates.folderId ?? null } : kb
        )
      )
      return { previous }
    },
    onError: (error, _variables, context) => {
      for (const [key, data] of context?.previous ?? []) {
        queryClient.setQueryData(key, data)
      }
      toast.error(error.message, { duration: 5000 })
    },
    onSettled: (_data, _error, { knowledgeBaseId }) => {
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.lists(),
      })
      /** `exact` for the reason {@link useBulkMoveKnowledgeBases} gives: a rename or folder
       *  move touches the base record, never its documents or chunks. */
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(knowledgeBaseId),
        exact: true,
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

/**
 * Starts a browser download of a knowledge base's bundle archive.
 *
 * An anchor navigation rather than a fetch: the archive is streamed and can run
 * to gigabytes, and the browser saving it straight to disk is what keeps it out
 * of page memory. The session cookie authenticates the same-origin request.
 */
export function downloadKnowledgeBaseExport(knowledgeBaseId: string): void {
  const anchor = document.createElement('a')
  anchor.href = contractUrl(exportKnowledgeBaseContract, {
    params: { id: knowledgeBaseId },
    query: {},
  })
  anchor.download = ''
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
}

export function useDeleteKnowledgeBase() {
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
        queryKey: knowledgeKeys.document(knowledgeBaseId, documentId),
      })
      /** The document list renders this row's filename, status, tags, and counts. */
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.documentLists(knowledgeBaseId),
      })
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(knowledgeBaseId),
        exact: true,
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
        queryKey: knowledgeKeys.document(knowledgeBaseId, documentId),
      })
      /** The document list renders this row's filename, status, tags, and counts. */
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.documentLists(knowledgeBaseId),
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
    staleTime: KNOWLEDGE_TAG_DEFINITION_LIST_STALE_TIME,
  })
}

async function fetchTagUsage(
  knowledgeBaseId: string,
  signal?: AbortSignal
): Promise<TagUsageData[]> {
  const result = await requestJson(getTagUsageContract, {
    params: { id: knowledgeBaseId },
    signal,
  })

  return result.data
}

export function useTagUsageQuery(knowledgeBaseId?: string | null, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: knowledgeKeys.tagUsage(knowledgeBaseId ?? ''),
    queryFn: ({ signal }) => fetchTagUsage(knowledgeBaseId as string, signal),
    enabled: Boolean(knowledgeBaseId) && (options?.enabled ?? true),
    staleTime: KNOWLEDGE_TAG_USAGE_STALE_TIME,
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
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.tagUsage(knowledgeBaseId),
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
      queryClient.invalidateQueries({
        queryKey: knowledgeKeys.tagUsage(knowledgeBaseId),
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
    staleTime: KNOWLEDGE_DOCUMENT_TAG_DEFINITION_LIST_STALE_TIME,
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
    query: {},
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

/**
 * Move a mixed selection of knowledge bases and knowledge folders into one
 * folder, or to the workspace root with `targetFolderId: null`.
 *
 * One request, one authorized operation: the Knowledge list interleaves folder
 * and knowledge base rows in a single grid, so a selection is routinely mixed
 * and must not be split into a resource call plus a per-folder fan-out.
 *
 * No optimistic patch, unlike the single-base move: a folder move re-parents
 * rows the list renders at a different level, and the response reports per-item
 * outcomes (`skipped`, `notFound`, `failed`) the client cannot predict.
 */
export function useBulkMoveKnowledgeBases(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      knowledgeBaseIds = [],
      folderIds = [],
      targetFolderId,
    }: Omit<BulkMoveKnowledgeItemsBody, 'workspaceId'>) => {
      const result = await requestJson(bulkMoveKnowledgeItemsContract, {
        body: { workspaceId, knowledgeBaseIds, folderIds, targetFolderId },
      })
      return result.data
    },
    onError: (error) => {
      toast.error(error.message, { duration: 5000 })
    },
    onSettled: (_data, _error, { knowledgeBaseIds = [] }) => {
      queryClient.invalidateQueries({ queryKey: knowledgeKeys.lists() })
      queryClient.invalidateQueries({ queryKey: folderKeys.resource('knowledge_base') })
      /**
       * `exact` because `detail` is the prefix for the base's documents, chunks, and tag
       * queries — a move only re-parents the base record itself, so a prefix invalidation would
       * refetch every cached document and chunk page for nothing. The sibling delete hook
       * deliberately stays non-exact, since there the children really must go.
       */
      for (const knowledgeBaseId of knowledgeBaseIds) {
        queryClient.invalidateQueries({
          queryKey: knowledgeKeys.detail(knowledgeBaseId),
          exact: true,
        })
      }
    },
  })
}

/**
 * Delete a mixed selection of knowledge bases and knowledge folders.
 *
 * Deleting a folder cascades to every knowledge base and subfolder inside it,
 * so the response's `deletedItems` totals exceed the explicitly selected count.
 */
export function useBulkDeleteKnowledgeBases(workspaceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      knowledgeBaseIds = [],
      folderIds = [],
    }: Omit<BulkDeleteKnowledgeItemsBody, 'workspaceId'>) => {
      const result = await requestJson(bulkDeleteKnowledgeItemsContract, {
        body: { workspaceId, knowledgeBaseIds, folderIds },
      })
      return result.data
    },
    onError: (error) => {
      toast.error(error.message, { duration: 5000 })
    },
    onSettled: (_data, _error, { knowledgeBaseIds = [] }) => {
      queryClient.invalidateQueries({ queryKey: knowledgeKeys.lists() })
      queryClient.invalidateQueries({ queryKey: folderKeys.resource('knowledge_base') })
      for (const knowledgeBaseId of knowledgeBaseIds) {
        queryClient.removeQueries({ queryKey: knowledgeKeys.detail(knowledgeBaseId) })
      }
    },
  })
}

async function searchWorkspaceKnowledge(
  body: WorkspaceKnowledgeSearchBody,
  signal?: AbortSignal
): Promise<WorkspaceKnowledgeSearchResult[]> {
  const data = await requestJson(searchWorkspaceKnowledgeContract, { body, signal })
  return data.data.results
}

/** Searches the canonical index under the signed-in person's ACLs. */
export function useWorkspaceKnowledgeSearch(
  owner: string | ResourceScope | undefined,
  query: string,
  filters?: WorkspaceSearchFilters
) {
  const trimmed = query.trim()
  const scope =
    typeof owner === 'string'
      ? owner
        ? { kind: 'workspace' as const, workspaceId: owner }
        : undefined
      : owner
  const scopeKey =
    scope?.kind === 'workspace' ? scope.workspaceId : scope ? resourceScopeKey(scope) : undefined
  return useQuery({
    queryKey: knowledgeKeys.search(scopeKey, trimmed, filters),
    queryFn: ({ signal }) =>
      searchWorkspaceKnowledge(
        {
          ...(scope ? resourceScopeFields(scope) : {}),
          query: trimmed,
          filters,
        },
        signal
      ),
    enabled: Boolean(scope) && trimmed.length > 0,
    staleTime: WORKSPACE_KNOWLEDGE_SEARCH_STALE_TIME,
    retry: false,
  })
}
