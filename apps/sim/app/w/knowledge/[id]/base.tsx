'use client'

import { useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import {
  Circle,
  CircleOff,
  FileText,
  LibraryBig,
  Loader2,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console-logger'
import { getDocumentIcon } from '@/app/w/knowledge/components/icons/document-icons'
import { useSidebarStore } from '@/stores/sidebar/store'
import { KnowledgeBaseLoading } from './components/knowledge-base-loading'

const logger = createLogger('KnowledgeBase')

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
  fileHash: string | null
  chunkCount: number
  tokenCount: number
  characterCount: number
  processingStatus: 'pending' | 'processing' | 'completed' | 'failed'
  processingStartedAt: string | null
  processingCompletedAt: string | null
  processingError: string | null
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
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
}

const getStatusDisplay = (doc: DocumentData) => {
  switch (doc.processingStatus) {
    case 'pending':
      return {
        text: 'Pending',
        className:
          'inline-flex items-center rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300',
      }
    case 'processing':
      return {
        text: 'Processing',
        className:
          'inline-flex items-center rounded-md bg-blue-100 px-2 py-1 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
      }
    case 'completed':
      return {
        text: 'Completed',
        className:
          'inline-flex items-center rounded-md bg-green-100 px-2 py-1 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400',
      }
    case 'failed':
      return {
        text: 'Failed',
        className:
          'inline-flex items-center rounded-md bg-red-100 px-2 py-1 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-300',
      }
    default:
      return {
        text: 'Unknown',
        className:
          'inline-flex items-center rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300',
      }
  }
}

const getProcessingTime = (doc: DocumentData) => {
  if (doc.processingStatus === 'pending') return null
  if (doc.processingStartedAt && doc.processingCompletedAt) {
    const start = new Date(doc.processingStartedAt)
    const end = new Date(doc.processingCompletedAt)
    const durationMs = end.getTime() - start.getTime()
    const durationSec = Math.round(durationMs / 1000)
    return `${durationSec}s`
  }
  if (doc.processingStartedAt && doc.processingStatus === 'processing') {
    const start = new Date(doc.processingStartedAt)
    const now = new Date()
    const durationMs = now.getTime() - start.getTime()
    const durationSec = Math.round(durationMs / 1000)
    return `${durationSec}s`
  }
  return null
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
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

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
        logger.error('Error fetching knowledge base:', err)
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setIsLoadingKnowledgeBase(false)
      }
    }

    if (id) {
      fetchKnowledgeBase()
    }
  }, [id])

  // Fetch documents on component mount and when dependencies change
  useEffect(() => {
    const fetchDocuments = async () => {
      try {
        setIsLoadingDocuments(true)
        setError(null)

        const response = await fetch(`/api/knowledge/${id}/documents`)

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('Knowledge base not found')
          }
          throw new Error(`Failed to fetch documents: ${response.statusText}`)
        }

        const result = await response.json()

        if (result.success) {
          setDocuments(result.data)
        } else {
          throw new Error(result.error || 'Failed to fetch documents')
        }
      } catch (err) {
        logger.error('Error fetching documents:', err)
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setIsLoadingDocuments(false)
      }
    }

    if (id) {
      fetchDocuments()
    }
  }, [id])

  // Auto-refresh documents when there are processing documents
  useEffect(() => {
    const hasProcessingDocuments = documents.some(
      (doc) => doc.processingStatus === 'pending' || doc.processingStatus === 'processing'
    )

    if (!hasProcessingDocuments) return

    const refreshInterval = setInterval(async () => {
      try {
        const response = await fetch(`/api/knowledge/${id}/documents`)
        if (response.ok) {
          const result = await response.json()
          if (result.success) {
            setDocuments(result.data)
          }
        }
      } catch (error) {
        logger.error('Error refreshing documents:', error)
      }
    }, 3000) // Refresh every 3 seconds

    return () => clearInterval(refreshInterval)
  }, [id, documents])

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
      logger.error('Error updating document:', err)
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
      logger.error('Error deleting document:', err)
    }
  }

  const handleRetryDocument = async (docId: string) => {
    const document = documents.find((doc) => doc.id === docId)
    if (!document) return

    try {
      // Update document status to processing immediately for UI feedback
      setDocuments((prev) =>
        prev.map((doc) =>
          doc.id === docId
            ? { ...doc, processingStatus: 'processing' as const, processingError: null }
            : doc
        )
      )

      const response = await fetch(`/api/knowledge/${id}/documents/${docId}/retry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        throw new Error('Failed to retry document processing')
      }

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to retry document processing')
      }

      // The document status will be updated by the auto-refresh mechanism
    } catch (err) {
      logger.error('Error retrying document:', err)
      // Revert the status change on error
      setDocuments((prev) =>
        prev.map((doc) =>
          doc.id === docId ? { ...doc, processingStatus: 'failed' as const } : doc
        )
      )
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

  const handleDeleteKnowledgeBase = async () => {
    if (!knowledgeBase) return

    try {
      setIsDeleting(true)

      const response = await fetch(`/api/knowledge/${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete knowledge base')
      }

      const result = await response.json()

      if (result.success) {
        // Redirect to knowledge bases list
        router.push('/w/knowledge')
      } else {
        throw new Error(result.error || 'Failed to delete knowledge base')
      }
    } catch (err) {
      logger.error('Error deleting knowledge base:', err)
      setIsDeleting(false)
    }
  }

  const handleAddDocuments = () => {
    fileInputRef.current?.click()
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    try {
      setIsUploading(true)

      // Upload all files and start processing
      const uploadedFiles = []

      for (const file of Array.from(files)) {
        const formData = new FormData()
        formData.append('file', file)

        const uploadResponse = await fetch('/api/files/upload', {
          method: 'POST',
          body: formData,
        })

        if (!uploadResponse.ok) {
          const errorData = await uploadResponse.json()
          throw new Error(`Failed to upload ${file.name}: ${errorData.error || 'Unknown error'}`)
        }

        const uploadResult = await uploadResponse.json()
        uploadedFiles.push({
          filename: file.name,
          fileUrl: uploadResult.path.startsWith('http')
            ? uploadResult.path
            : `${window.location.origin}${uploadResult.path}`,
          fileSize: file.size,
          mimeType: file.type,
          fileHash: undefined,
        })
      }

      // Start async document processing
      const processResponse = await fetch(`/api/knowledge/${id}/process-documents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          documents: uploadedFiles,
          processingOptions: {
            chunkSize: 1024,
            minCharactersPerChunk: 24,
            recipe: 'default',
            lang: 'en',
          },
        }),
      })

      if (!processResponse.ok) {
        throw new Error('Failed to start document processing')
      }

      // Refresh documents list to show new uploads
      const documentsResponse = await fetch(`/api/knowledge/${id}/documents`)
      if (documentsResponse.ok) {
        const result = await documentsResponse.json()
        if (result.success) {
          setDocuments(result.data)
        }
      }

      logger.info(`Started processing ${uploadedFiles.length} documents`)
    } catch (err) {
      logger.error('Error uploading documents:', err)
    } finally {
      setIsUploading(false)
      // Reset the file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
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
      <div className='flex items-center justify-between px-6 pt-[14px] pb-6'>
        <div className='flex items-center gap-2'>
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

        {/* Actions Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant='ghost' size='sm' className='h-8 w-8 p-0'>
              <MoreHorizontal className='h-4 w-4' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem
              onClick={() => setShowDeleteDialog(true)}
              className='text-red-600 focus:text-red-600'
            >
              <Trash2 className='mr-2 h-4 w-4' />
              Delete Knowledge Base
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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

                {/* Processing Status Badge */}
                {(() => {
                  const processingDocs = documents.filter(
                    (doc) =>
                      doc.processingStatus === 'pending' || doc.processingStatus === 'processing'
                  )

                  if (processingDocs.length > 0) {
                    return (
                      <div className='flex items-center gap-2'>
                        <div className='inline-flex items-center rounded-md bg-blue-100 px-2 py-1 font-medium text-blue-700 text-xs dark:bg-blue-900/30 dark:text-blue-300'>
                          <Loader2 className='mr-1.5 h-3 w-3 animate-spin' />
                          Processing {processingDocs.length}/{documents.length}
                        </div>
                      </div>
                    )
                  }
                  return null
                })()}
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
                      <col className={`${isSidebarCollapsed ? 'w-[16%]' : 'w-[18%]'}`} />
                      <col className='w-[8%]' />
                      <col className='w-[8%]' />
                      <col className='hidden w-[8%] lg:table-column' />
                      <col className={`${isSidebarCollapsed ? 'w-[20%]' : 'w-[18%]'}`} />
                      <col className='w-[12%]' />
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
                          <span className='text-muted-foreground text-xs leading-none'>
                            Processing
                          </span>
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
                      <col className={`${isSidebarCollapsed ? 'w-[16%]' : 'w-[18%]'}`} />
                      <col className='w-[8%]' />
                      <col className='w-[8%]' />
                      <col className='hidden w-[8%] lg:table-column' />
                      <col className={`${isSidebarCollapsed ? 'w-[20%]' : 'w-[18%]'}`} />
                      <col className='w-[12%]' />
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
                              <>
                                <input
                                  ref={fileInputRef}
                                  type='file'
                                  accept='.pdf,.doc,.docx,.txt,.csv,.xls,.xlsx'
                                  onChange={handleFileUpload}
                                  className='hidden'
                                  multiple
                                />
                                <button
                                  onClick={handleAddDocuments}
                                  disabled={isUploading}
                                  className='inline-flex items-center gap-1 rounded-md bg-[#701FFC] px-2 py-1 font-medium text-primary-foreground text-xs transition-colors hover:bg-[#6518E6] disabled:opacity-50'
                                >
                                  <Plus className='h-3 w-3' />
                                  <span>{isUploading ? 'Uploading...' : 'Add Document'}</span>
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      ) : (
                        filteredDocuments.map((doc, index) => {
                          const isSelected = selectedDocuments.has(doc.id)
                          const statusDisplay = getStatusDisplay(doc)
                          const processingTime = getProcessingTime(doc)

                          return (
                            <tr
                              key={doc.id}
                              className={`border-b transition-colors hover:bg-accent/30 ${
                                isSelected ? 'bg-accent/30' : ''
                              } ${
                                doc.processingStatus === 'completed'
                                  ? 'cursor-pointer'
                                  : 'cursor-default'
                              }`}
                              onClick={() => {
                                if (doc.processingStatus === 'completed') {
                                  handleDocumentClick(doc.id)
                                }
                              }}
                            >
                              {/* Select column */}
                              <td className='px-4 py-3'>
                                <Checkbox
                                  checked={isSelected}
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
                                  {doc.processingStatus === 'completed' ? (
                                    doc.tokenCount > 1000 ? (
                                      `${(doc.tokenCount / 1000).toFixed(1)}k`
                                    ) : (
                                      doc.tokenCount.toLocaleString()
                                    )
                                  ) : (
                                    <div className='text-muted-foreground'>—</div>
                                  )}
                                </div>
                              </td>

                              {/* Chunks column - hidden on small screens */}
                              <td className='hidden px-4 py-3 lg:table-cell'>
                                <div className='text-muted-foreground text-xs'>
                                  {doc.processingStatus === 'completed'
                                    ? doc.chunkCount.toLocaleString()
                                    : '—'}
                                </div>
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
                                <div className='flex items-center gap-2'>
                                  <div className={statusDisplay.className}>
                                    {statusDisplay.text}
                                  </div>
                                </div>
                              </td>

                              {/* Actions column */}
                              <td className='px-4 py-3'>
                                <div className='flex items-center gap-1'>
                                  {doc.processingStatus === 'failed' && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          variant='ghost'
                                          size='sm'
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            handleRetryDocument(doc.id)
                                          }}
                                          className='h-8 w-8 p-0 text-gray-500 hover:text-blue-600'
                                        >
                                          <RotateCcw className='h-4 w-4' />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent side='top'>Retry processing</TooltipContent>
                                    </Tooltip>
                                  )}

                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        variant='ghost'
                                        size='sm'
                                        onClick={(e) => {
                                          e.stopPropagation()
                                          handleToggleEnabled(doc.id)
                                        }}
                                        disabled={
                                          doc.processingStatus === 'processing' ||
                                          doc.processingStatus === 'pending'
                                        }
                                        className='h-8 w-8 p-0 text-gray-500 hover:text-gray-700 disabled:opacity-50'
                                      >
                                        {doc.enabled ? (
                                          <Circle className='h-4 w-4' />
                                        ) : (
                                          <CircleOff className='h-4 w-4' />
                                        )}
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side='top'>
                                      {doc.processingStatus === 'processing' ||
                                      doc.processingStatus === 'pending'
                                        ? 'Cannot modify while processing'
                                        : doc.enabled
                                          ? 'Disable Document'
                                          : 'Enable Document'}
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
                                        disabled={doc.processingStatus === 'processing'}
                                        className='h-8 w-8 p-0 text-gray-500 hover:text-red-600 disabled:opacity-50'
                                      >
                                        <Trash2 className='h-4 w-4' />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side='top'>
                                      {doc.processingStatus === 'processing'
                                        ? 'Cannot delete while processing'
                                        : 'Delete Document'}
                                    </TooltipContent>
                                  </Tooltip>
                                </div>
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Knowledge Base</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{knowledgeBaseName}"? This will permanently delete
              the knowledge base and all {documents.length} document
              {documents.length === 1 ? '' : 's'} within it. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteKnowledgeBase}
              disabled={isDeleting}
              className='bg-red-600 hover:bg-red-700'
            >
              {isDeleting ? 'Deleting...' : 'Delete Knowledge Base'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
