import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ChunkData, DocumentData, KnowledgeBaseData } from '@/lib/knowledge/types'
import {
  type KnowledgeChunksResponse,
  type KnowledgeDocumentsResponse,
  knowledgeKeys,
  serializeChunkParams,
  serializeDocumentParams,
  useDocumentQuery,
  useKnowledgeBaseQuery,
  useKnowledgeBasesQuery,
  useKnowledgeChunksQuery,
  useKnowledgeDocumentsQuery,
} from '@/hooks/queries/knowledge'

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
    error: query.error instanceof Error ? query.error.message : null,
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
    error: query.error instanceof Error ? query.error.message : null,
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
    sortBy?: string
    sortOrder?: string
    enabled?: boolean
    refetchInterval?: number | false
  }
) {
  const queryClient = useQueryClient()
  const requestLimit = options?.limit ?? DEFAULT_PAGE_SIZE
  const requestOffset = options?.offset ?? 0
  const paramsKey = serializeDocumentParams({
    knowledgeBaseId,
    limit: requestLimit,
    offset: requestOffset,
    search: options?.search,
    sortBy: options?.sortBy,
    sortOrder: options?.sortOrder,
  })

  const query = useKnowledgeDocumentsQuery(
    {
      knowledgeBaseId,
      limit: requestLimit,
      offset: requestOffset,
      search: options?.search,
      sortBy: options?.sortBy,
      sortOrder: options?.sortOrder,
    },
    {
      enabled: (options?.enabled ?? true) && Boolean(knowledgeBaseId),
      refetchInterval: options?.refetchInterval,
    }
  )

  const documents = query.data?.documents ?? []
  const pagination = query.data?.pagination ?? {
    total: 0,
    limit: requestLimit,
    offset: requestOffset,
    hasMore: false,
  }

  const refreshDocuments = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: knowledgeKeys.documents(knowledgeBaseId, paramsKey),
    })
  }, [queryClient, knowledgeBaseId, paramsKey])

  const updateDocument = useCallback(
    (documentId: string, updates: Partial<DocumentData>) => {
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
    },
    [knowledgeBaseId, paramsKey, queryClient]
  )

  return {
    documents,
    pagination,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isPlaceholderData: query.isPlaceholderData,
    error: query.error instanceof Error ? query.error.message : null,
    refreshDocuments,
    updateDocument,
  }
}

/**
 * Hook to fetch and manage knowledge bases list
 * Uses React Query as single source of truth
 */
export function useKnowledgeBasesList(
  workspaceId?: string,
  options?: {
    enabled?: boolean
  }
) {
  const queryClient = useQueryClient()
  const query = useKnowledgeBasesQuery(workspaceId, { enabled: options?.enabled ?? true })

  const removeKnowledgeBase = useCallback(
    (knowledgeBaseId: string) => {
      queryClient.setQueryData<KnowledgeBaseData[]>(
        knowledgeKeys.list(workspaceId),
        (previous) => previous?.filter((kb) => kb.id !== knowledgeBaseId) ?? []
      )
    },
    [queryClient, workspaceId]
  )

  const updateKnowledgeBase = useCallback(
    (id: string, updates: Partial<KnowledgeBaseData>) => {
      queryClient.setQueryData<KnowledgeBaseData[]>(
        knowledgeKeys.list(workspaceId),
        (previous) => previous?.map((kb) => (kb.id === id ? { ...kb, ...updates } : kb)) ?? []
      )
      queryClient.setQueryData<KnowledgeBaseData>(knowledgeKeys.detail(id), (previous) =>
        previous ? { ...previous, ...updates } : previous
      )
    },
    [queryClient, workspaceId]
  )

  const refreshList = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: knowledgeKeys.list(workspaceId) })
  }, [queryClient, workspaceId])

  return {
    knowledgeBases: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isPlaceholderData: query.isPlaceholderData,
    error: query.error instanceof Error ? query.error.message : null,
    refreshList,
    removeKnowledgeBase,
    updateKnowledgeBase,
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
  search = ''
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

  const goToPage = useCallback(
    async (newPage: number) => {
      if (newPage < 1 || newPage > totalPages) return
    },
    [totalPages]
  )

  const refreshChunks = useCallback(async () => {
    const paramsKey = serializeChunkParams({
      knowledgeBaseId,
      documentId,
      limit: DEFAULT_PAGE_SIZE,
      offset,
      search: search || undefined,
    })
    await queryClient.invalidateQueries({
      queryKey: knowledgeKeys.chunks(knowledgeBaseId, documentId, paramsKey),
    })
  }, [knowledgeBaseId, documentId, offset, search, queryClient])

  const updateChunk = useCallback(
    (chunkId: string, updates: Partial<ChunkData>) => {
      const paramsKey = serializeChunkParams({
        knowledgeBaseId,
        documentId,
        limit: DEFAULT_PAGE_SIZE,
        offset,
        search: search || undefined,
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
    [knowledgeBaseId, documentId, offset, search, queryClient]
  )

  return {
    chunks,
    isLoading: chunkQuery.isLoading,
    isFetching: chunkQuery.isFetching,
    error: chunkQuery.error instanceof Error ? chunkQuery.error.message : null,
    currentPage,
    totalPages,
    hasNextPage,
    hasPrevPage,
    goToPage,
    refreshChunks,
    updateChunk,
  }
}
