import { useCallback } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryClient } from '@tanstack/react-query'
import type { DocumentSortField, SortOrder } from '@/lib/knowledge/documents/types'
import type { ChunkData, DocumentData } from '@/lib/knowledge/types'
import {
  type DocumentTagFilter,
  type KnowledgeChunksResponse,
  type KnowledgeDocumentsResponse,
  serializeChunkParams,
  serializeDocumentParams,
  useDocumentQuery,
  useKnowledgeBaseQuery,
  useKnowledgeBasesQuery,
  useKnowledgeChunksQuery,
  useKnowledgeDocumentsQuery,
} from '@/hooks/queries/kb/knowledge'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'

const DEFAULT_PAGE_SIZE = 50

/**
 * Hook to fetch and manage a single knowledge base
 * Uses React Query as single source of truth
 */
export function useKnowledgeBase(id: string) {
  const queryClient = useQueryClient()
  const query = useKnowledgeBaseQuery(id)

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: knowledgeKeys.detail(id),
    })
  }, [queryClient, id])

  return {
    knowledgeBase: query.data ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error ? getErrorMessage(query.error) : null,
    refresh,
  }
}

/**
 * Hook to fetch and manage a single document
 * Uses React Query as single source of truth
 */
export function useDocument(knowledgeBaseId: string, documentId: string) {
  const query = useDocumentQuery(knowledgeBaseId, documentId)

  return {
    document: query.data ?? null,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error ? getErrorMessage(query.error) : null,
  }
}

/**
 * Hook to fetch and manage documents for a knowledge base
 * Uses React Query as single source of truth
 */
export function useKnowledgeBaseDocuments(
  knowledgeBaseId: string,
  options?: {
    search?: string
    limit?: number
    offset?: number
    sortBy?: DocumentSortField
    sortOrder?: SortOrder
    enabled?: boolean
    refetchInterval?:
      | number
      | false
      | ((data: KnowledgeDocumentsResponse | undefined) => number | false)
    enabledFilter?: 'all' | 'enabled' | 'disabled'
    tagFilters?: DocumentTagFilter[]
  }
) {
  const queryClient = useQueryClient()
  const requestLimit = options?.limit ?? DEFAULT_PAGE_SIZE
  const requestOffset = options?.offset ?? 0
  const enabledFilter = options?.enabledFilter ?? 'all'
  const tagFilters = options?.tagFilters
  const paramsKey = serializeDocumentParams({
    knowledgeBaseId,
    limit: requestLimit,
    offset: requestOffset,
    search: options?.search,
    sortBy: options?.sortBy,
    sortOrder: options?.sortOrder,
    enabledFilter,
    tagFilters,
  })

  const userRefetchInterval = options?.refetchInterval
  const refetchIntervalFn =
    typeof userRefetchInterval === 'function'
      ? (query: { state: { data?: KnowledgeDocumentsResponse } }) =>
          userRefetchInterval(query.state.data)
      : userRefetchInterval

  const query = useKnowledgeDocumentsQuery(
    {
      knowledgeBaseId,
      limit: requestLimit,
      offset: requestOffset,
      search: options?.search,
      sortBy: options?.sortBy,
      sortOrder: options?.sortOrder,
      enabledFilter,
      tagFilters,
    },
    {
      enabled: (options?.enabled ?? true) && Boolean(knowledgeBaseId),
      refetchInterval: refetchIntervalFn,
    }
  )

  const documents = query.data?.documents ?? []
  const pagination = query.data?.pagination ?? {
    total: 0,
    limit: requestLimit,
    offset: requestOffset,
    hasMore: false,
  }

  const hasProcessingDocs = documents.some(
    (doc) => doc.processingStatus === 'pending' || doc.processingStatus === 'processing'
  )

  const refreshDocuments = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: knowledgeKeys.documents(knowledgeBaseId, paramsKey),
    })
  }, [queryClient, knowledgeBaseId, paramsKey])

  const updateDocument = (documentId: string, updates: Partial<DocumentData>) => {
    queryClient.setQueryData<KnowledgeDocumentsResponse>(
      knowledgeKeys.documents(knowledgeBaseId, paramsKey),
      (previous) => {
        if (!previous) return previous
        return {
          ...previous,
          documents: previous.documents.map((doc) =>
            doc.id === documentId ? { ...doc, ...updates } : doc
          ),
        }
      }
    )
  }

  return {
    documents,
    pagination,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isPlaceholderData: query.isPlaceholderData,
    error: query.error ? getErrorMessage(query.error) : null,
    hasProcessingDocuments: hasProcessingDocs,
    refreshDocuments,
    updateDocument,
  }
}

/**
 * Hook to fetch and manage knowledge bases list
 * Uses React Query as single source of truth
 */
export function useKnowledgeBasesList(workspaceId?: string) {
  const query = useKnowledgeBasesQuery(workspaceId)

  return {
    knowledgeBases: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isPlaceholderData: query.isPlaceholderData,
    error: query.error ? getErrorMessage(query.error) : null,
  }
}

/**
 * Hook to manage chunks for a specific document
 * Uses React Query as single source of truth
 */
export function useDocumentChunks(
  knowledgeBaseId: string,
  documentId: string,
  page = 1,
  search = '',
  enabledFilter: 'all' | 'enabled' | 'disabled' = 'all',
  sortBy?: 'chunkIndex' | 'tokenCount' | 'enabled',
  sortOrder?: 'asc' | 'desc'
) {
  const queryClient = useQueryClient()

  const currentPage = Math.max(1, page)
  const offset = (currentPage - 1) * DEFAULT_PAGE_SIZE

  const chunkQuery = useKnowledgeChunksQuery(
    {
      knowledgeBaseId,
      documentId,
      limit: DEFAULT_PAGE_SIZE,
      offset,
      search: search || undefined,
      enabledFilter,
      sortBy,
      sortOrder,
    },
    {
      enabled: Boolean(knowledgeBaseId && documentId),
    }
  )

  const chunks = chunkQuery.data?.chunks ?? []
  const pagination = chunkQuery.data?.pagination ?? {
    total: 0,
    limit: DEFAULT_PAGE_SIZE,
    offset: 0,
    hasMore: false,
  }
  const totalPages = Math.max(1, Math.ceil(pagination.total / DEFAULT_PAGE_SIZE))
  const hasNextPage = currentPage < totalPages
  const hasPrevPage = currentPage > 1

  const updateChunk = useCallback(
    (chunkId: string, updates: Partial<ChunkData>) => {
      const paramsKey = serializeChunkParams({
        knowledgeBaseId,
        documentId,
        limit: DEFAULT_PAGE_SIZE,
        offset,
        search: search || undefined,
        enabledFilter,
        sortBy,
        sortOrder,
      })
      queryClient.setQueryData<KnowledgeChunksResponse>(
        knowledgeKeys.chunks(knowledgeBaseId, documentId, paramsKey),
        (previous) => {
          if (!previous) return previous
          return {
            ...previous,
            chunks: previous.chunks.map((chunk) =>
              chunk.id === chunkId ? { ...chunk, ...updates } : chunk
            ),
          }
        }
      )
    },
    [knowledgeBaseId, documentId, offset, search, enabledFilter, sortBy, sortOrder, queryClient]
  )

  return {
    chunks,
    isLoading: chunkQuery.isLoading,
    isFetching: chunkQuery.isFetching,
    error: chunkQuery.error ? getErrorMessage(chunkQuery.error) : null,
    currentPage,
    totalPages,
    hasNextPage,
    hasPrevPage,
    updateChunk,
  }
}
