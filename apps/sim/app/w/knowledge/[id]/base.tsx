'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { Circle, CircleOff, FileText, LibraryBig, Plus, Search, Trash2, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getDocumentIcon } from '@/app/w/knowledge/components/icons/document-icons'
import { useSidebarStore } from '@/stores/sidebar/store'
import { KnowledgeBaseLoading } from './components/knowledge-base-loading'

interface KnowledgeBaseProps {
  id: string
  knowledgeBaseName?: string
}

interface KnowledgeBaseData {
  id: string
  name: string
  description?: string
  tokenCount: number
  embeddingModel: string
  embeddingDimension: number
  chunkingConfig: any
  createdAt: string
  updatedAt: string
  workspaceId?: string
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

// Helper function to get file icon based on mime type
function getFileIcon(mimeType: string, filename: string) {
  const IconComponent = getDocumentIcon(mimeType, filename)
  return <IconComponent className='h-6 w-5' />
}

// Helper function to format file size
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`
}

// Helper function to get status badge styles
function getStatusBadgeStyles(enabled: boolean) {
  return enabled
    ? 'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400'
    : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-400'
}

export function KnowledgeBase({
  id,
  knowledgeBaseName: passedKnowledgeBaseName,
}: KnowledgeBaseProps) {
  const { mode, isExpanded } = useSidebarStore()
  const isSidebarCollapsed =
    mode === 'expanded' ? !isExpanded : mode === 'collapsed' || mode === 'hover'

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(new Set())
  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeBaseData | null>(null)
  const [documents, setDocuments] = useState<DocumentData[]>([])
  const [isLoadingKnowledgeBase, setIsLoadingKnowledgeBase] = useState(true)
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  // Get the knowledge base name for navigation - use passed name first, then fetched name
  const knowledgeBaseName = knowledgeBase?.name || passedKnowledgeBaseName || 'Knowledge Base'

  // Fetch knowledge base data
  useEffect(() => {
    const fetchKnowledgeBase = async () => {
      try {
        setIsLoadingKnowledgeBase(true)
        setError(null)

        const response = await fetch(`/api/knowledge/${id}`)

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('Knowledge base not found')
          }
          throw new Error(`Failed to fetch knowledge base: ${response.statusText}`)
        }

        const result = await response.json()

        if (result.success) {
          setKnowledgeBase(result.data)
        } else {
          throw new Error(result.error || 'Failed to fetch knowledge base')
        }
      } catch (err) {
        console.error('Error fetching knowledge base:', err)
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setIsLoadingKnowledgeBase(false)
      }
    }

    if (id) {
      fetchKnowledgeBase()
    }
  }, [id])

  // Fetch documents data
  useEffect(() => {
    const fetchDocuments = async () => {
      try {
        setIsLoadingDocuments(true)

        const response = await fetch(`/api/knowledge/${id}/documents`)

        if (!response.ok) {
          throw new Error(`Failed to fetch documents: ${response.statusText}`)
        }

        const result = await response.json()

        if (result.success) {
          setDocuments(result.data)
        } else {
          throw new Error(result.error || 'Failed to fetch documents')
        }
      } catch (err) {
        console.error('Error fetching documents:', err)
        // Don't set error here since we already have the knowledge base data
        setDocuments([])
      } finally {
        setIsLoadingDocuments(false)
      }
    }

    if (id && knowledgeBase) {
      fetchDocuments()
    }
  }, [id, knowledgeBase])

  // Filter documents based on search query
  const filteredDocuments = documents.filter((doc) =>
    doc.filename.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleToggleEnabled = async (docId: string) => {
    const document = documents.find((doc) => doc.id === docId)
    if (!document) return

    try {
      const response = await fetch(`/api/knowledge/${id}/documents/${docId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          enabled: !document.enabled,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to update document')
      }

      const result = await response.json()

