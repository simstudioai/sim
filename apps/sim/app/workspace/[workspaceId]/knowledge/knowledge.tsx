'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChipDropdownOption } from '@sim/emcn'
import {
  Button,
  ChipDropdown,
  cellIconNodeClass,
  chipContentGap,
  chipContentLabelClass,
  cn,
  Folder,
  FolderPlus,
  Plus,
  Tooltip,
} from '@sim/emcn'
import { Database, Lock } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { useParams, useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { PinButton } from '@/components/folders/pin-button'
import type { KnowledgeBaseData } from '@/lib/knowledge/types'
import type {
  FilterTag,
  ResourceAction,
  ResourceCell,
  ResourceColumn,
  ResourceRow,
  SearchConfig,
  SortConfig,
} from '@/app/workspace/[workspaceId]/components'
import {
  EMPTY_CELL_PLACEHOLDER,
  FloatingOverflowText,
  ownerCell,
  Resource,
  timeCell,
} from '@/app/workspace/[workspaceId]/components'
import { BaseTagsModal } from '@/app/workspace/[workspaceId]/knowledge/[id]/components'
import {
  CreateBaseModal,
  DeleteKnowledgeBaseModal,
  EditKnowledgeBaseModal,
  KnowledgeBaseContextMenu,
  KnowledgeFolderContextMenu,
  KnowledgeListContextMenu,
} from '@/app/workspace/[workspaceId]/knowledge/components'
import {
  knowledgeFolderParsers,
  knowledgeFolderUrlKeys,
} from '@/app/workspace/[workspaceId]/knowledge/search-params'
import { filterKnowledgeBases } from '@/app/workspace/[workspaceId]/knowledge/utils/sort'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import { useKnowledgeBasesList } from '@/hooks/kb/use-knowledge'
import {
  useCreateFolder,
  useDeleteFolderMutation,
  useFolders,
  useUpdateFolder,
} from '@/hooks/queries/folders'
import { useDeleteKnowledgeBase, useUpdateKnowledgeBase } from '@/hooks/queries/kb/knowledge'
import { usePinnedIds } from '@/hooks/queries/pinned-items'
import { isFolderOrAncestorLocked } from '@/hooks/queries/utils/folder-tree'
import { useWorkspaceMembersQuery } from '@/hooks/queries/workspace'
import { useDebounce } from '@/hooks/use-debounce'
import { useFolderBreadcrumbs } from '@/hooks/use-folder-breadcrumbs'
import { useFolderCreateWithDedup } from '@/hooks/use-folder-create-with-dedup'
import { useInlineRename } from '@/hooks/use-inline-rename'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import type { Folder as FolderType } from '@/stores/folders/types'

const logger = createLogger('Knowledge')

interface KnowledgeBaseWithDocCount extends KnowledgeBaseData {
  docCount?: number
}

const COLUMNS: ResourceColumn[] = [
  { id: 'name', header: 'Name' },
  { id: 'documents', header: 'Documents', widthMultiplier: 0.6 },
  { id: 'tokens', header: 'Tokens', widthMultiplier: 0.6 },
  { id: 'connectors', header: 'Connectors', widthMultiplier: 0.7 },
  { id: 'created', header: 'Created' },
  { id: 'owner', header: 'Owner' },
  { id: 'updated', header: 'Last Updated' },
]

const KNOWLEDGE_BASE_ICON = <Database className='size-[14px]' />
const FOLDER_ICON = <Folder className='size-[14px]' />

const CONNECTOR_FILTER_OPTIONS: ChipDropdownOption[] = [
  { value: 'all', label: 'All' },
  { value: 'connected', label: 'With connectors' },
  { value: 'unconnected', label: 'Without connectors' },
]

const CONTENT_FILTER_OPTIONS: ChipDropdownOption[] = [
  { value: 'all', label: 'All' },
  { value: 'has-docs', label: 'Has documents' },
  { value: 'empty', label: 'Empty' },
]

const FILTER_SECTION_LABEL_CLASS = 'text-[var(--text-muted)] text-small'

/** Folder rows are prefixed so their ids never collide with a (bare) knowledge base id. */
const folderRowId = (id: string) => `folder:${id}`
const parseRowId = (rowId: string): { kind: 'folder' | 'base'; id: string } => {
  if (rowId.startsWith('folder:')) return { kind: 'folder', id: rowId.slice('folder:'.length) }
  return { kind: 'base', id: rowId }
}

function connectorCell(connectorTypes?: string[]): ResourceCell {
  if (!connectorTypes || connectorTypes.length === 0) {
    return { label: EMPTY_CELL_PLACEHOLDER }
  }

  const entries = connectorTypes
    .map((type) => ({ type, def: CONNECTOR_META_REGISTRY[type] }))
    .filter(
      (e): e is { type: string; def: NonNullable<(typeof CONNECTOR_META_REGISTRY)[string]> } =>
        Boolean(e.def?.icon)
    )

  if (entries.length === 0) return { label: EMPTY_CELL_PLACEHOLDER }

  const visibleEntries = entries.slice(0, 3)
  const hiddenEntries = entries.slice(3)

  return {
    content: (
      <div className='flex items-center gap-1'>
        {visibleEntries.map(({ type, def }) => {
          const Icon = def.icon
          return (
            <Tooltip.Root key={type}>
              <Tooltip.Trigger asChild>
                <span className='flex size-5 flex-shrink-0 items-center justify-center rounded-md bg-[var(--surface-4)] text-[var(--text-secondary)]'>
                  <Icon className='size-[13px]' />
                </span>
              </Tooltip.Trigger>
              <Tooltip.Content>{def.name}</Tooltip.Content>
            </Tooltip.Root>
          )
        })}
        {hiddenEntries.length > 0 && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <span className='flex size-5 flex-shrink-0 items-center justify-center rounded-md bg-[var(--surface-4)] font-medium text-[var(--text-muted)] text-micro'>
                +{hiddenEntries.length}
              </span>
            </Tooltip.Trigger>
            <Tooltip.Content>{hiddenEntries.map(({ def }) => def.name).join(', ')}</Tooltip.Content>
          </Tooltip.Root>
        )}
      </div>
    ),
  }
}

