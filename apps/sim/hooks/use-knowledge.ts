import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Fuse from 'fuse.js'
import { createLogger } from '@/lib/logs/console/logger'
import {
  fetchKnowledgeChunks,
  knowledgeKeys,
  serializeChunkParams,
  serializeDocumentParams,
  useKnowledgeBaseQuery,
  useKnowledgeBasesQuery,
  useKnowledgeChunksQuery,
  useKnowledgeDocumentsQuery,
} from '@/hooks/queries/knowledge'
import {
  type ChunkData,
  type ChunksPagination,
  type DocumentData,
  type DocumentsCache,
  type DocumentsPagination,
  type KnowledgeBaseData,
  useKnowledgeStore,
} from '@/stores/knowledge/store'

const logger = createLogger('UseKnowledgeBase')

export function useKnowledgeBase(id: string) {
  const query = useKnowledgeBaseQuery(id)
  useEffect(() => {
    if (query.data) {
      const knowledgeBase = query.data
      useKnowledgeStore.setState((state) => ({
        knowledgeBases: {
          ...state.knowledgeBases,
          [knowledgeBase.id]: knowledgeBase,
        },
      }))
    }
  }, [query.data])

  return {
    knowledgeBase: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
  }
}

// Constants
const DEFAULT_PAGE_SIZE = 50

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
  const requestSearch = options?.search
  const requestSortBy = options?.sortBy
  const requestSortOrder = options?.sortOrder
  const paramsKey = serializeDocumentParams({
    knowledgeBaseId,
    limit: requestLimit,
    offset: requestOffset,
    search: requestSearch,
    sortBy: requestSortBy,
    sortOrder: requestSortOrder,
  })

  const query = useKnowledgeDocumentsQuery(
    {
      knowledgeBaseId,
      limit: requestLimit,
      offset: requestOffset,
      search: requestSearch,
      sortBy: requestSortBy,
      sortOrder: requestSortOrder,
    },
    {
      enabled: (options?.enabled ?? true) && Boolean(knowledgeBaseId),
    }
  )

  useEffect(() => {
    if (!query.data || !knowledgeBaseId) return
    const documentsCache = {
      documents: query.data.documents,
      pagination: query.data.pagination,
      searchQuery: requestSearch,
      sortBy: requestSortBy,
      sortOrder: requestSortOrder,
      lastFetchTime: Date.now(),
    }
    useKnowledgeStore.setState((state) => ({
      documents: {
        ...state.documents,
        [knowledgeBaseId]: documentsCache,
      },
    }))
  }, [query.data, knowledgeBaseId, requestSearch, requestSortBy, requestSortOrder])

  const documents = query.data?.documents ?? []
  const pagination =
    query.data?.pagination ??
    ({
      total: 0,
      limit: requestLimit,
      offset: requestOffset,
      hasMore: false,
    } satisfies DocumentsCache['pagination'])

  const refreshDocumentsData = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: knowledgeKeys.documents(knowledgeBaseId, paramsKey),
    })
  }, [queryClient, knowledgeBaseId, paramsKey])

  const updateDocumentLocal = useCallback(
    (documentId: string, updates: Partial<DocumentData>) => {
      queryClient.setQueryData<{
        documents: DocumentData[]
        pagination: DocumentsPagination
      }>(knowledgeKeys.documents(knowledgeBaseId, paramsKey), (previous) => {
        if (!previous) return previous
        return {
          ...previous,
          documents: previous.documents.map((doc) =>
            doc.id === documentId ? { ...doc, ...updates } : doc
          ),
        }
      })
      useKnowledgeStore.setState((state) => {
        const existing = state.documents[knowledgeBaseId]
        if (!existing) return state
        return {
          documents: {
            ...state.documents,
            [knowledgeBaseId]: {
              ...existing,
              documents: existing.documents.map((doc) =>
                doc.id === documentId ? { ...doc, ...updates } : doc
              ),
            },
          },
        }
      })
      logger.info(`Updated document ${documentId} for knowledge base ${knowledgeBaseId}`)
    },
    [knowledgeBaseId, paramsKey, queryClient]
  )

  return {
    documents,
    pagination,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refreshDocuments: refreshDocumentsData,
    updateDocument: updateDocumentLocal,
  }
}

