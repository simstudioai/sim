'use client'

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Badge,
  Button,
  ChipConfirmModal,
  type ChipConfirmTextSegment,
  ChipDatePicker,
  ChipDropdown,
  type ChipDropdownOption,
  ChipInput,
  ChipModal,
  ChipModalBody,
  ChipModalHeader,
  cellIconNodeClass,
  chipContentGap,
  chipContentLabelClass,
  chipVariants,
  cn,
  Loader,
  Tooltip,
  Trash,
} from '@sim/emcn'
import { Database, DatabaseX } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { format } from 'date-fns'
import { AlertCircle, Pencil, Plus, Tag, X } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { debounce, useQueryState, useQueryStates } from 'nuqs'
import { usePostHog } from 'posthog-js/react'
import { SearchHighlight } from '@/components/ui/search-highlight'
import { ALL_TAG_SLOTS, type AllTagSlot, getFieldTypeForSlot } from '@/lib/knowledge/constants'
import type { DocumentSortField, SortOrder } from '@/lib/knowledge/documents/types'
import { type FilterFieldType, getOperatorsForFieldType } from '@/lib/knowledge/filters/types'
import type { DocumentData } from '@/lib/knowledge/types'
import { captureEvent } from '@/lib/posthog/client'
import { formatFileSize } from '@/lib/uploads/utils/file-utils'
import type {
  BreadcrumbItem,
  FilterTag,
  ResourceAction,
  ResourceCell,
  ResourceColumn,
  ResourceRow,
  SelectableConfig,
  SortConfig,
} from '@/app/workspace/[workspaceId]/components'
import { FloatingOverflowText, Resource } from '@/app/workspace/[workspaceId]/components'
import {
  ActionBar,
  AddConnectorModal,
  AddDocumentsModal,
  BaseTagsModal,
  ConnectorsSection,
  DocumentContextMenu,
  RenameDocumentModal,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/components'
import {
  addConnectorParam,
  DEFAULT_KB_SORT_COLUMN,
  DEFAULT_KB_SORT_DIRECTION,
  documentFiltersParsers,
  documentFiltersUrlKeys,
  type KbSortColumn,
  pageParam,
  pageUrlKeys,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/search-params'
import { getDocumentIcon } from '@/app/workspace/[workspaceId]/knowledge/components'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import {
  useKnowledgeBase,
  useKnowledgeBaseDocuments,
  useKnowledgeBasesList,
} from '@/hooks/kb/use-knowledge'
import {
  type TagDefinition,
  useKnowledgeBaseTagDefinitions,
} from '@/hooks/kb/use-knowledge-base-tag-definitions'
import { isConnectorSyncingOrPending, useConnectorList } from '@/hooks/queries/kb/connectors'
import type { DocumentTagFilter } from '@/hooks/queries/kb/knowledge'
import {
  useBulkDocumentOperation,
  useDeleteDocument,
  useDeleteKnowledgeBase,
  useUpdateDocument,
  useUpdateKnowledgeBase,
} from '@/hooks/queries/kb/knowledge'
import { useDebounce } from '@/hooks/use-debounce'
import { useInlineRename } from '@/hooks/use-inline-rename'
import { useOAuthReturnForKBConnectors } from '@/hooks/use-oauth-return'

const logger = createLogger('KnowledgeBase')

const DOCUMENTS_PER_PAGE = 50

const DOCUMENT_COLUMNS: ResourceColumn[] = [
  { id: 'name', header: 'Name', widthMultiplier: 0.8 },
  { id: 'size', header: 'Size', widthMultiplier: 0.75 },
  { id: 'tokens', header: 'Tokens', widthMultiplier: 0.75 },
  { id: 'chunks', header: 'Chunks', widthMultiplier: 0.75 },
  { id: 'uploaded', header: 'Uploaded' },
  { id: 'status', header: 'Status', widthMultiplier: 0.75 },
  { id: 'tags', header: 'Tags' },
]

const STATUS_FILTER_OPTIONS: ChipDropdownOption[] = [
  { value: 'all', label: 'All' },
  { value: 'enabled', label: 'Enabled' },
  { value: 'disabled', label: 'Disabled' },
]

const FILTER_SECTION_LABEL_CLASS = 'text-[var(--text-muted)] text-small'

interface KnowledgeBaseProps {
  id: string
  knowledgeBaseName?: string
  workspaceId?: string
}

const AnimatedLoader = ({ className }: { className?: string }) => (
  <Loader className={className} animate />
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
  const router = useRouter()
  const [addConnectorType, setAddConnectorType] = useQueryState(
    addConnectorParam.key,
    addConnectorParam.parser
  )
  const posthog = usePostHog()

  useEffect(() => {
    captureEvent(posthog, 'knowledge_base_opened', {
      knowledge_base_id: id,
      knowledge_base_name: passedKnowledgeBaseName ?? 'Unknown',
    })
  }, [id, passedKnowledgeBaseName, posthog])

  useOAuthReturnForKBConnectors(id)
  const { removeKnowledgeBase } = useKnowledgeBasesList(workspaceId, { enabled: false })
  const userPermissions = useUserPermissionsContext()

  const { mutate: updateDocumentMutation, mutateAsync: updateDocumentAsync } = useUpdateDocument()
  const { mutate: deleteDocumentMutation } = useDeleteDocument()
  const { mutate: deleteKnowledgeBaseMutation, isPending: isDeleting } =
    useDeleteKnowledgeBase(workspaceId)
  const { mutateAsync: updateKnowledgeBaseMutation } = useUpdateKnowledgeBase(workspaceId)

  const kbRename = useInlineRename({
    onSave: (kbId, name) =>
      updateKnowledgeBaseMutation({ knowledgeBaseId: kbId, updates: { name } }),
  })
  const { mutate: bulkDocumentMutation, isPending: isBulkOperating } = useBulkDocumentOperation()

  const [showTagsModal, setShowTagsModal] = useState(false)
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
        .filter((f) => {
          if (!f.tagSlot || !f.value.trim()) return false
          // A `between` filter only applies once both bounds are set. Sending it
          // with just the lower bound would be rejected at the API boundary and
          // break the whole list while the user is still entering the range.
          if (f.operator === 'between' && !f.valueTo.trim()) return false
          return true
        })
        .map((f) => ({
          tagSlot: f.tagSlot,
          fieldType: f.fieldType,
          operator: f.operator,
          value: f.value,
          ...(f.operator === 'between' ? { valueTo: f.valueTo } : {}),
        })),
    [tagFilterEntries]
  )

  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(() => new Set())
  const [isSelectAllMode, setIsSelectAllMode] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showAddDocumentsModal, setShowAddDocumentsModal] = useState(false)
  const [showDeleteDocumentModal, setShowDeleteDocumentModal] = useState(false)
  const [documentToDelete, setDocumentToDelete] = useState<string | null>(null)
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false)
  const [showConnectorsModal, setShowConnectorsModal] = useState(false)
  const [currentPage, setCurrentPage] = useQueryState(pageParam.key, {
    ...pageParam.parser,
    ...pageUrlKeys,
  })

  const [
    { q: searchQuery, enabled: enabledFilter, sort: sortColumn, dir: sortDirection },
    setDocumentFilters,
  ] = useQueryStates(documentFiltersParsers, documentFiltersUrlKeys)

  /**
   * The input is controlled directly by the instant nuqs value; only the URL
   * write is debounced. The document query below reads a debounced value so it
   * doesn't refetch on every keystroke. Changing the search resets pagination.
   */
  const handleSearchChange = useCallback(
    (newQuery: string) => {
      const trimmed = newQuery.trim()
      const next = trimmed.length > 0 ? trimmed : null
      setDocumentFilters(
        { q: next },
        next === null ? undefined : { limitUrlUpdates: debounce(300) }
      )
      setCurrentPage(1)
    },
    [setDocumentFilters, setCurrentPage]
  )
  const debouncedSearchQuery = useDebounce(searchQuery, 300)

  /**
   * The resolved sort is exposed to the sort menu only when it differs from the
   * default, mirroring the prior `null`-means-default semantics.
   */
  const activeSort = useMemo(
    () =>
      sortColumn === DEFAULT_KB_SORT_COLUMN && sortDirection === DEFAULT_KB_SORT_DIRECTION
        ? null
        : { column: sortColumn, direction: sortDirection },
    [sortColumn, sortDirection]
  )

  const setEnabledFilter = useCallback(
    (value: 'all' | 'enabled' | 'disabled') => {
      setDocumentFilters({ enabled: value })
      setCurrentPage(1)
    },
    [setDocumentFilters, setCurrentPage]
  )

  const [contextMenuDocument, setContextMenuDocument] = useState<DocumentData | null>(null)
  const [showRenameModal, setShowRenameModal] = useState(false)
  const [documentToRename, setDocumentToRename] = useState<DocumentData | null>(null)
  const showAddConnectorModal = addConnectorType != null
  const updateAddConnectorParam = useCallback(
    (value: string | null) => {
      void setAddConnectorType(value, { history: 'replace', scroll: false })
    },
    [setAddConnectorType]
  )
  const setShowAddConnectorModal = useCallback(
    (open: boolean) => updateAddConnectorParam(open ? '' : null),
    [updateAddConnectorParam]
  )

  const {
    isOpen: isContextMenuOpen,
    position: contextMenuPosition,
    menuRef,
    handleContextMenu: baseHandleContextMenu,
    closeMenu: closeContextMenu,
  } = useContextMenu()

  const {
    knowledgeBase,
    error: knowledgeBaseError,
    refresh: refreshKnowledgeBase,
  } = useKnowledgeBase(id)

  const { data: connectors = [], isLoading: isLoadingConnectors } = useConnectorList(id)
  const hasSyncingConnectors = connectors.some(isConnectorSyncingOrPending)
  const hasSyncingConnectorsRef = useRef(hasSyncingConnectors)
  hasSyncingConnectorsRef.current = hasSyncingConnectors

  const {
    documents,
    pagination,
    isPlaceholderData: isPlaceholderDocuments,
    error: documentsError,
    hasProcessingDocuments,
    updateDocument,
    refreshDocuments,
  } = useKnowledgeBaseDocuments(id, {
    search: debouncedSearchQuery || undefined,
    limit: DOCUMENTS_PER_PAGE,
    offset: (currentPage - 1) * DOCUMENTS_PER_PAGE,
    sortBy: sortColumn as DocumentSortField,
    sortOrder: sortDirection as SortOrder,
    refetchInterval: (data) => {
      if (isDeleting) return false
      const hasPending = data?.documents?.some(
        (doc) => doc.processingStatus === 'pending' || doc.processingStatus === 'processing'
      )
      if (hasPending) return 3000
      if (hasSyncingConnectorsRef.current) return 5000
      return false
    },
    enabledFilter: enabledFilter,
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

  const knowledgeBaseName = knowledgeBase?.name || passedKnowledgeBaseName || 'Knowledge Base'
  /**
   * Breadcrumb leaf label. Falls back to the canonical '…' placeholder while
   * the name loads (mirroring loading.tsx) instead of duplicating the root
   * "Knowledge Base" crumb.
   */
  const knowledgeBaseCrumbLabel = knowledgeBase?.name || passedKnowledgeBaseName || '…'
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
            processingError: getErrorMessage(err, 'Failed to retry document processing'),
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

    try {
      await updateDocumentAsync({ knowledgeBaseId: id, documentId, updates: { filename: newName } })
      logger.info(`Document renamed: ${documentId}`)
    } catch (err) {
      if (previousName !== undefined) {
        updateDocument(documentId, { filename: previousName })
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
          enabledFilter: enabledFilter,
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
          enabledFilter: enabledFilter,
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
          enabledFilter: enabledFilter,
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

  const breadcrumbs: BreadcrumbItem[] = [
    {
      label: 'Knowledge Base',
      icon: Database,
      onClick: () => router.push(`/workspace/${workspaceId}/knowledge`),
    },
    {
      label: knowledgeBaseCrumbLabel,
      icon: Database,
      editing: kbRename.editingId
        ? {
            isEditing: true,
            value: kbRename.editValue,
            onChange: kbRename.setEditValue,
            onSubmit: kbRename.submitRename,
            onCancel: kbRename.cancelRename,
            disabled: kbRename.isSaving,
          }
        : undefined,
      dropdownItems: [
        ...(userPermissions.canEdit || userPermissions.isLoading
          ? [
              {
                label: 'Rename',
                icon: Pencil,
                disabled: !userPermissions.canEdit,
                onClick: () => kbRename.startRename(id, knowledgeBaseName),
              },
              {
                label: 'Tags',
                icon: Tag,
                disabled: !userPermissions.canEdit,
                onClick: () => setShowTagsModal(true),
              },
              {
                label: 'Delete',
                icon: Trash,
                disabled: !userPermissions.canEdit,
                onClick: () => setShowDeleteDialog(true),
              },
            ]
          : []),
      ],
    },
  ]

  const headerActions: ResourceAction[] = [
    ...(userPermissions.canEdit || userPermissions.isLoading
      ? [
          {
            text: 'New connector',
            icon: Plus,
            disabled: !userPermissions.canEdit,
            onSelect: () => setShowAddConnectorModal(true),
          },
        ]
      : []),
  ]

  const sortConfig: SortConfig = useMemo(
    () => ({
      options: [
        { id: 'filename', label: 'Name' },
        { id: 'fileSize', label: 'Size' },
        { id: 'tokenCount', label: 'Tokens' },
        { id: 'chunkCount', label: 'Chunks' },
        { id: 'uploadedAt', label: 'Uploaded' },
        { id: 'enabled', label: 'Status' },
      ],
      active: activeSort,
      onSort: (column, direction) => {
        setDocumentFilters({ sort: column as KbSortColumn, dir: direction })
        setCurrentPage(1)
      },
      /**
       * Clearing writes the defaults back (stripped by clearOnDefault), so the
       * sort menu reads "no active sort" again and the URL stays clean.
       */
      onClear: () => {
        setDocumentFilters({ sort: DEFAULT_KB_SORT_COLUMN, dir: DEFAULT_KB_SORT_DIRECTION })
        setCurrentPage(1)
      },
    }),
    [activeSort, setDocumentFilters, setCurrentPage]
  )

  const filterContent = useMemo(
    () => (
      <AutoWidthPanel>
        <div className='flex flex-col gap-2'>
          <div className='flex h-5 items-center justify-between'>
            <span className={FILTER_SECTION_LABEL_CLASS}>Status</span>
            {enabledFilter !== 'all' && (
              <Button
                variant='ghost'
                onClick={() => {
                  setEnabledFilter('all')
                  setSelectedDocuments(new Set())
                  setIsSelectAllMode(false)
                }}
                className='-mr-1 h-auto px-1 py-0.5 text-[var(--text-muted)] text-caption hover-hover:text-[var(--text-secondary)]'
              >
                Clear
              </Button>
            )}
          </div>
          <ChipDropdown
            options={STATUS_FILTER_OPTIONS}
            value={enabledFilter}
            onChange={(value) => {
              if (value !== 'all' && value !== 'enabled' && value !== 'disabled') return
              setEnabledFilter(value)
              setSelectedDocuments(new Set())
              setIsSelectAllMode(false)
            }}
            align='start'
            fullWidth
            flush
          />
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
      </AutoWidthPanel>
    ),
    [enabledFilter, tagDefinitions, tagFilterEntries]
  )

  const connectorBadges =
    connectors.length > 0 ? (
      <>
        {connectors.map((connector) => {
          const def = CONNECTOR_META_REGISTRY[connector.connectorType]
          const ConnectorIcon = def?.icon
          return (
            <button
              key={connector.id}
              type='button'
              onClick={() => setShowConnectorsModal(true)}
              className={cn(chipVariants({ variant: 'filled', flush: true }), 'max-w-[180px]')}
            >
              <span className='relative flex size-[14px] flex-shrink-0 items-center justify-center'>
                {connector.status === 'syncing' ? (
                  <Loader className='size-[14px]' animate />
                ) : (
                  ConnectorIcon && <ConnectorIcon className='size-[14px]' />
                )}
                {connector.status !== 'active' && connector.status !== 'syncing' && (
                  <span
                    className={cn(
                      '-right-0.5 -top-0.5 absolute size-1.5 rounded-xs border border-[var(--surface-2)]',
                      connector.status === 'error'
                        ? 'bg-[var(--text-error)]'
                        : connector.status === 'disabled'
                          ? 'bg-[var(--caution)]'
                          : 'bg-[var(--text-muted)]'
                    )}
                  />
                )}
              </span>
              <span className='truncate text-[var(--text-body)]'>
                {def?.name || connector.connectorType}
              </span>
            </button>
          )
        })}
      </>
    ) : null

  const filterTags: FilterTag[] = useMemo(
    () => [
      ...(enabledFilter !== 'all'
        ? [
            {
              label: `Status: ${enabledFilter === 'enabled' ? 'Enabled' : 'Disabled'}`,
              onRemove: () => {
                setEnabledFilter('all')
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
            const updated = tagFilterEntries.filter((e) => e.id !== f.id)
            setTagFilterEntries(updated)
            setCurrentPage(1)
            setSelectedDocuments(new Set())
            setIsSelectAllMode(false)
          },
        })),
    ],
    [enabledFilter, tagFilterEntries]
  )

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
        const ConnectorIcon = doc.connectorType
          ? CONNECTOR_META_REGISTRY[doc.connectorType]?.icon
          : null
        const DocIcon = ConnectorIcon || getDocumentIcon(doc.mimeType, doc.filename)

        const tags = getDocumentTags(doc, tagDefinitions)
        const tagsDisplayText = tags.map((t) => t.value).join(', ')

        const statusCell: ResourceCell =
          doc.processingStatus === 'failed' && doc.processingError
            ? {
                content: (
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <div className='cursor-help'>{getStatusBadge(doc)}</div>
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
                        role='presentation'
                        className='block max-w-full truncate text-[var(--text-secondary)] text-caption'
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        {tagsDisplayText}
                      </span>
                    </Tooltip.Trigger>
                    <Tooltip.Content side='top' className='max-w-[240px]'>
                      <div className='flex flex-col gap-0.5'>
                        {tags.map((tag) => (
                          <div key={tag.slot} className='truncate text-xs'>
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
                <span className={cn('flex min-w-0 items-center', chipContentGap)}>
                  <span className={cellIconNodeClass}>
                    <DocIcon className='size-[14px]' />
                  </span>
                  <FloatingOverflowText
                    label={doc.filename}
                    className={cn('block', chipContentLabelClass)}
                  >
                    <SearchHighlight text={doc.filename} searchQuery={searchQuery} />
                  </FloatingOverflowText>
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

  if (error && !knowledgeBase) {
    return (
      <div className='flex h-full flex-col items-center justify-center gap-3'>
        <DatabaseX className='size-[32px] text-[var(--text-muted)]' />
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
      <Resource onContextMenu={handleEmptyContextMenu}>
        <Resource.Header
          icon={Database}
          title='Knowledge Base'
          breadcrumbs={breadcrumbs}
          actions={[
            ...headerActions,
            {
              text: 'New documents',
              icon: Plus,
              onSelect: handleAddDocuments,
              disabled: userPermissions.canEdit !== true,
              variant: 'primary',
            },
          ]}
        />
        <Resource.Options
          search={{
            value: searchQuery,
            onChange: handleSearchChange,
            placeholder: 'Search documents...',
          }}
          sort={sortConfig}
          filter={filterContent ? { content: filterContent } : undefined}
          filterTags={filterTags}
          aside={connectorBadges}
        />
        <Resource.Table
          columns={DOCUMENT_COLUMNS}
          rows={documentRows}
          selectable={selectableConfig}
          onRowClick={handleDocumentClick}
          onRowContextMenu={handleDocumentContextMenu}
          pagination={{
            currentPage,
            totalPages,
            onPageChange: (page) => setCurrentPage(page),
          }}
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
      </Resource>

      <BaseTagsModal open={showTagsModal} onOpenChange={setShowTagsModal} knowledgeBaseId={id} />

      <ChipConfirmModal
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        srTitle='Delete Knowledge Base'
        title='Delete Knowledge Base'
        text={[
          'Are you sure you want to delete ',
          { text: knowledgeBaseName, bold: true },
          '? ',
          {
            text: `The knowledge base and all ${pagination.total} document${pagination.total === 1 ? '' : 's'} within it will be removed.`,
            error: true,
          },
          ' You can restore it from Recently Deleted in Settings.',
        ]}
        confirm={{
          label: 'Delete Knowledge Base',
          onClick: handleDeleteKnowledgeBase,
          pending: isDeleting,
          pendingLabel: 'Deleting...',
        }}
      />

      <ChipConfirmModal
        open={showDeleteDocumentModal}
        onOpenChange={(open) => {
          setShowDeleteDocumentModal(open)
          if (!open) setDocumentToDelete(null)
        }}
        srTitle='Delete Document'
        title='Delete Document'
        text={(() => {
          const docToDelete = documents.find((doc) => doc.id === documentToDelete)
          const base: ChipConfirmTextSegment[] = [
            'Are you sure you want to delete ',
            { text: docToDelete?.filename ?? 'this document', bold: true },
            '? ',
          ]
          return docToDelete?.connectorId
            ? [
                ...base,
                {
                  text: 'This document is synced from a connector. Deleting it will permanently exclude it from future syncs. To temporarily hide it from search, disable it instead.',
                  error: true,
                },
              ]
            : [
                ...base,
                { text: 'This will permanently delete the document.', error: true },
                ' This action cannot be undone.',
              ]
        })()}
        confirm={{
          label: 'Delete Document',
          onClick: confirmDeleteDocument,
        }}
      />

      <ChipConfirmModal
        open={showBulkDeleteModal}
        onOpenChange={setShowBulkDeleteModal}
        srTitle='Delete Documents'
        title='Delete Documents'
        text={[
          `Are you sure you want to delete ${selectedDocuments.size} document${selectedDocuments.size === 1 ? '' : 's'}? `,
          {
            text: `This will permanently delete the selected document${selectedDocuments.size === 1 ? '' : 's'}.`,
            error: true,
          },
          ' This action cannot be undone.',
        ]}
        confirm={{
          label: `Delete ${selectedDocuments.size} Document${selectedDocuments.size === 1 ? '' : 's'}`,
          onClick: confirmBulkDelete,
          pending: isBulkOperating,
          pendingLabel: 'Deleting...',
        }}
      />

      <AddDocumentsModal
        open={showAddDocumentsModal}
        onOpenChange={setShowAddDocumentsModal}
        knowledgeBaseId={id}
        chunkingConfig={knowledgeBase?.chunkingConfig}
      />

      {showAddConnectorModal && (
        <AddConnectorModal
          open
          onOpenChange={setShowAddConnectorModal}
          onConnectorTypeChange={updateAddConnectorParam}
          knowledgeBaseId={id}
          initialConnectorType={addConnectorType || undefined}
        />
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

      <ChipModal
        open={showConnectorsModal}
        onOpenChange={setShowConnectorsModal}
        srTitle='Connected Sources'
      >
        <ChipModalHeader onClose={() => setShowConnectorsModal(false)}>
          Connected Sources
        </ChipModalHeader>
        <ChipModalBody>
          <ConnectorsSection
            workspaceId={workspaceId}
            knowledgeBaseId={id}
            connectors={connectors}
            isLoading={isLoadingConnectors}
            canEdit={userPermissions.canEdit}
            className='mt-0'
          />
        </ChipModalBody>
      </ChipModal>

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

/**
 * Sizes the filter popover to its content with pure CSS `max-content` (clamped to
 * `[280, 420]`). Because the padding box is part of `max-content`, the `p-3`
 * inset is preserved on every edge — there is no separate measured/animated outer
 * layer that can disagree by a few pixels and clip the right padding. The width
 * still adapts to the active filters; it just resizes instantly rather than
 * animating.
 */
function AutoWidthPanel({ children }: { children: ReactNode }) {
  return <div className='flex w-max min-w-[280px] max-w-[420px] flex-col p-3'>{children}</div>
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
  id: generateId(),
  tagName: '',
  tagSlot: '',
  fieldType: 'text',
  operator: 'contains',
  value: '',
  valueTo: '',
})

/**
 * Default operator when a tag is selected. Text filters default to `contains`
 * so typing part of a value finds matches (exact `equals` stays one click away
 * in the operator dropdown); other field types keep their first, equality
 * operator.
 */
function getDefaultOperatorForFieldType(
  fieldType: FilterFieldType,
  operators: ReturnType<typeof getOperatorsForFieldType>
): string {
  if (fieldType === 'text') return 'contains'
  return operators[0]?.value ?? 'eq'
}

interface TagFilterSectionProps {
  tagDefinitions: TagDefinition[]
  entries: TagFilterEntry[]
  onChange: (entries: TagFilterEntry[]) => void
}

interface TagFilterValueControlProps {
  entry: TagFilterEntry
  onChange: (patch: Partial<TagFilterEntry>) => void
}

/**
 * Renders the value input for a knowledge base tag filter row.
 */
function TagFilterValueControl({ entry, onChange }: TagFilterValueControlProps) {
  const isBetween = entry.operator === 'between'

  if (entry.fieldType === 'date') {
    if (isBetween) {
      return (
        <div className='grid grid-cols-[1fr_auto_1fr] items-center gap-2'>
          <ChipDatePicker
            value={entry.value || undefined}
            onChange={(value) => onChange({ value })}
            placeholder='From'
            fullWidth
            flush
          />
          <span className='flex-shrink-0 text-[var(--text-muted)] text-caption'>to</span>
          <ChipDatePicker
            value={entry.valueTo || undefined}
            onChange={(value) => onChange({ valueTo: value })}
            placeholder='To'
            fullWidth
            flush
          />
        </div>
      )
    }

    return (
      <ChipDatePicker
        value={entry.value || undefined}
        onChange={(value) => onChange({ value })}
        placeholder='Select date'
        fullWidth
        flush
      />
    )
  }

  if (isBetween) {
    return (
      <div className='grid grid-cols-[1fr_auto_1fr] items-center gap-2'>
        <ChipInput
          value={entry.value}
          onChange={(event) => onChange({ value: event.target.value })}
          placeholder='From'
        />
        <span className='flex-shrink-0 text-[var(--text-muted)] text-caption'>to</span>
        <ChipInput
          value={entry.valueTo}
          onChange={(event) => onChange({ valueTo: event.target.value })}
          placeholder='To'
        />
      </div>
    )
  }

  return (
    <ChipInput
      value={entry.value}
      onChange={(event) => onChange({ value: event.target.value })}
      placeholder={
        entry.fieldType === 'boolean'
          ? 'true or false'
          : entry.fieldType === 'number'
            ? 'Enter number'
            : 'Enter value'
      }
    />
  )
}

/**
 * Tag filter section rendered inside the combined filter popover.
 */
function TagFilterSection({ tagDefinitions, entries, onChange }: TagFilterSectionProps) {
  const activeCount = entries.filter((f) => f.tagSlot && f.value.trim()).length

  const tagOptions: ChipDropdownOption[] = tagDefinitions.map((t) => ({
    value: t.displayName,
    label: t.displayName,
  }))

  const filtersToShow = useMemo(
    () => (entries.length > 0 ? entries : [createEmptyEntry()]),
    [entries]
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef(filtersToShow.length)

  useEffect(() => {
    if (filtersToShow.length > prevCountRef.current) {
      const el = scrollRef.current
      if (el) {
        requestAnimationFrame(() => {
          el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
        })
      }
    }
    prevCountRef.current = filtersToShow.length
  }, [filtersToShow.length])

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
      operator: getDefaultOperatorForFieldType(fieldType, operators),
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
    <div className='mt-3 border-[var(--border-1)] border-t pt-3'>
      <div className='flex h-5 items-center justify-between'>
        <span className={FILTER_SECTION_LABEL_CLASS}>Filter by tags</span>
        {activeCount > 0 && (
          <Button
            variant='ghost'
            className='-mr-1 h-auto px-1 py-0.5 text-[var(--text-muted)] text-caption hover-hover:text-[var(--text-secondary)]'
            onClick={() => onChange([])}
          >
            Clear all
          </Button>
        )}
      </div>

      <div
        ref={scrollRef}
        className='mt-2 flex max-h-[300px] flex-col gap-2 overflow-y-auto overflow-x-hidden'
      >
        {filtersToShow.map((entry, index) => {
          const operators = getOperatorsForFieldType(entry.fieldType)
          const operatorOptions: ChipDropdownOption[] = operators.map((op) => ({
            value: op.value,
            label: op.label,
          }))

          return (
            <div key={entry.id} className='flex flex-col gap-2'>
              {index > 0 && (
                <div className='flex items-center gap-2'>
                  <span className='shrink-0 text-[var(--text-muted)] text-caption leading-none'>
                    and
                  </span>
                  <div className='h-px flex-1 bg-[var(--border-1)]' />
                </div>
              )}
              <div className='flex items-start gap-2'>
                <div className='flex min-w-0 flex-1 flex-wrap items-center gap-2'>
                  <ChipDropdown
                    options={tagOptions}
                    value={entry.tagName}
                    onChange={(value) => handleTagChange(entry.id, value)}
                    placeholder='Select tag'
                    align='start'
                    matchTriggerWidth={false}
                    contentClassName='max-h-[240px] overflow-y-auto'
                    className='max-w-[150px]'
                    flush
                  />
                  {entry.tagSlot && (
                    <ChipDropdown
                      options={operatorOptions}
                      value={entry.operator}
                      onChange={(value) => updateEntry(entry.id, { operator: value, valueTo: '' })}
                      placeholder='Operator'
                      align='start'
                      matchTriggerWidth={false}
                      flush
                    />
                  )}
                </div>
                <Button
                  variant='ghost'
                  className='relative size-[30px] shrink-0 p-0 text-[var(--text-muted)] before:absolute before:inset-[-5px] before:content-[""] hover-hover:bg-[var(--surface-active)] hover-hover:text-[var(--text-error)]'
                  onClick={() => removeFilter(entry.id)}
                  aria-label='Remove tag filter'
                >
                  <X className='size-[14px]' />
                </Button>
              </div>
              {entry.tagSlot && (
                <TagFilterValueControl
                  entry={entry}
                  onChange={(patch) => updateEntry(entry.id, patch)}
                />
              )}
            </div>
          )
        })}
      </div>

      <Button
        variant='ghost'
        onClick={addFilter}
        className='mt-2 h-[30px] w-full justify-start gap-2 px-2 text-[var(--text-secondary)] text-caption hover-hover:text-[var(--text-primary)]'
      >
        <Plus className='size-[14px]' />
        Add filter
      </Button>
    </div>
  )
}
