'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { format } from 'date-fns'
import { AlertCircle, Loader2, Pencil, Plus, Tag, X } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import {
  Badge,
  Button,
  Combobox,
  type ComboboxOption,
  DatePicker,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Tooltip,
  Trash,
} from '@/components/emcn'
import { Database, DatabaseX } from '@/components/emcn/icons'
import { SearchHighlight } from '@/components/ui/search-highlight'
import { cn } from '@/lib/core/utils/cn'
import { ALL_TAG_SLOTS, type AllTagSlot, getFieldTypeForSlot } from '@/lib/knowledge/constants'
import type { DocumentSortField, SortOrder } from '@/lib/knowledge/documents/types'
import { type FilterFieldType, getOperatorsForFieldType } from '@/lib/knowledge/filters/types'
import type { DocumentData } from '@/lib/knowledge/types'
import { formatFileSize } from '@/lib/uploads/utils/file-utils'
import type {
  BreadcrumbItem,
  FilterTag,
  HeaderAction,
  ResourceCell,
  ResourceColumn,
  ResourceRow,
  SelectableConfig,
  SortConfig,
} from '@/app/workspace/[workspaceId]/components'
import { Resource } from '@/app/workspace/[workspaceId]/components'
import {
  ActionBar,
  AddConnectorModal,
  AddDocumentsModal,
  BaseTagsModal,
  ConnectorsSection,
  DocumentContextMenu,
  RenameDocumentModal,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/components'
import { getDocumentIcon } from '@/app/workspace/[workspaceId]/knowledge/components'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { CONNECTOR_REGISTRY } from '@/connectors/registry'
import {
  useKnowledgeBase,
  useKnowledgeBaseDocuments,
  useKnowledgeBasesList,
} from '@/hooks/kb/use-knowledge'
import {
  type TagDefinition,
  useKnowledgeBaseTagDefinitions,
} from '@/hooks/kb/use-knowledge-base-tag-definitions'
import { useConnectorList } from '@/hooks/queries/kb/connectors'
import type { DocumentTagFilter } from '@/hooks/queries/kb/knowledge'
import {
  useBulkDocumentOperation,
  useDeleteDocument,
  useDeleteKnowledgeBase,
  useUpdateDocument,
  useUpdateKnowledgeBase,
} from '@/hooks/queries/kb/knowledge'
import { useInlineRename } from '@/hooks/use-inline-rename'
import { useOAuthReturnForKBConnectors } from '@/hooks/use-oauth-return'

const logger = createLogger('KnowledgeBase')

const DOCUMENTS_PER_PAGE = 50

const DOCUMENT_COLUMNS: ResourceColumn[] = [
  { id: 'name', header: 'Name' },
  { id: 'size', header: 'Size' },
  { id: 'tokens', header: 'Tokens' },
  { id: 'chunks', header: 'Chunks' },
  { id: 'uploaded', header: 'Uploaded' },
  { id: 'status', header: 'Status' },
  { id: 'tags', header: 'Tags' },
]

interface KnowledgeBaseProps {
  id: string
  knowledgeBaseName?: string
  workspaceId?: string
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

interface TagValue {
  slot: AllTagSlot
  displayName: string
  value: string
}

/**
 * Computes tag values for a document
 */
function getDocumentTags(doc: DocumentData, definitions: TagDefinition[]): TagValue[] {
  const result: TagValue[] = []

  for (const slot of ALL_TAG_SLOTS) {
    const raw = doc[slot]
    if (raw == null) continue

    const def = definitions.find((d) => d.tagSlot === slot)
    const fieldType = def?.fieldType || getFieldTypeForSlot(slot) || 'text'

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
  workspaceId: propWorkspaceId,
}: KnowledgeBaseProps) {
  const params = useParams()
  const workspaceId = propWorkspaceId || (params.workspaceId as string)
  useOAuthReturnForKBConnectors(id)
  const { removeKnowledgeBase } = useKnowledgeBasesList(workspaceId, { enabled: false })
  const userPermissions = useUserPermissionsContext()

  const { mutate: updateDocumentMutation } = useUpdateDocument()
  const { mutate: deleteDocumentMutation } = useDeleteDocument()
  const { mutate: deleteKnowledgeBaseMutation, isPending: isDeleting } =
    useDeleteKnowledgeBase(workspaceId)
  const { mutate: updateKnowledgeBaseMutation } = useUpdateKnowledgeBase(workspaceId)

  const kbRename = useInlineRename({
    onSave: (kbId, name) =>
      updateKnowledgeBaseMutation({ knowledgeBaseId: kbId, updates: { name } }),
  })
  const { mutate: bulkDocumentMutation, isPending: isBulkOperating } = useBulkDocumentOperation()

  const [searchQuery, setSearchQuery] = useState('')
  const [showTagsModal, setShowTagsModal] = useState(false)
  const [enabledFilter, setEnabledFilter] = useState<'all' | 'enabled' | 'disabled'>('all')
  const [tagFilterEntries, setTagFilterEntries] = useState<
    {
      id: string
      tagName: string
      tagSlot: string
      fieldType: FilterFieldType
      operator: string
      value: string
      valueTo: string
    }[]
  >([])

  const activeTagFilters: DocumentTagFilter[] = useMemo(
    () =>
      tagFilterEntries
        .filter((f) => f.tagSlot && f.value.trim())
        .map((f) => ({
          tagSlot: f.tagSlot,
          fieldType: f.fieldType,
          operator: f.operator,
          value: f.value,
          ...(f.operator === 'between' && f.valueTo ? { valueTo: f.valueTo } : {}),
        })),
    [tagFilterEntries]
  )

  const handleSearchChange = useCallback((newQuery: string) => {
    setSearchQuery(newQuery)
    setCurrentPage(1)
  }, [])

  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(() => new Set())
  const [isSelectAllMode, setIsSelectAllMode] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showAddDocumentsModal, setShowAddDocumentsModal] = useState(false)
  const [showDeleteDocumentModal, setShowDeleteDocumentModal] = useState(false)
  const [documentToDelete, setDocumentToDelete] = useState<string | null>(null)
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false)
  const [showConnectorsModal, setShowConnectorsModal] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [sortBy, setSortBy] = useState<DocumentSortField>('uploadedAt')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const [contextMenuDocument, setContextMenuDocument] = useState<DocumentData | null>(null)
  const [showRenameModal, setShowRenameModal] = useState(false)
  const [documentToRename, setDocumentToRename] = useState<DocumentData | null>(null)
  const [showAddConnectorModal, setShowAddConnectorModal] = useState(false)

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

  const { data: connectors = [], isLoading: isLoadingConnectors } = useConnectorList(id)
  const hasSyncingConnectors = connectors.some((c) => c.status === 'syncing')
  const hasSyncingConnectorsRef = useRef(hasSyncingConnectors)
  hasSyncingConnectorsRef.current = hasSyncingConnectors

  const {
    documents,
    pagination,
    isLoading: isLoadingDocuments,
    isFetching: isFetchingDocuments,
    isPlaceholderData: isPlaceholderDocuments,
    error: documentsError,
    hasProcessingDocuments,
    updateDocument,
    refreshDocuments,
  } = useKnowledgeBaseDocuments(id, {
    search: searchQuery || undefined,
    limit: DOCUMENTS_PER_PAGE,
    offset: (currentPage - 1) * DOCUMENTS_PER_PAGE,
    sortBy,
    sortOrder,
    refetchInterval: (data) => {
      if (isDeleting) return false
      const hasPending = data?.documents?.some(
        (doc) => doc.processingStatus === 'pending' || doc.processingStatus === 'processing'
      )
      if (hasPending) return 3000
      if (hasSyncingConnectorsRef.current) return 5000
      return false
    },
    enabledFilter,
    tagFilters: activeTagFilters.length > 0 ? activeTagFilters : undefined,
  })

  const { tagDefinitions } = useKnowledgeBaseTagDefinitions(id)

  const prevHadSyncingRef = useRef(false)
  useEffect(() => {
    if (prevHadSyncingRef.current && !hasSyncingConnectors) {
      refreshKnowledgeBase()
      refreshDocuments()
    }
    prevHadSyncingRef.current = hasSyncingConnectors
  }, [hasSyncingConnectors, refreshKnowledgeBase, refreshDocuments])

  const router = useRouter()

  const knowledgeBaseName = knowledgeBase?.name || passedKnowledgeBaseName || 'Knowledge Base'
  const error = knowledgeBaseError || documentsError

  const totalPages = Math.ceil(pagination.total / pagination.limit)

  /**
   * Checks for documents with stale processing states and marks them as failed
   */
  const checkForDeadProcesses = useCallback(
    (docsToCheck: DocumentData[]) => {
      const now = new Date()
      const DEAD_PROCESS_THRESHOLD_MS = 600 * 1000 // 10 minutes

      const staleDocuments = docsToCheck.filter((doc) => {
        if (doc.processingStatus !== 'processing' || !doc.processingStartedAt) {
          return false
        }

        const processingDuration = now.getTime() - new Date(doc.processingStartedAt).getTime()
        return processingDuration > DEAD_PROCESS_THRESHOLD_MS
      })

      if (staleDocuments.length === 0) return

      logger.warn(`Found ${staleDocuments.length} documents with dead processes`)

      staleDocuments.forEach((doc) => {
        updateDocumentMutation(
          {
            knowledgeBaseId: id,
            documentId: doc.id,
            updates: { markFailedDueToTimeout: true },
          },
          {
            onSuccess: () => {
              logger.info(
                `Successfully marked dead process as failed for document: ${doc.filename}`
              )
            },
          }
        )
      })
    },
    [id, updateDocumentMutation]
  )

  useEffect(() => {
    if (hasProcessingDocuments) {
      checkForDeadProcesses(documents)
    }
  }, [hasProcessingDocuments, documents, checkForDeadProcesses])

  const handleToggleEnabled = (docId: string) => {
    const document = documents.find((doc) => doc.id === docId)
    if (!document) return

    const newEnabled = !document.enabled

    updateDocument(docId, { enabled: newEnabled })

    updateDocumentMutation(
      {
        knowledgeBaseId: id,
        documentId: docId,
        updates: { enabled: newEnabled },
      },
      {
        onError: () => {
          updateDocument(docId, { enabled: !newEnabled })
        },
      }
    )
  }

  /**
   * Handles retrying a failed document processing
   */
  const handleRetryDocument = (docId: string) => {
    updateDocument(docId, {
      processingStatus: 'pending',
      processingError: null,
      processingStartedAt: null,
      processingCompletedAt: null,
    })

    updateDocumentMutation(
      {
        knowledgeBaseId: id,
        documentId: docId,
        updates: { retryProcessing: true },
      },
      {
        onSuccess: () => {
          logger.info(`Document retry initiated successfully for: ${docId}`)
        },
        onError: (err) => {
          logger.error('Error retrying document:', err)
          updateDocument(docId, {
            processingStatus: 'failed',
            processingError:
              err instanceof Error ? err.message : 'Failed to retry document processing',
          })
        },
      }
    )
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

    return new Promise<void>((resolve, reject) => {
      updateDocumentMutation(
        {
          knowledgeBaseId: id,
          documentId,
          updates: { filename: newName },
        },
        {
          onSuccess: () => {
            logger.info(`Document renamed: ${documentId}`)
            resolve()
          },
          onError: (err) => {
            if (previousName !== undefined) {
              updateDocument(documentId, { filename: previousName })
            }
            logger.error('Error renaming document:', err)
            reject(err)
          },
        }
      )
    })
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
  const confirmDeleteDocument = () => {
    if (!documentToDelete) return

    deleteDocumentMutation(
      { knowledgeBaseId: id, documentId: documentToDelete },
      {
        onSuccess: () => {
          setSelectedDocuments((prev) => {
            const newSet = new Set(prev)
            newSet.delete(documentToDelete)
            return newSet
          })
        },
        onSettled: () => {
          setShowDeleteDocumentModal(false)
          setDocumentToDelete(null)
        },
      }
    )
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
      setIsSelectAllMode(false)
    }
  }

  const isAllSelected = documents.length > 0 && selectedDocuments.size === documents.length

  /**
   * Handles clicking on a document row to navigate to detail view
   */
  const handleDocumentClick = (docId: string) => {
    const document = documents.find((doc) => doc.id === docId)
    if (document?.processingStatus !== 'completed') return
    const urlParams = new URLSearchParams({
      kbName: knowledgeBaseName,
      docName: document?.filename || 'Document',
    })
    router.push(`/workspace/${workspaceId}/knowledge/${id}/${docId}?${urlParams.toString()}`)
  }

  /**
   * Handles deleting the entire knowledge base
   */
  const handleDeleteKnowledgeBase = () => {
    if (!knowledgeBase) return

    deleteKnowledgeBaseMutation(
      { knowledgeBaseId: id },
      {
        onSuccess: () => {
          removeKnowledgeBase(id)
          router.push(`/workspace/${workspaceId}/knowledge`)
        },
      }
    )
  }

  const handleAddDocuments = () => {
    setShowAddDocumentsModal(true)
  }

  /**
   * Handles bulk enabling of selected documents
   */
  const handleBulkEnable = () => {
    if (isSelectAllMode) {
      bulkDocumentMutation(
        {
          knowledgeBaseId: id,
          operation: 'enable',
          selectAll: true,
          enabledFilter,
        },
        {
          onSuccess: (result) => {
            logger.info(`Successfully enabled ${result.successCount} documents`)
            setSelectedDocuments(new Set())
            setIsSelectAllMode(false)
          },
        }
      )
      return
    }

    const documentsToEnable = documents.filter(
      (doc) => selectedDocuments.has(doc.id) && !doc.enabled
    )

    if (documentsToEnable.length === 0) return

    bulkDocumentMutation(
      {
        knowledgeBaseId: id,
        operation: 'enable',
        documentIds: documentsToEnable.map((doc) => doc.id),
      },
      {
        onSuccess: (result) => {
          result.updatedDocuments?.forEach((updatedDoc) => {
            updateDocument(updatedDoc.id, { enabled: updatedDoc.enabled })
          })
          logger.info(`Successfully enabled ${result.successCount} documents`)
          setSelectedDocuments(new Set())
        },
      }
    )
  }

  /**
   * Handles bulk disabling of selected documents
   */
  const handleBulkDisable = () => {
    if (isSelectAllMode) {
      bulkDocumentMutation(
        {
          knowledgeBaseId: id,
          operation: 'disable',
          selectAll: true,
          enabledFilter,
        },
        {
          onSuccess: (result) => {
            logger.info(`Successfully disabled ${result.successCount} documents`)
            setSelectedDocuments(new Set())
            setIsSelectAllMode(false)
          },
        }
      )
      return
    }

    const documentsToDisable = documents.filter(
      (doc) => selectedDocuments.has(doc.id) && doc.enabled
    )

    if (documentsToDisable.length === 0) return

    bulkDocumentMutation(
      {
        knowledgeBaseId: id,
        operation: 'disable',
        documentIds: documentsToDisable.map((doc) => doc.id),
      },
      {
        onSuccess: (result) => {
          result.updatedDocuments?.forEach((updatedDoc) => {
            updateDocument(updatedDoc.id, { enabled: updatedDoc.enabled })
          })
          logger.info(`Successfully disabled ${result.successCount} documents`)
          setSelectedDocuments(new Set())
        },
      }
    )
  }

  const handleBulkDelete = () => {
    if (selectedDocuments.size === 0) return
    setShowBulkDeleteModal(true)
  }

  const confirmBulkDelete = () => {
    if (isSelectAllMode) {
      bulkDocumentMutation(
        {
          knowledgeBaseId: id,
          operation: 'delete',
          selectAll: true,
          enabledFilter,
        },
        {
          onSuccess: (result) => {
            logger.info(`Successfully deleted ${result.successCount} documents`)
            setSelectedDocuments(new Set())
            setIsSelectAllMode(false)
          },
          onSettled: () => {
            setShowBulkDeleteModal(false)
          },
        }
      )
      return
    }

    const documentsToDelete = documents.filter((doc) => selectedDocuments.has(doc.id))

    if (documentsToDelete.length === 0) return

    bulkDocumentMutation(
      {
        knowledgeBaseId: id,
        operation: 'delete',
        documentIds: documentsToDelete.map((doc) => doc.id),
      },
      {
        onSuccess: (result) => {
          logger.info(`Successfully deleted ${result.successCount} documents`)
          setSelectedDocuments(new Set())
        },
        onSettled: () => {
          setShowBulkDeleteModal(false)
        },
      }
    )
  }

  const selectedDocumentsList = documents.filter((doc) => selectedDocuments.has(doc.id))
  const enabledCount = isSelectAllMode
    ? enabledFilter === 'disabled'
      ? 0
      : pagination.total
    : selectedDocumentsList.filter((doc) => doc.enabled).length
  const disabledCount = isSelectAllMode
    ? enabledFilter === 'enabled'
      ? 0
      : pagination.total
    : selectedDocumentsList.filter((doc) => !doc.enabled).length

  const handleDocumentContextMenu = useCallback(
    (e: React.MouseEvent, docId: string) => {
      const doc = documents.find((d) => d.id === docId)
      if (!doc) return

      const isCurrentlySelected = selectedDocuments.has(doc.id)

      if (!isCurrentlySelected) {
        setSelectedDocuments(new Set([doc.id]))
      }

      setContextMenuDocument(doc)
      baseHandleContextMenu(e)
    },
    [documents, selectedDocuments, baseHandleContextMenu]
  )

  const handleEmptyContextMenu = useCallback(
    (e: React.MouseEvent) => {
      setContextMenuDocument(null)
      baseHandleContextMenu(e)
    },
    [baseHandleContextMenu]
  )

  const handleContextMenuClose = useCallback(() => {
    closeContextMenu()
    setContextMenuDocument(null)
  }, [closeContextMenu])

  const prevKnowledgeBaseIdRef = useRef<string>(id)
  const isNavigatingToNewKB = prevKnowledgeBaseIdRef.current !== id

  if (knowledgeBase && knowledgeBase.id === id) {
    prevKnowledgeBaseIdRef.current = id
  }

  const isInitialLoad = isLoadingKnowledgeBase && !knowledgeBase
  const isFetchingNewKB = isNavigatingToNewKB && isFetchingDocuments

  const breadcrumbs: BreadcrumbItem[] = [
    {
      label: 'Knowledge Base',
      onClick: () => router.push(`/workspace/${workspaceId}/knowledge`),
    },
    {
      label: knowledgeBaseName,
      editing: kbRename.editingId
        ? {
            isEditing: true,
            value: kbRename.editValue,
            onChange: kbRename.setEditValue,
            onSubmit: kbRename.submitRename,
            onCancel: kbRename.cancelRename,
          }
        : undefined,
      dropdownItems: [
        ...(userPermissions.canEdit
          ? [
              {
                label: 'Rename',
                icon: Pencil,
                onClick: () => kbRename.startRename(id, knowledgeBaseName),
              },
              { label: 'Tags', icon: Tag, onClick: () => setShowTagsModal(true) },
              { label: 'Delete', icon: Trash, onClick: () => setShowDeleteDialog(true) },
            ]
          : []),
      ],
    },
  ]

  const headerActions: HeaderAction[] = [
    ...(userPermissions.canEdit
      ? [{ label: 'New connector', icon: Plus, onClick: () => setShowAddConnectorModal(true) }]
      : []),
  ]

  const sortConfig: SortConfig = {
    options: [
      { id: 'filename', label: 'Name' },
      { id: 'fileSize', label: 'Size' },
      { id: 'tokenCount', label: 'Tokens' },
      { id: 'chunkCount', label: 'Chunks' },
      { id: 'uploadedAt', label: 'Uploaded' },
      { id: 'enabled', label: 'Status' },
    ],
    active: { column: sortBy, direction: sortOrder },
    onSort: (column, direction) => {
      setSortBy(column as DocumentSortField)
      setSortOrder(direction)
      setCurrentPage(1)
    },
  }

  const filterContent = (
    <div className='w-[320px]'>
      <div className='border-[var(--border-1)] border-b px-3 py-2'>
        <span className='font-medium text-[var(--text-secondary)] text-caption'>Status</span>
      </div>
      <div className='flex flex-col gap-0.5 px-3 py-2'>
        {(['all', 'enabled', 'disabled'] as const).map((value) => (
          <button
            key={value}
            type='button'
            className={cn(
              'flex w-full cursor-pointer select-none items-center rounded-[5px] px-2 py-[5px] font-medium text-[var(--text-secondary)] text-caption outline-none transition-colors hover-hover:bg-[var(--surface-active)]',
              enabledFilter === value && 'bg-[var(--surface-active)]'
            )}
            onClick={() => {
              setEnabledFilter(value)
              setCurrentPage(1)
              setSelectedDocuments(new Set())
              setIsSelectAllMode(false)
            }}
          >
            {value.charAt(0).toUpperCase() + value.slice(1)}
          </button>
        ))}
      </div>
      <TagFilterSection
        tagDefinitions={tagDefinitions}
        entries={tagFilterEntries}
        onChange={(entries) => {
          setTagFilterEntries(entries)
          setCurrentPage(1)
          setSelectedDocuments(new Set())
          setIsSelectAllMode(false)
        }}
      />
    </div>
  )

  const connectorBadges =
    connectors.length > 0 ? (
      <>
        {connectors.map((connector) => {
          const def = CONNECTOR_REGISTRY[connector.connectorType]
          const ConnectorIcon = def?.icon
          return (
            <button
              key={connector.id}
              type='button'
              onClick={() => setShowConnectorsModal(true)}
              className='flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[var(--text-secondary)] text-caption shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover-hover:bg-[var(--surface-3)]'
            >
              {ConnectorIcon && <ConnectorIcon className='h-[14px] w-[14px]' />}
              {def?.name || connector.connectorType}
            </button>
          )
        })}
      </>
    ) : null

  const filterTags: FilterTag[] = [
    ...(enabledFilter !== 'all'
      ? [
          {
            label: `Status: ${enabledFilter === 'enabled' ? 'Enabled' : 'Disabled'}`,
            onRemove: () => {
              setEnabledFilter('all')
              setCurrentPage(1)
              setSelectedDocuments(new Set())
              setIsSelectAllMode(false)
            },
          },
        ]
      : []),
    ...tagFilterEntries
      .filter((f) => f.tagSlot && f.value.trim())
      .map((f) => ({
        label: `${f.tagName}: ${f.value}`,
        onRemove: () => {
          const updated = tagFilterEntries.filter((_, idx) => idx !== tagFilterEntries.indexOf(f))
          setTagFilterEntries(updated)
          setCurrentPage(1)
          setSelectedDocuments(new Set())
          setIsSelectAllMode(false)
        },
      })),
  ]

  const selectableConfig: SelectableConfig = {
    selectedIds: selectedDocuments,
    onSelectRow: handleSelectDocument,
    onSelectAll: handleSelectAll,
    isAllSelected,
    disabled: !userPermissions.canEdit,
  }

  const documentRows: ResourceRow[] = useMemo(
    () =>
      documents.map((doc) => {
        const ConnectorIcon = doc.connectorType ? CONNECTOR_REGISTRY[doc.connectorType]?.icon : null
        const DocIcon = ConnectorIcon || getDocumentIcon(doc.mimeType, doc.filename)

        const tags = getDocumentTags(doc, tagDefinitions)
        const tagsDisplayText = tags.map((t) => t.value).join(', ')

        const statusCell: ResourceCell =
          doc.processingStatus === 'failed' && doc.processingError
            ? {
                content: (
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <div style={{ cursor: 'help' }}>{getStatusBadge(doc)}</div>
                    </Tooltip.Trigger>
                    <Tooltip.Content side='top' className='max-w-xs'>
                      {doc.processingError}
                    </Tooltip.Content>
                  </Tooltip.Root>
                ),
              }
            : { content: getStatusBadge(doc) }

        const tagsCell: ResourceCell =
          tags.length === 0
            ? { label: null }
            : {
                content: (
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <span
                        className='block max-w-full truncate text-[var(--text-secondary)] text-caption'
                        onClick={(e) => e.stopPropagation()}
                      >
                        {tagsDisplayText}
                      </span>
                    </Tooltip.Trigger>
                    <Tooltip.Content
                      side='top'
                      className='max-h-[104px] max-w-[240px] overflow-y-auto'
                    >
                      <div className='flex flex-col gap-0.5'>
                        {tags.map((tag) => (
                          <div key={tag.slot} className='text-xs'>
                            <span className='text-[var(--text-muted)]'>{tag.displayName}:</span>{' '}
                            {tag.value}
                          </div>
                        ))}
                      </div>
                    </Tooltip.Content>
                  </Tooltip.Root>
                ),
              }

        return {
          id: doc.id,
          cells: {
            name: {
              content: (
                <span className='flex min-w-0 items-center gap-3 font-medium text-[var(--text-body)] text-sm'>
                  <span className='flex-shrink-0 text-[var(--text-icon)]'>
                    <DocIcon className='h-[14px] w-[14px]' />
                  </span>
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <span className='min-w-0 truncate'>
                        <SearchHighlight text={doc.filename} searchQuery={searchQuery} />
                      </span>
                    </Tooltip.Trigger>
                    <Tooltip.Content side='top'>{doc.filename}</Tooltip.Content>
                  </Tooltip.Root>
                </span>
              ),
            },
            size: { label: formatFileSize(doc.fileSize) },
            tokens: {
              label:
                doc.processingStatus === 'completed'
                  ? doc.tokenCount > 1000
                    ? `${(doc.tokenCount / 1000).toFixed(1)}k`
                    : doc.tokenCount.toLocaleString()
                  : null,
            },
            chunks: {
              label: doc.processingStatus === 'completed' ? doc.chunkCount.toLocaleString() : null,
            },
            uploaded: {
              content: (
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <span className='font-medium text-[var(--text-secondary)] text-sm'>
                      {format(new Date(doc.uploadedAt), 'MMM d')}
                    </span>
                  </Tooltip.Trigger>
                  <Tooltip.Content side='top'>
                    {format(new Date(doc.uploadedAt), 'MMM d, yyyy h:mm a')}
                  </Tooltip.Content>
                </Tooltip.Root>
              ),
            },
            status: statusCell,
            tags: tagsCell,
          },
        }
      }),
    [documents, tagDefinitions, searchQuery]
  )

  const emptyMessage = searchQuery
    ? 'No documents found'
    : enabledFilter !== 'all' || activeTagFilters.length > 0
      ? 'Nothing matches your filter'
      : undefined

  if (error && !knowledgeBase) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3'>
        <DatabaseX className='h-[32px] w-[32px] text-[var(--text-muted)]' />
        <div className='flex flex-col items-center gap-1'>
          <h2 className='font-medium text-[20px] text-[var(--text-secondary)]'>
            Knowledge base not found
          </h2>
          <p className='text-[var(--text-muted)] text-small'>
            This knowledge base may have been deleted or moved
          </p>
        </div>
      </div>
    )
  }

  return (
    <>
      <Resource
        icon={Database}
        title='Knowledge Base'
        breadcrumbs={breadcrumbs}
        create={{
          label: 'New documents',
          onClick: handleAddDocuments,
          disabled: userPermissions.canEdit !== true,
        }}
        headerActions={headerActions}
        sort={sortConfig}
        search={{
          value: searchQuery,
          onChange: handleSearchChange,
          placeholder: 'Search documents...',
        }}
        filter={filterContent}
        filterTags={filterTags}
        extras={connectorBadges}
        columns={DOCUMENT_COLUMNS}
        rows={documentRows}
        selectable={selectableConfig}
        onRowClick={handleDocumentClick}
        onRowContextMenu={handleDocumentContextMenu}
        onContextMenu={handleEmptyContextMenu}
        isLoading={
          isInitialLoad || isFetchingNewKB || (isLoadingDocuments && documents.length === 0)
        }
        pagination={{
          currentPage,
          totalPages,
          onPageChange: (page) => setCurrentPage(page),
        }}
        emptyMessage={emptyMessage}
        overlay={
          <ActionBar
            className={totalPages > 1 ? 'bottom-[72px]' : undefined}
            selectedCount={selectedDocuments.size}
            onEnable={disabledCount > 0 ? handleBulkEnable : undefined}
            onDisable={enabledCount > 0 ? handleBulkDisable : undefined}
            onDelete={handleBulkDelete}
            enabledCount={enabledCount}
            disabledCount={disabledCount}
            isLoading={isBulkOperating}
            totalCount={pagination.total}
            isAllPageSelected={isAllSelected}
            isAllSelected={isSelectAllMode}
            onSelectAll={() => setIsSelectAllMode(true)}
            onClearSelectAll={() => {
              setIsSelectAllMode(false)
              setSelectedDocuments(new Set())
            }}
          />
        }
      />

      <BaseTagsModal open={showTagsModal} onOpenChange={setShowTagsModal} knowledgeBaseId={id} />

      <Modal open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <ModalContent size='sm'>
          <ModalHeader>Delete Knowledge Base</ModalHeader>
          <ModalBody>
            <p className='text-[var(--text-secondary)]'>
              Are you sure you want to delete{' '}
              <span className='font-medium text-[var(--text-primary)]'>{knowledgeBaseName}</span>?
              The knowledge base and all {pagination.total} document
              {pagination.total === 1 ? '' : 's'} within it will be removed.{' '}
              <span className='text-[var(--text-tertiary)]'>
                You can restore it from Recently Deleted in Settings.
              </span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant='default'
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
            {(() => {
              const docToDelete = documents.find((doc) => doc.id === documentToDelete)
              return (
                <p className='text-[var(--text-secondary)]'>
                  Are you sure you want to delete{' '}
                  <span className='font-medium text-[var(--text-primary)]'>
                    {docToDelete?.filename ?? 'this document'}
                  </span>
                  ?{' '}
                  {docToDelete?.connectorId ? (
                    <span className='text-[var(--text-error)]'>
                      This document is synced from a connector. Deleting it will permanently exclude
                      it from future syncs. To temporarily hide it from search, disable it instead.
                    </span>
                  ) : (
                    <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
                  )}
                </p>
              )
            })()}
          </ModalBody>
          <ModalFooter>
            <Button
              variant='default'
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
            <p className='text-[var(--text-secondary)]'>
              Are you sure you want to delete {selectedDocuments.size} document
              {selectedDocuments.size === 1 ? '' : 's'}?{' '}
              <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant='default' onClick={() => setShowBulkDeleteModal(false)}>
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

      <AddDocumentsModal
        open={showAddDocumentsModal}
        onOpenChange={setShowAddDocumentsModal}
        knowledgeBaseId={id}
        chunkingConfig={knowledgeBase?.chunkingConfig}
      />

      {showAddConnectorModal && (
        <AddConnectorModal open onOpenChange={setShowAddConnectorModal} knowledgeBaseId={id} />
      )}

      {documentToRename && (
        <RenameDocumentModal
          open={showRenameModal}
          onOpenChange={setShowRenameModal}
          documentId={documentToRename.id}
          initialName={documentToRename.filename}
          onSave={handleSaveRename}
        />
      )}

      <Modal open={showConnectorsModal} onOpenChange={setShowConnectorsModal}>
        <ModalContent size='lg'>
          <ModalHeader>Connected Sources</ModalHeader>
          <ModalBody>
            <ConnectorsSection
              workspaceId={workspaceId}
              knowledgeBaseId={id}
              connectors={connectors}
              isLoading={isLoadingConnectors}
              canEdit={userPermissions.canEdit}
            />
          </ModalBody>
        </ModalContent>
      </Modal>

      <DocumentContextMenu
        isOpen={isContextMenuOpen}
        position={contextMenuPosition}
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
        onOpenSource={
          contextMenuDocument?.sourceUrl && selectedDocuments.size === 1
            ? () => window.open(contextMenuDocument.sourceUrl!, '_blank', 'noopener,noreferrer')
            : undefined
        }
        onRename={contextMenuDocument ? () => handleRenameDocument(contextMenuDocument) : undefined}
        onToggleEnabled={
          contextMenuDocument
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
          contextMenuDocument
            ? selectedDocuments.size > 1
              ? handleBulkDelete
              : () => handleDeleteDocument(contextMenuDocument.id)
            : undefined
        }
        onAddDocument={handleAddDocuments}
        disableRename={!userPermissions.canEdit}
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
    </>
  )
}

