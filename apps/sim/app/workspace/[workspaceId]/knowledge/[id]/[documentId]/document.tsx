'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Circle, CircleOff, FileText, Plus, Trash2 } from 'lucide-react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { SearchHighlight } from '@/components/ui/search-highlight'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console-logger'
import { ActionBar } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/action-bar/action-bar'
import { SearchInput } from '@/app/workspace/[workspaceId]/knowledge/components/search-input/search-input'
import { useDocumentChunks } from '@/hooks/use-knowledge'
import { type ChunkData, type DocumentData, useKnowledgeStore } from '@/stores/knowledge/store'
import { KnowledgeHeader } from '../../components/knowledge-header/knowledge-header'
import { CreateChunkModal } from './components/create-chunk-modal/create-chunk-modal'
import { DeleteChunkModal } from './components/delete-chunk-modal/delete-chunk-modal'
import { DocumentLoading } from './components/document-loading'
import { EditChunkModal } from './components/edit-chunk-modal/edit-chunk-modal'

const logger = createLogger('Document')

interface DocumentProps {
  knowledgeBaseId: string
  documentId: string
  knowledgeBaseName?: string
  documentName?: string
}

function getStatusBadgeStyles(enabled: boolean) {
  return enabled
    ? 'inline-flex items-center rounded-md bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
    : 'inline-flex items-center rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300'
}

function truncateContent(content: string, maxLength = 150): string {
  if (content.length <= maxLength) return content
  return `${content.substring(0, maxLength)}...`
}

