import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import Fuse from 'fuse.js'
import type { ChunkData, DocumentData, KnowledgeBaseData } from '@/lib/knowledge/types'
import {
  fetchKnowledgeChunks,
  type KnowledgeChunksResponse,
  type KnowledgeDocumentsResponse,
  knowledgeKeys,
  serializeChunkParams,
  serializeDocumentParams,
  useKnowledgeBaseQuery,
  useKnowledgeBasesQuery,
  useKnowledgeChunksQuery,
  useKnowledgeDocumentsQuery,
} from '@/hooks/queries/knowledge'

const logger = createLogger('UseKnowledge')

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

  const addKnowledgeBase = useCallback(
    (knowledgeBase: KnowledgeBaseData) => {
      queryClient.setQueryData<KnowledgeBaseData[]>(
        knowledgeKeys.list(workspaceId),
        (previous = []) => {
          if (previous.some((kb) => kb.id === knowledgeBase.id)) {
            return previous
          }
          return [knowledgeBase, ...previous]
        }
      )
    },
    [queryClient, workspaceId]
  )

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
    addKnowledgeBase,
    removeKnowledgeBase,
    updateKnowledgeBase,
  }
}

/**
 * Hook to manage chunks for a specific document
 * Supports both server-side and client-side search modes
 */
