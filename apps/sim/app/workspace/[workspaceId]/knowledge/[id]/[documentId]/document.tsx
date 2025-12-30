'use client'

import { startTransition, useCallback, useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import {
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleOff,
  FileText,
  Loader2,
  Search,
  X,
} from 'lucide-react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  Breadcrumb,
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Tooltip,
  Trash,
} from '@/components/emcn'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { SearchHighlight } from '@/components/ui/search-highlight'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  CreateChunkModal,
  DeleteChunkModal,
  DocumentTagsModal,
  EditChunkModal,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/[documentId]/components'
import { ActionBar } from '@/app/workspace/[workspaceId]/knowledge/[id]/components'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { knowledgeKeys } from '@/hooks/queries/knowledge'
import { useDocumentChunks } from '@/hooks/use-knowledge'
import { type ChunkData, type DocumentData, useKnowledgeStore } from '@/stores/knowledge/store'

const logger = createLogger('Document')

/**
 * Formats a date string to relative time (e.g., "2h ago", "3d ago")
 */
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (diffInSeconds < 60) {
    return 'just now'
  }
  if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60)
    return `${minutes}m ago`
  }
  if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600)
    return `${hours}h ago`
  }
  if (diffInSeconds < 604800) {
    const days = Math.floor(diffInSeconds / 86400)
    return `${days}d ago`
  }
  if (diffInSeconds < 2592000) {
    const weeks = Math.floor(diffInSeconds / 604800)
    return `${weeks}w ago`
  }
  if (diffInSeconds < 31536000) {
    const months = Math.floor(diffInSeconds / 2592000)
    return `${months}mo ago`
  }
  const years = Math.floor(diffInSeconds / 31536000)
  return `${years}y ago`
}

/**
 * Formats a date string to absolute format for tooltip display
 */
function formatAbsoluteDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

interface DocumentProps {
  knowledgeBaseId: string
  documentId: string
  knowledgeBaseName?: string
  documentName?: string
}

function getStatusBadgeStyles(enabled: boolean) {
  return enabled
    ? 'inline-flex items-center rounded-md bg-green-100 px-2 py-1 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400'
    : 'inline-flex items-center rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300'
}

function truncateContent(content: string, maxLength = 150): string {
  if (content.length <= maxLength) return content
  return `${content.substring(0, maxLength)}...`
}

function ChunkTableRowSkeleton() {
  return (
    <TableRow className='hover:bg-transparent'>
      <TableCell className='w-[52px] py-[8px]' style={{ paddingLeft: '20.5px', paddingRight: 0 }}>
        <div className='flex items-center'>
          <Skeleton className='h-[14px] w-[14px] rounded-[2px]' />
        </div>
      </TableCell>
      <TableCell className='w-[60px] py-[8px] pr-[12px] pl-[15px]'>
        <Skeleton className='h-[21px] w-[24px]' />
      </TableCell>
      <TableCell className='px-[12px] py-[8px]'>
        <Skeleton className='h-[21px] w-full' />
      </TableCell>
      <TableCell className='w-[8%] px-[12px] py-[8px]'>
        <Skeleton className='h-[18px] w-[32px]' />
      </TableCell>
      <TableCell className='w-[12%] px-[12px] py-[8px]'>
        <Skeleton className='h-[24px] w-[64px] rounded-md' />
      </TableCell>
      <TableCell className='w-[14%] py-[8px] pr-[4px] pl-[12px]'>
        <div className='flex items-center gap-[4px]'>
          <Skeleton className='h-[28px] w-[28px] rounded-[4px]' />
          <Skeleton className='h-[28px] w-[28px] rounded-[4px]' />
        </div>
      </TableCell>
    </TableRow>
  )
}

function ChunkTableSkeleton({ rowCount = 8 }: { rowCount?: number }) {
  return (
    <Table className='min-w-[700px] table-fixed text-[13px]'>
      <TableHeader>
        <TableRow className='hover:bg-transparent'>
          <TableHead
            className='w-[52px] py-[8px]'
            style={{ paddingLeft: '20.5px', paddingRight: 0 }}
          >
            <div className='flex items-center'>
              <Skeleton className='h-[14px] w-[14px] rounded-[2px]' />
            </div>
          </TableHead>
          <TableHead className='w-[60px] py-[8px] pr-[12px] pl-[15px] text-[12px] text-[var(--text-secondary)]'>
            Index
          </TableHead>
          <TableHead className='px-[12px] py-[8px] text-[12px] text-[var(--text-secondary)]'>
            Content
          </TableHead>
          <TableHead className='w-[8%] px-[12px] py-[8px] text-[12px] text-[var(--text-secondary)]'>
            Tokens
          </TableHead>
          <TableHead className='w-[12%] px-[12px] py-[8px] text-[12px] text-[var(--text-secondary)]'>
            Status
          </TableHead>
          <TableHead className='w-[14%] py-[8px] pr-[4px] pl-[12px] text-[12px] text-[var(--text-secondary)]'>
            Actions
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: rowCount }).map((_, i) => (
          <ChunkTableRowSkeleton key={i} />
        ))}
      </TableBody>
    </Table>
  )
}

