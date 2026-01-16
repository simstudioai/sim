'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import {
  AlertCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  CircleOff,
  Loader2,
  RotateCcw,
  Search,
  X,
} from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import {
  Badge,
  Breadcrumb,
  Button,
  Checkbox,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  Trash,
} from '@/components/emcn'
import { Input } from '@/components/ui/input'
import { SearchHighlight } from '@/components/ui/search-highlight'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/core/utils/cn'
import type { DocumentSortField, SortOrder } from '@/lib/knowledge/documents/types'
import type { DocumentData } from '@/lib/knowledge/types'
import {
  ActionBar,
  AddDocumentsModal,
  BaseTagsModal,
  DocumentContextMenu,
  RenameDocumentModal,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/components'
import { getDocumentIcon } from '@/app/workspace/[workspaceId]/knowledge/components'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import {
  useKnowledgeBase,
  useKnowledgeBaseDocuments,
  useKnowledgeBasesList,
} from '@/hooks/kb/use-knowledge'
import {
  type TagDefinition,
  useKnowledgeBaseTagDefinitions,
} from '@/hooks/kb/use-knowledge-base-tag-definitions'
import { knowledgeKeys } from '@/hooks/queries/knowledge'

const logger = createLogger('KnowledgeBase')

const DOCUMENTS_PER_PAGE = 50

function DocumentTableRowSkeleton() {
  return (
    <TableRow className='hover:bg-transparent'>
      <TableCell className='w-[28px] py-[8px] pr-0 pl-0'>
        <div className='flex items-center justify-center'>
          <Skeleton className='h-[14px] w-[14px] rounded-[2px]' />
        </div>
      </TableCell>
      <TableCell className='w-[180px] max-w-[180px] px-[12px] py-[8px]'>
        <div className='flex min-w-0 items-center gap-[8px]'>
          <Skeleton className='h-6 w-5 flex-shrink-0 rounded-[2px]' />
          <Skeleton className='h-[17px] w-[120px]' />
        </div>
      </TableCell>
      <TableCell className='hidden px-[12px] py-[8px] lg:table-cell'>
        <Skeleton className='h-[15px] w-[48px]' />
      </TableCell>
      <TableCell className='hidden px-[12px] py-[8px] lg:table-cell'>
        <Skeleton className='h-[15px] w-[32px]' />
      </TableCell>
      <TableCell className='px-[12px] py-[8px]'>
        <Skeleton className='h-[15px] w-[24px]' />
      </TableCell>
      <TableCell className='px-[12px] py-[8px]'>
        <Skeleton className='h-[15px] w-[60px]' />
      </TableCell>
      <TableCell className='px-[12px] py-[8px]'>
        <Skeleton className='h-[24px] w-[64px] rounded-md' />
      </TableCell>
      <TableCell className='px-[12px] py-[8px]'>
        <div className='flex items-center gap-[4px]'>
          <Skeleton className='h-[18px] w-[40px] rounded-full' />
          <Skeleton className='h-[18px] w-[40px] rounded-full' />
        </div>
      </TableCell>
      <TableCell className='py-[8px] pr-[4px] pl-[12px]'>
        <div className='flex items-center gap-[4px]'>
          <Skeleton className='h-[28px] w-[28px] rounded-[4px]' />
          <Skeleton className='h-[28px] w-[28px] rounded-[4px]' />
        </div>
      </TableCell>
    </TableRow>
  )
}

function DocumentTableSkeleton({ rowCount = 5 }: { rowCount?: number }) {
  return (
    <Table className='min-w-[700px] table-fixed text-[13px]'>
      <TableHeader>
        <TableRow className='hover:bg-transparent'>
          <TableHead className='w-[28px] py-[8px] pr-0 pl-0'>
            <div className='flex items-center justify-center'>
              <Skeleton className='h-[14px] w-[14px] rounded-[2px]' />
            </div>
          </TableHead>
          <TableHead className='w-[180px] max-w-[180px] px-[12px] py-[8px] text-[12px] text-[var(--text-secondary)]'>
            Name
          </TableHead>
          <TableHead className='hidden w-[8%] px-[12px] py-[8px] text-[12px] text-[var(--text-secondary)] lg:table-cell'>
            Size
          </TableHead>
          <TableHead className='hidden w-[8%] px-[12px] py-[8px] text-[12px] text-[var(--text-secondary)] lg:table-cell'>
            Tokens
          </TableHead>
          <TableHead className='w-[8%] px-[12px] py-[8px] text-[12px] text-[var(--text-secondary)]'>
            Chunks
          </TableHead>
          <TableHead className='w-[11%] px-[12px] py-[8px] text-[12px] text-[var(--text-secondary)]'>
            Uploaded
          </TableHead>
          <TableHead className='w-[10%] px-[12px] py-[8px] text-[12px] text-[var(--text-secondary)]'>
            Status
          </TableHead>
          <TableHead className='w-[12%] px-[12px] py-[8px] text-[12px] text-[var(--text-secondary)]'>
            Tags
          </TableHead>
          <TableHead className='w-[11%] py-[8px] pr-[4px] pl-[12px] text-[12px] text-[var(--text-secondary)]'>
            Actions
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: rowCount }).map((_, i) => (
          <DocumentTableRowSkeleton key={i} />
        ))}
      </TableBody>
    </Table>
  )
}

