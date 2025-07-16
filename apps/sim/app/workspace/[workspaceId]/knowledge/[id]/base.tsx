'use client'

import { useCallback, useEffect, useState } from 'react'
import { format } from 'date-fns'
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleOff,
  FileText,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
} from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
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
import { SearchHighlight } from '@/components/ui/search-highlight'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console-logger'
import { ActionBar } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/action-bar/action-bar'
import { getDocumentIcon } from '@/app/workspace/[workspaceId]/knowledge/components/icons/document-icons'
import { PrimaryButton } from '@/app/workspace/[workspaceId]/knowledge/components/primary-button/primary-button'
import { SearchInput } from '@/app/workspace/[workspaceId]/knowledge/components/search-input/search-input'
import { useKnowledgeBase, useKnowledgeBaseDocuments } from '@/hooks/use-knowledge'
import { type DocumentData, useKnowledgeStore } from '@/stores/knowledge/store'
import { KnowledgeHeader } from '../components/knowledge-header/knowledge-header'
import { KnowledgeBaseLoading } from './components/knowledge-base-loading/knowledge-base-loading'
import { UploadModal } from './components/upload-modal/upload-modal'

const logger = createLogger('KnowledgeBase')

// Constants
const DOCUMENTS_PER_PAGE = 50

interface KnowledgeBaseProps {
  id: string
  knowledgeBaseName?: string
}

function getFileIcon(mimeType: string, filename: string) {
  const IconComponent = getDocumentIcon(mimeType, filename)
  return <IconComponent className='h-6 w-5 flex-shrink-0' />
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
}

const getStatusDisplay = (doc: DocumentData) => {
  // Consolidated status: show processing status when not completed, otherwise show enabled/disabled
  switch (doc.processingStatus) {
    case 'pending':
      return {
        text: 'Pending',
        className:
          'inline-flex items-center rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300',
      }
    case 'processing':
      return {
        text: (
          <>
            <Loader2 className='mr-1.5 h-3 w-3 animate-spin' />
            Processing
          </>
        ),
        className:
          'inline-flex items-center rounded-md bg-[#701FFC]/10 px-2 py-1 text-xs font-medium text-[#701FFC] dark:bg-[#701FFC]/20 dark:text-[#8B5FFF]',
      }
    case 'failed':
      return {
        text: (
          <>
            Failed
            {doc.processingError && <AlertCircle className='ml-1.5 h-3 w-3' />}
          </>
        ),
        className:
          'inline-flex items-center rounded-md bg-red-100 px-2 py-1 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-300',
      }
    case 'completed':
      return doc.enabled
        ? {
            text: 'Enabled',
            className:
              'inline-flex items-center rounded-md bg-green-100 px-2 py-1 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400',
          }
        : {
            text: 'Disabled',
            className:
              'inline-flex items-center rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300',
          }
    default:
      return {
        text: 'Unknown',
        className:
          'inline-flex items-center rounded-md bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300',
      }
  }
}