export function useKnowledgeBasesList(
  workspaceId?: string,
  options?: {
    enabled?: boolean
  }
) {
  const queryClient = useQueryClient()
  const query = useKnowledgeBasesQuery(workspaceId, { enabled: options?.enabled ?? true })
  useEffect(() => {
    if (query.data) {
      useKnowledgeStore.setState((state) => ({
        knowledgeBasesList: query.data as KnowledgeBaseData[],
        knowledgeBasesListLoaded: true,
        loadingKnowledgeBasesList: query.isLoading,
        knowledgeBases: query.data!.reduce<Record<string, KnowledgeBaseData>>(
          (acc, kb) => {
            acc[kb.id] = kb
            return acc
          },
          { ...state.knowledgeBases }
        ),
      }))
    } else if (query.isLoading) {
      useKnowledgeStore.setState((state) => ({
        loadingKnowledgeBasesList: true,
      }))
    }
  }, [query.data, query.isLoading])

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
      useKnowledgeStore.setState((state) => ({
        knowledgeBases: {
          ...state.knowledgeBases,
          [knowledgeBase.id]: knowledgeBase,
        },
        knowledgeBasesList: state.knowledgeBasesList.some((kb) => kb.id === knowledgeBase.id)
          ? state.knowledgeBasesList
          : [knowledgeBase, ...state.knowledgeBasesList],
      }))
    },
    [queryClient, workspaceId]
  )

  const removeKnowledgeBase = useCallback(
    (knowledgeBaseId: string) => {
      queryClient.setQueryData<KnowledgeBaseData[]>(
        knowledgeKeys.list(workspaceId),
        (previous) => previous?.filter((kb) => kb.id !== knowledgeBaseId) ?? []
      )
      useKnowledgeStore.setState((state) => ({
        knowledgeBases: Object.fromEntries(
          Object.entries(state.knowledgeBases).filter(([id]) => id !== knowledgeBaseId)
        ),
        knowledgeBasesList: state.knowledgeBasesList.filter((kb) => kb.id !== knowledgeBaseId),
      }))
    },
    [queryClient, workspaceId]
  )

  const refreshList = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: knowledgeKeys.list(workspaceId) })
  }, [queryClient, workspaceId])

  const forceRefresh = refreshList

  return {
    knowledgeBases: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    refreshList,
    forceRefresh,
    addKnowledgeBase,
    removeKnowledgeBase,
    retryCount: 0,
    maxRetries: 0,
  }
}

