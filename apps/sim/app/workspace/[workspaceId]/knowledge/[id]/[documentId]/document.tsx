'use client'

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, FileText, Pencil, Tag } from 'lucide-react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  Badge,
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  PopoverItem,
  Trash,
} from '@/components/emcn'
import { SearchHighlight } from '@/components/ui/search-highlight'
import type { ChunkData } from '@/lib/knowledge/types'
import { formatTokenCount } from '@/lib/tokenization'
import type {
  BreadcrumbItem,
  FilterTag,
  HeaderAction,
  PaginationConfig,
  ResourceColumn,
  ResourceRow,
  SearchConfig,
  SelectableConfig,
} from '@/app/workspace/[workspaceId]/components'
import { Resource, ResourceHeader } from '@/app/workspace/[workspaceId]/components'
import {
  ChunkContextMenu,
  ChunkEditor,
  DeleteChunkModal,
  DocumentTagsModal,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/[documentId]/components'
import { ActionBar } from '@/app/workspace/[workspaceId]/knowledge/[id]/components'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { useDocument, useDocumentChunks, useKnowledgeBase } from '@/hooks/kb/use-knowledge'
import {
  knowledgeKeys,
  useBulkChunkOperation,
  useDeleteDocument,
  useDocumentChunkSearchQuery,
  useUpdateChunk,
  useUpdateDocument,
} from '@/hooks/queries/kb/knowledge'
import { useInlineRename } from '@/hooks/use-inline-rename'

const logger = createLogger('Document')

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface UnsavedChangesModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onKeepEditing: () => void
  onDiscard: () => void
}