      if (result.success) {
        setDocuments((prev) =>
          prev.map((doc) => (doc.id === docId ? { ...doc, enabled: !doc.enabled } : doc))
        )
      }
    } catch (err) {
      console.error('Error updating document:', err)
      // TODO: Show toast notification for error
    }
  }

  const handleDeleteDocument = async (docId: string) => {
    try {
      const response = await fetch(`/api/knowledge/${id}/documents/${docId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete document')
      }

      const result = await response.json()

      if (result.success) {
        setDocuments((prev) => prev.filter((doc) => doc.id !== docId))
        setSelectedDocuments((prev) => {
          const newSet = new Set(prev)
          newSet.delete(docId)
          return newSet
        })
      }
    } catch (err) {
      console.error('Error deleting document:', err)
      // TODO: Show toast notification for error
    }
  }

  const handleSelectDocument = (docId: string, checked: boolean) => {
    setSelectedDocuments((prev) => {
      const newSet = new Set(prev)
      if (checked) {
        newSet.add(docId)
      } else {
        newSet.delete(docId)
      }
      return newSet
    })
  }

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedDocuments(new Set(filteredDocuments.map((doc) => doc.id)))
    } else {
      setSelectedDocuments(new Set())
    }
  }

  const isAllSelected =
    filteredDocuments.length > 0 && selectedDocuments.size === filteredDocuments.length

  const handleDocumentClick = (docId: string) => {
    // Find the document to get its filename
    const document = documents.find((doc) => doc.id === docId)
    const params = new URLSearchParams({
      kbName: knowledgeBaseName, // Use the instantly available name
      docName: document?.filename || 'Document',
    })
    router.push(`/w/knowledge/${id}/${docId}?${params.toString()}`)
  }

  // Show loading component while data is being fetched
  if (isLoadingKnowledgeBase || isLoadingDocuments) {
    return <KnowledgeBaseLoading knowledgeBaseName={knowledgeBaseName} />
  }

  // Show error state for knowledge base fetch
  if (error && isLoadingKnowledgeBase) {
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
        <span className='font-medium text-sm'>{knowledgeBaseName}</span>
      </div>

      <div className='flex flex-1 overflow-hidden'>
        <div className='flex flex-1 flex-col overflow-hidden'>
          {/* Main Content */}
          <div className='flex-1 overflow-auto pt-[4px]'>
            <div className='px-6 pb-6'>
              {/* Search and Create Section */}
              <div className='mb-4 flex items-center justify-between'>
                <div className='relative max-w-md flex-1'>
                  <div className='relative flex items-center'>
                    <Search className='-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 h-[18px] w-[18px] transform text-muted-foreground' />
                    <input
                      type='text'
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder='Search documents...'
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

                {/* <button className='flex items-center gap-1 rounded-md bg-[#701FFC] px-3 py-[7px] font-[480] text-primary-foreground text-sm shadow-[0_0_0_0_#701FFC] transition-all duration-200 hover:bg-[#6518E6] hover:shadow-[0_0_0_4px_rgba(127,47,255,0.15)]'>
                  <Plus className='h-4 w-4 font-[480]' />
                  <span>Add Document</span>
                </button> */}
              </div>

              {/* Error State for documents */}
              {error && !isLoadingKnowledgeBase && (
                <div className='mb-4 rounded-md border border-red-200 bg-red-50 p-4'>
                  <p className='text-red-800 text-sm'>Error loading documents: {error}</p>
                </div>
              )}

              {/* Table container */}
              <div className='flex flex-1 flex-col overflow-hidden'>
                {/* Table header - fixed */}
                <div className='sticky top-0 z-10 border-b bg-background'>
                  <table className='w-full table-fixed'>
                    <colgroup>
                      <col className='w-[5%]' />
                      <col className={`${isSidebarCollapsed ? 'w-[18%]' : 'w-[20%]'}`} />
                      <col className='w-[10%]' />
                      <col className='w-[10%]' />
                      <col className='hidden w-[8%] lg:table-column' />
                      <col className={`${isSidebarCollapsed ? 'w-[22%]' : 'w-[20%]'}`} />
                      <col className='w-[10%]' />
                      <col className='w-[16%]' />
                    </colgroup>
                    <thead>
                      <tr>
                        <th className='px-4 pt-2 pb-3 text-left font-medium'>
                          <Checkbox
                            checked={isAllSelected}
                            onCheckedChange={handleSelectAll}
                            aria-label='Select all documents'
                            className='h-3.5 w-3.5 border-gray-300 focus-visible:ring-[#701FFC]/20 data-[state=checked]:border-[#701FFC] data-[state=checked]:bg-[#701FFC] [&>*]:h-3 [&>*]:w-3'
                          />
                        </th>
                        <th className='px-4 pt-2 pb-3 text-left font-medium'>
                          <span className='text-muted-foreground text-xs leading-none'>Name</span>
                        </th>
                        <th className='px-4 pt-2 pb-3 text-left font-medium'>
                          <span className='text-muted-foreground text-xs leading-none'>Size</span>
                        </th>
                        <th className='px-4 pt-2 pb-3 text-left font-medium'>
                          <span className='text-muted-foreground text-xs leading-none'>Tokens</span>
                        </th>
                        <th className='hidden px-4 pt-2 pb-3 text-left font-medium lg:table-cell'>
                          <span className='text-muted-foreground text-xs leading-none'>Chunks</span>
                        </th>
                        <th className='px-4 pt-2 pb-3 text-left font-medium'>
                          <span className='text-muted-foreground text-xs leading-none'>
                            Uploaded
                          </span>
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
                      <col className={`${isSidebarCollapsed ? 'w-[18%]' : 'w-[20%]'}`} />
                      <col className='w-[10%]' />
                      <col className='w-[10%]' />
                      <col className='hidden w-[8%] lg:table-column' />
                      <col className={`${isSidebarCollapsed ? 'w-[22%]' : 'w-[20%]'}`} />
                      <col className='w-[10%]' />
                      <col className='w-[16%]' />
                    </colgroup>
                    <tbody>
                      {filteredDocuments.length === 0 ? (
                        <tr className='border-b transition-colors hover:bg-accent/30'>
                          {/* Select column */}
                          <td className='px-4 py-3'>
                            <div className='h-3.5 w-3.5' />
                          </td>

                          {/* Name column */}
                          <td className='px-4 py-3'>
                            <div className='flex items-center gap-2'>
                              <FileText className='h-6 w-5 text-muted-foreground' />
                              <span className='text-muted-foreground text-sm italic'>
                                {documents.length === 0
                                  ? 'No documents yet'
                                  : 'No documents match your search'}
                              </span>
                            </div>
                          </td>

                          {/* Size column */}
                          <td className='px-4 py-3'>
                            <div className='text-muted-foreground text-xs'>—</div>
                          </td>

                          {/* Tokens column */}
                          <td className='px-4 py-3'>
                            <div className='text-muted-foreground text-xs'>—</div>
                          </td>

                          {/* Chunks column - hidden on small screens */}
                          <td className='hidden px-4 py-3 lg:table-cell'>
                            <div className='text-muted-foreground text-xs'>—</div>
                          </td>

                          {/* Upload Time column */}
                          <td className='px-4 py-3'>
                            <div className='text-muted-foreground text-xs'>—</div>
                          </td>

                          {/* Status column */}
                          <td className='px-4 py-3'>
                            <div className='text-muted-foreground text-xs'>—</div>
                          </td>

                          {/* Actions column */}
                          <td className='px-4 py-3'>
                            {documents.length === 0 && (
                              <button
                                onClick={() => {
                                  // TODO: Open add document modal when implemented
                                  console.log('Add document clicked')
                                }}
                                className='inline-flex items-center gap-1 rounded-md bg-[#701FFC] px-2 py-1 font-medium text-primary-foreground text-xs transition-colors hover:bg-[#6518E6]'
                              >
                                <Plus className='h-3 w-3' />
                                <span>Add Document</span>
                              </button>
                            )}
                          </td>
                        </tr>
                      ) : (
                        filteredDocuments.map((doc, index) => (
                          <tr
                            key={doc.id}
                            className='cursor-pointer border-b transition-colors hover:bg-accent/30'
                            onClick={() => handleDocumentClick(doc.id)}
                          >
                            {/* Select column */}
                            <td className='px-4 py-3'>
                              <Checkbox
                                checked={selectedDocuments.has(doc.id)}
                                onCheckedChange={(checked) =>
                                  handleSelectDocument(doc.id, checked as boolean)
                                }
                                onClick={(e) => e.stopPropagation()}
                                aria-label={`Select ${doc.filename}`}
                                className='h-3.5 w-3.5 border-gray-300 focus-visible:ring-[#701FFC]/20 data-[state=checked]:border-[#701FFC] data-[state=checked]:bg-[#701FFC] [&>*]:h-3 [&>*]:w-3'
                              />
                            </td>

                            {/* Name column */}
                            <td className='px-4 py-3'>
                              <div className='flex items-center gap-2'>
                                {getFileIcon(doc.mimeType, doc.filename)}
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className='block truncate text-sm' title={doc.filename}>
                                      {doc.filename}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side='top'>{doc.filename}</TooltipContent>
                                </Tooltip>
                              </div>
                            </td>

                            {/* Size column */}
                            <td className='px-4 py-3'>
                              <div className='text-muted-foreground text-xs'>
                                {formatFileSize(doc.fileSize)}
                              </div>
                            </td>

                            {/* Tokens column */}
                            <td className='px-4 py-3'>
                              <div className='text-xs'>
                                {doc.tokenCount > 1000
                                  ? `${(doc.tokenCount / 1000).toFixed(1)}k`
                                  : doc.tokenCount}
                              </div>
                            </td>

                            {/* Chunks column - hidden on small screens */}
                            <td className='hidden px-4 py-3 lg:table-cell'>
                              <div className='text-muted-foreground text-xs'>{doc.chunkCount}</div>
                            </td>

                            {/* Upload Time column */}
                            <td className='px-4 py-3'>
                              <div className='flex flex-col justify-center'>
                                <div className='flex items-center font-medium text-xs'>
                                  <span>{format(new Date(doc.uploadedAt), 'h:mm a')}</span>
                                  <span className='mx-1.5 hidden text-muted-foreground xl:inline'>
                                    •
                                  </span>
                                  <span className='hidden text-muted-foreground xl:inline'>
                                    {format(new Date(doc.uploadedAt), 'MMM d, yyyy')}
                                  </span>
                                </div>
                                <div className='mt-0.5 text-muted-foreground text-xs lg:hidden'>
                                  {format(new Date(doc.uploadedAt), 'MMM d')}
                                </div>
                              </div>
                            </td>

                            {/* Status column */}
                            <td className='px-4 py-3'>
                              <div
                                className={`inline-flex items-center justify-center rounded-md px-2 py-1 text-xs ${getStatusBadgeStyles(doc.enabled)}`}
                              >
                                <span className='font-medium'>
                                  {doc.enabled ? 'Enabled' : 'Disabled'}
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
                                        handleToggleEnabled(doc.id)
                                      }}
                                      className='h-8 w-8 p-0 text-gray-500 hover:text-gray-700'
                                    >
                                      {doc.enabled ? (
                                        <Circle className='h-4 w-4' />
                                      ) : (
                                        <CircleOff className='h-4 w-4' />
                                      )}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent side='top'>
                                    {doc.enabled ? 'Disable Document' : 'Enable Document'}
                                  </TooltipContent>
                                </Tooltip>

                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant='ghost'
                                      size='sm'
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleDeleteDocument(doc.id)
                                      }}
                                      className='h-8 w-8 p-0 text-gray-500 hover:text-red-600'
                                    >
                                      <Trash2 className='h-4 w-4' />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent side='top'>Delete Document</TooltipContent>
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
    </div>
  )
}