export function useDocumentChunks(
  knowledgeBaseId: string,
  documentId: string,
  urlPage = 1,
  urlSearch = '',
  options: { enableClientSearch?: boolean } = {}
) {
  const { enableClientSearch = false } = options
  const queryClient = useQueryClient()

  const [allChunks, setAllChunks] = useState<ChunkData[]>([])
  const [isLoadingAllChunks, setIsLoadingAllChunks] = useState(false)
  const [clientError, setClientError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState(urlSearch)
  const [currentPage, setCurrentPage] = useState(urlPage)

  useEffect(() => {
    setCurrentPage(urlPage)
  }, [urlPage])

  useEffect(() => {
    if (enableClientSearch) {
      setSearchQuery(urlSearch)
    }
  }, [enableClientSearch, urlSearch])

  const loadAllChunks = useCallback(async () => {
    if (!knowledgeBaseId || !documentId) return

    try {
      setIsLoadingAllChunks(true)
      setClientError(null)

      const aggregated: ChunkData[] = []
      let offset = 0
      let hasMore = true

      while (hasMore) {
        const { chunks: batch, pagination } = await fetchKnowledgeChunks({
          knowledgeBaseId,
          documentId,
          limit: DEFAULT_PAGE_SIZE,
          offset,
        })

        aggregated.push(...batch)
        hasMore = pagination.hasMore
        offset = pagination.offset + pagination.limit
      }

      setAllChunks(aggregated)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load chunks'
      setClientError(message)
      logger.error(`Failed to load chunks for document ${documentId}:`, err)
    } finally {
      setIsLoadingAllChunks(false)
    }
  }, [documentId, knowledgeBaseId])

  useEffect(() => {
    if (enableClientSearch) {
      loadAllChunks()
    }
  }, [enableClientSearch, loadAllChunks])

  const filteredChunks = useMemo(() => {
    if (!enableClientSearch) return allChunks
    if (!searchQuery.trim()) return allChunks

    const fuse = new Fuse(allChunks, {
      keys: ['content'],
      threshold: 0.3,
      includeScore: true,
      minMatchCharLength: 2,
      ignoreLocation: true,
    })

    return fuse.search(searchQuery).map((result) => result.item)
  }, [allChunks, searchQuery, enableClientSearch])

  const clientTotalPages = Math.max(1, Math.ceil(filteredChunks.length / DEFAULT_PAGE_SIZE))
  const clientPaginatedChunks = useMemo(() => {
    if (!enableClientSearch) return []
    const start = (currentPage - 1) * DEFAULT_PAGE_SIZE
    return filteredChunks.slice(start, start + DEFAULT_PAGE_SIZE)
  }, [filteredChunks, currentPage, enableClientSearch])

  const prevSearchRef = useRef(searchQuery)
  useEffect(() => {
    if (enableClientSearch && prevSearchRef.current !== searchQuery) {
      setCurrentPage(1)
      prevSearchRef.current = searchQuery
    }
  }, [searchQuery, enableClientSearch])

  const serverPage = Math.max(1, urlPage)
  const serverOffset = (serverPage - 1) * DEFAULT_PAGE_SIZE

  const chunkQuery = useKnowledgeChunksQuery(
    {
      knowledgeBaseId,
      documentId,
      limit: DEFAULT_PAGE_SIZE,
      offset: serverOffset,
      search: urlSearch || undefined,
    },
    {
      enabled: !enableClientSearch && Boolean(knowledgeBaseId && documentId),
    }
  )

  const serverChunks = chunkQuery.data?.chunks ?? []
  const serverPagination = chunkQuery.data?.pagination ?? {
    total: 0,
    limit: DEFAULT_PAGE_SIZE,
    offset: 0,
    hasMore: false,
  }
  const serverTotalPages = Math.max(1, Math.ceil(serverPagination.total / DEFAULT_PAGE_SIZE))

  const chunks = enableClientSearch ? clientPaginatedChunks : serverChunks
  const totalPages = enableClientSearch ? clientTotalPages : serverTotalPages
  const isLoading = enableClientSearch ? isLoadingAllChunks : chunkQuery.isLoading
  const isFetching = enableClientSearch ? isLoadingAllChunks : chunkQuery.isFetching
  const isPlaceholderData = enableClientSearch ? false : chunkQuery.isPlaceholderData
  const error = enableClientSearch
    ? clientError
    : chunkQuery.error instanceof Error
      ? chunkQuery.error.message
      : null
  const effectiveCurrentPage = enableClientSearch ? currentPage : serverPage
  const hasNextPage = effectiveCurrentPage < totalPages
  const hasPrevPage = effectiveCurrentPage > 1

  const goToPage = useCallback(
    async (page: number) => {
      if (page < 1 || page > totalPages) return
      if (enableClientSearch) {
        setCurrentPage(page)
      }
    },
    [totalPages, enableClientSearch]
  )

  const nextPage = useCallback(async () => {
    if (hasNextPage) {
      await goToPage(effectiveCurrentPage + 1)
    }
  }, [goToPage, hasNextPage, effectiveCurrentPage])

  const prevPage = useCallback(async () => {
    if (hasPrevPage) {
      await goToPage(effectiveCurrentPage - 1)
    }
  }, [goToPage, hasPrevPage, effectiveCurrentPage])

  const refreshChunks = useCallback(async () => {
    if (enableClientSearch) {
      await loadAllChunks()
    } else {
      const paramsKey = serializeChunkParams({
        knowledgeBaseId,
        documentId,
        limit: DEFAULT_PAGE_SIZE,
        offset: serverOffset,
        search: urlSearch || undefined,
      })
      await queryClient.invalidateQueries({
        queryKey: knowledgeKeys.chunks(knowledgeBaseId, documentId, paramsKey),
      })
    }
  }, [
    enableClientSearch,
    loadAllChunks,
    knowledgeBaseId,
    documentId,
    serverOffset,
    urlSearch,
    queryClient,
  ])

  const updateChunk = useCallback(
    (chunkId: string, updates: Partial<ChunkData>) => {
      if (enableClientSearch) {
        setAllChunks((prev) =>
          prev.map((chunk) => (chunk.id === chunkId ? { ...chunk, ...updates } : chunk))
        )
      } else {
        const paramsKey = serializeChunkParams({
          knowledgeBaseId,
          documentId,
          limit: DEFAULT_PAGE_SIZE,
          offset: serverOffset,
          search: urlSearch || undefined,
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
      }
    },
    [enableClientSearch, knowledgeBaseId, documentId, serverOffset, urlSearch, queryClient]
  )

  const clearChunks = useCallback(() => {
    if (enableClientSearch) {
      setAllChunks([])
    }
  }, [enableClientSearch])

  return {
    chunks,
    allChunks: enableClientSearch ? allChunks : chunks,
    filteredChunks: enableClientSearch ? filteredChunks : chunks,
    paginatedChunks: chunks,
    searchQuery: enableClientSearch ? searchQuery : urlSearch,
    setSearchQuery: enableClientSearch ? setSearchQuery : () => {},
    isLoading,
    isFetching,
    isPlaceholderData,
    error,
    pagination: enableClientSearch
      ? {
          total: filteredChunks.length,
          limit: DEFAULT_PAGE_SIZE,
          offset: (currentPage - 1) * DEFAULT_PAGE_SIZE,
          hasMore: hasNextPage,
        }
      : serverPagination,
    currentPage: effectiveCurrentPage,
    totalPages,
    hasNextPage,
    hasPrevPage,
    goToPage,
    nextPage,
    prevPage,
    refreshChunks,
    searchChunks: async (query: string) => {
      if (enableClientSearch) {
        setSearchQuery(query)
        return filteredChunks
      }
      return []
    },
    updateChunk,
    clearChunks,
  }
}

/**
 * Get cached knowledge base data from React Query
 * Useful for synchronous access to previously fetched data
 */
export function useCachedKnowledgeBase(knowledgeBaseId?: string) {
  const queryClient = useQueryClient()

  return useMemo(() => {
    if (!knowledgeBaseId) return null
    return (
      queryClient.getQueryData<KnowledgeBaseData>(knowledgeKeys.detail(knowledgeBaseId)) ?? null
    )
  }, [queryClient, knowledgeBaseId])
}

/**
 * Get cached documents data from React Query
 * Useful for synchronous access to previously fetched data
 */
export function useCachedDocuments(knowledgeBaseId?: string) {
  const queryClient = useQueryClient()

  return useMemo(() => {
    if (!knowledgeBaseId) return null
    const queries = queryClient.getQueriesData<KnowledgeDocumentsResponse>({
      queryKey: knowledgeKeys.detail(knowledgeBaseId),
    })
    for (const [key, data] of queries) {
      if (Array.isArray(key) && key.includes('documents') && data?.documents) {
        return data
      }
    }
    return null
  }, [queryClient, knowledgeBaseId])
}