export function Knowledge() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string

  const [{ folderId: currentFolderId }, setKnowledgeFolderParams] = useQueryStates(
    knowledgeFolderParsers,
    knowledgeFolderUrlKeys
  )

  const { config: permissionConfig } = usePermissionConfig()
  useEffect(() => {
    if (permissionConfig.hideKnowledgeBaseTab) {
      router.replace(`/workspace/${workspaceId}`)
    }
  }, [permissionConfig.hideKnowledgeBaseTab, router, workspaceId])

  const { knowledgeBases, error } = useKnowledgeBasesList(workspaceId)
  const { data: folders = [] } = useFolders(workspaceId, { resourceType: 'knowledge_base' })
  const { data: members } = useWorkspaceMembersQuery(workspaceId)

  const pinnedBaseIds = usePinnedIds(workspaceId, 'knowledge_base')
  const pinnedFolderIds = usePinnedIds(workspaceId, 'folder')

  if (error) {
    logger.error('Failed to load knowledge bases:', error)
  }
  const userPermissions = useUserPermissionsContext()
  const canEdit = userPermissions.canEdit === true

  const { mutateAsync: updateKnowledgeBaseMutation } = useUpdateKnowledgeBase(workspaceId)
  const { mutateAsync: deleteKnowledgeBaseMutation } = useDeleteKnowledgeBase(workspaceId)
  const createFolder = useCreateFolder()
  const updateFolder = useUpdateFolder()
  const deleteFolder = useDeleteFolderMutation()

  const [activeSort, setActiveSort] = useState<{
    column: string
    direction: 'asc' | 'desc'
  } | null>(null)
  const [connectorFilter, setConnectorFilter] = useState<string[]>([])
  const [contentFilter, setContentFilter] = useState<string[]>([])
  const [ownerFilter, setOwnerFilter] = useState<string[]>([])

  const [searchInputValue, setSearchInputValue] = useState('')
  const debouncedSearchQuery = useDebounce(searchInputValue, 300)

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)

  const [activeKnowledgeBase, setActiveKnowledgeBase] = useState<KnowledgeBaseWithDocCount | null>(
    null
  )
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [isTagsModalOpen, setIsTagsModalOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const [activeFolderId, setActiveFolderId] = useState<string | null>(null)
  const [isFolderDeleteModalOpen, setIsFolderDeleteModalOpen] = useState(false)

  const {
    isOpen: isListContextMenuOpen,
    position: listContextMenuPosition,
    handleContextMenu: handleListContextMenu,
    closeMenu: closeListContextMenu,
  } = useContextMenu()

  const {
    isOpen: isRowContextMenuOpen,
    position: rowContextMenuPosition,
    handleContextMenu: handleRowCtxMenu,
    closeMenu: closeRowContextMenu,
  } = useContextMenu()

  const {
    isOpen: isFolderContextMenuOpen,
    position: folderContextMenuPosition,
    handleContextMenu: handleFolderCtxMenu,
    closeMenu: closeFolderContextMenu,
  } = useContextMenu()

  const isRowContextMenuOpenRef = useRef(isRowContextMenuOpen)
  isRowContextMenuOpenRef.current = isRowContextMenuOpen
  const isFolderContextMenuOpenRef = useRef(isFolderContextMenuOpen)
  isFolderContextMenuOpenRef.current = isFolderContextMenuOpen

  const knowledgeBasesRef = useRef(knowledgeBases)
  knowledgeBasesRef.current = knowledgeBases

  const activeKnowledgeBaseRef = useRef(activeKnowledgeBase)
  activeKnowledgeBaseRef.current = activeKnowledgeBase

  const listRename = useInlineRename({
    onSave: (rowId, name) => {
      const parsed = parseRowId(rowId)
      if (parsed.kind === 'folder') {
        return updateFolder.mutateAsync({
          workspaceId,
          resourceType: 'knowledge_base',
          id: parsed.id,
          updates: { name },
        })
      }
      return updateKnowledgeBaseMutation({ knowledgeBaseId: parsed.id, updates: { name } })
    },
  })

  const breadcrumbRename = useInlineRename({
    onSave: (folderId, name) =>
      updateFolder.mutateAsync({
        workspaceId,
        resourceType: 'knowledge_base',
        id: folderId,
        updates: { name },
      }),
  })

  const handleContentContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement
      if (
        target.closest('[data-resource-row]') ||
        target.closest('button, input, a, [role="button"]')
      ) {
        return
      }
      handleListContextMenu(e)
    },
    [handleListContextMenu]
  )

  const handleOpenCreateModal = useCallback(() => {
    setIsCreateModalOpen(true)
  }, [])

  const handleUpdateKnowledgeBase = useCallback(
    async (id: string, name: string, description: string) => {
      await updateKnowledgeBaseMutation({
        knowledgeBaseId: id,
        updates: { name, description },
      })
      logger.info(`Knowledge base updated: ${id}`)
    },
    [updateKnowledgeBaseMutation]
  )

  const handleDeleteKnowledgeBase = useCallback(
    async (id: string) => {
      await deleteKnowledgeBaseMutation({ knowledgeBaseId: id })
      logger.info(`Knowledge base deleted: ${id}`)
    },
    [deleteKnowledgeBaseMutation]
  )

  const folderById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders])

  const activeFolder = activeFolderId ? (folderById.get(activeFolderId) ?? null) : null

  const visibleFolders = useMemo(() => {
    const siblings = folders.filter((folder) => (folder.parentId ?? null) === currentFolderId)
    const searched = debouncedSearchQuery
      ? siblings.filter((folder) =>
          folder.name.toLowerCase().includes(debouncedSearchQuery.toLowerCase())
        )
      : siblings
    return [...searched].sort((a, b) => a.name.localeCompare(b.name))
  }, [folders, currentFolderId, debouncedSearchQuery])

  const processedKBs = useMemo(() => {
    let result = filterKnowledgeBases(knowledgeBases, debouncedSearchQuery).filter(
      (kb) => (kb.folderId ?? null) === currentFolderId
    )

    if (connectorFilter.length > 0) {
      result = result.filter((kb) => {
        const hasConnectors = (kb.connectorTypes?.length ?? 0) > 0
        if (connectorFilter.includes('connected') && hasConnectors) return true
        if (connectorFilter.includes('unconnected') && !hasConnectors) return true
        return false
      })
    }

    if (contentFilter.length > 0) {
      const docCount = (kb: KnowledgeBaseData) => (kb as KnowledgeBaseWithDocCount).docCount ?? 0
      result = result.filter((kb) => {
        if (contentFilter.includes('has-docs') && docCount(kb) > 0) return true
        if (contentFilter.includes('empty') && docCount(kb) === 0) return true
        return false
      })
    }

    if (ownerFilter.length > 0) {
      result = result.filter((kb) => ownerFilter.includes(kb.userId))
    }

    const col = activeSort?.column ?? 'updated'
    const dir = activeSort?.direction ?? 'desc'
    return [...result].sort((a, b) => {
      let cmp = 0
      switch (col) {
        case 'name':
          cmp = a.name.localeCompare(b.name)
          break
        case 'documents':
          cmp =
            ((a as KnowledgeBaseWithDocCount).docCount || 0) -
            ((b as KnowledgeBaseWithDocCount).docCount || 0)
          break
        case 'tokens':
          cmp = (a.tokenCount || 0) - (b.tokenCount || 0)
          break
        case 'created':
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          break
        case 'updated':
          cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
          break
        case 'connectors':
          cmp = (a.connectorTypes?.length ?? 0) - (b.connectorTypes?.length ?? 0)
          break
        case 'owner':
          cmp = (members?.find((m) => m.userId === a.userId)?.name ?? '').localeCompare(
            members?.find((m) => m.userId === b.userId)?.name ?? ''
          )
          break
      }
      return dir === 'asc' ? cmp : -cmp
    })
  }, [
    knowledgeBases,
    currentFolderId,
    debouncedSearchQuery,
    connectorFilter,
    contentFilter,
    ownerFilter,
    activeSort,
    members,
  ])

  const baseRows: ResourceRow[] = useMemo(
    () =>
      processedKBs.map((kb) => {
        const kbWithCount = kb as KnowledgeBaseWithDocCount
        return {
          id: kb.id,
          cells: {
            name: {
              content: (
                <span className='flex w-full min-w-0 items-center justify-between'>
                  <span className={cn('flex min-w-0 items-center', chipContentGap)}>
                    <span className={cellIconNodeClass}>{KNOWLEDGE_BASE_ICON}</span>
                    <FloatingOverflowText
                      label={kb.name}
                      className={cn('block', chipContentLabelClass)}
                    />
                  </span>
                  <span className='flex items-center gap-0.5'>
                    {kb.locked && (
                      <span role='img' aria-label='Knowledge base is locked'>
                        <Lock className='size-[14px] text-[var(--text-icon)]' aria-hidden='true' />
                      </span>
                    )}
                    <PinButton
                      workspaceId={workspaceId}
                      resourceType='knowledge_base'
                      resourceId={kb.id}
                      pinned={pinnedBaseIds.has(kb.id)}
                    />
                  </span>
                </span>
              ),
            },
            documents: {
              label: String(kbWithCount.docCount || 0),
            },
            tokens: {
              label: kb.tokenCount ? kb.tokenCount.toLocaleString() : '0',
            },
            connectors: connectorCell(kb.connectorTypes),
            created: timeCell(kb.createdAt),
            owner: ownerCell(kb.userId, members),
            updated: timeCell(kb.updatedAt),
          },
        }
      }),
    [processedKBs, members, workspaceId, pinnedBaseIds]
  )

  const folderRows: ResourceRow[] = useMemo(
    () =>
      visibleFolders.map((folder) => ({
        id: folderRowId(folder.id),
        cells: {
          name: {
            content: (
              <span className='flex w-full min-w-0 items-center justify-between'>
                <span className={cn('flex min-w-0 items-center', chipContentGap)}>
                  <span className={cellIconNodeClass}>{FOLDER_ICON}</span>
                  <FloatingOverflowText
                    label={folder.name}
                    className={cn('block', chipContentLabelClass)}
                  />
                </span>
                <span className='flex items-center gap-0.5'>
                  {folder.locked && (
                    <span role='img' aria-label='Folder is locked'>
                      <Lock className='size-[14px] text-[var(--text-icon)]' aria-hidden='true' />
                    </span>
                  )}
                  <PinButton
                    workspaceId={workspaceId}
                    resourceType='folder'
                    resourceId={folder.id}
                    pinned={pinnedFolderIds.has(folder.id)}
                  />
                </span>
              </span>
            ),
          },
          documents: { label: EMPTY_CELL_PLACEHOLDER },
          tokens: { label: EMPTY_CELL_PLACEHOLDER },
          connectors: { label: EMPTY_CELL_PLACEHOLDER },
          created: timeCell(folder.createdAt),
          owner: ownerCell(folder.userId, members),
          updated: timeCell(folder.updatedAt),
        },
      })),
    [visibleFolders, members, workspaceId, pinnedFolderIds]
  )

  const rows: ResourceRow[] = useMemo(() => {
    const baseRowsList = [...folderRows, ...baseRows]
    if (!listRename.editingId) return baseRowsList
    return baseRowsList.map((row) => {
      if (row.id !== listRename.editingId) return row
      return {
        ...row,
        cells: {
          ...row.cells,
          name: {
            ...row.cells.name,
            editing: {
              value: listRename.editValue,
              onChange: listRename.setEditValue,
              onSubmit: listRename.submitRename,
              onCancel: listRename.cancelRename,
              disabled: listRename.isSaving,
            },
          },
        },
      }
    })
  }, [folderRows, baseRows, listRename.editingId, listRename.editValue, listRename.isSaving])

  const handleRowClick = useCallback(
    (rowId: string) => {
      if (isRowContextMenuOpenRef.current || isFolderContextMenuOpenRef.current) return
      if (listRename.editingId === rowId) return
      const parsed = parseRowId(rowId)
      if (parsed.kind === 'folder') {
        void setKnowledgeFolderParams({ folderId: parsed.id })
        return
      }
      const kb = knowledgeBasesRef.current.find((k) => k.id === parsed.id)
      if (!kb) return
      const urlParams = new URLSearchParams({ kbName: kb.name })
      router.push(`/workspace/${workspaceId}/knowledge/${kb.id}?${urlParams.toString()}`)
    },
    [router, workspaceId, setKnowledgeFolderParams, listRename.editingId]
  )

  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent, rowId: string) => {
      const parsed = parseRowId(rowId)
      if (parsed.kind === 'folder') {
        setActiveFolderId(parsed.id)
        handleFolderCtxMenu(e)
        return
      }
      const kb = knowledgeBasesRef.current.find((k) => k.id === parsed.id) as
        | KnowledgeBaseWithDocCount
        | undefined
      setActiveKnowledgeBase(kb ?? null)
      handleRowCtxMenu(e)
    },
    [handleRowCtxMenu, handleFolderCtxMenu]
  )

  const handleConfirmDelete = useCallback(async () => {
    const kb = activeKnowledgeBaseRef.current
    if (!kb) return
    setIsDeleting(true)
    try {
      await handleDeleteKnowledgeBase(kb.id)
      setIsDeleteModalOpen(false)
      setActiveKnowledgeBase(null)
    } finally {
      setIsDeleting(false)
    }
  }, [handleDeleteKnowledgeBase])

  const handleCloseDeleteModal = useCallback(() => {
    setIsDeleteModalOpen(false)
    setActiveKnowledgeBase(null)
  }, [])

  const handleOpenInNewTab = useCallback(() => {
    const kb = activeKnowledgeBaseRef.current
    if (!kb) return
    const urlParams = new URLSearchParams({ kbName: kb.name })
    window.open(`/workspace/${workspaceId}/knowledge/${kb.id}?${urlParams.toString()}`, '_blank')
  }, [workspaceId])

  const handleViewTags = useCallback(() => {
    setIsTagsModalOpen(true)
  }, [])

  const handleCopyId = useCallback(() => {
    const kb = activeKnowledgeBaseRef.current
    if (kb) {
      navigator.clipboard.writeText(kb.id)
    }
  }, [])

  const handleEdit = useCallback(() => {
    setIsEditModalOpen(true)
  }, [])

  const handleDelete = useCallback(() => {
    setIsDeleteModalOpen(true)
  }, [])

  const knowledgeBaseInheritedLocked = isFolderOrAncestorLocked(
    activeKnowledgeBase?.folderId ?? null,
    Object.fromEntries(folderById)
  )

  const handleToggleKnowledgeBaseLock = useCallback(() => {
    const kb = activeKnowledgeBaseRef.current
    if (!kb || knowledgeBaseInheritedLocked) return
    updateKnowledgeBaseMutation({
      knowledgeBaseId: kb.id,
      updates: { locked: !kb.locked },
    })
  }, [updateKnowledgeBaseMutation, knowledgeBaseInheritedLocked])

  const handleFolderOpen = useCallback(() => {
    if (!activeFolderId) return
    void setKnowledgeFolderParams({ folderId: activeFolderId })
    closeFolderContextMenu()
  }, [activeFolderId, setKnowledgeFolderParams, closeFolderContextMenu])

  const handleFolderRename = useCallback(() => {
    if (!activeFolder) return
    listRename.startRename(folderRowId(activeFolder.id), activeFolder.name)
    closeFolderContextMenu()
  }, [activeFolder, listRename.startRename, closeFolderContextMenu])

  const handleFolderDelete = useCallback(() => {
    setIsFolderDeleteModalOpen(true)
    closeFolderContextMenu()
  }, [closeFolderContextMenu])

  const folderInheritedLocked = isFolderOrAncestorLocked(
    activeFolder?.parentId ?? null,
    Object.fromEntries(folderById)
  )

  const handleToggleFolderLock = useCallback(() => {
    if (!activeFolder || folderInheritedLocked) return
    updateFolder.mutate({
      workspaceId,
      resourceType: 'knowledge_base',
      id: activeFolder.id,
      updates: { locked: !activeFolder.locked },
    })
  }, [activeFolder, folderInheritedLocked, updateFolder, workspaceId])

  const handleCloseFolderDeleteModal = useCallback(() => {
    setIsFolderDeleteModalOpen(false)
    setActiveFolderId(null)
  }, [])

  const handleConfirmFolderDelete = useCallback(async () => {
    if (!activeFolderId) return
    try {
      await deleteFolder.mutateAsync({
        workspaceId,
        resourceType: 'knowledge_base',
        id: activeFolderId,
      })
      setIsFolderDeleteModalOpen(false)
      setActiveFolderId(null)
      if (currentFolderId === activeFolderId) {
        void setKnowledgeFolderParams({ folderId: null })
      }
    } catch (deleteError) {
      logger.error('Failed to delete folder:', deleteError)
    }
  }, [activeFolderId, deleteFolder, workspaceId, currentFolderId, setKnowledgeFolderParams])

  const handleFolderCreated = useCallback(
    (folder: FolderType) => {
      listRename.startRename(folderRowId(folder.id), folder.name)
    },
    [listRename.startRename]
  )

  const handleCreateFolder = useFolderCreateWithDedup({
    workspaceId,
    resourceType: 'knowledge_base',
    folders,
    currentFolderId,
    createFolder,
    onCreated: handleFolderCreated,
  })

  const headerActions: ResourceAction[] = useMemo(
    () => [
      {
        text: 'New folder',
        icon: FolderPlus,
        onSelect: handleCreateFolder,
        disabled: createFolder.isPending || !canEdit,
      },
      {
        text: 'New base',
        icon: Plus,
        onSelect: handleOpenCreateModal,
        disabled: !canEdit,
        variant: 'primary',
      },
    ],
    [handleCreateFolder, createFolder.isPending, handleOpenCreateModal, canEdit]
  )

  const searchConfig: SearchConfig = useMemo(
    () => ({
      value: searchInputValue,
      onChange: setSearchInputValue,
      onClearAll: () => setSearchInputValue(''),
      placeholder: 'Search knowledge bases...',
    }),
    [searchInputValue]
  )

  const sortConfig: SortConfig = useMemo(
    () => ({
      options: [
        { id: 'name', label: 'Name' },
        { id: 'documents', label: 'Documents' },
        { id: 'tokens', label: 'Tokens' },
        { id: 'connectors', label: 'Connectors' },
        { id: 'created', label: 'Created' },
        { id: 'updated', label: 'Last Updated' },
        { id: 'owner', label: 'Owner' },
      ],
      active: activeSort,
      onSort: (column, direction) => setActiveSort({ column, direction }),
      onClear: () => setActiveSort(null),
    }),
    [activeSort]
  )

  const memberOptions: ChipDropdownOption[] = useMemo(
    () =>
      (members ?? []).map((m) => ({
        value: m.userId,
        label: m.name,
        iconElement: m.image ? (
          <img
            src={m.image}
            alt={m.name}
            referrerPolicy='no-referrer'
            className='size-[14px] rounded-full border border-[var(--border)] object-cover'
          />
        ) : (
          <span className='flex size-[14px] items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-3)] font-medium text-[8px] text-[var(--text-secondary)]'>
            {m.name.charAt(0).toUpperCase()}
          </span>
        ),
      })),
    [members]
  )

  const filterContent = useMemo(
    () => (
      <div className='flex w-[260px] flex-col gap-3 p-3'>
        <div className='flex flex-col gap-2'>
          <div className='flex h-5 items-center justify-between'>
            <span className={FILTER_SECTION_LABEL_CLASS}>Connectors</span>
            {connectorFilter.length > 0 && (
              <Button
                variant='ghost'
                onClick={() => setConnectorFilter([])}
                className='-mr-1 h-auto px-1 py-0.5 text-[var(--text-muted)] text-xs hover-hover:text-[var(--text-secondary)]'
              >
                Clear
              </Button>
            )}
          </div>
          <ChipDropdown
            options={CONNECTOR_FILTER_OPTIONS}
            value={connectorFilter[0] ?? 'all'}
            onChange={(value) => setConnectorFilter(value === 'all' ? [] : [value])}
            align='start'
            fullWidth
            flush
          />
        </div>
        <div className='flex flex-col gap-2'>
          <div className='flex h-5 items-center justify-between'>
            <span className={FILTER_SECTION_LABEL_CLASS}>Content</span>
            {contentFilter.length > 0 && (
              <Button
                variant='ghost'
                onClick={() => setContentFilter([])}
                className='-mr-1 h-auto px-1 py-0.5 text-[var(--text-muted)] text-xs hover-hover:text-[var(--text-secondary)]'
              >
                Clear
              </Button>
            )}
          </div>
          <ChipDropdown
            options={CONTENT_FILTER_OPTIONS}
            value={contentFilter[0] ?? 'all'}
            onChange={(value) => setContentFilter(value === 'all' ? [] : [value])}
            align='start'
            fullWidth
            flush
          />
        </div>
        {memberOptions.length > 0 && (
          <div className='flex flex-col gap-2'>
            <div className='flex h-5 items-center justify-between'>
              <span className={FILTER_SECTION_LABEL_CLASS}>Owner</span>
              {ownerFilter.length > 0 && (
                <Button
                  variant='ghost'
                  onClick={() => setOwnerFilter([])}
                  className='-mr-1 h-auto px-1 py-0.5 text-[var(--text-muted)] text-xs hover-hover:text-[var(--text-secondary)]'
                >
                  Clear
                </Button>
              )}
            </div>
            <ChipDropdown
              multiple
              options={memberOptions}
              value={ownerFilter}
              onChange={setOwnerFilter}
              allLabel='All'
              searchable
              searchPlaceholder='Search members...'
              align='start'
              fullWidth
              flush
            />
          </div>
        )}
      </div>
    ),
    [connectorFilter, contentFilter, ownerFilter, memberOptions]
  )

  const filterTags: FilterTag[] = useMemo(() => {
    const tags: FilterTag[] = []
    if (connectorFilter.length > 0) {
      const label =
        connectorFilter.length === 1
          ? `Connectors: ${connectorFilter[0] === 'connected' ? 'With connectors' : 'Without connectors'}`
          : `Connectors: ${connectorFilter.length} types`
      tags.push({ label, onRemove: () => setConnectorFilter([]) })
    }
    if (contentFilter.length > 0) {
      const label =
        contentFilter.length === 1
          ? `Content: ${contentFilter[0] === 'has-docs' ? 'Has documents' : 'Empty'}`
          : `Content: ${contentFilter.length} types`
      tags.push({ label, onRemove: () => setContentFilter([]) })
    }
    if (ownerFilter.length > 0) {
      const label =
        ownerFilter.length === 1
          ? `Owner: ${members?.find((m) => m.userId === ownerFilter[0])?.name ?? '1 member'}`
          : `Owner: ${ownerFilter.length} members`
      tags.push({ label, onRemove: () => setOwnerFilter([]) })
    }
    return tags
  }, [connectorFilter, contentFilter, ownerFilter, members])

  const handleNavigateToRoot = useCallback(() => {
    void setKnowledgeFolderParams({ folderId: null })
  }, [setKnowledgeFolderParams])

  const handleNavigateToFolder = useCallback(
    (folderId: string) => {
      void setKnowledgeFolderParams({ folderId })
    },
    [setKnowledgeFolderParams]
  )

  const listBreadcrumbs = useFolderBreadcrumbs({
    folderById,
    currentFolderId,
    rootLabel: 'Knowledge Base',
    onNavigateRoot: handleNavigateToRoot,
    onNavigateFolder: handleNavigateToFolder,
    breadcrumbRename,
    canEdit,
    canEditLoading: userPermissions.isLoading,
  })

  return (
    <>
      <Resource onContextMenu={handleContentContextMenu}>
        <Resource.Header
          icon={Database}
          title='Knowledge Base'
          breadcrumbs={listBreadcrumbs}
          actions={headerActions}
        />
        <Resource.Options
          search={searchConfig}
          sort={sortConfig}
          filterTags={filterTags}
          filter={{ content: filterContent }}
        />
        <Resource.Table
          columns={COLUMNS}
          rows={rows}
          onRowClick={handleRowClick}
          onRowContextMenu={handleRowContextMenu}
        />
      </Resource>

      <KnowledgeListContextMenu
        isOpen={isListContextMenuOpen}
        position={listContextMenuPosition}
        onClose={closeListContextMenu}
        onAddKnowledgeBase={handleOpenCreateModal}
        onCreateFolder={handleCreateFolder}
        disableAdd={!canEdit}
        disableCreateFolder={createFolder.isPending || !canEdit}
      />

      {activeKnowledgeBase && (
        <KnowledgeBaseContextMenu
          isOpen={isRowContextMenuOpen}
          position={rowContextMenuPosition}
          onClose={closeRowContextMenu}
          onOpenInNewTab={handleOpenInNewTab}
          onViewTags={handleViewTags}
          onCopyId={handleCopyId}
          onEdit={handleEdit}
          onDelete={handleDelete}
          showOpenInNewTab
          showViewTags
          showEdit
          showDelete
          disableEdit={!canEdit}
          disableDelete={!canEdit}
          onToggleLock={handleToggleKnowledgeBaseLock}
          showLock
          disableLock={!userPermissions.canAdmin || knowledgeBaseInheritedLocked}
          isLocked={Boolean(activeKnowledgeBase.locked)}
        />
      )}

      {activeFolder && (
        <KnowledgeFolderContextMenu
          isOpen={isFolderContextMenuOpen}
          position={folderContextMenuPosition}
          onClose={closeFolderContextMenu}
          onOpen={handleFolderOpen}
          onRename={handleFolderRename}
          onDelete={handleFolderDelete}
          canEdit={canEdit}
          onToggleLock={handleToggleFolderLock}
          showLock
          disableLock={!userPermissions.canAdmin || folderInheritedLocked}
          isLocked={Boolean(activeFolder.locked)}
        />
      )}

      {activeKnowledgeBase && (
        <EditKnowledgeBaseModal
          open={isEditModalOpen}
          onOpenChange={setIsEditModalOpen}
          knowledgeBaseId={activeKnowledgeBase.id}
          initialName={activeKnowledgeBase.name}
          initialDescription={activeKnowledgeBase.description || ''}
          chunkingConfig={activeKnowledgeBase.chunkingConfig}
          onSave={handleUpdateKnowledgeBase}
        />
      )}

      {activeKnowledgeBase && (
        <DeleteKnowledgeBaseModal
          isOpen={isDeleteModalOpen}
          onClose={handleCloseDeleteModal}
          onConfirm={handleConfirmDelete}
          isDeleting={isDeleting}
          knowledgeBaseName={activeKnowledgeBase.name}
        />
      )}

      {activeFolder && (
        <DeleteKnowledgeBaseModal
          isOpen={isFolderDeleteModalOpen}
          onClose={handleCloseFolderDeleteModal}
          onConfirm={handleConfirmFolderDelete}
          isDeleting={deleteFolder.isPending}
          knowledgeBaseName={activeFolder.name}
          kind='folder'
        />
      )}

      {activeKnowledgeBase && (
        <BaseTagsModal
          open={isTagsModalOpen}
          onOpenChange={setIsTagsModalOpen}
          knowledgeBaseId={activeKnowledgeBase.id}
        />
      )}

      <CreateBaseModal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        folderId={currentFolderId}
      />
    </>
  )
}
