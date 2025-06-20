import { create } from 'zustand'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('KnowledgeStore')

export interface ChunkingConfig {
  chunkSize?: number
  minCharactersPerChunk?: number
  recipe?: string
  lang?: string
  strategy?: 'recursive' | 'semantic' | 'sentence' | 'paragraph'
  [key: string]: unknown
}

export interface KnowledgeBaseData {
  id: string
  name: string
  description?: string
  tokenCount: number
  embeddingModel: string
  embeddingDimension: number
  chunkingConfig: ChunkingConfig
  createdAt: string
  updatedAt: string
  workspaceId?: string
}

export interface DocumentData {
  id: string
  knowledgeBaseId: string
  filename: string
  fileUrl: string
  fileSize: number
  mimeType: string
  chunkCount: number
  tokenCount: number
  characterCount: number
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed'
  processingStartedAt?: string | null
  processingCompletedAt?: string | null
  processingError?: string | null
  enabled: boolean
  uploadedAt: string
}

export interface ChunkData {
  id: string
  chunkIndex: number
  content: string
  contentLength: number
  tokenCount: number
  enabled: boolean
  startOffset: number
  endOffset: number
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface ChunksPagination {
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

export interface ChunksCache {
  chunks: ChunkData[]
  pagination: ChunksPagination
  searchQuery?: string
  lastFetchTime: number
}

interface KnowledgeStore {
  // State
  knowledgeBases: Record<string, KnowledgeBaseData>
  documents: Record<string, DocumentData[]> // knowledgeBaseId -> documents
  chunks: Record<string, ChunksCache> // documentId -> chunks cache
  knowledgeBasesList: KnowledgeBaseData[]

  // Loading states
  loadingKnowledgeBases: Set<string>
  loadingDocuments: Set<string>
  loadingChunks: Set<string>
  loadingKnowledgeBasesList: boolean
  knowledgeBasesListLoaded: boolean

  // Actions
  getKnowledgeBase: (id: string) => Promise<KnowledgeBaseData | null>
  getDocuments: (knowledgeBaseId: string) => Promise<DocumentData[]>
  getChunks: (
    knowledgeBaseId: string,
    documentId: string,
    options?: { search?: string; limit?: number; offset?: number }
  ) => Promise<ChunkData[]>
  getKnowledgeBasesList: () => Promise<KnowledgeBaseData[]>
  refreshDocuments: (knowledgeBaseId: string) => Promise<DocumentData[]>
  refreshChunks: (
    knowledgeBaseId: string,
    documentId: string,
    options?: { search?: string; limit?: number; offset?: number }
  ) => Promise<ChunkData[]>
  updateDocument: (
    knowledgeBaseId: string,
    documentId: string,
    updates: Partial<DocumentData>
  ) => void
  updateChunk: (documentId: string, chunkId: string, updates: Partial<ChunkData>) => void
  addPendingDocuments: (knowledgeBaseId: string, documents: DocumentData[]) => void
  addKnowledgeBase: (knowledgeBase: KnowledgeBaseData) => void
  removeKnowledgeBase: (id: string) => void
  removeDocument: (knowledgeBaseId: string, documentId: string) => void
  clearDocuments: (knowledgeBaseId: string) => void
  clearChunks: (documentId: string) => void
  clearKnowledgeBasesList: () => void

  // Getters
  getCachedKnowledgeBase: (id: string) => KnowledgeBaseData | null
  getCachedDocuments: (knowledgeBaseId: string) => DocumentData[] | null
  getCachedChunks: (documentId: string, options?: { search?: string }) => ChunksCache | null

  // Loading state getters
  isKnowledgeBaseLoading: (id: string) => boolean
  isDocumentsLoading: (knowledgeBaseId: string) => boolean
  isChunksLoading: (documentId: string) => boolean
}

export const useKnowledgeStore = create<KnowledgeStore>((set, get) => ({
  knowledgeBases: {},
  documents: {},
  chunks: {},
  knowledgeBasesList: [],
  loadingKnowledgeBases: new Set(),
  loadingDocuments: new Set(),
  loadingChunks: new Set(),
  loadingKnowledgeBasesList: false,
  knowledgeBasesListLoaded: false,

  getCachedKnowledgeBase: (id: string) => {
    return get().knowledgeBases[id] || null
  },

  getCachedDocuments: (knowledgeBaseId: string) => {
    return get().documents[knowledgeBaseId] || null
  },

  getCachedChunks: (documentId: string, options?: { search?: string }) => {
    return get().chunks[documentId] || null
  },

  isKnowledgeBaseLoading: (id: string) => {
    return get().loadingKnowledgeBases.has(id)
  },

  isDocumentsLoading: (knowledgeBaseId: string) => {
    return get().loadingDocuments.has(knowledgeBaseId)
  },

  isChunksLoading: (documentId: string) => {
    return get().loadingChunks.has(documentId)
  },

  getKnowledgeBase: async (id: string) => {
    const state = get()

    // Return cached data if it exists
    const cached = state.knowledgeBases[id]
    if (cached) {
      return cached
    }

    // Return cached data if already loading to prevent duplicate requests
    if (state.loadingKnowledgeBases.has(id)) {
      return null
    }

    try {
      set((state) => ({
        loadingKnowledgeBases: new Set([...state.loadingKnowledgeBases, id]),
      }))

      const response = await fetch(`/api/knowledge/${id}`)

      if (!response.ok) {
        throw new Error(`Failed to fetch knowledge base: ${response.statusText}`)
      }

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch knowledge base')
      }

      const knowledgeBase = result.data

      set((state) => ({
        knowledgeBases: {
          ...state.knowledgeBases,
          [id]: knowledgeBase,
        },
        loadingKnowledgeBases: new Set(
          [...state.loadingKnowledgeBases].filter((loadingId) => loadingId !== id)
        ),
      }))

      logger.info(`Knowledge base loaded: ${id}`)
      return knowledgeBase
    } catch (error) {
      logger.error(`Error fetching knowledge base ${id}:`, error)

      set((state) => ({
        loadingKnowledgeBases: new Set(
          [...state.loadingKnowledgeBases].filter((loadingId) => loadingId !== id)
        ),
      }))

      throw error
    }
  },

  getDocuments: async (knowledgeBaseId: string) => {
    const state = get()

    // Return cached documents if they exist
    const cached = state.documents[knowledgeBaseId]
    if (cached) {
      return cached
    }

    // Return empty array if already loading to prevent duplicate requests
    if (state.loadingDocuments.has(knowledgeBaseId)) {
      return []
    }

    try {
      set((state) => ({
        loadingDocuments: new Set([...state.loadingDocuments, knowledgeBaseId]),
      }))

      const response = await fetch(`/api/knowledge/${knowledgeBaseId}/documents`)

      if (!response.ok) {
        throw new Error(`Failed to fetch documents: ${response.statusText}`)
      }

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch documents')
      }

      const documents = result.data

      set((state) => ({
        documents: {
          ...state.documents,
          [knowledgeBaseId]: documents,
        },
        loadingDocuments: new Set(
          [...state.loadingDocuments].filter((loadingId) => loadingId !== knowledgeBaseId)
        ),
      }))

      logger.info(`Documents loaded for knowledge base: ${knowledgeBaseId}`)
      return documents
    } catch (error) {
      logger.error(`Error fetching documents for knowledge base ${knowledgeBaseId}:`, error)

      set((state) => ({
        loadingDocuments: new Set(
          [...state.loadingDocuments].filter((loadingId) => loadingId !== knowledgeBaseId)
        ),
      }))

      throw error
    }
  },

  getChunks: async (
    knowledgeBaseId: string,
    documentId: string,
    options?: { search?: string; limit?: number; offset?: number }
  ) => {
    const state = get()

    // Return cached chunks if they exist and match the exact search criteria AND offset
    const cached = state.chunks[documentId]
    if (
      cached &&
      cached.searchQuery === options?.search &&
      cached.pagination.offset === (options?.offset || 0) &&
      cached.pagination.limit === (options?.limit || 50)
    ) {
      return cached.chunks
    }

    // Return empty array if already loading to prevent duplicate requests
    if (state.loadingChunks.has(documentId)) {
      return cached?.chunks || []
    }

    try {
      set((state) => ({
        loadingChunks: new Set([...state.loadingChunks, documentId]),
      }))

      // Build query parameters
      const params = new URLSearchParams()
      if (options?.search) params.set('search', options.search)
      if (options?.limit) params.set('limit', options.limit.toString())
      if (options?.offset) params.set('offset', options.offset.toString())

      const response = await fetch(
        `/api/knowledge/${knowledgeBaseId}/documents/${documentId}/chunks?${params.toString()}`
      )

      if (!response.ok) {
        throw new Error(`Failed to fetch chunks: ${response.statusText}`)
      }

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch chunks')
      }

      const chunks = result.data
      const pagination = result.pagination

      set((state) => ({
        chunks: {
          ...state.chunks,
          [documentId]: {
            chunks, // Always replace chunks for traditional pagination
            pagination: {
              total: pagination?.total || chunks.length,
              limit: pagination?.limit || options?.limit || 50,
              offset: pagination?.offset || options?.offset || 0,
              hasMore: pagination?.hasMore || false,
            },
            searchQuery: options?.search,
            lastFetchTime: Date.now(),
          },
        },
        loadingChunks: new Set(
          [...state.loadingChunks].filter((loadingId) => loadingId !== documentId)
        ),
      }))

      logger.info(`Chunks loaded for document: ${documentId}`)
      return chunks
    } catch (error) {
      logger.error(`Error fetching chunks for document ${documentId}:`, error)

      set((state) => ({
        loadingChunks: new Set(
          [...state.loadingChunks].filter((loadingId) => loadingId !== documentId)
        ),
      }))

      throw error
    }
  },

  getKnowledgeBasesList: async () => {
    const state = get()

    // Return cached list if we have already loaded it before (prevents infinite loops when empty)
    if (state.knowledgeBasesListLoaded) {
      return state.knowledgeBasesList
    }

    // Return cached data if already loading
    if (state.loadingKnowledgeBasesList) {
      return state.knowledgeBasesList
    }

    // Create an AbortController for request cancellation
    const abortController = new AbortController()
    const timeoutId = setTimeout(() => {
      abortController.abort()
    }, 10000) // 10 second timeout

    try {
      set({ loadingKnowledgeBasesList: true })

      const response = await fetch('/api/knowledge', {
        signal: abortController.signal,
        headers: {
          'Content-Type': 'application/json',
        },
      })

      // Clear the timeout since request completed
      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(
          `Failed to fetch knowledge bases: ${response.status} ${response.statusText}`
        )
      }

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch knowledge bases')
      }

      const knowledgeBasesList = result.data || []

      set({
        knowledgeBasesList,
        loadingKnowledgeBasesList: false,
        knowledgeBasesListLoaded: true, // Mark as loaded regardless of result to prevent infinite loops
      })

      logger.info(`Knowledge bases list loaded: ${knowledgeBasesList.length} items`)
      return knowledgeBasesList
    } catch (error) {
      // Clear the timeout in case of error
      clearTimeout(timeoutId)

      logger.error('Error fetching knowledge bases list:', error)

      // Always set loading to false, even on error
      set({
        loadingKnowledgeBasesList: false,
        knowledgeBasesListLoaded: true, // Mark as loaded even on error to prevent infinite retries
      })

      // Don't throw on AbortError (timeout or cancellation)
      if (error instanceof Error && error.name === 'AbortError') {
        logger.warn('Knowledge bases list request was aborted (timeout or cancellation)')
        return state.knowledgeBasesList // Return whatever we have cached
      }

      throw error
    }
  },

  refreshDocuments: async (knowledgeBaseId: string) => {
    const state = get()

    // Return empty array if already loading to prevent duplicate requests
    if (state.loadingDocuments.has(knowledgeBaseId)) {
      return state.documents[knowledgeBaseId] || []
    }

    try {
      set((state) => ({
        loadingDocuments: new Set([...state.loadingDocuments, knowledgeBaseId]),
      }))

      const response = await fetch(`/api/knowledge/${knowledgeBaseId}/documents`)

      if (!response.ok) {
        throw new Error(`Failed to fetch documents: ${response.statusText}`)
      }

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch documents')
      }

      const documents = result.data

      set((state) => {
        // Merge with existing documents, being smart about when to use server data vs local optimistic updates
        const currentDocuments = state.documents[knowledgeBaseId] || []

        // For each fetched document, decide whether to use server data or preserve local state
        const mergedDocuments = documents.map((fetchedDoc: DocumentData) => {
          const existingDoc = currentDocuments.find((doc) => doc.id === fetchedDoc.id)

          if (!existingDoc) {
            // New document from server, use it as-is
            return fetchedDoc
          }

          // If processing status is different, generally prefer server data for these transitions:
          if (existingDoc.processingStatus !== fetchedDoc.processingStatus) {
            // Always allow these status progressions from server:
            // pending -> processing, pending -> completed, pending -> failed
            // processing -> completed, processing -> failed
            const allowedTransitions = [
              { from: 'pending', to: 'processing' },
              { from: 'pending', to: 'completed' },
              { from: 'pending', to: 'failed' },
              { from: 'processing', to: 'completed' },
              { from: 'processing', to: 'failed' },
            ]

            const transition = allowedTransitions.find(
              (t) => t.from === existingDoc.processingStatus && t.to === fetchedDoc.processingStatus
            )

            if (transition) {
              return fetchedDoc
            }
          }

          const existingHasTimestamps =
            existingDoc.processingStartedAt || existingDoc.processingCompletedAt
          const fetchedHasTimestamps =
            fetchedDoc.processingStartedAt || fetchedDoc.processingCompletedAt

          if (fetchedHasTimestamps && !existingHasTimestamps) {
            return fetchedDoc
          }

          // If the server document has updated stats (chunk count, token count, etc.), use it
          if (
            fetchedDoc.processingStatus === 'completed' &&
            (fetchedDoc.chunkCount !== existingDoc.chunkCount ||
              fetchedDoc.tokenCount !== existingDoc.tokenCount ||
              fetchedDoc.characterCount !== existingDoc.characterCount)
          ) {
            return fetchedDoc
          }

          // Otherwise, preserve the existing document (keeps optimistic updates)
          return existingDoc
        })

        // Add any new documents that weren't in the existing set
        const newDocuments = documents.filter(
          (fetchedDoc: DocumentData) => !currentDocuments.find((doc) => doc.id === fetchedDoc.id)
        )

        return {
          documents: {
            ...state.documents,
            [knowledgeBaseId]: [...mergedDocuments, ...newDocuments],
          },
          loadingDocuments: new Set(
            [...state.loadingDocuments].filter((loadingId) => loadingId !== knowledgeBaseId)
          ),
        }
      })

      logger.info(`Documents refreshed for knowledge base: ${knowledgeBaseId}`)
      return documents
    } catch (error) {
      logger.error(`Error refreshing documents for knowledge base ${knowledgeBaseId}:`, error)

      set((state) => ({
        loadingDocuments: new Set(
          [...state.loadingDocuments].filter((loadingId) => loadingId !== knowledgeBaseId)
        ),
      }))

      throw error
    }
  },

  refreshChunks: async (
    knowledgeBaseId: string,
    documentId: string,
    options?: { search?: string; limit?: number; offset?: number }
  ) => {
    const state = get()

    // Return cached chunks if already loading to prevent duplicate requests
    if (state.loadingChunks.has(documentId)) {
      return state.chunks[documentId]?.chunks || []
    }

    try {
      set((state) => ({
        loadingChunks: new Set([...state.loadingChunks, documentId]),
      }))

      // Build query parameters - for refresh, always start from offset 0
      const params = new URLSearchParams()
      if (options?.search) params.set('search', options.search)
      if (options?.limit) params.set('limit', options.limit.toString())
      params.set('offset', '0') // Always start fresh on refresh

      const response = await fetch(
        `/api/knowledge/${knowledgeBaseId}/documents/${documentId}/chunks?${params.toString()}`
      )

      if (!response.ok) {
        throw new Error(`Failed to fetch chunks: ${response.statusText}`)
      }

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to fetch chunks')
      }

      const chunks = result.data
      const pagination = result.pagination

      set((state) => ({
        chunks: {
          ...state.chunks,
          [documentId]: {
            chunks, // Replace all chunks with fresh data
            pagination: {
              total: pagination?.total || chunks.length,
              limit: pagination?.limit || options?.limit || 50,
              offset: 0, // Reset to start
              hasMore: pagination?.hasMore || false,
            },
            searchQuery: options?.search,
            lastFetchTime: Date.now(),
          },
        },
        loadingChunks: new Set(
          [...state.loadingChunks].filter((loadingId) => loadingId !== documentId)
        ),
      }))

      logger.info(`Chunks refreshed for document: ${documentId}`)
      return chunks
    } catch (error) {
      logger.error(`Error refreshing chunks for document ${documentId}:`, error)

      set((state) => ({
        loadingChunks: new Set(
          [...state.loadingChunks].filter((loadingId) => loadingId !== documentId)
        ),
      }))

      throw error
    }
  },

  updateDocument: (knowledgeBaseId: string, documentId: string, updates: Partial<DocumentData>) => {
    set((state) => {
      const documents = state.documents[knowledgeBaseId]
      if (!documents) return state

      const updatedDocuments = documents.map((doc) =>
        doc.id === documentId ? { ...doc, ...updates } : doc
      )

      return {
        documents: {
          ...state.documents,
          [knowledgeBaseId]: updatedDocuments,
        },
      }
    })
  },

  updateChunk: (documentId: string, chunkId: string, updates: Partial<ChunkData>) => {
    set((state) => {
      const cachedChunks = state.chunks[documentId]
      if (!cachedChunks || !cachedChunks.chunks) return state

      const updatedChunks = cachedChunks.chunks.map((chunk) =>
        chunk.id === chunkId ? { ...chunk, ...updates } : chunk
      )

      return {
        chunks: {
          ...state.chunks,
          [documentId]: {
            ...cachedChunks,
            chunks: updatedChunks,
          },
        },
      }
    })
  },

  addPendingDocuments: (knowledgeBaseId: string, newDocuments: DocumentData[]) => {
    set((state) => {
      const existingDocuments = state.documents[knowledgeBaseId] || []

      const existingIds = new Set(existingDocuments.map((doc) => doc.id))
      const uniqueNewDocuments = newDocuments.filter((doc) => !existingIds.has(doc.id))

      if (uniqueNewDocuments.length === 0) {
        logger.warn(`No new documents to add - all ${newDocuments.length} documents already exist`)
        return state
      }

      const updatedDocuments = [...existingDocuments, ...uniqueNewDocuments]

      return {
        documents: {
          ...state.documents,
          [knowledgeBaseId]: updatedDocuments,
        },
      }
    })
    logger.info(
      `Added ${newDocuments.filter((doc) => !get().documents[knowledgeBaseId]?.some((existing) => existing.id === doc.id)).length} pending documents for knowledge base: ${knowledgeBaseId}`
    )
  },

  addKnowledgeBase: (knowledgeBase: KnowledgeBaseData) => {
    set((state) => ({
      knowledgeBases: {
        ...state.knowledgeBases,
        [knowledgeBase.id]: knowledgeBase,
      },
      knowledgeBasesList: [knowledgeBase, ...state.knowledgeBasesList],
    }))
    logger.info(`Knowledge base added: ${knowledgeBase.id}`)
  },

  removeKnowledgeBase: (id: string) => {
    set((state) => {
      const newKnowledgeBases = { ...state.knowledgeBases }
      delete newKnowledgeBases[id]

      const newDocuments = { ...state.documents }
      delete newDocuments[id]

      return {
        knowledgeBases: newKnowledgeBases,
        documents: newDocuments,
        knowledgeBasesList: state.knowledgeBasesList.filter((kb) => kb.id !== id),
      }
    })
    logger.info(`Knowledge base removed: ${id}`)
  },

  removeDocument: (knowledgeBaseId: string, documentId: string) => {
    set((state) => {
      const documents = state.documents[knowledgeBaseId]
      if (!documents) return state

      const updatedDocuments = documents.filter((doc) => doc.id !== documentId)

      // Also clear chunks for the removed document
      const newChunks = { ...state.chunks }
      delete newChunks[documentId]

      return {
        documents: {
          ...state.documents,
          [knowledgeBaseId]: updatedDocuments,
        },
        chunks: newChunks,
      }
    })
    logger.info(`Document removed from knowledge base: ${documentId}`)
  },

  clearDocuments: (knowledgeBaseId: string) => {
    set((state) => {
      const newDocuments = { ...state.documents }
      delete newDocuments[knowledgeBaseId]
      return { documents: newDocuments }
    })
    logger.info(`Documents cleared for knowledge base: ${knowledgeBaseId}`)
  },

  clearChunks: (documentId: string) => {
    set((state) => {
      const newChunks = { ...state.chunks }
      delete newChunks[documentId]
      return { chunks: newChunks }
    })
    logger.info(`Chunks cleared for document: ${documentId}`)
  },

  clearKnowledgeBasesList: () => {
    set({
      knowledgeBasesList: [],
      knowledgeBasesListLoaded: false, // Reset loaded state to allow reloading
    })
    logger.info('Knowledge bases list cleared')
  },
}))
