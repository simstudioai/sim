import { useEffect, useState } from 'react'
import { type ChunkData, type DocumentData, useKnowledgeStore } from '@/stores/knowledge/knowledge'

export function useKnowledgeBase(id: string) {
  const { getKnowledgeBase, getCachedKnowledgeBase, loadingKnowledgeBases } = useKnowledgeStore()

  const [error, setError] = useState<string | null>(null)

  const knowledgeBase = getCachedKnowledgeBase(id)
  const isLoading = loadingKnowledgeBases.has(id)

  useEffect(() => {
    const loadData = async () => {
      try {
        setError(null)
        await getKnowledgeBase(id)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load knowledge base')
      }
    }

    if (id && !knowledgeBase && !isLoading) {
      loadData()
    }
  }, [id, knowledgeBase, isLoading, getKnowledgeBase])

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
    const loadData = async () => {
      try {
        setError(null)
        await getDocuments(knowledgeBaseId)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load documents')
      }
    }

    if (knowledgeBaseId && documents.length === 0 && !isLoading) {
      loadData()
    }
  }, [knowledgeBaseId, documents.length, isLoading, getDocuments])

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
    addKnowledgeBase,
    removeKnowledgeBase,
    clearKnowledgeBasesList,
  } = useKnowledgeStore()

  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadData = async () => {
      try {
        setError(null)
        await getKnowledgeBasesList()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load knowledge bases')
      }
    }

    if (knowledgeBasesList.length === 0 && !loadingKnowledgeBasesList) {
      loadData()
    }
  }, [knowledgeBasesList.length, loadingKnowledgeBasesList, getKnowledgeBasesList])

  const refreshList = async () => {
    try {
      setError(null)
      clearKnowledgeBasesList()
      await getKnowledgeBasesList()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh knowledge bases')
    }
  }

  return {
    knowledgeBases: knowledgeBasesList,
    isLoading: loadingKnowledgeBasesList,
    error,
    refreshList,
    addKnowledgeBase,
    removeKnowledgeBase,
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

  const isStoreLoading = isChunksLoading(documentId)
  const combinedIsLoading = isLoading || isStoreLoading

  useEffect(() => {
    if (!knowledgeBaseId || !documentId) return

    const cached = getCachedChunks(documentId)
    if (cached) {
      setChunks(cached.chunks)
      setPagination(cached.pagination)
      setIsLoading(false)
    }
  }, [knowledgeBaseId, documentId, getCachedChunks])

  // Initial load
  useEffect(() => {
    if (!knowledgeBaseId || !documentId) return

    const loadChunks = async () => {
      try {
        setIsLoading(true)
        setError(null)

        // Try to get cached chunks first
        const cached = getCachedChunks(documentId)
        if (cached) {
          setChunks(cached.chunks)
          setPagination(cached.pagination)
          setIsLoading(false)
          return
        }

        // If not cached, fetch from API
        const fetchedChunks = await getChunks(knowledgeBaseId, documentId, {
          limit: pagination.limit,
          offset: pagination.offset,
        })

        setChunks(fetchedChunks)

        // Update pagination from cache after fetch
        const updatedCache = getCachedChunks(documentId)
        if (updatedCache) {
          setPagination(updatedCache.pagination)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load chunks')
      } finally {
        setIsLoading(false)
      }
    }

    loadChunks()
  }, [knowledgeBaseId, documentId, getChunks, getCachedChunks])

  // Sync with store state changes
  useEffect(() => {
    const cached = getCachedChunks(documentId)
    if (cached) {
      setChunks(cached.chunks)
      setPagination(cached.pagination)
    }
  }, [documentId, getCachedChunks])

  useEffect(() => {
    if (!isStoreLoading && isLoading) {
      const cached = getCachedChunks(documentId)
      if (cached) {
        setIsLoading(false)
      }
    }
  }, [isStoreLoading, isLoading, documentId, getCachedChunks])

  const refreshChunksData = async (options?: {
    search?: string
    limit?: number
    offset?: number
  }) => {
    try {
      setIsLoading(true)
      setError(null)

      const fetchedChunks = await refreshChunks(knowledgeBaseId, documentId, options)

      // Update local state from cache
      const cached = getCachedChunks(documentId, { search: options?.search })
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

  const searchChunks = async (searchQuery: string) => {
    try {
      setIsLoading(true)
      setError(null)

      const searchResults = await getChunks(knowledgeBaseId, documentId, {
        search: searchQuery,
        limit: pagination.limit,
        offset: 0, // Reset to first page for new search
      })

      // Update local state from cache
      const cached = getCachedChunks(documentId, { search: searchQuery })
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
