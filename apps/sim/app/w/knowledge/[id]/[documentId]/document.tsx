'use client'

import { useCallback, useEffect, useState } from 'react'
import { Circle, CircleOff, FileText, LibraryBig, Search, Trash2, X } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSidebarStore } from '@/stores/sidebar/store'
import { DocumentLoading } from './components/document-loading'
import { EditChunkModal } from './components/edit-chunk-modal'

interface DocumentProps {
  knowledgeBaseId: string
  documentId: string
  knowledgeBaseName: string
  documentName: string
}

interface DocumentData {
  id: string
  knowledgeBaseId: string
  filename: string
  fileUrl: string
  fileSize: number
  mimeType: string
  fileHash?: string
  chunkCount: number
  tokenCount: number
  characterCount: number
  enabled: boolean
  uploadedAt: string
}

interface ChunkData {
  id: string
  chunkIndex: number
  content: string
  contentLength: number
  tokenCount: number
  enabled: boolean
  startOffset: number
  endOffset: number
  overlapTokens: number
  metadata: any
  searchRank: string
  qualityScore: string | null
  createdAt: string
  updatedAt: string
}

interface ChunksResponse {
  success: boolean
  data: ChunkData[]
  error?: string
  pagination: {
    total: number
    limit: number
    offset: number
    hasMore: boolean
  }
}

// Helper function to get status badge styles
function getStatusBadgeStyles(enabled: boolean) {
  return enabled
    ? 'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400'
    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-400'
}