export function Document({
  knowledgeBaseId,
  documentId,
  knowledgeBaseName,
  documentName,
}: DocumentProps) {
  const { getCachedKnowledgeBase, getCachedDocuments } = useKnowledgeStore()
  const { workspaceId } = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const currentPageFromURL = Number.parseInt(searchParams.get('page') || '1', 10)

  const {
    chunks: paginatedChunks,
    allChunks,
    filteredChunks,
    searchQuery,
    setSearchQuery,
    currentPage,
    totalPages,
    hasNextPage,
    hasPrevPage,
    goToPage,
    nextPage,
    prevPage,
    isLoading: isLoadingAllChunks,
    error: chunksError,
    refreshChunks,
    updateChunk,
  } = useDocumentChunks(knowledgeBaseId, documentId, currentPageFromURL, '', {
    enableClientSearch: true,
  })

  const [selectedChunks, setSelectedChunks] = useState<Set<string>>(new Set())
  const [selectedChunk, setSelectedChunk] = useState<ChunkData | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isCreateChunkModalOpen, setIsCreateChunkModalOpen] = useState(false)
  const [chunkToDelete, setChunkToDelete] = useState<ChunkData | null>(null)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [isBulkOperating, setIsBulkOperating] = useState(false)

  const [document, setDocument] = useState<DocumentData | null>(null)
  const [isLoadingDocument, setIsLoadingDocument] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const combinedError = error || chunksError

  // URL synchronization for pagination
  const updatePageInURL = useCallback(
    (newPage: number) => {
      const params = new URLSearchParams(searchParams)
      if (newPage > 1) {
        params.set('page', newPage.toString())
      } else {
        params.delete('page')
      }
      router.replace(`?${params.toString()}`, { scroll: false })
    },
    [router, searchParams]
  )

  // Sync URL when page changes
  useEffect(() => {
    updatePageInURL(currentPage)
  }, [currentPage, updatePageInURL])

  useEffect(() => {
    const fetchDocument = async () => {
      try {
        setIsLoadingDocument(true)
        setError(null)

        const cachedDocuments = getCachedDocuments(knowledgeBaseId)
        const cachedDoc = cachedDocuments?.documents?.find((d) => d.id === documentId)

        if (cachedDoc) {
          setDocument(cachedDoc)
          setIsLoadingDocument(false)
          return
        }

        const response = await fetch(`/api/knowledge/${knowledgeBaseId}/documents/${documentId}`)

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('Document not found')
          }
          throw new Error(`Failed to fetch document: ${response.statusText}`)
        }

        const result = await response.json()

        if (result.success) {
          setDocument(result.data)
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
  const effectiveDocumentName = document?.filename || documentName || 'Document'

  const breadcrumbs = [
    { label: 'Knowledge', href: `/workspace/${workspaceId}/knowledge` },
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
    const chunk = allChunks.find((c) => c.id === chunkId)
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
    const chunk = allChunks.find((c) => c.id === chunkId)
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
      setSelectedChunks(new Set(paginatedChunks.map((chunk: ChunkData) => chunk.id)))
    } else {
      setSelectedChunks(new Set())
    }
  }

  const handleChunkCreated = async (newChunk: ChunkData) => {
    // Refresh the chunks list to include the new chunk
    await refreshChunks()
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
    const chunksToEnable = allChunks.filter(
      (chunk) => selectedChunks.has(chunk.id) && !chunk.enabled
    )
    await performBulkChunkOperation('enable', chunksToEnable)
  }

  const handleBulkDisable = async () => {
    const chunksToDisable = allChunks.filter(
      (chunk) => selectedChunks.has(chunk.id) && chunk.enabled
    )
    await performBulkChunkOperation('disable', chunksToDisable)
  }

  const handleBulkDelete = async () => {
    const chunksToDelete = allChunks.filter((chunk) => selectedChunks.has(chunk.id))
    await performBulkChunkOperation('delete', chunksToDelete)
  }

  // Calculate bulk operation counts
  const selectedChunksList = allChunks.filter((chunk) => selectedChunks.has(chunk.id))
  const enabledCount = selectedChunksList.filter((chunk) => chunk.enabled).length
  const disabledCount = selectedChunksList.filter((chunk) => !chunk.enabled).length

  const isAllSelected = paginatedChunks.length > 0 && selectedChunks.size === paginatedChunks.length

  if (isLoadingDocument || isLoadingAllChunks) {
    return (
      <DocumentLoading
        knowledgeBaseId={knowledgeBaseId}
        knowledgeBaseName={effectiveKnowledgeBaseName}
        documentName={effectiveDocumentName}
      />
    )
  }

  if (combinedError && !isLoadingAllChunks) {
    const errorBreadcrumbs = [
      { label: 'Knowledge', href: `/workspace/${workspaceId}/knowledge` },
      {
        label: effectiveKnowledgeBaseName,
        href: `/workspace/${workspaceId}/knowledge/${knowledgeBaseId}`,
      },
      { label: 'Error' },
    ]

    return (
      <div className='flex h-[100vh] flex-col pl-64'>
        <KnowledgeHeader breadcrumbs={errorBreadcrumbs} />
        <div className='flex flex-1 items-center justify-center'>
          <div className='text-center'>
            <p className='mb-2 text-red-600 text-sm'>Error: {combinedError}</p>
            <button
              onClick={() => window.location.reload()}
              className='text-blue-600 text-sm underline hover:text-blue-800'
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className='flex h-[100vh] flex-col pl-64'>
      {/* Fixed Header with Breadcrumbs */}
      <KnowledgeHeader breadcrumbs={breadcrumbs} />

      <div className='flex flex-1 overflow-hidden'>
        <div className='flex flex-1 flex-col overflow-hidden'>
          {/* Main Content */}
          <div className='flex-1 overflow-auto'>
            <div className='px-6 pb-6'>
              {/* Search Section */}
              <div className='mb-4 flex items-center justify-between pt-1'>
                <SearchInput
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder={
                    document?.processingStatus === 'completed'
                      ? 'Search chunks...'
                      : 'Document processing...'
                  }
                  disabled={document?.processingStatus !== 'completed'}
                />

                <Button
                  onClick={() => setIsCreateChunkModalOpen(true)}
                  disabled={document?.processingStatus === 'failed'}
                  size='sm'
                  className='flex items-center gap-1 bg-[#701FFC] font-[480] text-white shadow-[0_0_0_0_#701FFC] transition-all duration-200 hover:bg-[#6518E6] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)] disabled:cursor-not-allowed disabled:opacity-50'
                >
                  <Plus className='h-3.5 w-3.5' />
                  <span>Create Chunk</span>
                </Button>
              </div>

              {/* Document Tags Display */}
              {document &&
                (() => {
                  const tags = [
                    { label: 'Tag 1', value: document.tag1 },
                    { label: 'Tag 2', value: document.tag2 },
                    { label: 'Tag 3', value: document.tag3 },
                    { label: 'Tag 4', value: document.tag4 },
                    { label: 'Tag 5', value: document.tag5 },
                    { label: 'Tag 6', value: document.tag6 },
                    { label: 'Tag 7', value: document.tag7 },
                  ].filter((tag) => tag.value?.trim())

                  return tags.length > 0 ? (
                    <div className='mb-4 rounded-md bg-muted/50 p-3'>
                      <p className='mb-2 text-muted-foreground text-xs'>Document Tags:</p>
                      <div className='flex flex-wrap gap-2'>
                        {tags.map((tag, index) => (
                          <span
                            key={index}
                            className='inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-primary text-xs'
                          >
                            <span className='font-medium'>{tag.label}:</span>
                            <span>{tag.value}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null
                })()}

              {/* Error State for chunks */}
              {combinedError && !isLoadingAllChunks && (
                <div className='mb-4 rounded-md border border-red-200 bg-red-50 p-4'>
                  <p className='text-red-800 text-sm'>Error loading chunks: {combinedError}</p>
                </div>
              )}

              {/* Table container */}
              <div className='flex flex-1 flex-col overflow-hidden'>
                {/* Table header - fixed */}
                <div className='sticky top-0 z-10 border-b bg-background'>
                  <table className='w-full table-fixed'>
                    <colgroup>
                      <col className='w-[5%]' />
                      <col className='w-[8%]' />
                      <col className='w-[55%]' />
                      <col className='w-[10%]' />
                      <col className='w-[10%]' />
                      <col className='w-[12%]' />
                    </colgroup>
                    <thead>
                      <tr>
                        <th className='px-4 pt-2 pb-3 text-left font-medium'>
                          <Checkbox
                            checked={isAllSelected}
                            onCheckedChange={handleSelectAll}
                            disabled={document?.processingStatus !== 'completed'}
                            aria-label='Select all chunks'
                            className='h-3.5 w-3.5 border-gray-300 focus-visible:ring-[#701FFC]/20 data-[state=checked]:border-[#701FFC] data-[state=checked]:bg-[#701FFC] [&>*]:h-3 [&>*]:w-3'
                          />
                        </th>
                        <th className='px-4 pt-2 pb-3 text-left font-medium'>
                          <span className='text-muted-foreground text-xs leading-none'>Index</span>
                        </th>
                        <th className='px-4 pt-2 pb-3 text-left font-medium'>
                          <span className='text-muted-foreground text-xs leading-none'>
                            Content
                          </span>
                        </th>
                        <th className='px-4 pt-2 pb-3 text-left font-medium'>
                          <span className='text-muted-foreground text-xs leading-none'>Tokens</span>
                        </th>
                        <th className='px-4 pt-2 pb-3 text-left font-medium'>
                          <span className='text-muted-foreground text-xs leading-none'>Status</span>
                        </th>
                        <th className='px-4 pt-2 pb-3 text-left font-medium'>
                          <span className='text-muted-foreground text-xs leading-none'>
                            Actions
                          </span>
                        </th>
                      </tr>
                    </thead>
                  </table>
                </div>

                {/* Table body - scrollable */}
                <div className='flex-1 overflow-auto'>
                  <table className='w-full table-fixed'>
                    <colgroup>
                      <col className='w-[5%]' />
                      <col className='w-[8%]' />
                      <col className='w-[55%]' />
                      <col className='w-[10%]' />
                      <col className='w-[10%]' />
                      <col className='w-[12%]' />
                    </colgroup>
                    <tbody>
                      {document?.processingStatus !== 'completed' ? (
                        <tr className='border-b transition-colors'>
                          <td className='px-4 py-3'>
                            <div className='h-3.5 w-3.5' />
                          </td>
                          <td className='px-4 py-3'>
                            <div className='text-muted-foreground text-xs'>—</div>
                          </td>
                          <td className='px-4 py-3'>
                            <div className='flex items-center gap-2'>
                              <FileText className='h-5 w-5 text-muted-foreground' />
                              <span className='text-muted-foreground text-sm italic'>
                                {document?.processingStatus === 'pending' &&
                                  'Document processing pending...'}
                                {document?.processingStatus === 'processing' &&
                                  'Document processing in progress...'}
                                {document?.processingStatus === 'failed' &&
                                  'Document processing failed'}
                                {!document?.processingStatus && 'Document not ready'}
                              </span>
                            </div>
                          </td>
                          <td className='px-4 py-3'>
                            <div className='text-muted-foreground text-xs'>—</div>
                          </td>
                          <td className='px-4 py-3'>
                            <div className='text-muted-foreground text-xs'>—</div>
                          </td>
                          <td className='px-4 py-3'>
                            <div className='text-muted-foreground text-xs'>—</div>
                          </td>
                        </tr>
                      ) : paginatedChunks.length === 0 && !isLoadingAllChunks ? (
                        <tr className='border-b transition-colors hover:bg-accent/30'>
                          <td className='px-4 py-3'>
                            <div className='h-3.5 w-3.5' />
                          </td>
                          <td className='px-4 py-3'>
                            <div className='text-muted-foreground text-xs'>—</div>
                          </td>
                          <td className='px-4 py-3'>
                            <div className='flex items-center gap-2'>
                              <FileText className='h-5 w-5 text-muted-foreground' />
                              <span className='text-muted-foreground text-sm italic'>
                                {document?.processingStatus === 'completed'
                                  ? searchQuery.trim()
                                    ? 'No chunks match your search'
                                    : 'No chunks found'
                                  : 'Document is still processing...'}
                              </span>
                            </div>
                          </td>
                          <td className='px-4 py-3'>
                            <div className='text-muted-foreground text-xs'>—</div>
                          </td>
                          <td className='px-4 py-3'>
                            <div className='text-muted-foreground text-xs'>—</div>
                          </td>
                          <td className='px-4 py-3'>
                            <div className='text-muted-foreground text-xs'>—</div>
                          </td>
                        </tr>
                      ) : isLoadingAllChunks ? (
                        // Show loading skeleton rows when chunks are loading
                        Array.from({ length: 5 }).map((_, index) => (
                          <tr key={`loading-${index}`} className='border-b transition-colors'>
                            <td className='px-4 py-3'>
                              <div className='h-3.5 w-3.5 animate-pulse rounded bg-muted' />
                            </td>
                            <td className='px-4 py-3'>
                              <div className='h-4 w-8 animate-pulse rounded bg-muted' />
                            </td>
                            <td className='px-4 py-3'>
                              <div className='h-4 w-full animate-pulse rounded bg-muted' />
                            </td>
                            <td className='px-4 py-3'>
                              <div className='h-4 w-12 animate-pulse rounded bg-muted' />
                            </td>
                            <td className='px-4 py-3'>
                              <div className='h-4 w-12 animate-pulse rounded bg-muted' />
                            </td>
                            <td className='px-4 py-3'>
                              <div className='h-4 w-16 animate-pulse rounded bg-muted' />
                            </td>
                          </tr>
                        ))
                      ) : (
                        paginatedChunks.map((chunk: ChunkData) => (
                          <tr
                            key={chunk.id}
                            className='cursor-pointer border-b transition-colors hover:bg-accent/30'
                            onClick={() => handleChunkClick(chunk)}
                          >
                            {/* Select column */}
                            <td className='px-4 py-3'>
                              <Checkbox
                                checked={selectedChunks.has(chunk.id)}
                                onCheckedChange={(checked) =>
                                  handleSelectChunk(chunk.id, checked as boolean)
                                }
                                aria-label={`Select chunk ${chunk.chunkIndex}`}
                                className='h-3.5 w-3.5 border-gray-300 focus-visible:ring-[#701FFC]/20 data-[state=checked]:border-[#701FFC] data-[state=checked]:bg-[#701FFC] [&>*]:h-3 [&>*]:w-3'
                                onClick={(e) => e.stopPropagation()}
                              />
                            </td>

                            {/* Index column */}
                            <td className='px-4 py-3'>
                              <div className='font-mono text-sm'>{chunk.chunkIndex}</div>
                            </td>

                            {/* Content column */}
                            <td className='px-4 py-3'>
                              <div className='text-sm' title={chunk.content}>
                                <SearchHighlight
                                  text={truncateContent(chunk.content)}
                                  searchQuery={searchQuery}
                                />
                              </div>
                            </td>

                            {/* Tokens column */}
                            <td className='px-4 py-3'>
                              <div className='text-xs'>
                                {chunk.tokenCount > 1000
                                  ? `${(chunk.tokenCount / 1000).toFixed(1)}k`
                                  : chunk.tokenCount}
                              </div>
                            </td>

                            {/* Status column */}
                            <td className='px-4 py-3'>
                              <div className={getStatusBadgeStyles(chunk.enabled)}>
                                <span className='font-medium'>
                                  {chunk.enabled ? 'Enabled' : 'Disabled'}
                                </span>
                              </div>
                            </td>

                            {/* Actions column */}
                            <td className='px-4 py-3'>
                              <div className='flex items-center gap-1'>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant='ghost'
                                      size='sm'
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleToggleEnabled(chunk.id)
                                      }}
                                      className='h-8 w-8 p-0 text-gray-500 hover:text-gray-700'
                                    >
                                      {chunk.enabled ? (
                                        <Circle className='h-4 w-4' />
                                      ) : (
                                        <CircleOff className='h-4 w-4' />
                                      )}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent side='top'>
                                    {chunk.enabled ? 'Disable Chunk' : 'Enable Chunk'}
                                  </TooltipContent>
                                </Tooltip>

                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant='ghost'
                                      size='sm'
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleDeleteChunk(chunk.id)
                                      }}
                                      className='h-8 w-8 p-0 text-gray-500 hover:text-red-600'
                                    >
                                      <Trash2 className='h-4 w-4' />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent side='top'>Delete Chunk</TooltipContent>
                                </Tooltip>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls */}
                {document?.processingStatus === 'completed' && totalPages > 1 && (
                  <div className='flex items-center justify-center border-t bg-background px-6 py-4'>
                    <div className='flex items-center gap-1'>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={prevPage}
                        disabled={!hasPrevPage || isLoadingAllChunks}
                        className='h-8 w-8 p-0'
                      >
                        <ChevronLeft className='h-4 w-4' />
                      </Button>

                      {/* Page numbers - show a few around current page */}
                      <div className='mx-4 flex items-center gap-6'>
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
                              disabled={isLoadingAllChunks}
                              className={`font-medium text-sm transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 ${
                                page === currentPage ? 'text-foreground' : 'text-muted-foreground'
                              }`}
                            >
                              {page}
                            </button>
                          )
                        })}
                      </div>

                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={nextPage}
                        disabled={!hasNextPage || isLoadingAllChunks}
                        className='h-8 w-8 p-0'
                      >
                        <ChevronRight className='h-4 w-4' />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Edit Chunk Modal */}
      <EditChunkModal
        chunk={selectedChunk}
        document={document}
        knowledgeBaseId={knowledgeBaseId}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onChunkUpdate={(updatedChunk: ChunkData) => {
          updateChunk(updatedChunk.id, updatedChunk)
          setSelectedChunk(updatedChunk)
        }}
        allChunks={allChunks}
        currentPage={currentPage}
        totalPages={totalPages}
        onNavigateToChunk={(chunk: ChunkData) => {
          setSelectedChunk(chunk)
        }}
        onNavigateToPage={async (page: number, selectChunk: 'first' | 'last') => {
          await goToPage(page)

          const checkAndSelectChunk = () => {
            if (!isLoadingAllChunks && paginatedChunks.length > 0) {
              if (selectChunk === 'first') {
                setSelectedChunk(paginatedChunks[0])
              } else {
                setSelectedChunk(paginatedChunks[paginatedChunks.length - 1])
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
        document={document}
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
    </div>
  )
}