/**
 * Hook to manage chunks for a specific document with optional client-side search
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

  const [chunks, setChunks] = useState<ChunkData[]>([])
  const [allChunks, setAllChunks] = useState<ChunkData[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pagination, setPagination] = useState({
    total: 0,
    limit: 50,
    offset: 0,
    hasMore: false,
  })

  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(urlPage)

  useEffect(() => {
    setCurrentPage(urlPage)
  }, [urlPage])

  useEffect(() => {
    if (!enableClientSearch) return
    setSearchQuery(urlSearch)
  }, [enableClientSearch, urlSearch])

  if (enableClientSearch) {
    const loadAllChunks = useCallback(async () => {
      if (!knowledgeBaseId || !documentId) return

      try {
        setIsLoading(true)
        setError(null)

        const aggregated: ChunkData[] = []
        const limit = DEFAULT_PAGE_SIZE
        let offset = 0
        let hasMore = true

        while (hasMore) {
          const { chunks: batch, pagination: batchPagination } = await fetchKnowledgeChunks({
            knowledgeBaseId,
            documentId,
            limit,
            offset,
          })

          aggregated.push(...batch)
          hasMore = batchPagination.hasMore
          offset = batchPagination.offset + batchPagination.limit
        }

        setAllChunks(aggregated)
        setChunks(aggregated)
        setPagination({
          total: aggregated.length,
          limit,
          offset: 0,
          hasMore: false,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load chunks'
        setError(message)
        logger.error(`Failed to load chunks for document ${documentId}:`, err)
      } finally {
        setIsLoading(false)
      }
    }, [documentId, knowledgeBaseId])

    useEffect(() => {
      loadAllChunks()
    }, [loadAllChunks])

    const filteredChunks = useMemo(() => {
      if (!searchQuery.trim()) return allChunks

      const fuse = new Fuse(allChunks, {
        keys: ['content'],
        threshold: 0.3,
        includeScore: true,
        includeMatches: true,
        minMatchCharLength: 2,
        ignoreLocation: true,
      })

      const results = fuse.search(searchQuery)
      return results.map((result) => result.item)
    }, [allChunks, searchQuery])

    const CHUNKS_PER_PAGE = DEFAULT_PAGE_SIZE
    const totalPages = Math.max(1, Math.ceil(filteredChunks.length / CHUNKS_PER_PAGE))
    const hasNextPage = currentPage < totalPages
    const hasPrevPage = currentPage > 1

    const paginatedChunks = useMemo(() => {
      const startIndex = (currentPage - 1) * CHUNKS_PER_PAGE
      const endIndex = startIndex + CHUNKS_PER_PAGE
      return filteredChunks.slice(startIndex, endIndex)
    }, [filteredChunks, currentPage])

    useEffect(() => {
      if (currentPage > 1) {
        setCurrentPage(1)
      }
    }, [searchQuery, currentPage])

    useEffect(() => {
      if (currentPage > totalPages && totalPages > 0) {
        setCurrentPage(totalPages)
      }
    }, [currentPage, totalPages])

    const goToPage = useCallback(
      (page: number) => {
        if (page >= 1 && page <= totalPages) {
          setCurrentPage(page)
        }
      },
      [totalPages]
    )

    const nextPage = useCallback(() => {
      if (hasNextPage) {
        setCurrentPage((prev) => prev + 1)
      }
    }, [hasNextPage])

    const prevPage = useCallback(() => {
      if (hasPrevPage) {
        setCurrentPage((prev) => prev - 1)
      }
    }, [hasPrevPage])

    return {
      chunks: paginatedChunks,
      allChunks,
      filteredChunks,
      paginatedChunks,
      searchQuery,
      setSearchQuery,
      isLoading,
      error,
      pagination: {
        total: filteredChunks.length,
        limit: CHUNKS_PER_PAGE,
        offset: (currentPage - 1) * CHUNKS_PER_PAGE,
        hasMore: hasNextPage,
      },
      currentPage,
      totalPages,
      hasNextPage,
      hasPrevPage,
      goToPage,
      nextPage,
      prevPage,
      refreshChunks: loadAllChunks,
      searchChunks: async () => filteredChunks,
      updateChunk: (chunkId: string, updates: Partial<ChunkData>) => {
        setAllChunks((previous) =>
          previous.map((chunk) => (chunk.id === chunkId ? { ...chunk, ...updates } : chunk))
        )
        setChunks((previous) =>
          previous.map((chunk) => (chunk.id === chunkId ? { ...chunk, ...updates } : chunk))
        )
      },
      clearChunks: () => {
        setAllChunks([])
        setChunks([])
      },
    }
  }

  const serverCurrentPage = Math.max(1, urlPage)
  const serverSearchQuery = urlSearch ?? ''
  const serverLimit = DEFAULT_PAGE_SIZE
  const serverOffset = (serverCurrentPage - 1) * serverLimit

  const chunkQueryParams = useMemo(
    () => ({
      knowledgeBaseId,
      documentId,
      limit: serverLimit,
      offset: serverOffset,
      search: serverSearchQuery ? serverSearchQuery : undefined,
    }),
    [documentId, knowledgeBaseId, serverLimit, serverOffset, serverSearchQuery]
  )

  const chunkParamsKey = useMemo(() => serializeChunkParams(chunkQueryParams), [chunkQueryParams])

  const chunkQuery = useKnowledgeChunksQuery(chunkQueryParams, {
    enabled: Boolean(knowledgeBaseId && documentId),
  })

  useEffect(() => {
    if (chunkQuery.data) {
      setChunks(chunkQuery.data.chunks)
      setPagination(chunkQuery.data.pagination)
    }
  }, [chunkQuery.data])

  useEffect(() => {
    setIsLoading(chunkQuery.isFetching || chunkQuery.isLoading)
  }, [chunkQuery.isFetching, chunkQuery.isLoading])

  useEffect(() => {
    const message = chunkQuery.error instanceof Error ? chunkQuery.error.message : chunkQuery.error
    setError(message ?? null)
  }, [chunkQuery.error])

  const totalPages = Math.max(
    1,
    Math.ceil(
      (pagination.total || 0) /
        (pagination.limit && pagination.limit > 0 ? pagination.limit : DEFAULT_PAGE_SIZE)
    )
  )
  const hasNextPage = serverCurrentPage < totalPages
  const hasPrevPage = serverCurrentPage > 1

  const goToPage = useCallback(
    async (page: number) => {
      if (!knowledgeBaseId || !documentId) return
      if (page < 1 || page > totalPages) return

      const offset = (page - 1) * serverLimit
      const paramsKey = serializeChunkParams({
        knowledgeBaseId,
        documentId,
        limit: serverLimit,
        offset,
        search: chunkQueryParams.search,
      })

      await queryClient.fetchQuery({
        queryKey: knowledgeKeys.chunks(knowledgeBaseId, documentId, paramsKey),
        queryFn: () =>
          fetchKnowledgeChunks({
            knowledgeBaseId,
            documentId,
            limit: serverLimit,
            offset,
            search: chunkQueryParams.search,
          }),
      })
    },
    [chunkQueryParams.search, documentId, knowledgeBaseId, queryClient, serverLimit, totalPages]
  )

  const nextPage = useCallback(async () => {
    if (hasNextPage) {
      await goToPage(serverCurrentPage + 1)
    }
  }, [goToPage, hasNextPage, serverCurrentPage])

  const prevPage = useCallback(async () => {
    if (hasPrevPage) {
      await goToPage(serverCurrentPage - 1)
    }
  }, [goToPage, hasPrevPage, serverCurrentPage])

  const refreshChunksData = useCallback(async () => {
    if (!knowledgeBaseId || !documentId) return
    await queryClient.invalidateQueries({
      queryKey: knowledgeKeys.chunks(knowledgeBaseId, documentId, chunkParamsKey),
    })
  }, [chunkParamsKey, documentId, knowledgeBaseId, queryClient])

  const searchChunks = useCallback(
    async (newSearchQuery: string) => {
      if (!knowledgeBaseId || !documentId) return []
      const paramsKey = serializeChunkParams({
        knowledgeBaseId,
        documentId,
        limit: serverLimit,
        offset: 0,
        search: newSearchQuery || undefined,
      })

      const result = await queryClient.fetchQuery({
        queryKey: knowledgeKeys.chunks(knowledgeBaseId, documentId, paramsKey),
        queryFn: () =>
          fetchKnowledgeChunks({
            knowledgeBaseId,
            documentId,
            limit: serverLimit,
            offset: 0,
            search: newSearchQuery || undefined,
          }),
      })

      return result.chunks
    },
    [documentId, knowledgeBaseId, queryClient, serverLimit]
  )

  const updateChunkLocal = useCallback(
    (chunkId: string, updates: Partial<ChunkData>) => {
      queryClient.setQueriesData<{
        chunks: ChunkData[]
        pagination: ChunksPagination
      }>(
        {
          predicate: (query) =>
            Array.isArray(query.queryKey) &&
            query.queryKey[0] === knowledgeKeys.all[0] &&
            query.queryKey[1] === knowledgeKeys.detail('')[1] &&
            query.queryKey[2] === knowledgeBaseId &&
            query.queryKey[3] === 'documents' &&
            query.queryKey[4] === documentId &&
            query.queryKey[5] === 'chunks',
        },
        (oldData) => {
          if (!oldData) return oldData
          return {
            ...oldData,
            chunks: oldData.chunks.map((chunk) =>
              chunk.id === chunkId ? { ...chunk, ...updates } : chunk
            ),
          }
        }
      )

      setChunks((previous) =>
        previous.map((chunk) => (chunk.id === chunkId ? { ...chunk, ...updates } : chunk))
      )
      useKnowledgeStore.getState().updateChunk(documentId, chunkId, updates)
    },
    [documentId, knowledgeBaseId, queryClient]
  )

  const clearChunksLocal = useCallback(() => {
    useKnowledgeStore.getState().clearChunks(documentId)
    setChunks([])
    setPagination({
      total: 0,
      limit: DEFAULT_PAGE_SIZE,
      offset: 0,
      hasMore: false,
    })
  }, [documentId])

  return {
    chunks,
    allChunks: chunks,
    filteredChunks: chunks,
    paginatedChunks: chunks,
    searchQuery: serverSearchQuery,
    setSearchQuery: () => {},
    isLoading,
    error,
    pagination,
    currentPage: serverCurrentPage,
    totalPages,
    hasNextPage,
    hasPrevPage,
    goToPage,
    nextPage,
    prevPage,
    refreshChunks: refreshChunksData,
    searchChunks,
    updateChunk: updateChunkLocal,
    clearChunks: clearChunksLocal,
  }
}
