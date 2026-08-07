'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChipConfirmModal,
  type ChipConfirmTextSegment,
  ChipModal,
  ChipModalBody,
  ChipModalHeader,
  Trash,
} from '@sim/emcn'
import { Database, Pencil, Plus, TagIcon } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { useParams, useRouter } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { Resource } from '@/components/resource'
import {
  type KnowledgeDocumentList,
  type KnowledgeEnabledFilter,
  KnowledgeView,
  type TagFilterEntry,
} from '@/components/resources/knowledge-view'
import type { DocumentSortField, SortOrder } from '@/lib/knowledge/documents/types'
import type { DocumentData } from '@/lib/knowledge/types'
import { captureEvent } from '@/lib/posthog/client'
import type { BreadcrumbItem, ResourceAction } from '@/app/workspace/[workspaceId]/components'
import { DocumentTagsModal } from '@/app/workspace/[workspaceId]/knowledge/[id]/[documentId]/components'
import {
  ActionBar,
  AddConnectorModal,
  AddDocumentsModal,
  BaseTagsModal,
  ConnectorsSection,
  DocumentContextMenu,
  RenameDocumentModal,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/components'
import { useKnowledgeListState } from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-knowledge-list-state'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import {
  useKnowledgeBase,
  useKnowledgeBaseDocuments,
  useKnowledgeBasesList,
} from '@/hooks/kb/use-knowledge'
import { useKnowledgeBaseTagDefinitions } from '@/hooks/kb/use-knowledge-base-tag-definitions'
import { isConnectorSyncingOrPending, useConnectorList } from '@/hooks/queries/kb/connectors'
import {
  useBulkDocumentOperation,
  useDeleteDocument,
  useDeleteKnowledgeBase,
  useUpdateDocument,
  useUpdateKnowledgeBase,
} from '@/hooks/queries/kb/knowledge'
import { useInlineRename } from '@/hooks/use-inline-rename'
import { useOAuthReturnForKBConnectors } from '@/hooks/use-oauth-return'
import { grantsFromPermissions, type ResourceHost, workspaceSource } from '@/resources'

const logger = createLogger('KnowledgeBase')

const DOCUMENTS_PER_PAGE = 50

interface KnowledgeBaseProps {
  id: string
  knowledgeBaseName?: string
  workspaceId?: string
  /**
   * Who owns the URL around this surface. The knowledge page owns it; the
   * mothership panel does not, and its document-list view-state stays local so
   * it never writes `?q` / `?enabled` / `?sort` / `?dir` / `?page` into the
   * host's address bar.
   */
  host: ResourceHost
}

/**
 * The knowledge base editing shell: the header and every mutation a workspace
 * member can perform on a base (upload, connectors, tags, rename, delete, bulk
 * enable/disable/delete), wrapped around the canonical {@link KnowledgeView}
 * that renders the document list itself.
 */