interface KnowledgeBaseLoadingProps {
  knowledgeBaseName: string
}

function KnowledgeBaseLoading({ knowledgeBaseName }: KnowledgeBaseLoadingProps) {
  const params = useParams()
  const workspaceId = params?.workspaceId as string

  const breadcrumbItems = [
    { label: 'Knowledge Base', href: `/workspace/${workspaceId}/knowledge` },
    { label: knowledgeBaseName },
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
            <Skeleton className='h-[21px] w-[300px] rounded-[4px]' />
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
                placeholder='Search documents...'
                disabled
                className='flex-1 border-0 bg-transparent px-0 font-medium text-[var(--text-secondary)] text-small leading-none placeholder:text-[var(--text-subtle)] focus-visible:ring-0 focus-visible:ring-offset-0'
              />
            </div>
            <Button disabled variant='tertiary' className='h-[32px] rounded-[6px]'>
              Add Documents
            </Button>
          </div>

          <div className='mt-[12px] flex flex-1 flex-col overflow-hidden'>
            <DocumentTableSkeleton rowCount={8} />
          </div>
        </div>
      </div>
    </div>
  )
}

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

const AnimatedLoader = ({ className }: { className?: string }) => (
  <Loader2 className={cn(className, 'animate-spin')} />
)

const getStatusBadge = (doc: DocumentData) => {
  switch (doc.processingStatus) {
    case 'pending':
      return (
        <Badge variant='gray' size='sm'>
          Pending
        </Badge>
      )
    case 'processing':
      return (
        <Badge variant='purple' size='sm' icon={AnimatedLoader}>
          Processing
        </Badge>
      )
    case 'failed':
      return doc.processingError ? (
        <Badge variant='red' size='sm' icon={AlertCircle}>
          Failed
        </Badge>
      ) : (
        <Badge variant='red' size='sm'>
          Failed
        </Badge>
      )
    case 'completed':
      return doc.enabled ? (
        <Badge variant='green' size='sm'>
          Enabled
        </Badge>
      ) : (
        <Badge variant='gray' size='sm'>
          Disabled
        </Badge>
      )
    default:
      return (
        <Badge variant='gray' size='sm'>
          Unknown
        </Badge>
      )
  }
}

const TAG_SLOTS = [
  'tag1',
  'tag2',
  'tag3',
  'tag4',
  'tag5',
  'tag6',
  'tag7',
  'number1',
  'number2',
  'number3',
  'number4',
  'number5',
  'date1',
  'date2',
  'boolean1',
  'boolean2',
  'boolean3',
] as const

type TagSlot = (typeof TAG_SLOTS)[number]

interface TagValue {
  slot: TagSlot
  displayName: string
  value: string
}

const TAG_FIELD_TYPES: Record<string, string> = {
  tag: 'text',
  number: 'number',
  date: 'date',
  boolean: 'boolean',
}

/**
 * Computes tag values for a document
 */
function getDocumentTags(doc: DocumentData, definitions: TagDefinition[]): TagValue[] {
  const result: TagValue[] = []

  for (const slot of TAG_SLOTS) {
    const raw = doc[slot]
    if (raw == null) continue

    const def = definitions.find((d) => d.tagSlot === slot)
    const fieldType = def?.fieldType || TAG_FIELD_TYPES[slot.replace(/\d+$/, '')] || 'text'

    let value: string
    if (fieldType === 'date') {
      try {
        value = format(new Date(raw as string), 'MMM d, yyyy')
      } catch {
        value = String(raw)
      }
    } else if (fieldType === 'boolean') {
      value = raw ? 'Yes' : 'No'
    } else if (fieldType === 'number' && typeof raw === 'number') {
      value = raw.toLocaleString()
    } else {
      value = String(raw)
    }

    if (value) {
      result.push({ slot, displayName: def?.displayName || slot, value })
    }
  }

  return result
}