interface DocumentLoadingProps {
  knowledgeBaseId: string
  knowledgeBaseName: string
  documentName: string
}

function DocumentLoading({
  knowledgeBaseId,
  knowledgeBaseName,
  documentName,
}: DocumentLoadingProps) {
  const { workspaceId } = useParams()

  const breadcrumbItems = [
    { label: 'Knowledge Base', href: `/workspace/${workspaceId}/knowledge` },
    {
      label: knowledgeBaseName,
      href: `/workspace/${workspaceId}/knowledge/${knowledgeBaseId}`,
    },
    { label: documentName },
  ]

  return (
    <div className='flex h-full flex-1 flex-col'>
      <div className='flex flex-1 overflow-hidden'>
        <div className='flex flex-1 flex-col overflow-auto bg-white px-[24px] pt-[24px] pb-[24px] dark:bg-[var(--bg)]'>
          <Breadcrumb items={breadcrumbItems} />

          <div className='mt-[14px] flex items-center justify-between'>
            <Skeleton className='h-[27px] w-[200px] rounded-[4px]' />
            <div className='flex items-center gap-2'>
              <Skeleton className='h-[32px] w-[52px] rounded-[6px]' />
              <Skeleton className='h-[32px] w-[32px] rounded-[6px]' />
            </div>
          </div>

          <div className='mt-[4px]'>
            <Skeleton className='h-[21px] w-[80px] rounded-[4px]' />
          </div>

          <div className='mt-[16px] flex items-center gap-[8px]'>
            <Skeleton className='h-[21px] w-[80px] rounded-[4px]' />
            <div className='mb-[-1.5px] h-[18px] w-[1.25px] rounded-full bg-[#3A3A3A]' />
            <Skeleton className='h-[21px] w-[140px] rounded-[4px]' />
          </div>

          <div className='mt-[14px] flex items-center justify-between'>
            <div className='flex h-[32px] w-[400px] items-center gap-[6px] rounded-[8px] bg-[var(--surface-3)] px-[8px] dark:bg-[var(--surface-4)]'>
              <Search className='h-[14px] w-[14px] text-[var(--text-subtle)]' />
              <Input
                placeholder='Search chunks...'
                disabled
                className='flex-1 border-0 bg-transparent px-0 font-medium text-[var(--text-secondary)] text-small leading-none placeholder:text-[var(--text-subtle)] focus-visible:ring-0 focus-visible:ring-offset-0'
              />
            </div>
            <Button disabled variant='tertiary' className='h-[32px] rounded-[6px]'>
              Create Chunk
            </Button>
          </div>

          <div className='mt-[12px] flex flex-1 flex-col overflow-hidden'>
            <ChunkTableSkeleton rowCount={8} />
          </div>
        </div>
      </div>
    </div>
  )
}