export function KnowledgeBase({
  id,
  knowledgeBaseName: passedKnowledgeBaseName,
  workspaceId: propWorkspaceId,
  host,
}: KnowledgeBaseProps) {
  const params = useParams()
  const workspaceId = propWorkspaceId || (params.workspaceId as string)
  const router = useRouter()
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
  const [selectedDocuments, setSelectedDocuments] = useState<Set<string>>(() => new Set())
  const [isSelectAllMode, setIsSelectAllMode] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [showAddDocumentsModal, setShowAddDocumentsModal] = useState(false)
  const [showDeleteDocumentModal, setShowDeleteDocumentModal] = useState(false)
  const [documentToDelete, setDocumentToDelete] = useState<string | null>(null)
  const [showBulkDeleteModal, setShowBulkDeleteModal] = useState(false)
  const [showConnectorsModal, setShowConnectorsModal] = useState(false)

  /** Clearing the list selection is what every filter change does before refetching. */
  const clearSelection = useCallback(() => {
    setSelectedDocuments(new Set())
    setIsSelectAllMode(false)
  }, [])

  const {
    searchQuery,
    setSearchQuery,
    highlightQuery,
    debouncedSearchQuery,
    enabledFilter,
    setEnabledFilter,
    tagFilterEntries,
    setTagFilterEntries,
    activeTagFilters,
    currentPage,
    setCurrentPage,
    sortColumn,
    sortDirection,
    sort,
    addConnectorType,
    setAddConnectorType,
  } = useKnowledgeListState({ host })

  const showAddConnectorModal = addConnectorType != null
  const setShowAddConnectorModal = useCallback(
    (open: boolean) => setAddConnectorType(open ? '' : null),
    [setAddConnectorType]
  )

  const [contextMenuDocument, setContextMenuDocument] = useState<DocumentData | null>(null)
  const [showRenameModal, setShowRenameModal] = useState(false)
  const [documentToRename, setDocumentToRename] = useState<DocumentData | null>(null)
  const [showDocumentTagsModal, setShowDocumentTagsModal] = useState(false)
  const [documentForTagsId, setDocumentForTagsId] = useState<string | null>(null)

  const {
    isOpen: isContextMenuOpen,
    position: contextMenuPosition,
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
    error: documentsError,
    hasProcessingDocuments,
    updateDocument,
    refreshDocuments,
  } = useKnowledgeBaseDocuments(id, {
    search: debouncedSearchQuery.trim() || undefined,
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

  const source = useMemo(
    () => workspaceSource({ kind: 'knowledge', workspaceId, resourceId: id }),
    [workspaceId, id]
  )
  const grants = useMemo(() => grantsFromPermissions(userPermissions), [userPermissions])

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
   * Opens the rename document modal
   */
  const handleRenameDocument = (doc: DocumentData) => {
    setDocumentToRename(doc)
    setShowRenameModal(true)
  }

  /**
   * Opens the document tags modal
   */
  const handleViewDocumentTags = (doc: DocumentData) => {
    setDocumentForTagsId(doc.id)
    setShowDocumentTagsModal(true)
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
                icon: TagIcon,
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

  const handleEnabledFilterChange = useCallback(
    (value: KnowledgeEnabledFilter) => {
      setEnabledFilter(value)
      clearSelection()
    },
    [setEnabledFilter, clearSelection]
  )

  const handleTagFilterEntriesChange = useCallback(
    (entries: TagFilterEntry[]) => {
      setTagFilterEntries(entries)
      clearSelection()
    },
    [setTagFilterEntries, clearSelection]
  )

  const unavailable = Boolean(error) && !knowledgeBase

  const list: KnowledgeDocumentList = {
    documents,
    tagDefinitions,
    connectors,
    unavailable,
    search: searchQuery,
    onSearchChange: setSearchQuery,
    highlightQuery,
    enabledFilter,
    onEnabledFilterChange: handleEnabledFilterChange,
    tagFilterEntries,
    onTagFilterEntriesChange: handleTagFilterEntriesChange,
    sort,
    pagination: {
      currentPage,
      totalPages,
      onPageChange: (page) => setCurrentPage(page),
    },
  }

  /**
   * A knowledge base that could not be resolved replaces the whole surface —
   * no header, no toolbar, no modals. There is nothing to act on, and the
   * breadcrumb would name a base that is gone.
   */
  if (unavailable) {
    return <KnowledgeView source={source} grants={grants} host={host} list={list} />
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
        <KnowledgeView
          source={source}
          grants={grants}
          host={host}
          list={list}
          interaction={{
            selection: {
              selectedIds: selectedDocuments,
              onSelectRow: handleSelectDocument,
              onSelectAll: handleSelectAll,
              isAllSelected,
            },
            onRowClick: handleDocumentClick,
            onRowContextMenu: handleDocumentContextMenu,
            onConnectorSelect: () => setShowConnectorsModal(true),
            overlay: (
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
                onClearSelectAll={clearSelection}
              />
            ),
          }}
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
          onConnectorTypeChange={setAddConnectorType}
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

      {documentForTagsId && (
        <DocumentTagsModal
          open={showDocumentTagsModal}
          onOpenChange={setShowDocumentTagsModal}
          knowledgeBaseId={id}
          documentId={documentForTagsId}
          documentData={documents.find((doc) => doc.id === documentForTagsId) ?? null}
          onDocumentUpdate={(updates) => updateDocument(documentForTagsId, updates)}
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
          contextMenuDocument && selectedDocuments.size === 1 && userPermissions.canEdit
            ? () => handleViewDocumentTags(contextMenuDocument)
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