export function KnowledgeBase({
  id,
  knowledgeBaseName: passedKnowledgeBaseName,
}: KnowledgeBaseProps) {
  const queryClient = useQueryClient()
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const { removeKnowledgeBase } = useKnowledgeBasesList(workspaceId, { enabled: false })
  const userPermissions = useUserPermissionsContext()

  const [searchQuery, setSearchQuery] = useState('')
  const [showTagsModal, setShowTagsModal] = useState(false)

  /**
   * Memoize the search query setter to prevent unnecessary re-renders
   */
  const handleSearchChange = useCallback((newQuery: string) => {
    setSearchQuery(newQuery)
    setCurrentPage(1)
  }, [])

  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(new Set())
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showAddDocumentsModal, setShowAddDocumentsModal] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isBulkOperating, setIsBulkOperating] = useState(false)
  const [showDeleteDocumentModal, setShowDeleteDocumentModal] = useState(false)
  const [documentToDelete, setDocumentToDelete] = useState<string | null>(null)
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [sortBy, setSortBy] = useState<DocumentSortField>('uploadedAt')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const [contextMenuDocument, setContextMenuDocument] = useState<DocumentData | null>(null)
  const [showRenameModal, setShowRenameModal] = useState(false)
  const [documentToRename, setDocumentToRename] = useState<DocumentData | null>(null)

  const {
    isOpen: isContextMenuOpen,
    position: contextMenuPosition,
    menuRef,
    handleContextMenu: baseHandleContextMenu,
    closeMenu: closeContextMenu,
  } = useContextMenu()

  const {
    knowledgeBase,
    isLoading: isLoadingKnowledgeBase,
    error: knowledgeBaseError,
    refresh: refreshKnowledgeBase,
  } = useKnowledgeBase(id)
  const [hasProcessingDocuments, setHasProcessingDocuments] = useState(false)

  const {
    documents,
    pagination,
    isLoading: isLoadingDocuments,
    isFetching: isFetchingDocuments,
    isPlaceholderData: isPlaceholderDocuments,
    error: documentsError,
    updateDocument,
    refreshDocuments,
  } = useKnowledgeBaseDocuments(id, {
    search: searchQuery || undefined,
    limit: DOCUMENTS_PER_PAGE,
    offset: (currentPage - 1) * DOCUMENTS_PER_PAGE,
    sortBy,
    sortOrder,
    refetchInterval: hasProcessingDocuments && !isDeleting ? 3000 : false,
  })

  const { tagDefinitions } = useKnowledgeBaseTagDefinitions(id)

  const router = useRouter()

  const knowledgeBaseName = knowledgeBase?.name || passedKnowledgeBaseName || 'Knowledge Base'
  const error = knowledgeBaseError || documentsError

  const totalPages = Math.ceil(pagination.total / pagination.limit)
  const hasNextPage = currentPage < totalPages
  const hasPrevPage = currentPage > 1

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

  const handleSort = useCallback(
    (field: DocumentSortField) => {
      if (sortBy === field) {
        setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
      } else {
        setSortBy(field)
        setSortOrder('desc')
      }
      setCurrentPage(1)
    },
    [sortBy, sortOrder]
  )

  const renderSortableHeader = (field: DocumentSortField, label: string, className = '') => (
    <TableHead className={`px-[12px] py-[8px] ${className}`}>
      <button
        type='button'
        onClick={() => handleSort(field)}
        className='flex items-center gap-[4px] text-[12px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]'
      >
        <span>{label}</span>
        {sortBy === field &&
          (sortOrder === 'asc' ? (
            <ChevronUp className='h-[12px] w-[12px]' />
          ) : (
            <ChevronDown className='h-[12px] w-[12px]' />
          ))}
      </button>
    </TableHead>
  )

  useEffect(() => {
    const processing = documents.some(
      (doc) => doc.processingStatus === 'pending' || doc.processingStatus === 'processing'
    )
    setHasProcessingDocuments(processing)

    if (processing) {
      checkForDeadProcesses()
    }
  }, [documents])

  /**
   * Checks for documents with stale processing states and marks them as failed
   */
  const checkForDeadProcesses = async () => {
    const now = new Date()
    const DEAD_PROCESS_THRESHOLD_MS = 600 * 1000 // 10 minutes

    const staleDocuments = documents.filter((doc) => {
      if (doc.processingStatus !== 'processing' || !doc.processingStartedAt) {
        return false
      }

      const processingDuration = now.getTime() - new Date(doc.processingStartedAt).getTime()
      return processingDuration > DEAD_PROCESS_THRESHOLD_MS
    })

    if (staleDocuments.length === 0) return

    logger.warn(`Found ${staleDocuments.length} documents with dead processes`)

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

  const handleToggleEnabled = async (docId: string) => {
    const document = documents.find((doc) => doc.id === docId)
    if (!document) return

    const newEnabled = !document.enabled

    updateDocument(docId, { enabled: newEnabled })

    try {
      const response = await fetch(`/api/knowledge/${id}/documents/${docId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          enabled: newEnabled,
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to update document')
      }

      const result = await response.json()

      if (!result.success) {
        updateDocument(docId, { enabled: !newEnabled })
      }
    } catch (err) {
      updateDocument(docId, { enabled: !newEnabled })
      logger.error('Error updating document:', err)
    }
  }

  /**
   * Handles retrying a failed document processing
   */
  const handleRetryDocument = async (docId: string) => {
    try {
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

      await refreshDocuments()

      logger.info(`Document retry initiated successfully for: ${docId}`)
    } catch (err) {
      logger.error('Error retrying document:', err)
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

  /**
   * Opens the rename document modal
   */
  const handleRenameDocument = (doc: DocumentData) => {
    setDocumentToRename(doc)
    setShowRenameModal(true)
  }

  /**
   * Saves the renamed document
   */
  const handleSaveRename = async (documentId: string, newName: string) => {
    const currentDoc = documents.find((doc) => doc.id === documentId)
    const previousName = currentDoc?.filename

    updateDocument(documentId, { filename: newName })
    queryClient.setQueryData<DocumentData>(knowledgeKeys.document(id, documentId), (previous) =>
      previous ? { ...previous, filename: newName } : previous
    )

    try {
      const response = await fetch(`/api/knowledge/${id}/documents/${documentId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ filename: newName }),
      })

      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Failed to rename document')
      }

      const result = await response.json()

      if (!result.success) {
        throw new Error(result.error || 'Failed to rename document')
      }

      logger.info(`Document renamed: ${documentId}`)
    } catch (err) {
      if (previousName !== undefined) {
        updateDocument(documentId, { filename: previousName })
        queryClient.setQueryData<DocumentData>(
          knowledgeKeys.document(id, documentId),
          (previous) => (previous ? { ...previous, filename: previousName } : previous)
        )
      }
      logger.error('Error renaming document:', err)
      throw err
    }
  }

  /**
   * Opens the delete document confirmation modal
   */
  const handleDeleteDocument = (docId: string) => {
    setDocumentToDelete(docId)
    setShowDeleteDocumentModal(true)
  }

  /**
   * Confirms and executes the deletion of a single document
   */
  const confirmDeleteDocument = async () => {
    if (!documentToDelete) return

    try {
      const response = await fetch(`/api/knowledge/${id}/documents/${documentToDelete}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete document')
      }

      const result = await response.json()

      if (result.success) {
        refreshDocuments()

        setSelectedDocuments((prev) => {
          const newSet = new Set(prev)
          newSet.delete(documentToDelete)
          return newSet
        })
      }
    } catch (err) {
      logger.error('Error deleting document:', err)
    } finally {
      setShowDeleteDocumentModal(false)
      setDocumentToDelete(null)
    }
  }

  /**
   * Handles selecting/deselecting a document
   */
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

  /**
   * Handles selecting/deselecting all documents
   */
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedDocuments(new Set(documents.map((doc) => doc.id)))
    } else {
      setSelectedDocuments(new Set())
    }
  }

  const isAllSelected = documents.length > 0 && selectedDocuments.size === documents.length

  /**
   * Handles clicking on a document row to navigate to detail view
   */
  const handleDocumentClick = (docId: string) => {
    const document = documents.find((doc) => doc.id === docId)
    const urlParams = new URLSearchParams({
      kbName: knowledgeBaseName,
      docName: document?.filename || 'Document',
    })
    router.push(`/workspace/${workspaceId}/knowledge/${id}/${docId}?${urlParams.toString()}`)
  }

  /**
   * Handles deleting the entire knowledge base
   */
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

  /**
   * Opens the add documents modal
   */
  const handleAddDocuments = () => {
    setShowAddDocumentsModal(true)
  }

  /**
   * Handles bulk enabling of selected documents
   */
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
        result.data.updatedDocuments.forEach((updatedDoc: { id: string; enabled: boolean }) => {
          updateDocument(updatedDoc.id, { enabled: updatedDoc.enabled })
        })

        logger.info(`Successfully enabled ${result.data.successCount} documents`)
      }

      setSelectedDocuments(new Set())
    } catch (err) {
      logger.error('Error enabling documents:', err)
    } finally {
      setIsBulkOperating(false)
    }
  }

  /**
   * Handles bulk disabling of selected documents
   */
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
        result.data.updatedDocuments.forEach((updatedDoc: { id: string; enabled: boolean }) => {
          updateDocument(updatedDoc.id, { enabled: updatedDoc.enabled })
        })

        logger.info(`Successfully disabled ${result.data.successCount} documents`)
      }

      setSelectedDocuments(new Set())
    } catch (err) {
      logger.error('Error disabling documents:', err)
    } finally {
      setIsBulkOperating(false)
    }
  }

  /**
   * Opens the bulk delete confirmation modal
   */
  const handleBulkDelete = () => {
    if (selectedDocuments.size === 0) return
    setShowBulkDeleteModal(true)
  }

  /**
   * Confirms and executes the bulk deletion of selected documents
   */
  const confirmBulkDelete = async () => {
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

      await refreshDocuments()

      setSelectedDocuments(new Set())
    } catch (err) {
      logger.error('Error deleting documents:', err)
    } finally {
      setIsBulkOperating(false)
      setShowBulkDeleteModal(false)
    }
  }

  const selectedDocumentsList = documents.filter((doc) => selectedDocuments.has(doc.id))
  const enabledCount = selectedDocumentsList.filter((doc) => doc.enabled).length
  const disabledCount = selectedDocumentsList.filter((doc) => !doc.enabled).length

  /**
   * Handle right-click on a document row
   * If right-clicking on an unselected document, select only that document
   * If right-clicking on a selected document with multiple selections, keep all selections
   */
  const handleDocumentContextMenu = useCallback(
    (e: React.MouseEvent, doc: DocumentData) => {
      const isCurrentlySelected = selectedDocuments.has(doc.id)

      if (!isCurrentlySelected) {
        setSelectedDocuments(new Set([doc.id]))
      }

      setContextMenuDocument(doc)
      baseHandleContextMenu(e)
    },
    [selectedDocuments, baseHandleContextMenu]
  )

  /**
   * Handle right-click on empty space (table container)
   */
  const handleEmptyContextMenu = useCallback(
    (e: React.MouseEvent) => {
      setContextMenuDocument(null)
      baseHandleContextMenu(e)
    },
    [baseHandleContextMenu]
  )

  /**
   * Handle context menu close
   */
  const handleContextMenuClose = useCallback(() => {
    closeContextMenu()
    setContextMenuDocument(null)
  }, [closeContextMenu])

  const prevKnowledgeBaseIdRef = useRef<string>(id)
  const isNavigatingToNewKB = prevKnowledgeBaseIdRef.current !== id

  useEffect(() => {
    if (knowledgeBase && knowledgeBase.id === id) {
      prevKnowledgeBaseIdRef.current = id
    }
  }, [knowledgeBase, id])

  const isInitialLoad = isLoadingKnowledgeBase && !knowledgeBase
  const isFetchingNewKB = isNavigatingToNewKB && isFetchingDocuments

  if (isInitialLoad || isFetchingNewKB) {
    return <KnowledgeBaseLoading knowledgeBaseName={knowledgeBaseName} />
  }

  const breadcrumbItems = [
    { label: 'Knowledge Base', href: `/workspace/${workspaceId}/knowledge` },
    { label: knowledgeBaseName },
  ]

  if (error && !knowledgeBase) {
    return (
      <div className='flex h-full flex-1 flex-col'>
        <div className='flex flex-1 overflow-hidden'>
          <div className='flex flex-1 flex-col overflow-auto px-[24px] pt-[24px] pb-[24px]'>
            <Breadcrumb items={breadcrumbItems} />

            <div className='mt-[24px]'>
              <div className='flex h-64 items-center justify-center rounded-lg border border-muted-foreground/25 bg-muted/20'>
                <div className='text-center'>
                  <p className='font-medium text-[var(--text-secondary)] text-sm'>
                    Error loading knowledge base
                  </p>
                  <p className='mt-1 text-[var(--text-muted)] text-xs'>{error}</p>
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
              {knowledgeBaseName}
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
                    onClick={() => setShowDeleteDialog(true)}
                    disabled={!userPermissions.canEdit}
                    className='h-[32px] rounded-[6px]'
                  >
                    <Trash className='h-[14px] w-[14px]' />
                  </Button>
                </Tooltip.Trigger>
                {!userPermissions.canEdit && (
                  <Tooltip.Content>
                    Write permission required to delete knowledge base
                  </Tooltip.Content>
                )}
              </Tooltip.Root>
            </div>
          </div>

          {knowledgeBase?.description && (
            <p className='mt-[4px] line-clamp-2 max-w-[40vw] font-medium text-[14px] text-[var(--text-tertiary)]'>
              {knowledgeBase.description}
            </p>
          )}

          <div className='mt-[16px] flex items-center gap-[8px]'>
            <span className='text-[14px] text-[var(--text-muted)]'>
              {pagination.total} {pagination.total === 1 ? 'document' : 'documents'}
            </span>
            {knowledgeBase?.updatedAt && (
              <>
                <div className='mb-[-1.5px] h-[18px] w-[1.25px] rounded-full bg-[#3A3A3A]' />
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <span className='cursor-default text-[14px] text-[var(--text-muted)]'>
                      last updated: {formatRelativeTime(knowledgeBase.updatedAt)}
                    </span>
                  </Tooltip.Trigger>
                  <Tooltip.Content>{formatAbsoluteDate(knowledgeBase.updatedAt)}</Tooltip.Content>
                </Tooltip.Root>
              </>
            )}
          </div>

          <div className='mt-[14px] flex items-center justify-between'>
            <div className='flex h-[32px] w-[400px] items-center gap-[6px] rounded-[8px] bg-[var(--surface-4)] px-[8px]'>
              <Search className='h-[14px] w-[14px] text-[var(--text-subtle)]' />
              <Input
                placeholder='Search documents...'
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                className='flex-1 border-0 bg-transparent px-0 font-medium text-[var(--text-secondary)] text-small leading-none placeholder:text-[var(--text-subtle)] focus-visible:ring-0 focus-visible:ring-offset-0'
              />
              {searchQuery &&
                (isLoadingDocuments ? (
                  <Loader2 className='h-[14px] w-[14px] animate-spin text-[var(--text-subtle)]' />
                ) : (
                  <button
                    onClick={() => handleSearchChange('')}
                    className='text-[var(--text-subtle)] transition-colors hover:text-[var(--text-secondary)]'
                  >
                    <X className='h-[14px] w-[14px]' />
                  </button>
                ))}
            </div>

            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button
                  onClick={handleAddDocuments}
                  disabled={userPermissions.canEdit !== true}
                  variant='tertiary'
                  className='h-[32px] rounded-[6px]'
                >
                  Add Documents
                </Button>
              </Tooltip.Trigger>
              {userPermissions.canEdit !== true && (
                <Tooltip.Content>Write permission required to add documents</Tooltip.Content>
              )}
            </Tooltip.Root>
          </div>

          {error && !isLoadingKnowledgeBase && (
            <div className='mt-[24px]'>
              <div className='flex h-64 items-center justify-center rounded-lg border border-muted-foreground/25 bg-muted/20'>
                <div className='text-center'>
                  <p className='font-medium text-[var(--text-secondary)] text-sm'>
                    Error loading documents
                  </p>
                  <p className='mt-1 text-[var(--text-muted)] text-xs'>{error}</p>
                </div>
              </div>
            </div>
          )}

          <div className='mt-[12px] flex flex-1 flex-col' onContextMenu={handleEmptyContextMenu}>
            {isLoadingDocuments && documents.length === 0 ? (
              <DocumentTableSkeleton rowCount={5} />
            ) : documents.length === 0 ? (
              <div className='mt-[10px] flex h-64 items-center justify-center rounded-lg border border-muted-foreground/25 bg-muted/20'>
                <div className='text-center'>
                  <p className='font-medium text-[var(--text-secondary)] text-sm'>
                    {searchQuery ? 'No documents found' : 'No documents yet'}
                  </p>
                  <p className='mt-1 text-[var(--text-muted)] text-xs'>
                    {searchQuery
                      ? 'Try a different search term'
                      : userPermissions.canEdit === true
                        ? 'Add documents to get started'
                        : 'Documents will appear here once added'}
                  </p>
                </div>
              </div>
            ) : (
              <Table className='min-w-[700px] table-fixed text-[13px]'>
                <TableHeader>
                  <TableRow className='hover:bg-transparent'>
                    <TableHead className='w-[28px] py-[8px] pr-0 pl-0'>
                      <div className='flex items-center justify-center'>
                        <Checkbox
                          size='sm'
                          checked={isAllSelected}
                          onCheckedChange={handleSelectAll}
                          disabled={!userPermissions.canEdit}
                          aria-label='Select all documents'
                        />
                      </div>
                    </TableHead>
                    {renderSortableHeader('filename', 'Name', 'w-[180px] max-w-[180px]')}
                    {renderSortableHeader('fileSize', 'Size', 'hidden w-[8%] lg:table-cell')}
                    {renderSortableHeader('tokenCount', 'Tokens', 'hidden w-[8%] lg:table-cell')}
                    {renderSortableHeader('chunkCount', 'Chunks', 'w-[8%]')}
                    {renderSortableHeader('uploadedAt', 'Uploaded', 'w-[11%]')}
                    {renderSortableHeader('processingStatus', 'Status', 'w-[10%]')}
                    <TableHead className='w-[12%] px-[12px] py-[8px] text-[12px] text-[var(--text-secondary)]'>
                      Tags
                    </TableHead>
                    <TableHead className='w-[11%] py-[8px] pr-[4px] pl-[12px] text-[12px] text-[var(--text-secondary)]'>
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.map((doc) => {
                    const isSelected = selectedDocuments.has(doc.id)

                    return (
                      <TableRow
                        key={doc.id}
                        className={`${
                          isSelected
                            ? 'bg-[var(--surface-3)] dark:bg-[var(--surface-4)]'
                            : 'hover:bg-[var(--surface-3)] dark:hover:bg-[var(--surface-4)]'
                        } ${doc.processingStatus === 'completed' ? 'cursor-pointer' : 'cursor-default'}`}
                        onClick={() => {
                          if (doc.processingStatus === 'completed') {
                            handleDocumentClick(doc.id)
                          }
                        }}
                        onContextMenu={(e) => handleDocumentContextMenu(e, doc)}
                      >
                        <TableCell className='w-[28px] py-[8px] pr-0 pl-0'>
                          <div className='flex items-center justify-center'>
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={(checked) =>
                                handleSelectDocument(doc.id, checked as boolean)
                              }
                              size='sm'
                              disabled={!userPermissions.canEdit}
                              onClick={(e) => e.stopPropagation()}
                              aria-label={`Select ${doc.filename}`}
                            />
                          </div>
                        </TableCell>
                        <TableCell className='w-[180px] max-w-[180px] px-[12px] py-[8px]'>
                          <div className='flex min-w-0 items-center gap-[8px]'>
                            {getFileIcon(doc.mimeType, doc.filename)}
                            <Tooltip.Root>
                              <Tooltip.Trigger asChild>
                                <span
                                  className='block min-w-0 truncate text-[14px] text-[var(--text-primary)]'
                                  title={doc.filename}
                                >
                                  <SearchHighlight text={doc.filename} searchQuery={searchQuery} />
                                </span>
                              </Tooltip.Trigger>
                              <Tooltip.Content side='top'>{doc.filename}</Tooltip.Content>
                            </Tooltip.Root>
                          </div>
                        </TableCell>
                        <TableCell className='hidden px-[12px] py-[8px] text-[12px] text-[var(--text-muted)] lg:table-cell'>
                          {formatFileSize(doc.fileSize)}
                        </TableCell>
                        <TableCell className='hidden px-[12px] py-[8px] text-[12px] lg:table-cell'>
                          {doc.processingStatus === 'completed' ? (
                            doc.tokenCount > 1000 ? (
                              `${(doc.tokenCount / 1000).toFixed(1)}k`
                            ) : (
                              doc.tokenCount.toLocaleString()
                            )
                          ) : (
                            <span className='text-[var(--text-muted)]'>—</span>
                          )}
                        </TableCell>
                        <TableCell className='px-[12px] py-[8px] text-[12px] text-[var(--text-muted)]'>
                          {doc.processingStatus === 'completed'
                            ? doc.chunkCount.toLocaleString()
                            : '—'}
                        </TableCell>
                        <TableCell className='px-[12px] py-[8px]'>
                          <Tooltip.Root>
                            <Tooltip.Trigger asChild>
                              <span className='text-[12px] text-[var(--text-muted)]'>
                                {format(new Date(doc.uploadedAt), 'MMM d')}
                              </span>
                            </Tooltip.Trigger>
                            <Tooltip.Content side='top'>
                              {format(new Date(doc.uploadedAt), 'MMM d, yyyy h:mm a')}
                            </Tooltip.Content>
                          </Tooltip.Root>
                        </TableCell>
                        <TableCell className='px-[12px] py-[8px]'>
                          {doc.processingStatus === 'failed' && doc.processingError ? (
                            <Tooltip.Root>
                              <Tooltip.Trigger asChild>
                                <div style={{ cursor: 'help' }}>{getStatusBadge(doc)}</div>
                              </Tooltip.Trigger>
                              <Tooltip.Content side='top' className='max-w-xs'>
                                {doc.processingError}
                              </Tooltip.Content>
                            </Tooltip.Root>
                          ) : (
                            getStatusBadge(doc)
                          )}
                        </TableCell>
                        <TableCell className='px-[12px] py-[8px]'>
                          {(() => {
                            const tags = getDocumentTags(doc, tagDefinitions)
                            if (tags.length === 0) {
                              return <span className='text-[12px] text-[var(--text-muted)]'>—</span>
                            }
                            const displayText = tags.map((t) => t.value).join(', ')
                            return (
                              <Tooltip.Root>
                                <Tooltip.Trigger asChild>
                                  <span
                                    className='block max-w-full truncate text-[12px] text-[var(--text-secondary)]'
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {displayText}
                                  </span>
                                </Tooltip.Trigger>
                                <Tooltip.Content
                                  side='top'
                                  className='max-h-[104px] max-w-[240px] overflow-y-auto'
                                >
                                  <div className='flex flex-col gap-[2px]'>
                                    {tags.map((tag) => (
                                      <div key={tag.slot} className='text-[11px]'>
                                        <span className='text-[var(--text-muted)]'>
                                          {tag.displayName}:
                                        </span>{' '}
                                        {tag.value}
                                      </div>
                                    ))}
                                  </div>
                                </Tooltip.Content>
                              </Tooltip.Root>
                            )
                          })()}
                        </TableCell>
                        <TableCell className='py-[8px] pr-[4px] pl-[12px]'>
                          <div className='flex items-center gap-[4px]'>
                            {doc.processingStatus === 'failed' && (
                              <Tooltip.Root>
                                <Tooltip.Trigger asChild>
                                  <Button
                                    variant='ghost'
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleRetryDocument(doc.id)
                                    }}
                                    className='h-[28px] w-[28px] p-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                                  >
                                    <RotateCcw className='h-[14px] w-[14px]' />
                                  </Button>
                                </Tooltip.Trigger>
                                <Tooltip.Content side='top'>Retry processing</Tooltip.Content>
                              </Tooltip.Root>
                            )}
                            <Tooltip.Root>
                              <Tooltip.Trigger asChild>
                                <Button
                                  variant='ghost'
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleToggleEnabled(doc.id)
                                  }}
                                  disabled={
                                    doc.processingStatus === 'processing' ||
                                    doc.processingStatus === 'pending' ||
                                    !userPermissions.canEdit
                                  }
                                  className='h-[28px] w-[28px] p-0 text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50'
                                >
                                  {doc.enabled ? (
                                    <Circle className='h-[14px] w-[14px]' />
                                  ) : (
                                    <CircleOff className='h-[14px] w-[14px]' />
                                  )}
                                </Button>
                              </Tooltip.Trigger>
                              <Tooltip.Content side='top'>
                                {doc.processingStatus === 'processing' ||
                                doc.processingStatus === 'pending'
                                  ? 'Cannot modify while processing'
                                  : !userPermissions.canEdit
                                    ? 'Write permission required to modify documents'
                                    : doc.enabled
                                      ? 'Disable Document'
                                      : 'Enable Document'}
                              </Tooltip.Content>
                            </Tooltip.Root>
                            <Tooltip.Root>
                              <Tooltip.Trigger asChild>
                                <Button
                                  variant='ghost'
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleDeleteDocument(doc.id)
                                  }}
                                  disabled={
                                    doc.processingStatus === 'processing' ||
                                    !userPermissions.canEdit
                                  }
                                  className='h-[28px] w-[28px] p-0 text-[var(--text-muted)] hover:text-[var(--text-error)] disabled:opacity-50'
                                >
                                  <Trash className='h-[14px] w-[14px]' />
                                </Button>
                              </Tooltip.Trigger>
                              <Tooltip.Content side='top'>
                                {doc.processingStatus === 'processing'
                                  ? 'Cannot delete while processing'
                                  : !userPermissions.canEdit
                                    ? 'Write permission required to delete documents'
                                    : 'Delete Document'}
                              </Tooltip.Content>
                            </Tooltip.Root>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}

            {totalPages > 1 && (
              <div className='flex items-center justify-center border-t bg-background px-4 pt-[10px]'>
                <div className='flex items-center gap-1'>
                  <Button
                    variant='ghost'
                    onClick={prevPage}
                    disabled={!hasPrevPage || isLoadingDocuments}
                  >
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
                          disabled={isLoadingDocuments}
                          className={`font-medium text-sm transition-colors hover:text-foreground disabled:opacity-50 ${
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
                    onClick={nextPage}
                    disabled={!hasNextPage || isLoadingDocuments}
                  >
                    <ChevronRight className='h-3.5 w-3.5' />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <BaseTagsModal open={showTagsModal} onOpenChange={setShowTagsModal} knowledgeBaseId={id} />

      <Modal open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <ModalContent size='sm'>
          <ModalHeader>Delete Knowledge Base</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              Are you sure you want to delete "{knowledgeBaseName}"? This will permanently delete
              the knowledge base and all {pagination.total} document
              {pagination.total === 1 ? '' : 's'} within it.{' '}
              <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant='active'
              onClick={() => setShowDeleteDialog(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button variant='destructive' onClick={handleDeleteKnowledgeBase} disabled={isDeleting}>
              {isDeleting ? 'Deleting...' : 'Delete Knowledge Base'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal open={showDeleteDocumentModal} onOpenChange={setShowDeleteDocumentModal}>
        <ModalContent size='sm'>
          <ModalHeader>Delete Document</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              Are you sure you want to delete "
              {documents.find((doc) => doc.id === documentToDelete)?.filename ?? 'this document'}"?{' '}
              <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant='active'
              onClick={() => {
                setShowDeleteDocumentModal(false)
                setDocumentToDelete(null)
              }}
            >
              Cancel
            </Button>
            <Button variant='destructive' onClick={confirmDeleteDocument}>
              Delete Document
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal open={showBulkDeleteModal} onOpenChange={setShowBulkDeleteModal}>
        <ModalContent size='sm'>
          <ModalHeader>Delete Documents</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              Are you sure you want to delete {selectedDocuments.size} document
              {selectedDocuments.size === 1 ? '' : 's'}?{' '}
              <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='active' onClick={() => setShowBulkDeleteModal(false)}>
              Cancel
            </Button>
            <Button variant='destructive' onClick={confirmBulkDelete} disabled={isBulkOperating}>
              {isBulkOperating
                ? 'Deleting...'
                : `Delete ${selectedDocuments.size} Document${selectedDocuments.size === 1 ? '' : 's'}`}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Add Documents Modal */}
      <AddDocumentsModal
        open={showAddDocumentsModal}
        onOpenChange={setShowAddDocumentsModal}
        knowledgeBaseId={id}
        chunkingConfig={knowledgeBase?.chunkingConfig}
      />

      {/* Rename Document Modal */}
      {documentToRename && (
        <RenameDocumentModal
          open={showRenameModal}
          onOpenChange={setShowRenameModal}
          documentId={documentToRename.id}
          initialName={documentToRename.filename}
          onSave={handleSaveRename}
        />
      )}

      <ActionBar
        selectedCount={selectedDocuments.size}
        onEnable={disabledCount > 0 ? handleBulkEnable : undefined}
        onDisable={enabledCount > 0 ? handleBulkDisable : undefined}
        onDelete={handleBulkDelete}
        enabledCount={enabledCount}
        disabledCount={disabledCount}
        isLoading={isBulkOperating}
      />

      <DocumentContextMenu
        isOpen={isContextMenuOpen}
        position={contextMenuPosition}
        menuRef={menuRef}
        onClose={handleContextMenuClose}
        hasDocument={contextMenuDocument !== null}
        isDocumentEnabled={contextMenuDocument?.enabled ?? true}
        hasTags={
          contextMenuDocument
            ? getDocumentTags(contextMenuDocument, tagDefinitions).length > 0
            : false
        }
        selectedCount={selectedDocuments.size}
        enabledCount={enabledCount}
        disabledCount={disabledCount}
        onOpenInNewTab={
          contextMenuDocument && selectedDocuments.size === 1
            ? () => {
                const urlParams = new URLSearchParams({
                  kbName: knowledgeBaseName,
                  docName: contextMenuDocument.filename || 'Document',
                })
                window.open(
                  `/workspace/${workspaceId}/knowledge/${id}/${contextMenuDocument.id}?${urlParams.toString()}`,
                  '_blank'
                )
              }
            : undefined
        }
        onRename={
          contextMenuDocument && selectedDocuments.size === 1 && userPermissions.canEdit
            ? () => handleRenameDocument(contextMenuDocument)
            : undefined
        }
        onToggleEnabled={
          contextMenuDocument && userPermissions.canEdit
            ? selectedDocuments.size > 1
              ? () => {
                  if (disabledCount > 0) {
                    handleBulkEnable()
                  } else {
                    handleBulkDisable()
                  }
                }
              : () => handleToggleEnabled(contextMenuDocument.id)
            : undefined
        }
        onViewTags={
          contextMenuDocument && selectedDocuments.size === 1
            ? () => {
                const urlParams = new URLSearchParams({
                  kbName: knowledgeBaseName,
                  docName: contextMenuDocument.filename || 'Document',
                })
                router.push(
                  `/workspace/${workspaceId}/knowledge/${id}/${contextMenuDocument.id}?${urlParams.toString()}`
                )
              }
            : undefined
        }
        onDelete={
          contextMenuDocument && userPermissions.canEdit
            ? selectedDocuments.size > 1
              ? handleBulkDelete
              : () => handleDeleteDocument(contextMenuDocument.id)
            : undefined
        }
        onAddDocument={userPermissions.canEdit ? handleAddDocuments : undefined}
        disableToggleEnabled={
          !userPermissions.canEdit ||
          contextMenuDocument?.processingStatus === 'processing' ||
          contextMenuDocument?.processingStatus === 'pending'
        }
        disableDelete={
          !userPermissions.canEdit || contextMenuDocument?.processingStatus === 'processing'
        }
        disableAddDocument={!userPermissions.canEdit}
      />
    </div>
  )
}