interface TagFilterEntry {
  id: string
  tagName: string
  tagSlot: string
  fieldType: FilterFieldType
  operator: string
  value: string
  valueTo: string
}

const createEmptyEntry = (): TagFilterEntry => ({
  id: crypto.randomUUID(),
  tagName: '',
  tagSlot: '',
  fieldType: 'text',
  operator: 'eq',
  value: '',
  valueTo: '',
})

interface TagFilterSectionProps {
  tagDefinitions: TagDefinition[]
  entries: TagFilterEntry[]
  onChange: (entries: TagFilterEntry[]) => void
}

/**
 * Tag filter section rendered inside the combined filter popover
 */
function TagFilterSection({ tagDefinitions, entries, onChange }: TagFilterSectionProps) {
  const activeCount = entries.filter((f) => f.tagSlot && f.value.trim()).length

  const tagOptions: ComboboxOption[] = tagDefinitions.map((t) => ({
    value: t.displayName,
    label: t.displayName,
  }))

  const filtersToShow = useMemo(
    () => (entries.length > 0 ? entries : [createEmptyEntry()]),
    [entries]
  )

  const updateEntry = (id: string, patch: Partial<TagFilterEntry>) => {
    const existing = filtersToShow.find((e) => e.id === id)
    if (!existing) return
    const updated = filtersToShow.map((e) => (e.id === id ? { ...e, ...patch } : e))
    onChange(updated)
  }

  const handleTagChange = (id: string, tagName: string) => {
    const def = tagDefinitions.find((t) => t.displayName === tagName)
    const fieldType = (def?.fieldType || 'text') as FilterFieldType
    const operators = getOperatorsForFieldType(fieldType)
    updateEntry(id, {
      tagName,
      tagSlot: def?.tagSlot || '',
      fieldType,
      operator: operators[0]?.value || 'eq',
      value: '',
      valueTo: '',
    })
  }

  const addFilter = () => {
    onChange([...filtersToShow, createEmptyEntry()])
  }

  const removeFilter = (id: string) => {
    const remaining = filtersToShow.filter((e) => e.id !== id)
    onChange(remaining.length > 0 ? remaining : [])
  }

  if (tagDefinitions.length === 0) return null

  return (
    <div className='border-[var(--border-1)] border-t'>
      <div className='flex items-center justify-between px-3 py-2'>
        <span className='font-medium text-[var(--text-secondary)] text-caption'>
          Filter by tags
        </span>
        <div className='flex items-center gap-1'>
          {activeCount > 0 && (
            <Button
              variant='ghost'
              className='h-auto px-1.5 py-0.5 text-[var(--text-muted)] text-xs'
              onClick={() => onChange([])}
            >
              Clear all
            </Button>
          )}
          <Button variant='ghost' className='h-auto p-0' onClick={addFilter}>
            <Plus className='h-3.5 w-3.5' />
          </Button>
        </div>
      </div>

      <div className='flex max-h-[320px] flex-col gap-2 overflow-y-auto px-3 pb-3'>
        {filtersToShow.map((entry) => {
          const operators = getOperatorsForFieldType(entry.fieldType)
          const operatorOptions: ComboboxOption[] = operators.map((op) => ({
            value: op.value,
            label: op.label,
          }))
          const isBetween = entry.operator === 'between'

          return (
            <div
              key={entry.id}
              className='flex flex-col gap-1.5 rounded-md border border-[var(--border-1)] p-2'
            >
              <div className='flex items-center justify-between'>
                <Label className='text-[var(--text-muted)] text-xs'>Tag</Label>
                <button
                  type='button'
                  onClick={() => removeFilter(entry.id)}
                  className='text-[var(--text-muted)] transition-colors hover-hover:text-[var(--text-error)]'
                >
                  <X className='h-3 w-3' />
                </button>
              </div>
              <Combobox
                options={tagOptions}
                value={entry.tagName}
                onChange={(v) => handleTagChange(entry.id, v)}
                placeholder='Select tag'
              />

              {entry.tagSlot && (
                <>
                  <Label className='text-[var(--text-muted)] text-xs'>Operator</Label>
                  <Combobox
                    options={operatorOptions}
                    value={entry.operator}
                    onChange={(v) => updateEntry(entry.id, { operator: v, valueTo: '' })}
                    placeholder='Select operator'
                  />

                  <Label className='text-[var(--text-muted)] text-xs'>Value</Label>
                  {entry.fieldType === 'date' ? (
                    isBetween ? (
                      <div className='flex items-center gap-1.5'>
                        <DatePicker
                          size='sm'
                          value={entry.value || undefined}
                          onChange={(v) => updateEntry(entry.id, { value: v })}
                          placeholder='From'
                        />
                        <span className='flex-shrink-0 text-[var(--text-muted)] text-xs'>to</span>
                        <DatePicker
                          size='sm'
                          value={entry.valueTo || undefined}
                          onChange={(v) => updateEntry(entry.id, { valueTo: v })}
                          placeholder='To'
                        />
                      </div>
                    ) : (
                      <DatePicker
                        size='sm'
                        value={entry.value || undefined}
                        onChange={(v) => updateEntry(entry.id, { value: v })}
                        placeholder='Select date'
                      />
                    )
                  ) : isBetween ? (
                    <div className='flex items-center gap-1.5'>
                      <Input
                        value={entry.value}
                        onChange={(e) => updateEntry(entry.id, { value: e.target.value })}
                        placeholder='From'
                        className='h-[28px] text-caption'
                      />
                      <span className='flex-shrink-0 text-[var(--text-muted)] text-xs'>to</span>
                      <Input
                        value={entry.valueTo}
                        onChange={(e) => updateEntry(entry.id, { valueTo: e.target.value })}
                        placeholder='To'
                        className='h-[28px] text-caption'
                      />
                    </div>
                  ) : (
                    <Input
                      value={entry.value}
                      onChange={(e) => updateEntry(entry.id, { value: e.target.value })}
                      placeholder={
                        entry.fieldType === 'boolean'
                          ? 'true or false'
                          : entry.fieldType === 'number'
                            ? 'Enter number'
                            : 'Enter value'
                      }
                      className='h-[28px] text-caption'
                    />
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
