import { useEffect, useState } from 'react'
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

export function useKnowledgeBaseDocuments(knowledgeBaseId: string) {
  const { getDocuments, getCachedDocuments, loadingDocuments, updateDocument, refreshDocuments } =
    useKnowledgeStore()

  const [error, setError] = useState<string | null>(null)

  const documents = getCachedDocuments(knowledgeBaseId) || []
  const isLoading = loadingDocuments.has(knowledgeBaseId)

  useEffect(() => {
    if (!knowledgeBaseId || documents.length > 0 || isLoading) return

    let isMounted = true

    const loadData = async () => {
      try {
        setError(null)
        await getDocuments(knowledgeBaseId)
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to load documents')
        }
      }
    }

    loadData()

    return () => {
      isMounted = false
    }
  }, [knowledgeBaseId, documents.length, isLoading]) // Removed getDocuments from dependencies

  const refreshDocumentsData = async () => {
    try {
      setError(null)
      await refreshDocuments(knowledgeBaseId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh documents')
    }
  }

  const updateDocumentLocal = (documentId: string, updates: Partial<DocumentData>) => {
    updateDocument(knowledgeBaseId, documentId, updates)
  }

  return {
    documents,
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
 * Hook to manage chunks for a specific document
 */
export function useDocumentChunks(knowledgeBaseId: string, documentId: string) {
  const { getChunks, refreshChunks, updateChunk, getCachedChunks, clearChunks, isChunksLoading } =
    useKnowledgeStore()

  const [chunks, setChunks] = useState<ChunkData[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pagination, setPagination] = useState({
    total: 0,
    limit: 50,
    offset: 0,
    hasMore: false,
  })
  const [currentPage, setCurrentPage] = useState(1)
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [initialLoadDone, setInitialLoadDone] = useState(false)

  const isStoreLoading = isChunksLoading(documentId)
  const combinedIsLoading = isLoading || isStoreLoading

  // Computed pagination properties
  const totalPages = Math.ceil(pagination.total / pagination.limit)
  const hasNextPage = currentPage < totalPages
  const hasPrevPage = currentPage > 1

  // Single effect to handle all data loading and syncing
  useEffect(() => {
    if (!knowledgeBaseId || !documentId) return

    let isMounted = true

    const loadAndSyncData = async () => {
      try {
        // Check cache first
        const cached = getCachedChunks(documentId)
        if (
          cached &&
          cached.searchQuery === searchQuery &&
          cached.pagination.offset === (currentPage - 1) * pagination.limit
        ) {
          if (isMounted) {
            setChunks(cached.chunks)
            setPagination(cached.pagination)
            setIsLoading(false)
            setInitialLoadDone(true)
          }
          return
        }

        // If not cached and we haven't done initial load, fetch from API
        if (!initialLoadDone && !isStoreLoading) {
          setIsLoading(true)
          setError(null)

          const offset = (currentPage - 1) * pagination.limit

          const fetchedChunks = await getChunks(knowledgeBaseId, documentId, {
            limit: pagination.limit,
            offset,
            search: searchQuery || undefined,
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
    currentPage,
    searchQuery,
    isStoreLoading,
    initialLoadDone,
    pagination.limit,
  ])

  // Separate effect to sync with store state changes (no API calls)
  useEffect(() => {
    if (!documentId || !initialLoadDone) return

    const cached = getCachedChunks(documentId)
    if (
      cached &&
      cached.searchQuery === searchQuery &&
      cached.pagination.offset === (currentPage - 1) * pagination.limit
    ) {
      setChunks(cached.chunks)
      setPagination(cached.pagination)
    }

    // Update loading state based on store
    if (!isStoreLoading && isLoading) {
      setIsLoading(false)
    }
  }, [
    documentId,
    isStoreLoading,
    isLoading,
    initialLoadDone,
    searchQuery,
    currentPage,
    pagination.limit,
  ])

  const goToPage = async (page: number) => {
    if (page < 1 || page > totalPages || page === currentPage) return

    try {
      setIsLoading(true)
      setError(null)
      setCurrentPage(page)

      const offset = (page - 1) * pagination.limit

      const fetchedChunks = await getChunks(knowledgeBaseId, documentId, {
        limit: pagination.limit,
        offset,
        search: searchQuery || undefined,
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
    if (hasNextPage) {
      return goToPage(currentPage + 1)
    }
  }

  const prevPage = () => {
    if (hasPrevPage) {
      return goToPage(currentPage - 1)
    }
  }

  const refreshChunksData = async (options?: {
    search?: string
    limit?: number
    offset?: number
  }) => {
    try {
      setIsLoading(true)
      setError(null)

      // Update search query if provided and reset to page 1
      if (options?.search !== undefined) {
        setSearchQuery(options.search)
        setCurrentPage(1)
      }

      const offset = options?.offset ?? (currentPage - 1) * pagination.limit

      const fetchedChunks = await refreshChunks(knowledgeBaseId, documentId, {
        ...options,
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
      setSearchQuery(newSearchQuery)
      setCurrentPage(1) // Reset to first page for new search

      const searchResults = await getChunks(knowledgeBaseId, documentId, {
        search: newSearchQuery,
        limit: pagination.limit,
        offset: 0, // Reset to first page for new search
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
    isLoading: combinedIsLoading,
    error,
    pagination,
    currentPage,
    totalPages,
    hasNextPage,
    hasPrevPage,
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