export function KnowledgeBase({
  id,
  knowledgeBaseName: passedKnowledgeBaseName,
}: KnowledgeBaseProps) {
  const { removeKnowledgeBase } = useKnowledgeStore()
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const [searchQuery, setSearchQuery] = useState('')

  // Memoize the search query setter to prevent unnecessary re-renders
  const handleSearchChange = useCallback((newQuery: string) => {
    setSearchQuery(newQuery)
    setCurrentPage(1) // Reset to page 1 when searching
  }, [])

  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(new Set())
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isBulkOperating, setIsBulkOperating] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)

  const {
    knowledgeBase,
    isLoading: isLoadingKnowledgeBase,
    error: knowledgeBaseError,
  } = useKnowledgeBase(id)
  const {
    documents,
    pagination,
    isLoading: isLoadingDocuments,
    error: documentsError,
    updateDocument,
    refreshDocuments,
  } = useKnowledgeBaseDocuments(id, {
    search: searchQuery || undefined,
    limit: DOCUMENTS_PER_PAGE,
    offset: (currentPage - 1) * DOCUMENTS_PER_PAGE,
  })

  const router = useRouter()

  const knowledgeBaseName = knowledgeBase?.name || passedKnowledgeBaseName || 'Knowledge Base'
  const error = knowledgeBaseError || documentsError

  // Pagination calculations
  const totalPages = Math.ceil(pagination.total / pagination.limit)
  const hasNextPage = currentPage < totalPages
  const hasPrevPage = currentPage > 1

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

  // Auto-refresh documents when there are processing documents
  useEffect(() => {
    const hasProcessingDocuments = documents.some(
      (doc) => doc.processingStatus === 'pending' || doc.processingStatus === 'processing'
    )

    if (!hasProcessingDocuments) return

    const refreshInterval = setInterval(async () => {
      try {
        // Only refresh if we're not in the middle of other operations
        if (!isDeleting) {
          // Check for dead processes before refreshing
          await checkForDeadProcesses()
          await refreshDocuments()
        }
      } catch (error) {
        logger.error('Error refreshing documents:', error)
      }
    }, 3000) // Refresh every 3 seconds

    return () => clearInterval(refreshInterval)
  }, [documents, refreshDocuments, isDeleting])

  // Check for documents stuck in processing due to dead processes
  const checkForDeadProcesses = async () => {
    const now = new Date()
    const DEAD_PROCESS_THRESHOLD_MS = 150 * 1000 // 150 seconds (2.5 minutes)

    const staleDocuments = documents.filter((doc) => {
      if (doc.processingStatus !== 'processing' || !doc.processingStartedAt) {
        return false
      }

      const processingDuration = now.getTime() - new Date(doc.processingStartedAt).getTime()
      return processingDuration > DEAD_PROCESS_THRESHOLD_MS
    })

    if (staleDocuments.length === 0) return

    logger.warn(`Found ${staleDocuments.length} documents with dead processes`)

    // Mark stale documents as failed via API to sync with database
    const markFailedPromises = staleDocuments.map(async (doc) => {
      try {
        const response = await fetch(`/api/knowledge/${id}/documents/${doc.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            markFailedDueToTimeout: true,
          }),
        })

        if (!response.ok) {
          // If API call fails, log but don't throw to avoid stopping other recoveries
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
          logger.error(`Failed to mark document ${doc.id} as failed: ${errorData.error}`)
          return
        }

        const result = await response.json()
        if (result.success) {
          logger.info(`Successfully marked dead process as failed for document: ${doc.filename}`)
        }
      } catch (error) {
        logger.error(`Error marking document ${doc.id} as failed:`, error)
      }
    })

    await Promise.allSettled(markFailedPromises)
  }

  // Calculate pagination info for display
  const totalItems = pagination?.total || 0

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
        // Update the document in the store
        updateDocument(docId, { enabled: !document.enabled })
      }
    } catch (err) {
      logger.error('Error updating document:', err)
    }
  }

  const handleRetryDocument = async (docId: string) => {
    try {
      // Optimistically update the document status
      updateDocument(docId, {
        processingStatus: 'pending',
        processingError: null,
        processingStartedAt: null,
        processingCompletedAt: null,
      })

      const response = await fetch(`/api/knowledge/${id}/documents/${docId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          retryProcessing: true,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to retry document processing')
      }

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to retry document processing')
      }

      // Immediately refresh to get the current DB state
      await refreshDocuments()

      // Set up a single interval-based refresh to catch the status transition from pending -> processing
      let refreshAttempts = 0
      const maxRefreshAttempts = 3
      const refreshInterval = setInterval(async () => {
        try {
          refreshAttempts++
          await refreshDocuments()
          if (refreshAttempts >= maxRefreshAttempts) {
            clearInterval(refreshInterval)
          }
        } catch (error) {
          logger.error('Error refreshing documents after retry:', error)
          clearInterval(refreshInterval)
        }
      }, 1000) // Check every second for 3 seconds

      // Clear interval after maximum time to prevent memory leaks
      setTimeout(() => {
        clearInterval(refreshInterval)
      }, 4000)

      logger.info(`Document retry initiated successfully for: ${docId}`)
    } catch (err) {
      logger.error('Error retrying document:', err)
      // Revert the status change on error - get the current document first to avoid overwriting other fields
      const currentDoc = documents.find((doc) => doc.id === docId)
      if (currentDoc) {
        updateDocument(docId, {
          processingStatus: 'failed',
          processingError:
            err instanceof Error ? err.message : 'Failed to retry document processing',
        })
      }
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
        // Invalidate and refresh documents to update the list
        refreshDocuments()

        // Clear selected documents
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
      setSelectedDocuments(new Set(documents.map((doc) => doc.id)))
    } else {
      setSelectedDocuments(new Set())
    }
  }

  const isAllSelected = documents.length > 0 && selectedDocuments.size === documents.length

  const handleDocumentClick = (docId: string) => {
    // Find the document to get its filename
    const document = documents.find((doc) => doc.id === docId)
    const urlParams = new URLSearchParams({
      kbName: knowledgeBaseName, // Use the instantly available name
      docName: document?.filename || 'Document',
    })
    router.push(`/workspace/${workspaceId}/knowledge/${id}/${docId}?${urlParams.toString()}`)
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
        // Remove from store and redirect to knowledge bases list
        removeKnowledgeBase(id)
        router.push(`/workspace/${workspaceId}/knowledge`)
      } else {
        throw new Error(result.error || 'Failed to delete knowledge base')
      }
    } catch (err) {
      logger.error('Error deleting knowledge base:', err)
      setIsDeleting(false)
    }
  }

  const handleAddDocuments = () => {
    setShowUploadModal(true)
  }

  const handleBulkEnable = async () => {
    const documentsToEnable = documents.filter(
      (doc) => selectedDocuments.has(doc.id) && !doc.enabled
    )

    if (documentsToEnable.length === 0) return

    try {
      setIsBulkOperating(true)

      const response = await fetch(`/api/knowledge/${id}/documents`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operation: 'enable',
          documentIds: documentsToEnable.map((doc) => doc.id),
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to enable documents')
      }

      const result = await response.json()

      if (result.success) {
        // Update successful documents in the store
        result.data.updatedDocuments.forEach((updatedDoc: { id: string; enabled: boolean }) => {
          updateDocument(updatedDoc.id, { enabled: updatedDoc.enabled })
        })

        logger.info(`Successfully enabled ${result.data.successCount} documents`)
      }

      // Clear selection after successful operation
      setSelectedDocuments(new Set())
    } catch (err) {
      logger.error('Error enabling documents:', err)
    } finally {
      setIsBulkOperating(false)
    }
  }

  const handleBulkDisable = async () => {
    const documentsToDisable = documents.filter(
      (doc) => selectedDocuments.has(doc.id) && doc.enabled
    )

    if (documentsToDisable.length === 0) return

    try {
      setIsBulkOperating(true)

      const response = await fetch(`/api/knowledge/${id}/documents`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operation: 'disable',
          documentIds: documentsToDisable.map((doc) => doc.id),
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to disable documents')
      }

      const result = await response.json()

      if (result.success) {
        // Update successful documents in the store
        result.data.updatedDocuments.forEach((updatedDoc: { id: string; enabled: boolean }) => {
          updateDocument(updatedDoc.id, { enabled: updatedDoc.enabled })
        })

        logger.info(`Successfully disabled ${result.data.successCount} documents`)
      }

      // Clear selection after successful operation
      setSelectedDocuments(new Set())
    } catch (err) {
      logger.error('Error disabling documents:', err)
    } finally {
      setIsBulkOperating(false)
    }
  }

  const handleBulkDelete = async () => {
    const documentsToDelete = documents.filter((doc) => selectedDocuments.has(doc.id))

    if (documentsToDelete.length === 0) return

    try {
      setIsBulkOperating(true)

      const response = await fetch(`/api/knowledge/${id}/documents`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          operation: 'delete',
          documentIds: documentsToDelete.map((doc) => doc.id),
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to delete documents')
      }

      const result = await response.json()

      if (result.success) {
        logger.info(`Successfully deleted ${result.data.successCount} documents`)
      }

      // Refresh documents list to reflect deletions
      await refreshDocuments()

      // Clear selection after successful operation
      setSelectedDocuments(new Set())
    } catch (err) {
      logger.error('Error deleting documents:', err)
    } finally {
      setIsBulkOperating(false)
    }
  }

  // Calculate bulk operation counts
  const selectedDocumentsList = documents.filter((doc) => selectedDocuments.has(doc.id))
  const enabledCount = selectedDocumentsList.filter((doc) => doc.enabled).length
  const disabledCount = selectedDocumentsList.filter((doc) => !doc.enabled).length

  // Breadcrumbs for the knowledge base page
  const breadcrumbs = [
    {
      id: 'knowledge-root',
      label: 'Knowledge',
      href: `/workspace/${workspaceId}/knowledge`,
    },
    {
      id: `knowledge-base-${id}`,
      label: knowledgeBaseName,
    },
  ]

  // Show loading component while data is being fetched initially
  if ((isLoadingKnowledgeBase || isLoadingDocuments) && !knowledgeBase && documents.length === 0) {
    return <KnowledgeBaseLoading knowledgeBaseName={knowledgeBaseName} />
  }

  // Show error state for knowledge base fetch
  if (error && !knowledgeBase) {
    const errorBreadcrumbs = [
      {
        id: 'knowledge-root',
        label: 'Knowledge',
        href: `/workspace/${workspaceId}/knowledge`,
      },
      {
        id: 'error',
        label: 'Error',
      },
    ]

    return (
      <div className='flex h-[100vh] flex-col pl-64'>
        <KnowledgeHeader breadcrumbs={errorBreadcrumbs} />
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
    <div className='flex h-[100vh] flex-col pl-64'>
      {/* Fixed Header with Breadcrumbs */}
      <KnowledgeHeader
        breadcrumbs={breadcrumbs}
        options={{ onDeleteKnowledgeBase: () => setShowDeleteDialog(true) }}
      />

      <div className='flex flex-1 overflow-hidden'>
        <div className='flex flex-1 flex-col overflow-hidden'>
          {/* Main Content */}
          <div className='flex-1 overflow-auto'>
            <div className='px-6 pb-6'>
              {/* Search and Filters Section */}
              <div className='mb-4 space-y-3 pt-1'>
                <div className='flex items-center justify-between'>
                  <SearchInput
                    value={searchQuery}
                    onChange={handleSearchChange}
                    placeholder='Search documents...'
                  />

                  <div className='flex items-center gap-3'>
                    {/* Clear Search Button */}
                    {searchQuery && (
                      <button
                        onClick={() => {
                          setSearchQuery('')
                          setCurrentPage(1)
                        }}
                        className='text-muted-foreground text-sm hover:text-foreground'
                      >
                        Clear search
                      </button>
                    )}

                    {/* Add Documents Button */}
                    <PrimaryButton onClick={handleAddDocuments}>
                      <Plus className='h-3.5 w-3.5' />
                      Add Documents
                    </PrimaryButton>
                  </div>
                </div>
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
                <div className='sticky top-0 z-10 overflow-x-auto border-b bg-background'>
                  <table className='w-full min-w-[700px] table-fixed'>
                    <colgroup>
                      <col className='w-[4%]' />
                      <col className='w-[24%]' />
                      <col className='w-[8%]' />
                      <col className='w-[8%]' />
                      <col className='hidden w-[8%] lg:table-column' />
                      <col className='w-[16%]' />
                      <col className='w-[12%]' />
                      <col className='w-[14%]' />
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
                  <table className='w-full min-w-[700px] table-fixed'>
                    <colgroup>
                      <col className='w-[4%]' />
                      <col className='w-[24%]' />
                      <col className='w-[8%]' />
                      <col className='w-[8%]' />
                      <col className='hidden w-[8%] lg:table-column' />
                      <col className='w-[16%]' />
                      <col className='w-[12%]' />
                      <col className='w-[14%]' />
                    </colgroup>
                    <tbody>
                      {documents.length === 0 && !isLoadingDocuments ? (
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
                                {totalItems === 0
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
                            <div className='text-muted-foreground text-xs'>—</div>
                          </td>
                        </tr>
                      ) : isLoadingDocuments && documents.length === 0 ? (
                        Array.from({ length: 5 }).map((_, index) => (
                          <tr key={`loading-${index}`} className='border-b transition-colors'>
                            <td className='px-4 py-3'>
                              <div className='h-3.5 w-3.5 animate-pulse rounded bg-muted' />
                            </td>
                            <td className='px-4 py-3'>
                              <div className='h-4 w-32 animate-pulse rounded bg-muted' />
                            </td>
                            <td className='px-4 py-3'>
                              <div className='h-4 w-16 animate-pulse rounded bg-muted' />
                            </td>
                            <td className='px-4 py-3'>
                              <div className='h-4 w-12 animate-pulse rounded bg-muted' />
                            </td>
                            <td className='hidden px-4 py-3 lg:table-cell'>
                              <div className='h-4 w-12 animate-pulse rounded bg-muted' />
                            </td>
                            <td className='px-4 py-3'>
                              <div className='h-4 w-20 animate-pulse rounded bg-muted' />
                            </td>
                            <td className='px-4 py-3'>
                              <div className='h-4 w-16 animate-pulse rounded bg-muted' />
                            </td>
                            <td className='px-4 py-3'>
                              <div className='h-4 w-20 animate-pulse rounded bg-muted' />
                            </td>
                          </tr>
                        ))
                      ) : (
                        documents.map((doc) => {
                          const isSelected = selectedDocuments.has(doc.id)
                          const statusDisplay = getStatusDisplay(doc)
                          // const processingTime = getProcessingTime(doc)

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
                                        <SearchHighlight
                                          text={doc.filename}
                                          searchQuery={searchQuery}
                                        />
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
                                {doc.processingStatus === 'failed' && doc.processingError ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div
                                        className={statusDisplay.className}
                                        style={{ cursor: 'help' }}
                                      >
                                        {statusDisplay.text}
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent side='top' className='max-w-xs'>
                                      {doc.processingError}
                                    </TooltipContent>
                                  </Tooltip>
                                ) : (
                                  <div className={statusDisplay.className}>
                                    {statusDisplay.text}
                                  </div>
                                )}
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
                                          className='h-8 w-8 p-0 text-gray-500 hover:text-gray-700'
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

                {/* Pagination Controls */}
                {totalPages > 1 && (
                  <div className='flex items-center justify-center border-t bg-background px-6 py-4'>
                    <div className='flex items-center gap-1'>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={prevPage}
                        disabled={!hasPrevPage || isLoadingDocuments}
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
                              disabled={isLoadingDocuments}
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
                        disabled={!hasNextPage || isLoadingDocuments}
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

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Knowledge Base</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{knowledgeBaseName}"? This will permanently delete
              the knowledge base and all {totalItems} document
              {totalItems === 1 ? '' : 's'} within it. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteKnowledgeBase}
              disabled={isDeleting}
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            >
              {isDeleting ? 'Deleting...' : 'Delete Knowledge Base'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Upload Modal */}
      <UploadModal
        open={showUploadModal}
        onOpenChange={setShowUploadModal}
        knowledgeBaseId={id}
        chunkingConfig={knowledgeBase?.chunkingConfig}
        onUploadComplete={refreshDocuments}
      />

      {/* Bulk Action Bar */}
      <ActionBar
        selectedCount={selectedDocuments.size}
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
