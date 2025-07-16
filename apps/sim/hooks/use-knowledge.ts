import { useCallback, useEffect, useMemo, useState } from 'react'
import Fuse from 'fuse.js'
import { type ChunkData, type DocumentData, useKnowledgeStore } from '@/stores/knowledge/store'

export function useKnowledgeBase(id: string) {
  const { getKnowledgeBase, getCachedKnowledgeBase, loadingKnowledgeBases } = useKnowledgeStore()

  const [error, setError] = useState<string | null>(null)

  const knowledgeBase = getCachedKnowledgeBase(id)
  const isLoading = loadingKnowledgeBases.has(id)

  useEffect(() => {
    if (!id || knowledgeBase || isLoading) return

    let isMounted = true

    const loadData = async () => {
      try {
        setError(null)
        await getKnowledgeBase(id)
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to load knowledge base')
        }
      }
    }

    loadData()

    return () => {
      isMounted = false
    }
  }, [id, knowledgeBase, isLoading]) // Removed getKnowledgeBase from dependencies

  return {
    knowledgeBase,
    isLoading,
    error,
  }
}

// Constants
const MAX_DOCUMENTS_LIMIT = 10000
const DEFAULT_PAGE_SIZE = 50

export function useKnowledgeBaseDocuments(
  knowledgeBaseId: string,
  options?: { search?: string; limit?: number; offset?: number }
) {
  const { getDocuments, getCachedDocuments, loadingDocuments, updateDocument, refreshDocuments } =
    useKnowledgeStore()

  const [error, setError] = useState<string | null>(null)

  const documentsCache = getCachedDocuments(knowledgeBaseId)
  const allDocuments = documentsCache?.documents || []
  const isLoading = loadingDocuments.has(knowledgeBaseId)

  // Load all documents on initial mount
  useEffect(() => {
    if (!knowledgeBaseId || allDocuments.length > 0 || isLoading) return

    let isMounted = true

    const loadAllDocuments = async () => {
      try {
        setError(null)
        await getDocuments(knowledgeBaseId, { limit: MAX_DOCUMENTS_LIMIT })
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to load documents')
        }
      }
    }

    loadAllDocuments()

    return () => {
      isMounted = false
    }
  }, [knowledgeBaseId, allDocuments.length, isLoading, getDocuments])

  // Client-side filtering and pagination
  const { documents, pagination } = useMemo(() => {
    let filteredDocs = allDocuments

    // Apply search filter
    if (options?.search) {
      const searchLower = options.search.toLowerCase()
      filteredDocs = filteredDocs.filter((doc) => doc.filename.toLowerCase().includes(searchLower))
    }

    // Apply pagination
    const offset = options?.offset || 0
    const limit = options?.limit || DEFAULT_PAGE_SIZE
    const total = filteredDocs.length
    const paginatedDocs = filteredDocs.slice(offset, offset + limit)

    return {
      documents: paginatedDocs,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    }
  }, [allDocuments, options?.search, options?.limit, options?.offset])

  const refreshDocumentsData = useCallback(async () => {
    try {
      setError(null)
      await refreshDocuments(knowledgeBaseId, { limit: MAX_DOCUMENTS_LIMIT })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh documents')
    }
  }, [knowledgeBaseId, refreshDocuments])

  const updateDocumentLocal = useCallback(
    (documentId: string, updates: Partial<DocumentData>) => {
      updateDocument(knowledgeBaseId, documentId, updates)
    },
    [knowledgeBaseId, updateDocument]
  )

  return {
    documents,
    pagination,
    isLoading,
    error,
    refreshDocuments: refreshDocumentsData,
    updateDocument: updateDocumentLocal,
  }
}