function UnsavedChangesModal({
  open,
  onOpenChange,
  onKeepEditing,
  onDiscard,
}: UnsavedChangesModalProps) {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size='sm'>
        <ModalHeader>Unsaved Changes</ModalHeader>
        <ModalBody>
          <p className='text-[12px] text-[var(--text-secondary)]'>
            You have unsaved changes. Are you sure you want to discard them?
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant='default' onClick={onKeepEditing}>
            Keep Editing
          </Button>
          <Button variant='destructive' onClick={onDiscard}>
            Discard Changes
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

interface DocumentProps {
  knowledgeBaseId: string
  documentId: string
  knowledgeBaseName?: string
  documentName?: string
}

function truncateContent(content: string, maxLength = 150, searchQuery = ''): string {
  if (content.length <= maxLength) return content

  if (searchQuery.trim()) {
    const searchTerms = searchQuery
      .trim()
      .split(/\s+/)
      .filter((term) => term.length > 0)
      .map((term) => term.toLowerCase())

    for (const term of searchTerms) {
      const matchIndex = content.toLowerCase().indexOf(term)
      if (matchIndex !== -1) {
        const contextBefore = 30
        const start = Math.max(0, matchIndex - contextBefore)
        const end = Math.min(content.length, start + maxLength)

        let result = content.substring(start, end)
        if (start > 0) result = `...${result}`
        if (end < content.length) result = `${result}...`
        return result
      }
    }
  }

  return `${content.substring(0, maxLength)}...`
}

const CHUNK_COLUMNS: ResourceColumn[] = [
  { id: 'content', header: 'Content' },
  { id: 'index', header: 'Index' },
  { id: 'tokens', header: 'Tokens' },
  { id: 'status', header: 'Status' },
]

export function Document({
  knowledgeBaseId,
  documentId,
  knowledgeBaseName,
  documentName,
}: DocumentProps) {
  const queryClient = useQueryClient()
  const { workspaceId } = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const currentPageFromURL = Number.parseInt(searchParams.get('page') || '1', 10)
  const userPermissions = useUserPermissionsContext()

  const { knowledgeBase } = useKnowledgeBase(knowledgeBaseId)
  const {
    document: documentData,
    isLoading: isLoadingDocument,
    error: documentError,
  } = useDocument(knowledgeBaseId, documentId)

  const [showTagsModal, setShowTagsModal] = useState(false)

  const [searchQuery, setSearchQuery] = useState('')
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('')
  const [enabledFilter, setEnabledFilter] = useState<'all' | 'enabled' | 'disabled'>('all')

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
    isFetching: isFetchingChunks,
  } = useDocumentChunks(knowledgeBaseId, documentId, currentPageFromURL, '', enabledFilter)

  const { data: searchResults = [], error: searchQueryError } = useDocumentChunkSearchQuery(
    {
      knowledgeBaseId,
      documentId,
      search: debouncedSearchQuery,
    },
    {
      enabled: Boolean(debouncedSearchQuery.trim()),
    }
  )

  const searchError = searchQueryError instanceof Error ? searchQueryError.message : null

  const [selectedChunks, setSelectedChunks] = useState<Set<string>>(() => new Set())

  // Inline editor state
  const [selectedChunkId, setSelectedChunkId] = useState<string | null>(null)
  const [isCreatingNewChunk, setIsCreatingNewChunk] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [showUnsavedChangesAlert, setShowUnsavedChangesAlert] = useState(false)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const saveRef = useRef<(() => Promise<void>) | null>(null)
  const saveStatusRef = useRef<SaveStatus>('idle')
  saveStatusRef.current = saveStatus

  // Auto-select chunk from URL param on mount
  const initialChunkParam = useRef(searchParams.get('chunk'))
  useEffect(() => {
    if (initialChunkParam.current) {
      setSelectedChunkId(initialChunkParam.current)
      initialChunkParam.current = null
    }
  }, [])

  useEffect(() => {
    const handler = setTimeout(() => {
      startTransition(() => {
        setDebouncedSearchQuery(searchQuery)
      })
    }, 200)

    return () => {
      clearTimeout(handler)
    }
  }, [searchQuery])

  const isSearching = debouncedSearchQuery.trim().length > 0
  const showingSearch = isSearching && searchQuery.trim().length > 0 && searchResults.length > 0
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

  // Keep a ref to displayChunks so cross-page navigation can read fresh data
  const displayChunksRef = useRef(displayChunks)
  displayChunksRef.current = displayChunks

  const goToPage = useCallback(
    async (page: number) => {
      const params = new URLSearchParams(window.location.search)
      if (page > 1) {
        params.set('page', page.toString())
      } else {
        params.delete('page')
      }
      window.history.replaceState(null, '', `?${params.toString()}`)

      if (showingSearch) {
        return
      }
      return await initialGoToPage(page)
    },
    [showingSearch, initialGoToPage]
  )

  const refreshChunks = showingSearch ? async () => {} : initialRefreshChunks
  const updateChunk = showingSearch
    ? (_id: string, _updates: Record<string, unknown>) => {}
    : initialUpdateChunk

  const [chunkToDelete, setChunkToDelete] = useState<ChunkData | null>(null)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [showDeleteDocumentDialog, setShowDeleteDocumentDialog] = useState(false)
  const [contextMenuChunk, setContextMenuChunk] = useState<ChunkData | null>(null)

  const { mutate: updateChunkMutation } = useUpdateChunk()
  const { mutate: deleteDocumentMutation, isPending: isDeletingDocument } = useDeleteDocument()
  const { mutate: bulkChunkMutation, isPending: isBulkOperating } = useBulkChunkOperation()
  const { mutate: updateDocumentMutation } = useUpdateDocument()

  const docRename = useInlineRename({
    onSave: (docId, filename) =>
      updateDocumentMutation({ knowledgeBaseId, documentId: docId, updates: { filename } }),
  })

  const {
    isOpen: isContextMenuOpen,
    position: contextMenuPosition,
    menuRef,
    handleContextMenu: baseHandleContextMenu,
    closeMenu: closeContextMenu,
  } = useContextMenu()

  const combinedError = documentError || searchError || initialError

  const isConnectorDocument = Boolean(documentData?.connectorId)
  const effectiveKnowledgeBaseName = knowledgeBase?.name || knowledgeBaseName || 'Knowledge Base'
  const effectiveDocumentName = documentData?.filename || documentName || 'Document'
  const isCompleted = documentData?.processingStatus === 'completed'
  const canEdit = userPermissions.canEdit === true

  const isInEditorView = selectedChunkId !== null || isCreatingNewChunk

  // Derive selected chunk from displayChunks (memoized)
  const selectedChunk = useMemo(
    () => (selectedChunkId ? (displayChunks.find((c) => c.id === selectedChunkId) ?? null) : null),
    [selectedChunkId, displayChunks]
  )

  // Chunk navigation helpers (memoized)
  const currentChunkIndex = useMemo(
    () => (selectedChunk ? displayChunks.findIndex((c) => c.id === selectedChunk.id) : -1),
    [selectedChunk, displayChunks]
  )
  const canNavigatePrev = currentChunkIndex > 0 || currentPage > 1
  const canNavigateNext = currentChunkIndex < displayChunks.length - 1 || currentPage < totalPages

  const closeEditor = useCallback(() => {
    setSelectedChunkId(null)
    setIsCreatingNewChunk(false)
    setIsDirty(false)
    setSaveStatus('idle')
  }, [])

  const guardDirtyAction = useCallback(
    (action: () => void) => {
      if (isDirty) {
        setPendingAction(() => action)
        setShowUnsavedChangesAlert(true)
      } else {
        action()
      }
    },
    [isDirty]
  )

  const handleBackAttempt = useCallback(() => {
    guardDirtyAction(closeEditor)
  }, [guardDirtyAction, closeEditor])

  const handleSave = useCallback(async () => {
    if (!saveRef.current || !isDirty || saveStatusRef.current === 'saving') return

    setSaveStatus('saving')
    try {
      await saveRef.current()
      setSaveStatus('saved')
    } catch {
      setSaveStatus('error')
    }
  }, [isDirty])

  const handleDiscardChanges = useCallback(() => {
    setShowUnsavedChangesAlert(false)
    const action = pendingAction
    setPendingAction(null)
    if (action) {
      setIsDirty(false)
      action()
    } else {
      closeEditor()
    }
  }, [pendingAction, closeEditor])

  // Auto-clear save status after 2 seconds
  useEffect(() => {
    if (saveStatus === 'saved' || saveStatus === 'error') {
      const timer = setTimeout(() => setSaveStatus('idle'), 2000)
      return () => clearTimeout(timer)
    }
  }, [saveStatus])

  // Cmd+S keyboard shortcut
  useEffect(() => {
    if (!isInEditorView) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isInEditorView, handleSave])

  // beforeunload guard
  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  const navigateToChunk = useCallback(
    async (direction: 'prev' | 'next') => {
      if (!selectedChunk) return

      if (direction === 'prev') {
        if (currentChunkIndex > 0) {
          setSelectedChunkId(displayChunks[currentChunkIndex - 1].id)
        } else if (currentPage > 1) {
          await goToPage(currentPage - 1)
          // Use ref to read fresh displayChunks after page change
          const checkAndSelect = () => {
            const chunks = displayChunksRef.current
            if (chunks.length > 0 && chunks !== displayChunks) {
              setSelectedChunkId(chunks[chunks.length - 1].id)
            } else {
              setTimeout(checkAndSelect, 100)
            }
          }
          setTimeout(checkAndSelect, 0)
        }
      } else {
        if (currentChunkIndex < displayChunks.length - 1) {
          setSelectedChunkId(displayChunks[currentChunkIndex + 1].id)
        } else if (currentPage < totalPages) {
          await goToPage(currentPage + 1)
          const checkAndSelect = () => {
            const chunks = displayChunksRef.current
            if (chunks.length > 0 && chunks !== displayChunks) {
              setSelectedChunkId(chunks[0].id)
            } else {
              setTimeout(checkAndSelect, 100)
            }
          }
          setTimeout(checkAndSelect, 0)
        }
      }
    },
    [selectedChunk, currentChunkIndex, displayChunks, currentPage, totalPages, goToPage]
  )

  const handleNavigateChunk = useCallback(
    (direction: 'prev' | 'next') => {
      guardDirtyAction(() => void navigateToChunk(direction))
    },
    [guardDirtyAction, navigateToChunk]
  )

  const breadcrumbs: BreadcrumbItem[] = combinedError
    ? [
        {
          label: 'Knowledge Base',
          onClick: () => router.push(`/workspace/${workspaceId}/knowledge`),
        },
        {
          label: effectiveKnowledgeBaseName,
          onClick: () => router.push(`/workspace/${workspaceId}/knowledge/${knowledgeBaseId}`),
        },
        { label: 'Error' },
      ]
    : [
        {
          label: 'Knowledge Base',
          onClick: () => router.push(`/workspace/${workspaceId}/knowledge`),
        },
        {
          label: effectiveKnowledgeBaseName,
          onClick: () => router.push(`/workspace/${workspaceId}/knowledge/${knowledgeBaseId}`),
        },
        {
          label: effectiveDocumentName,
          editing: docRename.editingId
            ? {
                isEditing: true,
                value: docRename.editValue,
                onChange: docRename.setEditValue,
                onSubmit: docRename.submitRename,
                onCancel: docRename.cancelRename,
              }
            : undefined,
          dropdownItems: [
            ...(userPermissions.canEdit
              ? [
                  {
                    label: 'Rename',
                    icon: Pencil,
                    onClick: () => docRename.startRename(documentId, effectiveDocumentName),
                  },
                  { label: 'Tags', icon: Tag, onClick: () => setShowTagsModal(true) },
                  {
                    label: 'Delete',
                    icon: Trash,
                    onClick: () => setShowDeleteDocumentDialog(true),
                  },
                ]
              : []),
          ],
        },
      ]

  const handleNewChunk = useCallback(() => {
    guardDirtyAction(() => {
      setIsCreatingNewChunk(true)
      setSelectedChunkId(null)
      setIsDirty(false)
      setSaveStatus('idle')
    })
  }, [guardDirtyAction])

  const handleChunkCreated = useCallback((chunkId: string) => {
    setIsCreatingNewChunk(false)
    setIsDirty(false)
    setSaveStatus('idle')
    setSelectedChunkId(chunkId)
  }, [])

  const createAction = {
    label: 'New chunk',
    onClick: handleNewChunk,
    disabled:
      documentData?.processingStatus === 'failed' ||
      !userPermissions.canEdit ||
      isConnectorDocument,
  }

  const searchConfig: SearchConfig | undefined = isCompleted
    ? {
        value: searchQuery,
        onChange: (value: string) => setSearchQuery(value),
        placeholder: 'Search chunks...',
      }
    : undefined

  const filterContent = (
    <div className='w-[200px]'>
      <div className='border-[var(--border-1)] border-b px-[12px] py-[8px]'>
        <span className='font-medium text-[12px] text-[var(--text-secondary)]'>Status</span>
      </div>
      <div className='flex flex-col gap-[2px] px-[12px] py-[8px]'>
        <PopoverItem
          active={enabledFilter === 'all'}
          onClick={() => {
            setEnabledFilter('all')
            setSelectedChunks(new Set())
            goToPage(1)
          }}
        >
          All
        </PopoverItem>
        <PopoverItem
          active={enabledFilter === 'enabled'}
          onClick={() => {
            setEnabledFilter('enabled')
            setSelectedChunks(new Set())
            goToPage(1)
          }}
        >
          Enabled
        </PopoverItem>
        <PopoverItem
          active={enabledFilter === 'disabled'}
          onClick={() => {
            setEnabledFilter('disabled')
            setSelectedChunks(new Set())
            goToPage(1)
          }}
        >
          Disabled
        </PopoverItem>
      </div>
    </div>
  )

  const filterTags: FilterTag[] = [
    ...(enabledFilter !== 'all'
      ? [
          {
            label: `Status: ${enabledFilter === 'enabled' ? 'Enabled' : 'Disabled'}`,
            onRemove: () => {
              setEnabledFilter('all')
              setSelectedChunks(new Set())
              goToPage(1)
            },
          },
        ]
      : []),
  ]

  const handleChunkClick = useCallback((rowId: string) => {
    setSelectedChunkId(rowId)
  }, [])

  const handleToggleEnabled = useCallback(
    (chunkId: string) => {
      const chunk = displayChunks.find((c) => c.id === chunkId)
      if (!chunk) return

      updateChunkMutation(
        {
          knowledgeBaseId,
          documentId,
          chunkId,
          enabled: !chunk.enabled,
        },
        {
          onSuccess: () => {
            updateChunk(chunkId, { enabled: !chunk.enabled })
          },
        }
      )
    },
    [displayChunks, knowledgeBaseId, documentId, updateChunk]
  )

  const handleDeleteChunk = useCallback(
    (chunkId: string) => {
      const chunk = displayChunks.find((c) => c.id === chunkId)
      if (chunk) {
        setChunkToDelete(chunk)
        setIsDeleteModalOpen(true)
      }
    },
    [displayChunks]
  )

  const handleCloseDeleteModal = () => {
    if (chunkToDelete) {
      setSelectedChunks((prev) => {
        const newSet = new Set(prev)
        newSet.delete(chunkToDelete.id)
        return newSet
      })
    }
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

  const handleDeleteDocument = () => {
    if (!documentData) return

    deleteDocumentMutation(
      { knowledgeBaseId, documentId },
      {
        onSuccess: () => {
          router.push(`/workspace/${workspaceId}/knowledge/${knowledgeBaseId}`)
        },
      }
    )
  }

  const performBulkChunkOperation = (
    operation: 'enable' | 'disable' | 'delete',
    chunks: ChunkData[]
  ) => {
    if (chunks.length === 0) return

    bulkChunkMutation(
      {
        knowledgeBaseId,
        documentId,
        operation,
        chunkIds: chunks.map((chunk) => chunk.id),
      },
      {
        onSuccess: (result) => {
          if (operation === 'delete' || result.errorCount > 0) {
            refreshChunks()
          } else {
            chunks.forEach((chunk) => {
              updateChunk(chunk.id, { enabled: operation === 'enable' })
            })
          }
          logger.info(`Successfully ${operation}d ${result.successCount} chunks`)
          setSelectedChunks(new Set())
        },
      }
    )
  }

  const handleBulkEnable = () => {
    const chunksToEnable = displayChunks.filter(
      (chunk) => selectedChunks.has(chunk.id) && !chunk.enabled
    )
    performBulkChunkOperation('enable', chunksToEnable)
  }

  const handleBulkDisable = () => {
    const chunksToDisable = displayChunks.filter(
      (chunk) => selectedChunks.has(chunk.id) && chunk.enabled
    )
    performBulkChunkOperation('disable', chunksToDisable)
  }

  const handleBulkDelete = () => {
    const chunksToDelete = displayChunks.filter((chunk) => selectedChunks.has(chunk.id))
    performBulkChunkOperation('delete', chunksToDelete)
  }

  const [enabledCount, disabledCount] = useMemo(() => {
    let enabled = 0
    let disabled = 0
    for (const chunk of displayChunks) {
      if (selectedChunks.has(chunk.id)) {
        if (chunk.enabled) enabled++
        else disabled++
      }
    }
    return [enabled, disabled]
  }, [displayChunks, selectedChunks])

  const isAllSelected = displayChunks.length > 0 && selectedChunks.size === displayChunks.length

  const handleChunkContextMenu = useCallback(
    (e: React.MouseEvent, rowId: string) => {
      const chunk = displayChunks.find((c) => c.id === rowId)
      if (!chunk) return

      if (userPermissions.canEdit && !isConnectorDocument) {
        const isCurrentlySelected = selectedChunks.has(chunk.id)

        if (!isCurrentlySelected) {
          setSelectedChunks(new Set([chunk.id]))
        }
      }

      setContextMenuChunk(chunk)
      baseHandleContextMenu(e)
    },
    [
      displayChunks,
      selectedChunks,
      baseHandleContextMenu,
      userPermissions.canEdit,
      isConnectorDocument,
    ]
  )

  const handleEmptyContextMenu = useCallback(
    (e: React.MouseEvent) => {
      setContextMenuChunk(null)
      baseHandleContextMenu(e)
    },
    [baseHandleContextMenu]
  )

  const handleContextMenuClose = useCallback(() => {
    closeContextMenu()
    setContextMenuChunk(null)
  }, [closeContextMenu])

  const handleDocumentTagsUpdate = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: knowledgeKeys.document(knowledgeBaseId, documentId),
    })
  }, [knowledgeBaseId, documentId, queryClient])

  const prevDocumentIdRef = useRef<string>(documentId)
  const isNavigatingToNewDoc = prevDocumentIdRef.current !== documentId

  useEffect(() => {
    if (documentData && documentData.id === documentId) {
      prevDocumentIdRef.current = documentId
    }
  }, [documentData, documentId])

  const isFetchingNewDoc = isNavigatingToNewDoc && isFetchingChunks

  const selectableConfig: SelectableConfig | undefined = isCompleted
    ? {
        selectedIds: selectedChunks,
        onSelectRow: handleSelectChunk,
        onSelectAll: handleSelectAll,
        isAllSelected,
        disabled: !userPermissions.canEdit || isConnectorDocument,
      }
    : undefined

  const paginationConfig: PaginationConfig | undefined =
    isCompleted && totalPages > 1
      ? {
          currentPage,
          totalPages,
          onPageChange: goToPage,
        }
      : undefined

  const chunkRows: ResourceRow[] = useMemo(() => {
    if (!isCompleted) {
      return [
        {
          id: 'processing-status',
          cells: {
            content: {
              content: (
                <div className='flex items-center gap-[8px]'>
                  <FileText className='h-5 w-5 flex-shrink-0 text-[var(--text-muted)]' />
                  <span className='text-[14px] text-[var(--text-muted)] italic'>
                    {documentData?.processingStatus === 'pending' &&
                      'Document processing pending...'}
                    {documentData?.processingStatus === 'processing' &&
                      'Document processing in progress...'}
                    {documentData?.processingStatus === 'failed' && 'Document processing failed'}
                    {!documentData?.processingStatus && 'Document not ready'}
                  </span>
                </div>
              ),
            },
            index: { label: '—' },
            tokens: { label: '—' },
            status: { label: '—' },
          },
        },
      ]
    }

    return displayChunks.map((chunk: ChunkData) => ({
      id: chunk.id,
      cells: {
        content: {
          content: (
            <span
              className='block min-w-0 truncate text-[14px] text-[var(--text-primary)]'
              title={chunk.content}
            >
              <SearchHighlight
                text={truncateContent(chunk.content, 150, searchQuery)}
                searchQuery={searchQuery}
              />
            </span>
          ),
        },
        index: {
          content: (
            <span className='font-mono text-[14px] text-[var(--text-primary)]'>
              {chunk.chunkIndex}
            </span>
          ),
        },
        tokens: {
          label: formatTokenCount(chunk.tokenCount),
        },
        status: {
          content: (
            <Badge variant={chunk.enabled ? 'green' : 'gray'} size='sm'>
              {chunk.enabled ? 'Enabled' : 'Disabled'}
            </Badge>
          ),
        },
      },
    }))
  }, [isCompleted, documentData?.processingStatus, displayChunks, searchQuery])

  const emptyMessage = isCompleted ? (searchQuery ? 'No chunks found' : 'No chunks yet') : undefined

  // Save button label
  const saveLabel =
    saveStatus === 'saving'
      ? isCreatingNewChunk
        ? 'Creating...'
        : 'Saving...'
      : saveStatus === 'saved'
        ? isCreatingNewChunk
          ? 'Created'
          : 'Saved'
        : saveStatus === 'error'
          ? isCreatingNewChunk
            ? 'Create failed'
            : 'Save failed'
          : isCreatingNewChunk
            ? 'Create Chunk'
            : 'Save'

  // Editor breadcrumbs (shared between create and edit views)
  const editorBreadcrumbs = useCallback(
    (lastLabel: string): BreadcrumbItem[] => [
      {
        label: 'Knowledge Base',
        onClick: () => router.push(`/workspace/${workspaceId}/knowledge`),
      },
      {
        label: effectiveKnowledgeBaseName,
        onClick: () => router.push(`/workspace/${workspaceId}/knowledge/${knowledgeBaseId}`),
      },
      {
        label: effectiveDocumentName,
        onClick: handleBackAttempt,
      },
      { label: lastLabel },
    ],
    [
      workspaceId,
      effectiveKnowledgeBaseName,
      knowledgeBaseId,
      effectiveDocumentName,
      handleBackAttempt,
      router,
    ]
  )

  // Inline create chunk view
  if (isCreatingNewChunk && documentData) {
    const createActions: HeaderAction[] = [
      {
        label: saveLabel,
        onClick: () => void handleSave(),
        disabled: !isDirty || saveStatus === 'saving',
      },
    ]

    return (
      <>
        <div className='flex h-full flex-1 flex-col overflow-hidden bg-[var(--bg)]'>
          <ResourceHeader
            icon={FileText}
            breadcrumbs={editorBreadcrumbs('New Chunk')}
            actions={createActions}
          />
          <ChunkEditor
            key='new-chunk'
            mode='create'
            document={documentData}
            knowledgeBaseId={knowledgeBaseId}
            canEdit
            maxChunkSize={knowledgeBase?.chunkingConfig?.maxSize}
            onDirtyChange={setIsDirty}
            saveRef={saveRef}
            onCreated={handleChunkCreated}
          />
        </div>

        <UnsavedChangesModal
          open={showUnsavedChangesAlert}
          onOpenChange={setShowUnsavedChangesAlert}
          onKeepEditing={() => {
            setShowUnsavedChangesAlert(false)
            setPendingAction(null)
          }}
          onDiscard={handleDiscardChanges}
        />
      </>
    )
  }

  // Inline edit chunk view
  if (selectedChunkId) {
    if (!selectedChunk || !documentData) {
      return (
        <div className='flex h-full flex-1 flex-col overflow-hidden bg-[var(--bg)]'>
          <ResourceHeader
            icon={FileText}
            breadcrumbs={[
              {
                label: 'Knowledge Base',
                onClick: () => router.push(`/workspace/${workspaceId}/knowledge`),
              },
              {
                label: effectiveKnowledgeBaseName,
                onClick: () =>
                  router.push(`/workspace/${workspaceId}/knowledge/${knowledgeBaseId}`),
              },
              {
                label: effectiveDocumentName,
                onClick: () => setSelectedChunkId(null),
              },
              { label: 'Loading...' },
            ]}
          />
          <div className='flex flex-1 items-center justify-center'>
            <span className='text-[14px] text-[var(--text-muted)]'>Loading chunk...</span>
          </div>
        </div>
      )
    }

    const editorActions: HeaderAction[] = [
      {
        label: 'Previous chunk',
        icon: ChevronUp,
        onClick: () => handleNavigateChunk('prev'),
        disabled: !canNavigatePrev,
      },
      {
        label: 'Next chunk',
        icon: ChevronDown,
        onClick: () => handleNavigateChunk('next'),
        disabled: !canNavigateNext,
      },
    ]

    if (canEdit && !isConnectorDocument) {
      editorActions.push({
        label: saveLabel,
        onClick: () => void handleSave(),
        disabled: !isDirty || saveStatus === 'saving',
      })
    }

    return (
      <>
        <div className='flex h-full flex-1 flex-col overflow-hidden bg-[var(--bg)]'>
          <ResourceHeader
            icon={FileText}
            breadcrumbs={editorBreadcrumbs(`Chunk #${selectedChunk.chunkIndex}`)}
            actions={editorActions}
          />
          <ChunkEditor
            key={selectedChunk.id}
            chunk={selectedChunk}
            document={documentData}
            knowledgeBaseId={knowledgeBaseId}
            canEdit={canEdit && !isConnectorDocument}
            maxChunkSize={knowledgeBase?.chunkingConfig?.maxSize}
            onDirtyChange={setIsDirty}
            saveRef={saveRef}
          />
        </div>

        <UnsavedChangesModal
          open={showUnsavedChangesAlert}
          onOpenChange={setShowUnsavedChangesAlert}
          onKeepEditing={() => {
            setShowUnsavedChangesAlert(false)
            setPendingAction(null)
          }}
          onDiscard={handleDiscardChanges}
        />
      </>
    )
  }

  // Default table view
  return (
    <>
      <Resource
        icon={FileText}
        title={effectiveDocumentName}
        breadcrumbs={breadcrumbs}
        create={createAction}
        search={combinedError ? undefined : searchConfig}
        disableHeaderSort
        columns={CHUNK_COLUMNS}
        rows={combinedError ? [] : chunkRows}
        selectable={combinedError ? undefined : selectableConfig}
        onRowClick={isCompleted ? handleChunkClick : undefined}
        onRowContextMenu={isCompleted ? handleChunkContextMenu : undefined}
        onContextMenu={handleEmptyContextMenu}
        isLoading={isLoadingDocument || isFetchingNewDoc}
        pagination={paginationConfig}
        emptyMessage={combinedError ? 'Error loading document' : emptyMessage}
        filter={combinedError ? undefined : filterContent}
        filterTags={combinedError ? undefined : filterTags}
      />

      <DocumentTagsModal
        open={showTagsModal}
        onOpenChange={setShowTagsModal}
        knowledgeBaseId={knowledgeBaseId}
        documentId={documentId}
        documentData={documentData}
        onDocumentUpdate={handleDocumentTagsUpdate}
      />

      <DeleteChunkModal
        chunk={chunkToDelete}
        knowledgeBaseId={knowledgeBaseId}
        documentId={documentId}
        isOpen={isDeleteModalOpen}
        onClose={handleCloseDeleteModal}
      />

      <ActionBar
        className={paginationConfig ? 'bottom-[72px]' : undefined}
        selectedCount={selectedChunks.size}
        onEnable={disabledCount > 0 && !isConnectorDocument ? handleBulkEnable : undefined}
        onDisable={enabledCount > 0 && !isConnectorDocument ? handleBulkDisable : undefined}
        onDelete={!isConnectorDocument ? handleBulkDelete : undefined}
        enabledCount={enabledCount}
        disabledCount={disabledCount}
        isLoading={isBulkOperating}
      />

      <Modal open={showDeleteDocumentDialog} onOpenChange={setShowDeleteDocumentDialog}>
        <ModalContent size='sm'>
          <ModalHeader>Delete Document</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              Are you sure you want to delete{' '}
              <span className='font-medium text-[var(--text-primary)]'>
                {effectiveDocumentName}
              </span>
              ? This will permanently delete the document and all {documentData?.chunkCount ?? 0}{' '}
              chunk
              {documentData?.chunkCount === 1 ? '' : 's'} within it.{' '}
              {documentData?.connectorId ? (
                <span className='text-[var(--text-error)]'>
                  This document is synced from a connector. Deleting it will permanently exclude it
                  from future syncs. To temporarily hide it from search, disable it instead.
                </span>
              ) : (
                <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
              )}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant='default'
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

      <ChunkContextMenu
        isOpen={isContextMenuOpen}
        position={contextMenuPosition}
        menuRef={menuRef}
        onClose={handleContextMenuClose}
        hasChunk={contextMenuChunk !== null}
        isChunkEnabled={contextMenuChunk?.enabled ?? true}
        selectedCount={selectedChunks.size}
        enabledCount={enabledCount}
        disabledCount={disabledCount}
        onOpenInNewTab={
          contextMenuChunk
            ? () => {
                const url = `/workspace/${workspaceId}/knowledge/${knowledgeBaseId}/${documentId}?chunk=${contextMenuChunk.id}`
                window.open(url, '_blank')
              }
            : undefined
        }
        onEdit={
          contextMenuChunk
            ? () => {
                setSelectedChunkId(contextMenuChunk.id)
              }
            : undefined
        }
        onCopyContent={
          contextMenuChunk
            ? () => {
                navigator.clipboard.writeText(contextMenuChunk.content)
              }
            : undefined
        }
        onToggleEnabled={
          contextMenuChunk
            ? selectedChunks.size > 1
              ? () => {
                  if (disabledCount > 0) {
                    handleBulkEnable()
                  } else {
                    handleBulkDisable()
                  }
                }
              : () => handleToggleEnabled(contextMenuChunk.id)
            : undefined
        }
        onDelete={
          contextMenuChunk
            ? selectedChunks.size > 1
              ? handleBulkDelete
              : () => handleDeleteChunk(contextMenuChunk.id)
            : undefined
        }
        onAddChunk={handleNewChunk}
        disableToggleEnabled={!userPermissions.canEdit || isConnectorDocument}
        disableDelete={!userPermissions.canEdit || isConnectorDocument}
        disableEdit={!userPermissions.canEdit && !isConnectorDocument}
        disableAddChunk={
          !userPermissions.canEdit ||
          documentData?.processingStatus === 'failed' ||
          isConnectorDocument
        }
        isConnectorDocument={isConnectorDocument}
      />
    </>
  )
}