// Helper function to truncate content for display
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
  const { mode, isExpanded } = useSidebarStore()
  const isSidebarCollapsed =
    mode === 'expanded' ? !isExpanded : mode === 'collapsed' || mode === 'hover'

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedChunks, setSelectedChunks] = useState<Set<string>>(new Set())
  const [selectedChunk, setSelectedChunk] = useState<ChunkData | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)

  const [document, setDocument] = useState<DocumentData | null>(null)
  const [chunks, setChunks] = useState<ChunkData[]>([])
  const [isLoadingDocument, setIsLoadingDocument] = useState(true)
  const [isLoadingChunks, setIsLoadingChunks] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pagination, setPagination] = useState({
    total: 0,
    limit: 50,
    offset: 0,
    hasMore: false,
  })

  // Fetch document data
  useEffect(() => {
    const fetchDocument = async () => {
      try {
        setIsLoadingDocument(true)
        setError(null)

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
        console.error('Error fetching document:', err)
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setIsLoadingDocument(false)
      }
    }

    if (knowledgeBaseId && documentId) {
      fetchDocument()
    }
  }, [knowledgeBaseId, documentId])

  // Fetch chunks data
  const fetchChunks = useCallback(
    async (search?: string, offset = 0) => {
      try {
        setIsLoadingChunks(true)

        const params = new URLSearchParams({
          limit: pagination.limit.toString(),
          offset: offset.toString(),
        })

        if (search) params.append('search', search)

        const response = await fetch(
          `/api/knowledge/${knowledgeBaseId}/documents/${documentId}/chunks?${params}`
        )

        if (!response.ok) {
          throw new Error(`Failed to fetch chunks: ${response.statusText}`)
        }

        const result: ChunksResponse = await response.json()

        if (result.success) {
          if (offset === 0) {
            setChunks(result.data)
          } else {
            setChunks((prev) => [...prev, ...result.data])
          }
          setPagination(result.pagination)
        } else {
          throw new Error(result.error || 'Failed to fetch chunks')
        }
      } catch (err) {
        console.error('Error fetching chunks:', err)
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setIsLoadingChunks(false)
      }
    },
    [knowledgeBaseId, documentId, pagination.limit]
  )

  // Initial fetch and refetch on filter changes
  useEffect(() => {
    if (document) {
      fetchChunks(searchQuery, 0)
    }
  }, [document, searchQuery, fetchChunks])

  const handleChunkClick = (chunk: ChunkData) => {
    setSelectedChunk(chunk)
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
    setSelectedChunk(null)
  }

  const handleToggleEnabled = async (chunkId: string) => {
    const chunk = chunks.find((c) => c.id === chunkId)
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
        setChunks((prev) => prev.map((c) => (c.id === chunkId ? { ...c, enabled: !c.enabled } : c)))
      }
    } catch (err) {
      console.error('Error updating chunk:', err)
    }
  }

  const handleDeleteChunk = async (chunkId: string) => {
    try {
      const response = await fetch(
        `/api/knowledge/${knowledgeBaseId}/documents/${documentId}/chunks/${chunkId}`,
        {
          method: 'DELETE',
        }
      )

      if (!response.ok) {
        throw new Error('Failed to delete chunk')
      }

      const result = await response.json()

      if (result.success) {
        setChunks((prev) => prev.filter((c) => c.id !== chunkId))
        setSelectedChunks((prev) => {
          const newSet = new Set(prev)
          newSet.delete(chunkId)
          return newSet
        })
      }
    } catch (err) {
      console.error('Error deleting chunk:', err)
    }
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
      setSelectedChunks(new Set(chunks.map((chunk) => chunk.id)))
    } else {
      setSelectedChunks(new Set())
    }
  }

  const isAllSelected = chunks.length > 0 && selectedChunks.size === chunks.length
  const isIndeterminate = selectedChunks.size > 0 && selectedChunks.size < chunks.length

  // Show loading component while data is being fetched
  if (isLoadingDocument || isLoadingChunks) {
    return (
      <DocumentLoading
        knowledgeBaseId={knowledgeBaseId}
        knowledgeBaseName={knowledgeBaseName}
        documentName={documentName}
      />
    )
  }

  // Show error state for document fetch
  if (error && isLoadingDocument) {
    return (
      <div
        className={`flex h-[100vh] flex-col transition-padding duration-200 ${isSidebarCollapsed ? 'pl-14' : 'pl-60'}`}
      >
        <div className='flex items-center gap-2 px-6 pt-[14px] pb-6'>
          <Link
            href='/w/knowledge'
            prefetch={true}
            className='group flex items-center gap-2 font-medium text-sm transition-colors hover:text-muted-foreground'
          >
            <LibraryBig className='h-[18px] w-[18px] text-muted-foreground transition-colors group-hover:text-muted-foreground/70' />
            <span>Knowledge</span>
          </Link>
          <span className='text-muted-foreground'>/</span>
          <Link
            href={`/w/knowledge/${knowledgeBaseId}`}
            className='font-medium text-sm transition-colors hover:text-muted-foreground'
          >
            {knowledgeBaseName}
          </Link>
          <span className='text-muted-foreground'>/</span>
          <span className='font-medium text-sm'>Error</span>
        </div>
        <div className='flex flex-1 items-center justify-center'>
          <div className='text-center'>
            <p className='mb-2 text-red-600 text-sm'>Error: {error}</p>
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
    <div
      className={`flex h-[100vh] flex-col transition-padding duration-200 ${isSidebarCollapsed ? 'pl-14' : 'pl-60'}`}
    >
      {/* Fixed Header with Breadcrumbs */}
      <div className='flex items-center gap-2 px-6 pt-[14px] pb-6'>
        <Link
          href='/w/knowledge'
          prefetch={true}
          className='group flex items-center gap-2 font-medium text-sm transition-colors hover:text-muted-foreground'
        >
          <LibraryBig className='h-[18px] w-[18px] text-muted-foreground transition-colors group-hover:text-muted-foreground/70' />
          <span>Knowledge</span>
        </Link>
        <span className='text-muted-foreground'>/</span>
        <Link
          href={`/w/knowledge/${knowledgeBaseId}`}
          className='font-medium text-sm transition-colors hover:text-muted-foreground'
        >
          {knowledgeBaseName}
        </Link>
        <span className='text-muted-foreground'>/</span>
        <span className='font-medium text-sm'>{documentName}</span>
      </div>

      <div className='flex flex-1 overflow-hidden'>
        <div className='flex flex-1 flex-col overflow-hidden'>
          {/* Main Content */}
          <div className='flex-1 overflow-auto pt-[4px]'>
            <div className='px-6 pb-6'>
              {/* Search Section */}
              <div className='mb-4'>
                <div className='relative max-w-md'>
                  <div className='relative flex items-center'>
                    <Search className='-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 h-[18px] w-[18px] transform text-muted-foreground' />
                    <input
                      type='text'
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder='Search chunks...'
                      className='h-10 w-full rounded-md border bg-background px-9 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:font-medium file:text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className='-translate-y-1/2 absolute top-1/2 right-3 transform text-muted-foreground hover:text-foreground'
                      >
                        <X className='h-[18px] w-[18px]' />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Error State for chunks */}
              {error && !isLoadingDocument && (
                <div className='mb-4 rounded-md border border-red-200 bg-red-50 p-4'>
                  <p className='text-red-800 text-sm'>Error loading chunks: {error}</p>
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
                      <col className={`${isSidebarCollapsed ? 'w-[57%]' : 'w-[55%]'}`} />
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
                      <col className={`${isSidebarCollapsed ? 'w-[57%]' : 'w-[55%]'}`} />
                      <col className='w-[10%]' />
                      <col className='w-[10%]' />
                      <col className='w-[12%]' />
                    </colgroup>
                    <tbody>
                      {chunks.length === 0 ? (
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
                                No chunks found
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
                      ) : (
                        chunks.map((chunk) => (
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
                                {truncateContent(chunk.content)}
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
                              <div
                                className={`inline-flex items-center justify-center rounded-md px-2 py-1 text-xs ${getStatusBadgeStyles(chunk.enabled)}`}
                              >
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
          setChunks((prev) => prev.map((c) => (c.id === updatedChunk.id ? updatedChunk : c)))
          setSelectedChunk(updatedChunk)
        }}
      />
    </div>
  )
}