export function Document({
  knowledgeBaseId,
  documentId,
  knowledgeBaseName,
  documentName,
}: DocumentProps) {
  const {
    getCachedKnowledgeBase,
    getCachedDocuments,
    updateDocument: updateDocumentInStore,
    removeDocument,
  } = useKnowledgeStore()
  const queryClient = useQueryClient()
  const { workspaceId } = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const currentPageFromURL = Number.parseInt(searchParams.get('page') || '1', 10)
  const userPermissions = useUserPermissionsContext()

  /**
   * Get cached document synchronously for immediate render
   */
  const getInitialCachedDocument = useCallback(() => {
    const cachedDocuments = getCachedDocuments(knowledgeBaseId)
    return cachedDocuments?.documents?.find((d) => d.id === documentId) || null
  }, [getCachedDocuments, knowledgeBaseId, documentId])

  const [showTagsModal, setShowTagsModal] = useState(false)

  // Search state management
  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  const [isSearching, setIsSearching] = useState(false)

  // Load initial chunks (no search) for immediate display
  const {
    chunks: initialChunks,
    currentPage: initialPage,
    totalPages: initialTotalPages,
    hasNextPage: initialHasNextPage,
    hasPrevPage: initialHasPrevPage,
    goToPage: initialGoToPage,
    error: initialError,
    refreshChunks: initialRefreshChunks,
    updateChunk: initialUpdateChunk,
  } = useDocumentChunks(knowledgeBaseId, documentId, currentPageFromURL, '', {
    enableClientSearch: false,
  })

  // Search results state
  const [searchResults, setSearchResults] = useState<ChunkData[]>([])
  const [isLoadingSearch, setIsLoadingSearch] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  // Load all search results when query changes
  useEffect(() => {
    if (!debouncedSearchQuery.trim()) {
      setSearchResults([])
      setSearchError(null)
      return
    }

    let isMounted = true

    const searchAllChunks = async () => {
      try {
        setIsLoadingSearch(true)
        setSearchError(null)

        const allResults: ChunkData[] = []
        let hasMore = true
        let offset = 0
        const limit = 100 // Larger batches for search

        while (hasMore && isMounted) {
          const response = await fetch(
            `/api/knowledge/${knowledgeBaseId}/documents/${documentId}/chunks?search=${encodeURIComponent(debouncedSearchQuery)}&limit=${limit}&offset=${offset}`
          )

          if (!response.ok) {
            throw new Error('Search failed')
          }

          const result = await response.json()

          if (result.success && result.data) {
            allResults.push(...result.data)
            hasMore = result.pagination?.hasMore || false
            offset += limit
          } else {
            hasMore = false
          }
        }

        if (isMounted) {
          setSearchResults(allResults)
        }
      } catch (err) {
        if (isMounted) {
          setSearchError(err instanceof Error ? err.message : 'Search failed')
        }
      } finally {
        if (isMounted) {
          setIsLoadingSearch(false)
        }
      }
    }

    searchAllChunks()

    return () => {
      isMounted = false
    }
  }, [debouncedSearchQuery, knowledgeBaseId, documentId])

  const [selectedChunks, setSelectedChunks] = useState<Set<string>>(new Set())
  const [selectedChunk, setSelectedChunk] = useState<ChunkData | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Debounce search query with 200ms delay for optimal UX
  useEffect(() => {
    const handler = setTimeout(() => {
      startTransition(() => {
        setDebouncedSearchQuery(searchQuery)
        setIsSearching(searchQuery.trim().length > 0)
      })
    }, 200)

    return () => {
      clearTimeout(handler)
    }
  }, [searchQuery])

  // Determine which data to show
  const showingSearch = isSearching && searchQuery.trim().length > 0 && searchResults.length > 0

  // Removed unused allDisplayChunks variable

  // Client-side pagination for search results
  const SEARCH_PAGE_SIZE = 50
  const maxSearchPages = Math.ceil(searchResults.length / SEARCH_PAGE_SIZE)
  const searchCurrentPage =
    showingSearch && maxSearchPages > 0
      ? Math.max(1, Math.min(currentPageFromURL, maxSearchPages))
      : 1
  const searchTotalPages = Math.max(1, maxSearchPages)
  const searchStartIndex = (searchCurrentPage - 1) * SEARCH_PAGE_SIZE
  const paginatedSearchResults = searchResults.slice(
    searchStartIndex,
    searchStartIndex + SEARCH_PAGE_SIZE
  )

  const displayChunks = showingSearch ? paginatedSearchResults : initialChunks
  const currentPage = showingSearch ? searchCurrentPage : initialPage
  const totalPages = showingSearch ? searchTotalPages : initialTotalPages
  const hasNextPage = showingSearch ? searchCurrentPage < searchTotalPages : initialHasNextPage
  const hasPrevPage = showingSearch ? searchCurrentPage > 1 : initialHasPrevPage

  const goToPage = useCallback(
    async (page: number) => {
      // Update URL first for both modes
      const params = new URLSearchParams(window.location.search)
      if (page > 1) {
        params.set('page', page.toString())
      } else {
        params.delete('page')
      }
      window.history.replaceState(null, '', `?${params.toString()}`)

      if (showingSearch) {
        // For search, URL update is sufficient (client-side pagination)
        return
      }
      // For normal view, also trigger server-side pagination
      return await initialGoToPage(page)
    },
    [showingSearch, initialGoToPage]
  )

  const nextPage = useCallback(async () => {
    if (hasNextPage) {
      await goToPage(currentPage + 1)
    }
  }, [hasNextPage, currentPage, goToPage])

  const prevPage = useCallback(async () => {
    if (hasPrevPage) {
      await goToPage(currentPage - 1)
    }
  }, [hasPrevPage, currentPage, goToPage])

  const refreshChunks = showingSearch ? async () => {} : initialRefreshChunks
  const updateChunk = showingSearch ? (id: string, updates: any) => {} : initialUpdateChunk

  const initialCachedDoc = getInitialCachedDocument()
  const [documentData, setDocumentData] = useState<DocumentData | null>(initialCachedDoc)
  const [isLoadingDocument, setIsLoadingDocument] = useState(!initialCachedDoc)
  const [error, setError] = useState<string | null>(null)

  const [isCreateChunkModalOpen, setIsCreateChunkModalOpen] = useState(false)
  const [chunkToDelete, setChunkToDelete] = useState<ChunkData | null>(null)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [isBulkOperating, setIsBulkOperating] = useState(false)
  const [showDeleteDocumentDialog, setShowDeleteDocumentDialog] = useState(false)
  const [isDeletingDocument, setIsDeletingDocument] = useState(false)

  const combinedError = error || searchError || initialError

  // URL updates are handled directly in goToPage function to prevent pagination conflicts

  useEffect(() => {
    const fetchDocument = async () => {
      // Check for cached data first
      const cachedDocuments = getCachedDocuments(knowledgeBaseId)
      const cachedDoc = cachedDocuments?.documents?.find((d) => d.id === documentId)

      if (cachedDoc) {
        setDocumentData(cachedDoc)
        setIsLoadingDocument(false)
        return
      }

      // Only show loading and fetch if we don't have cached data
      setIsLoadingDocument(true)
      setError(null)

      try {
        const response = await fetch(`/api/knowledge/${knowledgeBaseId}/documents/${documentId}`)

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('Document not found')
          }
          throw new Error(`Failed to fetch document: ${response.statusText}`)
        }

        const result = await response.json()

        if (result.success) {
          setDocumentData(result.data)
        } else {
          throw new Error(result.error || 'Failed to fetch document')
        }
      } catch (err) {
        logger.error('Error fetching document:', err)
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setIsLoadingDocument(false)
      }
    }

    if (knowledgeBaseId && documentId) {
      fetchDocument()
    }
  }, [knowledgeBaseId, documentId, getCachedDocuments])

  const knowledgeBase = getCachedKnowledgeBase(knowledgeBaseId)
  const effectiveKnowledgeBaseName = knowledgeBase?.name || knowledgeBaseName || 'Knowledge Base'
  const effectiveDocumentName = documentData?.filename || documentName || 'Document'

  const breadcrumbItems = [
    { label: 'Knowledge Base', href: `/workspace/${workspaceId}/knowledge` },
    {
      label: effectiveKnowledgeBaseName,
      href: `/workspace/${workspaceId}/knowledge/${knowledgeBaseId}`,
    },
    { label: effectiveDocumentName },
  ]

  const handleChunkClick = (chunk: ChunkData) => {
    setSelectedChunk(chunk)
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
    setSelectedChunk(null)
  }

  const handleToggleEnabled = async (chunkId: string) => {
    const chunk = displayChunks.find((c) => c.id === chunkId)
    if (!chunk) return

    try {
      const response = await fetch(
        `/api/knowledge/${knowledgeBaseId}/documents/${documentId}/chunks/${chunkId}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            enabled: !chunk.enabled,
          }),
        }
      )

      if (!response.ok) {
        throw new Error('Failed to update chunk')
      }

      const result = await response.json()

      if (result.success) {
        updateChunk(chunkId, { enabled: !chunk.enabled })
      }
    } catch (err) {
      logger.error('Error updating chunk:', err)
    }
  }

  const handleDeleteChunk = (chunkId: string) => {
    const chunk = displayChunks.find((c) => c.id === chunkId)
    if (chunk) {
      setChunkToDelete(chunk)
      setIsDeleteModalOpen(true)
    }
  }

  const handleChunkDeleted = async () => {
    await refreshChunks()
    if (chunkToDelete) {
      setSelectedChunks((prev) => {
        const newSet = new Set(prev)
        newSet.delete(chunkToDelete.id)
        return newSet
      })
    }
  }

  const handleCloseDeleteModal = () => {
    setIsDeleteModalOpen(false)
    setChunkToDelete(null)
  }

  const handleSelectChunk = (chunkId: string, checked: boolean) => {
    setSelectedChunks((prev) => {
      const newSet = new Set(prev)
      if (checked) {
        newSet.add(chunkId)
      } else {
        newSet.delete(chunkId)
      }
      return newSet
    })
  }

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedChunks(new Set(displayChunks.map((chunk: ChunkData) => chunk.id)))
    } else {
      setSelectedChunks(new Set())
    }
  }

  const handleChunkCreated = async () => {
    // Refresh the chunks list to include the new chunk
    await refreshChunks()
  }

  /**
   * Handles deleting the document
   */
  const handleDeleteDocument = async () => {
    if (!documentData) return

    try {
      setIsDeletingDocument(true)

      const response = await fetch(`/api/knowledge/${knowledgeBaseId}/documents/${documentId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete document')
      }

      const result = await response.json()

      if (result.success) {
        removeDocument(knowledgeBaseId, documentId)

        // Invalidate React Query cache to ensure fresh data on KB page
        await queryClient.invalidateQueries({
          queryKey: knowledgeKeys.detail(knowledgeBaseId),
        })

        router.push(`/workspace/${workspaceId}/knowledge/${knowledgeBaseId}`)
      } else {
        throw new Error(result.error || 'Failed to delete document')
      }
    } catch (err) {
      logger.error('Error deleting document:', err)
      setIsDeletingDocument(false)
    }
  }

  // Shared utility function for bulk chunk operations
  const performBulkChunkOperation = async (
    operation: 'enable' | 'disable' | 'delete',
    chunks: ChunkData[]
  ) => {
    if (chunks.length === 0) return

    try {
      setIsBulkOperating(true)

      const response = await fetch(
        `/api/knowledge/${knowledgeBaseId}/documents/${documentId}/chunks`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            operation,
            chunkIds: chunks.map((chunk) => chunk.id),
          }),
        }
      )

      if (!response.ok) {
        throw new Error(`Failed to ${operation} chunks`)
      }

      const result = await response.json()

      if (result.success) {
        if (operation === 'delete') {
          // Refresh chunks list to reflect deletions
          await refreshChunks()
        } else {
          // Update successful chunks in the store for enable/disable operations
          result.data.results.forEach((opResult: any) => {
            if (opResult.operation === operation) {
              opResult.chunkIds.forEach((chunkId: string) => {
                updateChunk(chunkId, { enabled: operation === 'enable' })
              })
            }
          })
        }

        logger.info(`Successfully ${operation}d ${result.data.successCount} chunks`)
      }

      // Clear selection after successful operation
      setSelectedChunks(new Set())
    } catch (err) {
      logger.error(`Error ${operation}ing chunks:`, err)
    } finally {
      setIsBulkOperating(false)
    }
  }

  const handleBulkEnable = async () => {
    const chunksToEnable = displayChunks.filter(
      (chunk) => selectedChunks.has(chunk.id) && !chunk.enabled
    )
    await performBulkChunkOperation('enable', chunksToEnable)
  }

  const handleBulkDisable = async () => {
    const chunksToDisable = displayChunks.filter(
      (chunk) => selectedChunks.has(chunk.id) && chunk.enabled
    )
    await performBulkChunkOperation('disable', chunksToDisable)
  }

  const handleBulkDelete = async () => {
    const chunksToDelete = displayChunks.filter((chunk) => selectedChunks.has(chunk.id))
    await performBulkChunkOperation('delete', chunksToDelete)
  }

  // Calculate bulk operation counts
  const selectedChunksList = displayChunks.filter((chunk) => selectedChunks.has(chunk.id))
  const enabledCount = selectedChunksList.filter((chunk) => chunk.enabled).length
  const disabledCount = selectedChunksList.filter((chunk) => !chunk.enabled).length

  const isAllSelected = displayChunks.length > 0 && selectedChunks.size === displayChunks.length

  const handleDocumentTagsUpdate = useCallback(
    (tagData: Record<string, string>) => {
      updateDocumentInStore(knowledgeBaseId, documentId, tagData)
      setDocumentData((prev) => (prev ? { ...prev, ...tagData } : null))
    },
    [knowledgeBaseId, documentId, updateDocumentInStore]
  )

  if (isLoadingDocument) {
    return (
      <DocumentLoading
        knowledgeBaseId={knowledgeBaseId}
        knowledgeBaseName={effectiveKnowledgeBaseName}
        documentName={effectiveDocumentName}
      />
    )
  }

  if (combinedError) {
    const errorBreadcrumbItems = [
      { label: 'Knowledge Base', href: `/workspace/${workspaceId}/knowledge` },
      {
        label: effectiveKnowledgeBaseName,
        href: `/workspace/${workspaceId}/knowledge/${knowledgeBaseId}`,
      },
      { label: 'Error' },
    ]

    return (
      <div className='flex h-full flex-1 flex-col'>
        <div className='flex flex-1 overflow-hidden'>
          <div className='flex flex-1 flex-col overflow-auto px-[24px] pt-[24px] pb-[24px]'>
            <Breadcrumb items={errorBreadcrumbItems} />
            <div className='mt-[24px]'>
              <div className='flex h-64 items-center justify-center rounded-lg border border-muted-foreground/25 bg-muted/20'>
                <div className='text-center'>
                  <p className='font-medium text-[var(--text-secondary)] text-sm'>
                    Error loading document
                  </p>
                  <p className='mt-1 text-[var(--text-muted)] text-xs'>{combinedError}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className='flex h-full flex-1 flex-col'>
      <div className='flex flex-1 overflow-hidden'>
        <div className='flex flex-1 flex-col overflow-auto bg-white px-[24px] pt-[24px] pb-[24px] dark:bg-[var(--bg)]'>
          <Breadcrumb items={breadcrumbItems} />

          <div className='mt-[14px] flex items-center justify-between'>
            <h1 className='font-medium text-[18px] text-[var(--text-primary)]'>
              {effectiveDocumentName}
            </h1>
            <div className='flex items-center gap-2'>
              {userPermissions.canEdit && (
                <Button
                  onClick={() => setShowTagsModal(true)}
                  variant='default'
                  className='h-[32px] rounded-[6px]'
                >
                  Tags
                </Button>
              )}
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    onClick={() => setShowDeleteDocumentDialog(true)}
                    disabled={!userPermissions.canEdit}
                    className='h-[32px] rounded-[6px]'
                  >
                    <Trash className='h-[14px] w-[14px]' />
                  </Button>
                </Tooltip.Trigger>
                {!userPermissions.canEdit && (
                  <Tooltip.Content>Write permission required to delete document</Tooltip.Content>
                )}
              </Tooltip.Root>
            </div>
          </div>

          <p className='mt-[4px] font-medium text-[14px] text-[var(--text-tertiary)]'>
            {documentData?.chunkCount ?? 0} {documentData?.chunkCount === 1 ? 'chunk' : 'chunks'}
          </p>

          <div className='mt-[16px] flex items-center gap-[8px]'>
            <span className='text-[14px] text-[var(--text-muted)]'>
              {documentData?.tokenCount !== undefined
                ? documentData.tokenCount > 1000
                  ? `${(documentData.tokenCount / 1000).toFixed(1)}k`
                  : documentData.tokenCount.toLocaleString()
                : '0'}{' '}
              tokens
            </span>
            {documentData?.uploadedAt && (
              <>
                <div className='mb-[-1.5px] h-[18px] w-[1.25px] rounded-full bg-[#3A3A3A]' />
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <span className='cursor-default text-[14px] text-[var(--text-muted)]'>
                      uploaded: {formatRelativeTime(documentData.uploadedAt)}
                    </span>
                  </Tooltip.Trigger>
                  <Tooltip.Content>{formatAbsoluteDate(documentData.uploadedAt)}</Tooltip.Content>
                </Tooltip.Root>
              </>
            )}
          </div>

          <div className='mt-[14px] flex items-center justify-between'>
            <div className='flex h-[32px] w-[400px] items-center gap-[6px] rounded-[8px] bg-[var(--surface-4)] px-[8px]'>
              <Search className='h-[14px] w-[14px] text-[var(--text-subtle)]' />
              <Input
                placeholder={
                  documentData?.processingStatus === 'completed'
                    ? 'Search chunks...'
                    : 'Document processing...'
                }
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                disabled={documentData?.processingStatus !== 'completed'}
                className='flex-1 border-0 bg-transparent px-0 font-medium text-[var(--text-secondary)] text-small leading-none placeholder:text-[var(--text-subtle)] focus-visible:ring-0 focus-visible:ring-offset-0'
              />
              {searchQuery &&
                (isLoadingSearch ? (
                  <Loader2 className='h-[14px] w-[14px] animate-spin text-[var(--text-subtle)]' />
                ) : (
                  <button
                    onClick={() => setSearchQuery('')}
                    className='text-[var(--text-subtle)] transition-colors hover:text-[var(--text-secondary)]'
                  >
                    <X className='h-[14px] w-[14px]' />
                  </button>
                ))}
            </div>

            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  onClick={() => setIsCreateChunkModalOpen(true)}
                  disabled={documentData?.processingStatus === 'failed' || !userPermissions.canEdit}
                  variant='tertiary'
                  className='h-[32px] rounded-[6px]'
                >
                  Create Chunk
                </Button>
              </Tooltip.Trigger>
              {!userPermissions.canEdit && (
                <Tooltip.Content>Write permission required to create chunks</Tooltip.Content>
              )}
            </Tooltip.Root>
          </div>

          <div className='mt-[12px] flex flex-1 flex-col overflow-hidden'>
            {displayChunks.length === 0 && documentData?.processingStatus === 'completed' ? (
              <div className='mt-[10px] flex h-64 items-center justify-center rounded-lg border border-muted-foreground/25 bg-muted/20'>
                <div className='text-center'>
                  <p className='font-medium text-[var(--text-secondary)] text-sm'>
                    {searchQuery ? 'No chunks found' : 'No chunks yet'}
                  </p>
                  <p className='mt-1 text-[var(--text-muted)] text-xs'>
                    {searchQuery
                      ? 'Try a different search term'
                      : userPermissions.canEdit
                        ? 'Create chunks to get started'
                        : 'Chunks will appear here once created'}
                  </p>
                </div>
              </div>
            ) : (
              <Table className='min-w-[700px] table-fixed text-[13px]'>
                <TableHeader>
                  <TableRow className='hover:bg-transparent'>
                    <TableHead
                      className='w-[52px] py-[8px]'
                      style={{ paddingLeft: '20.5px', paddingRight: 0 }}
                    >
                      <div className='flex items-center'>
                        <Checkbox
                          checked={isAllSelected}
                          onCheckedChange={handleSelectAll}
                          disabled={
                            documentData?.processingStatus !== 'completed' ||
                            !userPermissions.canEdit
                          }
                          aria-label='Select all chunks'
                          className='h-[14px] w-[14px] border-[var(--border-2)] focus-visible:ring-[var(--brand-primary-hex)]/20 data-[state=checked]:border-[var(--brand-primary-hex)] data-[state=checked]:bg-[var(--brand-primary-hex)] [&>*]:h-[12px] [&>*]:w-[12px]'
                        />
                      </div>
                    </TableHead>
                    <TableHead className='w-[60px] py-[8px] pr-[12px] pl-[15px] text-[12px] text-[var(--text-secondary)]'>
                      Index
                    </TableHead>
                    <TableHead className='px-[12px] py-[8px] text-[12px] text-[var(--text-secondary)]'>
                      Content
                    </TableHead>
                    <TableHead className='w-[8%] px-[12px] py-[8px] text-[12px] text-[var(--text-secondary)]'>
                      Tokens
                    </TableHead>
                    <TableHead className='w-[12%] px-[12px] py-[8px] text-[12px] text-[var(--text-secondary)]'>
                      Status
                    </TableHead>
                    <TableHead className='w-[14%] py-[8px] pr-[4px] pl-[12px] text-[12px] text-[var(--text-secondary)]'>
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documentData?.processingStatus !== 'completed' ? (
                    <TableRow className='hover:bg-transparent'>
                      <TableCell
                        className='w-[52px] py-[8px]'
                        style={{ paddingLeft: '20.5px', paddingRight: 0 }}
                      >
                        <div className='flex items-center'>
                          <div className='h-[14px] w-[14px]' />
                        </div>
                      </TableCell>
                      <TableCell className='w-[60px] px-[12px] py-[8px] text-[12px] text-[var(--text-muted)]'>
                        —
                      </TableCell>
                      <TableCell className='px-[12px] py-[8px]'>
                        <div className='flex items-center gap-[8px]'>
                          <FileText className='h-5 w-5 flex-shrink-0 text-[var(--text-muted)]' />
                          <span className='text-[14px] text-[var(--text-muted)] italic'>
                            {documentData?.processingStatus === 'pending' &&
                              'Document processing pending...'}
                            {documentData?.processingStatus === 'processing' &&
                              'Document processing in progress...'}
                            {documentData?.processingStatus === 'failed' &&
                              'Document processing failed'}
                            {!documentData?.processingStatus && 'Document not ready'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className='w-[8%] px-[12px] py-[8px] text-[12px] text-[var(--text-muted)]'>
                        —
                      </TableCell>
                      <TableCell className='w-[12%] px-[12px] py-[8px] text-[12px] text-[var(--text-muted)]'>
                        —
                      </TableCell>
                      <TableCell className='w-[14%] py-[8px] pr-[4px] pl-[12px] text-[12px] text-[var(--text-muted)]'>
                        —
                      </TableCell>
                    </TableRow>
                  ) : (
                    displayChunks.map((chunk: ChunkData) => (
                      <TableRow
                        key={chunk.id}
                        className='cursor-pointer hover:bg-[var(--surface-2)]'
                        onClick={() => handleChunkClick(chunk)}
                      >
                        <TableCell
                          className='w-[52px] py-[8px]'
                          style={{ paddingLeft: '20.5px', paddingRight: 0 }}
                        >
                          <div className='flex items-center'>
                            <Checkbox
                              checked={selectedChunks.has(chunk.id)}
                              onCheckedChange={(checked) =>
                                handleSelectChunk(chunk.id, checked as boolean)
                              }
                              disabled={!userPermissions.canEdit}
                              aria-label={`Select chunk ${chunk.chunkIndex}`}
                              className='h-[14px] w-[14px] border-[var(--border-2)] focus-visible:ring-[var(--brand-primary-hex)]/20 data-[state=checked]:border-[var(--brand-primary-hex)] data-[state=checked]:bg-[var(--brand-primary-hex)] [&>*]:h-[12px] [&>*]:w-[12px]'
                              onClick={(e) => e.stopPropagation()}
                            />
                          </div>
                        </TableCell>
                        <TableCell className='w-[60px] py-[8px] pr-[12px] pl-[15px] font-mono text-[14px] text-[var(--text-primary)]'>
                          {chunk.chunkIndex}
                        </TableCell>
                        <TableCell className='px-[12px] py-[8px]'>
                          <span
                            className='block min-w-0 truncate text-[14px] text-[var(--text-primary)]'
                            title={chunk.content}
                          >
                            <SearchHighlight
                              text={truncateContent(chunk.content)}
                              searchQuery={searchQuery}
                            />
                          </span>
                        </TableCell>
                        <TableCell className='w-[8%] px-[12px] py-[8px] text-[12px] text-[var(--text-muted)]'>
                          {chunk.tokenCount > 1000
                            ? `${(chunk.tokenCount / 1000).toFixed(1)}k`
                            : chunk.tokenCount}
                        </TableCell>
                        <TableCell className='w-[12%] px-[12px] py-[8px]'>
                          <div className={getStatusBadgeStyles(chunk.enabled)}>
                            {chunk.enabled ? 'Enabled' : 'Disabled'}
                          </div>
                        </TableCell>
                        <TableCell className='w-[14%] py-[8px] pr-[4px] pl-[12px]'>
                          <div className='flex items-center gap-[4px]'>
                            <Tooltip.Root>
                              <Tooltip.Trigger asChild>
                                <Button
                                  variant='ghost'
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleToggleEnabled(chunk.id)
                                  }}
                                  disabled={!userPermissions.canEdit}
                                  className='h-[28px] w-[28px] p-0 text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50'
                                >
                                  {chunk.enabled ? (
                                    <Circle className='h-[14px] w-[14px]' />
                                  ) : (
                                    <CircleOff className='h-[14px] w-[14px]' />
                                  )}
                                </Button>
                              </Tooltip.Trigger>
                              <Tooltip.Content side='top'>
                                {!userPermissions.canEdit
                                  ? 'Write permission required to modify chunks'
                                  : chunk.enabled
                                    ? 'Disable Chunk'
                                    : 'Enable Chunk'}
                              </Tooltip.Content>
                            </Tooltip.Root>
                            <Tooltip.Root>
                              <Tooltip.Trigger asChild>
                                <Button
                                  variant='ghost'
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleDeleteChunk(chunk.id)
                                  }}
                                  disabled={!userPermissions.canEdit}
                                  className='h-[28px] w-[28px] p-0 text-[var(--text-muted)] hover:text-[var(--text-error)] disabled:opacity-50'
                                >
                                  <Trash className='h-[14px] w-[14px]' />
                                </Button>
                              </Tooltip.Trigger>
                              <Tooltip.Content side='top'>
                                {!userPermissions.canEdit
                                  ? 'Write permission required to delete chunks'
                                  : 'Delete Chunk'}
                              </Tooltip.Content>
                            </Tooltip.Root>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}

            {documentData?.processingStatus === 'completed' && totalPages > 1 && (
              <div className='flex items-center justify-center border-t bg-background px-4 pt-[10px]'>
                <div className='flex items-center gap-1'>
                  <Button variant='ghost' onClick={prevPage} disabled={!hasPrevPage}>
                    <ChevronLeft className='h-3.5 w-3.5' />
                  </Button>

                  <div className='mx-[12px] flex items-center gap-[16px]'>
                    {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                      let page: number
                      if (totalPages <= 5) {
                        page = i + 1
                      } else if (currentPage <= 3) {
                        page = i + 1
                      } else if (currentPage >= totalPages - 2) {
                        page = totalPages - 4 + i
                      } else {
                        page = currentPage - 2 + i
                      }

                      if (page < 1 || page > totalPages) return null

                      return (
                        <button
                          key={page}
                          onClick={() => goToPage(page)}
                          disabled={false}
                          className={`font-medium text-sm transition-colors hover:text-foreground disabled:opacity-50 ${
                            page === currentPage ? 'text-foreground' : 'text-muted-foreground'
                          }`}
                        >
                          {page}
                        </button>
                      )
                    })}
                  </div>

                  <Button variant='ghost' onClick={nextPage} disabled={!hasNextPage}>
                    <ChevronRight className='h-3.5 w-3.5' />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <DocumentTagsModal
        open={showTagsModal}
        onOpenChange={setShowTagsModal}
        knowledgeBaseId={knowledgeBaseId}
        documentId={documentId}
        documentData={documentData}
        onDocumentUpdate={handleDocumentTagsUpdate}
      />

      {/* Edit Chunk Modal */}
      <EditChunkModal
        chunk={selectedChunk}
        document={documentData}
        knowledgeBaseId={knowledgeBaseId}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onChunkUpdate={(updatedChunk: ChunkData) => {
          updateChunk(updatedChunk.id, updatedChunk)
          setSelectedChunk(updatedChunk)
        }}
        allChunks={displayChunks}
        currentPage={currentPage}
        totalPages={totalPages}
        onNavigateToChunk={(chunk: ChunkData) => {
          setSelectedChunk(chunk)
        }}
        onNavigateToPage={async (page: number, selectChunk: 'first' | 'last') => {
          await goToPage(page)

          const checkAndSelectChunk = () => {
            if (displayChunks.length > 0) {
              if (selectChunk === 'first') {
                setSelectedChunk(displayChunks[0])
              } else {
                setSelectedChunk(displayChunks[displayChunks.length - 1])
              }
            } else {
              // Retry after a short delay if chunks aren't loaded yet
              setTimeout(checkAndSelectChunk, 100)
            }
          }

          setTimeout(checkAndSelectChunk, 0)
        }}
      />

      {/* Create Chunk Modal */}
      <CreateChunkModal
        open={isCreateChunkModalOpen}
        onOpenChange={setIsCreateChunkModalOpen}
        document={documentData}
        knowledgeBaseId={knowledgeBaseId}
        onChunkCreated={handleChunkCreated}
      />

      {/* Delete Chunk Modal */}
      <DeleteChunkModal
        chunk={chunkToDelete}
        knowledgeBaseId={knowledgeBaseId}
        documentId={documentId}
        isOpen={isDeleteModalOpen}
        onClose={handleCloseDeleteModal}
        onChunkDeleted={handleChunkDeleted}
      />

      {/* Bulk Action Bar */}
      <ActionBar
        selectedCount={selectedChunks.size}
        onEnable={disabledCount > 0 ? handleBulkEnable : undefined}
        onDisable={enabledCount > 0 ? handleBulkDisable : undefined}
        onDelete={handleBulkDelete}
        enabledCount={enabledCount}
        disabledCount={disabledCount}
        isLoading={isBulkOperating}
      />

      {/* Delete Document Modal */}
      <Modal open={showDeleteDocumentDialog} onOpenChange={setShowDeleteDocumentDialog}>
        <ModalContent size='sm'>
          <ModalHeader>Delete Document</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              Are you sure you want to delete "{effectiveDocumentName}"? This will permanently
              delete the document and all {documentData?.chunkCount ?? 0} chunk
              {documentData?.chunkCount === 1 ? '' : 's'} within it.{' '}
              <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant='active'
              onClick={() => setShowDeleteDocumentDialog(false)}
              disabled={isDeletingDocument}
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={handleDeleteDocument}
              disabled={isDeletingDocument}
            >
              {isDeletingDocument ? 'Deleting...' : 'Delete Document'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