export function useKnowledgeBasesList() {
  const {
    getKnowledgeBasesList,
    knowledgeBasesList,
    loadingKnowledgeBasesList,
    knowledgeBasesListLoaded,
    addKnowledgeBase,
    removeKnowledgeBase,
    clearKnowledgeBasesList,
  } = useKnowledgeStore()

  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const maxRetries = 3

  useEffect(() => {
    // Only load if we haven't loaded before AND we're not currently loading
    if (knowledgeBasesListLoaded || loadingKnowledgeBasesList) return

    let isMounted = true
    let retryTimeoutId: NodeJS.Timeout | null = null

    const loadData = async (attempt = 0) => {
      // Don't proceed if component is unmounted
      if (!isMounted) return

      try {
        setError(null)
        await getKnowledgeBasesList()

        // Reset retry count on success
        if (isMounted) {
          setRetryCount(0)
        }
      } catch (err) {
        if (!isMounted) return

        const errorMessage = err instanceof Error ? err.message : 'Failed to load knowledge bases'

        // Only set error and retry if we haven't exceeded max retries
        if (attempt < maxRetries) {
          console.warn(`Knowledge bases load attempt ${attempt + 1} failed, retrying...`, err)
          setRetryCount(attempt + 1)

          // Exponential backoff: 1s, 2s, 4s
          const delay = 2 ** attempt * 1000
          retryTimeoutId = setTimeout(() => {
            if (isMounted) {
              loadData(attempt + 1)
            }
          }, delay)
        } else {
          console.error('All retry attempts failed for knowledge bases list:', err)
          setError(errorMessage)
          setRetryCount(maxRetries)
        }
      }
    }

    // Always start from attempt 0
    loadData(0)

    // Cleanup function
    return () => {
      isMounted = false
      if (retryTimeoutId) {
        clearTimeout(retryTimeoutId)
      }
    }
  }, [knowledgeBasesListLoaded, loadingKnowledgeBasesList, getKnowledgeBasesList])

  const refreshList = async () => {
    try {
      setError(null)
      setRetryCount(0)
      clearKnowledgeBasesList()
      await getKnowledgeBasesList()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to refresh knowledge bases'
      setError(errorMessage)
      console.error('Error refreshing knowledge bases list:', err)
    }
  }

  // Force refresh function that bypasses cache and resets everything
  const forceRefresh = async () => {
    setError(null)
    setRetryCount(0)
    clearKnowledgeBasesList()

    // Force reload by clearing cache and loading state
    useKnowledgeStore.setState({
      knowledgeBasesList: [],
      loadingKnowledgeBasesList: false,
      knowledgeBasesListLoaded: false, // Reset store's loaded state
    })

    try {
      await getKnowledgeBasesList()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to refresh knowledge bases'
      setError(errorMessage)
      console.error('Error force refreshing knowledge bases list:', err)
    }
  }

  return {
    knowledgeBases: knowledgeBasesList,
    isLoading: loadingKnowledgeBasesList,
    error,
    refreshList,
    forceRefresh,
    addKnowledgeBase,
    removeKnowledgeBase,
    retryCount,
    maxRetries,
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
  const { getChunks, refreshChunks, updateChunk, getCachedChunks, clearChunks, isChunksLoading } =
    useKnowledgeStore()

  const { enableClientSearch = false } = options

  // State for both modes
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
  const [initialLoadDone, setInitialLoadDone] = useState(false)
  const [isMounted, setIsMounted] = useState(false)

  // Client-side search state
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(urlPage)

  // Handle mounting state
  useEffect(() => {
    setIsMounted(true)
    return () => setIsMounted(false)
  }, [])

  // Sync with URL page changes
  useEffect(() => {
    setCurrentPage(urlPage)
  }, [urlPage])

  const isStoreLoading = isChunksLoading(documentId)
  const combinedIsLoading = isLoading || isStoreLoading

  if (enableClientSearch) {
    const loadAllChunks = useCallback(async () => {
      if (!knowledgeBaseId || !documentId || !isMounted) return

      try {
        setIsLoading(true)
        setError(null)

        const allChunksData: ChunkData[] = []
        let hasMore = true
        let offset = 0
        const limit = 50

        while (hasMore && isMounted) {
          const response = await fetch(
            `/api/knowledge/${knowledgeBaseId}/documents/${documentId}/chunks?limit=${limit}&offset=${offset}`
          )

          if (!response.ok) {
            throw new Error('Failed to fetch chunks')
          }

          const result = await response.json()

          if (result.success) {
            allChunksData.push(...result.data)
            hasMore = result.pagination.hasMore
            offset += limit
          } else {
            throw new Error(result.error || 'Failed to fetch chunks')
          }
        }

        if (isMounted) {
          setAllChunks(allChunksData)
          setChunks(allChunksData) // For compatibility
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to load chunks')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }, [knowledgeBaseId, documentId, isMounted])

    // Load chunks on mount
    useEffect(() => {
      if (isMounted) {
        loadAllChunks()
      }
    }, [isMounted, loadAllChunks])

    // Client-side filtering with fuzzy search
    const filteredChunks = useMemo(() => {
      if (!isMounted || !searchQuery.trim()) return allChunks

      const fuse = new Fuse(allChunks, {
        keys: ['content'],
        threshold: 0.3, // Lower = more strict matching
        includeScore: true,
        includeMatches: true,
        minMatchCharLength: 2,
        ignoreLocation: true,
      })

      const results = fuse.search(searchQuery)
      return results.map((result) => result.item)
    }, [allChunks, searchQuery, isMounted])

    // Client-side pagination
    const CHUNKS_PER_PAGE = 50
    const totalPages = Math.max(1, Math.ceil(filteredChunks.length / CHUNKS_PER_PAGE))
    const hasNextPage = currentPage < totalPages
    const hasPrevPage = currentPage > 1

    const paginatedChunks = useMemo(() => {
      const startIndex = (currentPage - 1) * CHUNKS_PER_PAGE
      const endIndex = startIndex + CHUNKS_PER_PAGE
      return filteredChunks.slice(startIndex, endIndex)
    }, [filteredChunks, currentPage])

    // Reset to page 1 when search changes
    useEffect(() => {
      if (currentPage > 1) {
        setCurrentPage(1)
      }
    }, [searchQuery])

    // Reset to valid page if current page exceeds total
    useEffect(() => {
      if (currentPage > totalPages && totalPages > 0) {
        setCurrentPage(totalPages)
      }
    }, [currentPage, totalPages])

    // Navigation functions
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

    // Operations
    const refreshChunksData = useCallback(async () => {
      await loadAllChunks()
    }, [loadAllChunks])

    const updateChunkLocal = useCallback((chunkId: string, updates: Partial<ChunkData>) => {
      setAllChunks((prev) =>
        prev.map((chunk) => (chunk.id === chunkId ? { ...chunk, ...updates } : chunk))
      )
      setChunks((prev) =>
        prev.map((chunk) => (chunk.id === chunkId ? { ...chunk, ...updates } : chunk))
      )
    }, [])

    return {
      // Data - return paginatedChunks as chunks for display
      chunks: paginatedChunks,
      allChunks,
      filteredChunks,
      paginatedChunks,

      // Search
      searchQuery,
      setSearchQuery,

      // Pagination
      currentPage,
      totalPages,
      hasNextPage,
      hasPrevPage,
      goToPage,
      nextPage,
      prevPage,

      // State
      isLoading: combinedIsLoading,
      error,
      pagination: {
        total: filteredChunks.length,
        limit: CHUNKS_PER_PAGE,
        offset: (currentPage - 1) * CHUNKS_PER_PAGE,
        hasMore: hasNextPage,
      },

      // Operations
      refreshChunks: refreshChunksData,
      updateChunk: updateChunkLocal,
      clearChunks: () => clearChunks(documentId),

      // Legacy compatibility
      searchChunks: async (newSearchQuery: string) => {
        setSearchQuery(newSearchQuery)
        return paginatedChunks
      },
    }
  }

  const serverCurrentPage = urlPage
  const serverSearchQuery = urlSearch

  // Computed pagination properties
  const serverTotalPages = Math.ceil(pagination.total / pagination.limit)
  const serverHasNextPage = serverCurrentPage < serverTotalPages
  const serverHasPrevPage = serverCurrentPage > 1

  // Single effect to handle all data loading and syncing
  useEffect(() => {
    if (!knowledgeBaseId || !documentId) return

    let isMounted = true

    const loadAndSyncData = async () => {
      try {
        // Check cache first
        const cached = getCachedChunks(documentId)
        const expectedOffset = (serverCurrentPage - 1) * 50 // Use hardcoded limit

        if (
          cached &&
          cached.searchQuery === serverSearchQuery &&
          cached.pagination.offset === expectedOffset
        ) {
          if (isMounted) {
            setChunks(cached.chunks)
            setPagination(cached.pagination)
            setIsLoading(false)
            setInitialLoadDone(true)
          }
          return
        }

        // Fetch from API
        setIsLoading(true)
        setError(null)

        const limit = 50
        const offset = (serverCurrentPage - 1) * limit

        const fetchedChunks = await getChunks(knowledgeBaseId, documentId, {
          limit,
          offset,
          search: serverSearchQuery || undefined,
        })

        if (isMounted) {
          setChunks(fetchedChunks)

          // Update pagination from cache after fetch
          const updatedCache = getCachedChunks(documentId)
          if (updatedCache) {
            setPagination(updatedCache.pagination)
          }

          setInitialLoadDone(true)
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to load chunks')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    loadAndSyncData()

    return () => {
      isMounted = false
    }
  }, [
    knowledgeBaseId,
    documentId,
    serverCurrentPage,
    serverSearchQuery,
    isStoreLoading,
    initialLoadDone,
  ])

  // Separate effect to sync with store state changes (no API calls)
  useEffect(() => {
    if (!documentId || !initialLoadDone) return

    const cached = getCachedChunks(documentId)
    const expectedOffset = (serverCurrentPage - 1) * 50

    if (
      cached &&
      cached.searchQuery === serverSearchQuery &&
      cached.pagination.offset === expectedOffset
    ) {
      setChunks(cached.chunks)
      setPagination(cached.pagination)
    }

    // Update loading state based on store
    if (!isStoreLoading && isLoading) {
      setIsLoading(false)
    }
  }, [documentId, isStoreLoading, isLoading, initialLoadDone, serverSearchQuery, serverCurrentPage])

  const goToPage = async (page: number) => {
    if (page < 1 || page > serverTotalPages || page === serverCurrentPage) return

    try {
      setIsLoading(true)
      setError(null)

      const limit = 50
      const offset = (page - 1) * limit

      const fetchedChunks = await getChunks(knowledgeBaseId, documentId, {
        limit,
        offset,
        search: serverSearchQuery || undefined,
      })

      // Update local state from cache
      const cached = getCachedChunks(documentId)
      if (cached) {
        setChunks(cached.chunks)
        setPagination(cached.pagination)
      }

      return fetchedChunks
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load page')
      throw err
    } finally {
      setIsLoading(false)
    }
  }

  const nextPage = () => {
    if (serverHasNextPage) {
      return goToPage(serverCurrentPage + 1)
    }
  }

  const prevPage = () => {
    if (serverHasPrevPage) {
      return goToPage(serverCurrentPage - 1)
    }
  }

  const refreshChunksData = async (options?: {
    search?: string
    limit?: number
    offset?: number
    preservePage?: boolean
  }) => {
    try {
      setIsLoading(true)
      setError(null)

      const limit = 50
      const offset = options?.offset ?? (serverCurrentPage - 1) * limit

      const fetchedChunks = await refreshChunks(knowledgeBaseId, documentId, {
        search: options?.search,
        limit,
        offset,
      })

      // Update local state from cache
      const cached = getCachedChunks(documentId)
      if (cached) {
        setChunks(cached.chunks)
        setPagination(cached.pagination)
      }

      return fetchedChunks
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh chunks')
      throw err
    } finally {
      setIsLoading(false)
    }
  }

  const searchChunks = async (newSearchQuery: string) => {
    try {
      setIsLoading(true)
      setError(null)

      const limit = 50
      const searchResults = await getChunks(knowledgeBaseId, documentId, {
        search: newSearchQuery,
        limit,
        offset: 0, // Always start from first page for search
      })

      // Update local state from cache
      const cached = getCachedChunks(documentId)
      if (cached) {
        setChunks(cached.chunks)
        setPagination(cached.pagination)
      }

      return searchResults
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search chunks')
      throw err
    } finally {
      setIsLoading(false)
    }
  }

  return {
    chunks,
    allChunks: chunks, // In server mode, allChunks is the same as chunks
    filteredChunks: chunks, // In server mode, filteredChunks is the same as chunks
    paginatedChunks: chunks, // In server mode, paginatedChunks is the same as chunks

    // Search (not used in server mode but needed for consistency)
    searchQuery: urlSearch,
    setSearchQuery: () => {}, // No-op in server mode

    isLoading: combinedIsLoading,
    error,
    pagination,
    currentPage: serverCurrentPage,
    totalPages: serverTotalPages,
    hasNextPage: serverHasNextPage,
    hasPrevPage: serverHasPrevPage,
    goToPage,
    nextPage,
    prevPage,
    refreshChunks: refreshChunksData,
    searchChunks,
    updateChunk: (chunkId: string, updates: Partial<ChunkData>) => {
      updateChunk(documentId, chunkId, updates)
      setChunks((prevChunks) =>
        prevChunks.map((chunk) => (chunk.id === chunkId ? { ...chunk, ...updates } : chunk))
      )
    },
    clearChunks: () => clearChunks(documentId),
  }
}
