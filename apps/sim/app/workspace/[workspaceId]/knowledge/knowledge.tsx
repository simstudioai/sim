'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChipDropdownOption } from '@sim/emcn'
import { Button, ChipConfirmModal, ChipDropdown, Plus, Tooltip, toast } from '@sim/emcn'
import { Database, FolderPlus } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useParams, useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import type { KnowledgeBaseData } from '@/lib/knowledge/types'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import type {
  BreadcrumbItem,
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
  ownerCell,
  Resource,
  timeCell,
} from '@/app/workspace/[workspaceId]/components'
import type { MoveOptionNode } from '@/app/workspace/[workspaceId]/components/folders'
import {
  buildDescendantIndex,
  buildMoveOptions,
  FolderContextMenu,
  folderBreadcrumbItems,
  folderRow,
  folderRowId,
  nextUntitledFolderName,
  parseFolderedRowId,
  parseMoveOptionValue,
  useFolderNavigation,
  useFolderRowDragDrop,
} from '@/app/workspace/[workspaceId]/components/folders'
import { BaseTagsModal } from '@/app/workspace/[workspaceId]/knowledge/[id]/components'
import {
  CreateBaseModal,
  DeleteKnowledgeBaseModal,
  EditKnowledgeBaseModal,
  KnowledgeBaseContextMenu,
  KnowledgeListContextMenu,
} from '@/app/workspace/[workspaceId]/knowledge/components'
import {
  knowledgeParsers,
  knowledgeSortParams,
  knowledgeUrlKeys,
} from '@/app/workspace/[workspaceId]/knowledge/search-params'
import { filterKnowledgeBases } from '@/app/workspace/[workspaceId]/knowledge/utils/sort'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import { useKnowledgeBasesList } from '@/hooks/kb/use-knowledge'
import { useCreateFolder, useDeleteFolderMutation, useUpdateFolder } from '@/hooks/queries/folders'
import { useDeleteKnowledgeBase, useUpdateKnowledgeBase } from '@/hooks/queries/kb/knowledge'
import { usePinItem, usePinnedIds, useUnpinItem } from '@/hooks/queries/pinned-items'
import { useWorkspaceMembersQuery, type WorkspaceMember } from '@/hooks/queries/workspace'
import { useDebounce } from '@/hooks/use-debounce'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { useInlineRename } from '@/hooks/use-inline-rename'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useUrlSort } from '@/hooks/use-url-sort'
import type { WorkflowFolder } from '@/stores/folders/types'

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

const ROOT_BREADCRUMB_LABEL = 'Knowledge Base'
const FOLDER_RESOURCE_TYPE = 'knowledge_base' as const

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

  const { config: permissionConfig } = usePermissionConfig()
  useEffect(() => {
    if (permissionConfig.hideKnowledgeBaseTab) {
      router.replace(`/workspace/${workspaceId}`)
    }
  }, [permissionConfig.hideKnowledgeBaseTab, router, workspaceId])

  const { knowledgeBases, error } = useKnowledgeBasesList(workspaceId)
  const { data: members } = useWorkspaceMembersQuery(workspaceId)
  /**
   * Indexed once: `ownerCell` resolves a member per row, so passing the raw array makes the
   * owner column O(rows x members) on every rebuild. Tables already does this.
   */
  const membersById = useMemo(() => {
    const byId = new Map<string, WorkspaceMember>()
    for (const member of members ?? []) byId.set(member.userId, member)
    return byId
  }, [members])
  /**
   * Two pin lookups: a folder pins under `resourceType: 'folder'`, which is a different pin
   * namespace from the knowledge bases it contains, so one set cannot answer for both.
   */
  const pinnedBaseIds = usePinnedIds(workspaceId, 'knowledge_base')
  const pinnedFolderIds = usePinnedIds(workspaceId, 'folder')
  const pinItem = usePinItem()
  const unpinItem = useUnpinItem()

  useEffect(() => {
    if (error) logger.error('Failed to load knowledge bases:', error)
  }, [error])

  const userPermissions = useUserPermissionsContext()

  const { mutateAsync: updateKnowledgeBaseMutation } = useUpdateKnowledgeBase(workspaceId)
  const { mutateAsync: deleteKnowledgeBaseMutation } = useDeleteKnowledgeBase(workspaceId)

  const { currentFolderId, setCurrentFolderId, breadcrumbs, folders, folderById, foldersResolved } =
    useFolderNavigation({
      resourceType: FOLDER_RESOURCE_TYPE,
      workspaceId,
    })

  const createFolder = useCreateFolder()
  const updateFolder = useUpdateFolder()
  const deleteFolder = useDeleteFolderMutation()

  const [
    {
      search: urlSearchQuery,
      connector: connectorFilter,
      content: contentFilter,
      owner: ownerFilter,
    },
    setKnowledgeFilters,
  ] = useQueryStates(knowledgeParsers, knowledgeUrlKeys)

  /**
   * The input is controlled directly by the instant nuqs value; only the URL
   * write is debounced. The in-memory filter below still reads a debounced
   * value so it doesn't recompute on every keystroke.
   */
  const setSearchQuery = useDebouncedSearchSetter((value, options) =>
    setKnowledgeFilters({ search: value }, options)
  )
  const debouncedSearchQuery = useDebounce(urlSearchQuery, SEARCH_DEBOUNCE_MS)

  const {
    activeSort,
    onSort: onSortColumn,
    onClear: onClearSort,
  } = useUrlSort(knowledgeSortParams, knowledgeUrlKeys)

  const setConnectorFilter = useCallback(
    (next: string[]) => setKnowledgeFilters({ connector: next }),
    [setKnowledgeFilters]
  )
  const setContentFilter = useCallback(
    (next: string[]) => setKnowledgeFilters({ content: next }),
    [setKnowledgeFilters]
  )
  const setOwnerFilter = useCallback(
    (next: string[]) => setKnowledgeFilters({ owner: next }),
    [setKnowledgeFilters]
  )

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)

  const [activeKnowledgeBase, setActiveKnowledgeBase] = useState<KnowledgeBaseWithDocCount | null>(
    null
  )
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [isTagsModalOpen, setIsTagsModalOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const [activeFolder, setActiveFolder] = useState<WorkflowFolder | null>(null)
  const [folderPendingDelete, setFolderPendingDelete] = useState<WorkflowFolder | null>(null)

  const {
    isOpen: isFolderContextMenuOpen,
    position: folderContextMenuPosition,
    handleContextMenu: handleFolderCtxMenu,
    closeMenu: closeFolderContextMenu,
  } = useContextMenu()

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

  const isRowContextMenuOpenRef = useRef(isRowContextMenuOpen)
  isRowContextMenuOpenRef.current = isRowContextMenuOpen

  const isFolderContextMenuOpenRef = useRef(isFolderContextMenuOpen)
  isFolderContextMenuOpenRef.current = isFolderContextMenuOpen

  const knowledgeBasesRef = useRef(knowledgeBases)
  knowledgeBasesRef.current = knowledgeBases

  const activeKnowledgeBaseRef = useRef(activeKnowledgeBase)
  activeKnowledgeBaseRef.current = activeKnowledgeBase

  const activeFolderRef = useRef(activeFolder)
  activeFolderRef.current = activeFolder

  const foldersRef = useRef(folders)
  foldersRef.current = folders

  const currentFolderIdRef = useRef(currentFolderId)
  currentFolderIdRef.current = currentFolderId

  /**
   * Renames both kinds of row through one multiplexed session — the row id already encodes
   * which kind it is, so the table's `editing` cell wiring stays identical for folders and
   * knowledge bases. A duplicate sibling name is a 409 from the folder API; the mutations
   * below surface it and `useInlineRename` keeps the edit session open so the user can pick
   * another name.
   */
  const listRename = useInlineRename({
    onSave: async (rowId, name) => {
      const parsed = parseFolderedRowId(rowId)
      if (parsed.kind === 'folder') {
        try {
          return await updateFolder.mutateAsync({
            workspaceId,
            resourceType: FOLDER_RESOURCE_TYPE,
            id: parsed.id,
            updates: { name },
          })
        } catch (renameError) {
          toast.error(getErrorMessage(renameError, 'Failed to rename folder'))
          throw renameError
        }
      }
      return updateKnowledgeBaseMutation({
        knowledgeBaseId: parsed.id,
        updates: { name },
      })
    },
  })

  const listRenameRef = useRef(listRename)
  listRenameRef.current = listRename

  /** Renames the open folder from its breadcrumb crumb, where it has no row to edit. */
  const breadcrumbRename = useInlineRename({
    onSave: async (folderId, name) => {
      try {
        return await updateFolder.mutateAsync({
          workspaceId,
          resourceType: FOLDER_RESOURCE_TYPE,
          id: folderId,
          updates: { name },
        })
      } catch (renameError) {
        toast.error(getErrorMessage(renameError, 'Failed to rename folder'))
        throw renameError
      }
    },
  })

  const breadcrumbRenameRef = useRef(breadcrumbRename)
  breadcrumbRenameRef.current = breadcrumbRename

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

  /**
   * Folders in the open folder, sorted independently of the bases below them.
   *
   * With no explicit sort the two blocks disagree on purpose — folders read best
   * alphabetically while bases read best most-recently-updated-first — which mirrors the
   * Files page. The resource filters (connectors/content/owner) describe properties a folder
   * does not have, so folders answer only to the search term.
   */
  const visibleFolders = useMemo(() => {
    const siblings = folders.filter((folder) => (folder.parentId ?? null) === currentFolderId)
    const needle = debouncedSearchQuery.trim().toLowerCase()
    const searched = needle
      ? siblings.filter((folder) => folder.name.toLowerCase().includes(needle))
      : siblings

    const col = activeSort?.column ?? 'name'
    const dir = activeSort?.direction ?? 'asc'
    return [...searched].sort((a, b) => {
      const aPinned = pinnedFolderIds.has(a.id)
      const bPinned = pinnedFolderIds.has(b.id)
      if (aPinned !== bPinned) return aPinned ? -1 : 1

      let cmp = 0
      if (col === 'created') {
        cmp = a.createdAt.getTime() - b.createdAt.getTime()
      } else if (col === 'updated') {
        cmp = a.updatedAt.getTime() - b.updatedAt.getTime()
      } else {
        cmp = a.name.localeCompare(b.name)
      }
      return dir === 'asc' ? cmp : -cmp
    })
  }, [folders, currentFolderId, debouncedSearchQuery, activeSort, pinnedFolderIds])

  const processedKBs = useMemo(() => {
    /**
     * A `folderId` that no longer names an active folder — a base restored on its own out of
     * Recently Deleted while its folder stayed archived, or a cascade that failed partway —
     * would otherwise match no level at all and leave the base unreachable from every view.
     * Fall it back to the root instead — but only once `foldersResolved` says the index is the
     * complete set for THIS workspace. Gating on a loading flag instead would treat an errored
     * fetch, a disabled query, or the previous workspace's cached folders as "no such folder"
     * and drag every foldered base to the root.
     */
    let result = filterKnowledgeBases(knowledgeBases, debouncedSearchQuery).filter((kb) => {
      const folderId = kb.folderId ?? null
      const effectiveFolderId =
        !foldersResolved || !folderId || folderById.has(folderId) ? folderId : null
      return effectiveFolderId === currentFolderId
    })

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
      // Pinned bases float to the top of every sort/direction — pinning is a
      // user-declared priority, not another sort key to be inverted by `desc`.
      const aPinned = pinnedBaseIds.has(a.id)
      const bPinned = pinnedBaseIds.has(b.id)
      if (aPinned !== bPinned) return aPinned ? -1 : 1

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
          cmp = (membersById.get(a.userId)?.name ?? '').localeCompare(
            membersById.get(b.userId)?.name ?? ''
          )
          break
      }
      return dir === 'asc' ? cmp : -cmp
    })
  }, [
    knowledgeBases,
    currentFolderId,
    folderById,
    foldersResolved,
    debouncedSearchQuery,
    connectorFilter,
    contentFilter,
    ownerFilter,
    activeSort,
    membersById,
    pinnedBaseIds,
  ])

  const baseRows: ResourceRow[] = useMemo(() => {
    const folderRows = visibleFolders.map((folder) =>
      folderRow(folder, {
        pinned: pinnedFolderIds.has(folder.id),
        cells: {
          documents: { label: EMPTY_CELL_PLACEHOLDER },
          tokens: { label: EMPTY_CELL_PLACEHOLDER },
          connectors: { label: EMPTY_CELL_PLACEHOLDER },
          created: timeCell(folder.createdAt),
          owner: ownerCell(folder.userId, membersById),
          updated: timeCell(folder.updatedAt),
        },
      })
    )

    const knowledgeBaseRows = processedKBs.map((kb) => {
      const kbWithCount = kb as KnowledgeBaseWithDocCount
      return {
        id: kb.id,
        cells: {
          name: {
            icon: KNOWLEDGE_BASE_ICON,
            label: kb.name,
            pinned: pinnedBaseIds.has(kb.id),
          },
          documents: {
            label: String(kbWithCount.docCount || 0),
          },
          tokens: {
            label: kb.tokenCount ? kb.tokenCount.toLocaleString() : '0',
          },
          connectors: connectorCell(kb.connectorTypes),
          created: timeCell(kb.createdAt),
          owner: ownerCell(kb.userId, membersById),
          updated: timeCell(kb.updatedAt),
        },
      }
    })

    return [...folderRows, ...knowledgeBaseRows]
  }, [visibleFolders, processedKBs, membersById, pinnedFolderIds, pinnedBaseIds])

  /**
   * Rename is layered over the built rows rather than folded into the builder above, so a
   * keystroke in the rename field does not rebuild every row's cells.
   */
  const rows: ResourceRow[] = useMemo(() => {
    if (!listRename.editingId) return baseRows
    return baseRows.map((row) => {
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
  }, [
    baseRows,
    listRename.editingId,
    listRename.editValue,
    listRename.isSaving,
    listRename.setEditValue,
    listRename.submitRename,
    listRename.cancelRename,
  ])

  const handleRowClick = useCallback(
    (rowId: string) => {
      if (isRowContextMenuOpenRef.current || isFolderContextMenuOpenRef.current) return
      if (listRenameRef.current.editingId === rowId) return

      const parsed = parseFolderedRowId(rowId)
      if (parsed.kind === 'folder') {
        setCurrentFolderId(parsed.id)
        return
      }

      const kb = knowledgeBasesRef.current.find((k) => k.id === parsed.id)
      if (!kb) return
      const urlParams = new URLSearchParams({ kbName: kb.name })
      router.push(`/workspace/${workspaceId}/knowledge/${parsed.id}?${urlParams.toString()}`)
    },
    [router, workspaceId, setCurrentFolderId]
  )

  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent, rowId: string) => {
      const parsed = parseFolderedRowId(rowId)
      if (parsed.kind === 'folder') {
        const folder = foldersRef.current.find((item) => item.id === parsed.id)
        if (!folder) return
        setActiveFolder(folder)
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

  const canEdit = userPermissions.canEdit === true

  const handleCreateFolder = useCallback(async () => {
    if (!workspaceId) return
    const parentId = currentFolderIdRef.current
    const name = nextUntitledFolderName(foldersRef.current, parentId)

    try {
      const folder = await createFolder.mutateAsync({
        workspaceId,
        resourceType: FOLDER_RESOURCE_TYPE,
        name,
        parentId: parentId ?? undefined,
      })
      /**
       * A live search term filters the folder list too, so a brand-new "New folder" would not
       * match it — the row never renders, the rename field never appears, and the create reads
       * as a no-op even though it succeeded. Clear the search so the thing just created is on
       * screen to be named.
       */
      setSearchQuery('')
      // Drop straight into rename: the auto-generated name is a placeholder, and the user
      // should not have to hunt for a second action to replace it.
      listRenameRef.current.startRename(folderRowId(folder.id), folder.name)
    } catch (createError) {
      logger.error('Failed to create folder', createError)
      toast.error(getErrorMessage(createError, 'Failed to create folder'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  const handleRenameFolder = useCallback(() => {
    const folder = activeFolderRef.current
    if (!folder) return
    listRenameRef.current.startRename(folderRowId(folder.id), folder.name)
  }, [])

  const handleOpenFolder = useCallback(() => {
    const folder = activeFolderRef.current
    if (folder) setCurrentFolderId(folder.id)
  }, [setCurrentFolderId])

  const handleCopyFolderId = useCallback(() => {
    const folder = activeFolderRef.current
    if (folder) navigator.clipboard.writeText(folder.id)
  }, [])

  const handleRequestFolderDelete = useCallback(() => {
    setFolderPendingDelete(activeFolderRef.current)
  }, [])

  const folderPendingDeleteRef = useRef(folderPendingDelete)
  folderPendingDeleteRef.current = folderPendingDelete

  const handleConfirmFolderDelete = useCallback(async () => {
    const folder = folderPendingDeleteRef.current
    if (!folder) return
    try {
      await deleteFolder.mutateAsync({
        workspaceId,
        resourceType: FOLDER_RESOURCE_TYPE,
        id: folder.id,
      })
      setFolderPendingDelete(null)
      setActiveFolder(null)
      // Deleting the folder you are standing in leaves the list pointed at an archived
      // folder, which renders as an empty page with a dead breadcrumb — step out to its
      // parent instead.
      if (currentFolderIdRef.current === folder.id) {
        setCurrentFolderId(folder.parentId)
      }
    } catch (deleteError) {
      logger.error('Failed to delete folder', deleteError)
      toast.error(getErrorMessage(deleteError, 'Failed to delete folder'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, setCurrentFolderId])

  const descendantsByFolderId = useMemo(() => buildDescendantIndex(folders), [folders])

  const handleToggleBasePin = useCallback(() => {
    const kb = activeKnowledgeBaseRef.current
    if (!kb) return
    const mutation = pinnedBaseIds.has(kb.id) ? unpinItem : pinItem
    mutation.mutate({ workspaceId, resourceType: 'knowledge_base', resourceId: kb.id })
    closeRowContextMenu()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutation objects are unstable; mutate is stable in v5
  }, [workspaceId, pinnedBaseIds, closeRowContextMenu])

  const handleToggleFolderPin = useCallback(() => {
    const folder = activeFolderRef.current
    if (!folder) return
    const mutation = pinnedFolderIds.has(folder.id) ? unpinItem : pinItem
    mutation.mutate({ workspaceId, resourceType: 'folder', resourceId: folder.id })
    closeFolderContextMenu()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutation objects are unstable; mutate is stable in v5
  }, [workspaceId, pinnedFolderIds, closeFolderContextMenu])

  /** Move targets for the folder under the cursor: itself and its subtree are unreachable. */
  const folderMoveOptions: MoveOptionNode[] = useMemo(() => {
    if (!activeFolder) return []
    const excluded = new Set<string>([activeFolder.id])
    for (const id of descendantsByFolderId.get(activeFolder.id) ?? []) excluded.add(id)
    return buildMoveOptions({
      folders,
      rootLabel: ROOT_BREADCRUMB_LABEL,
      excludedFolderIds: excluded,
    })
  }, [folders, activeFolder, descendantsByFolderId])

  /** Move targets for a knowledge base: every folder, since a base has no subtree. */
  const knowledgeBaseMoveOptions: MoveOptionNode[] = useMemo(
    () => buildMoveOptions({ folders, rootLabel: ROOT_BREADCRUMB_LABEL }),
    [folders]
  )

  /** Shared by the "Move to" submenu and by dropping a folder row onto another folder. */
  const moveFolderTo = useCallback(
    async (folderId: string, parentId: string | null) => {
      try {
        await updateFolder.mutateAsync({
          workspaceId,
          resourceType: FOLDER_RESOURCE_TYPE,
          id: folderId,
          updates: { parentId },
        })
      } catch (moveError) {
        logger.error('Failed to move folder', moveError)
        toast.error(getErrorMessage(moveError, 'Failed to move folder'))
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutation objects are unstable; mutateAsync is stable in v5
    [workspaceId]
  )

  /** Shared by the "Move to" submenu and by dropping a base row onto a folder. */
  const moveKnowledgeBaseTo = useCallback(
    async (knowledgeBaseId: string, folderId: string | null) => {
      try {
        await updateKnowledgeBaseMutation({ knowledgeBaseId, updates: { folderId } })
      } catch (moveError) {
        logger.error('Failed to move knowledge base', moveError)
        toast.error(getErrorMessage(moveError, 'Failed to move knowledge base'))
      }
    },
    [updateKnowledgeBaseMutation]
  )

  const handleMoveFolder = useCallback(
    async (optionValue: string) => {
      const folder = activeFolderRef.current
      if (!folder) return
      const parentId = parseMoveOptionValue(optionValue)
      // Live placement, not the snapshot taken when the menu opened — a refetch or concurrent
      // move in between would otherwise skip the write the user just chose. Matches the
      // knowledge-base move below and both Tables handlers.
      const current = foldersRef.current.find((item) => item.id === folder.id) ?? folder
      if ((current.parentId ?? null) !== parentId) await moveFolderTo(folder.id, parentId)
      closeFolderContextMenu()
    },
    [moveFolderTo, closeFolderContextMenu]
  )

  const handleMoveKnowledgeBase = useCallback(
    async (optionValue: string) => {
      const kb = activeKnowledgeBaseRef.current
      if (!kb) return
      const folderId = parseMoveOptionValue(optionValue)
      // Re-read placement from the live list: `activeKnowledgeBase` is a snapshot from when
      // the menu opened, and a refetch since then would make the no-op check wrong.
      const current = knowledgeBasesRef.current.find((item) => item.id === kb.id) ?? kb
      if ((current.folderId ?? null) !== folderId) await moveKnowledgeBaseTo(kb.id, folderId)
      closeRowContextMenu()
    },
    [moveKnowledgeBaseTo, closeRowContextMenu]
  )

  const rowDragDropConfig = useFolderRowDragDrop({
    canEdit,
    editingRowId: listRename.editingId,
    descendantsByFolderId,
    getFolderParentId: (folderId) => foldersRef.current.find((f) => f.id === folderId)?.parentId,
    getResourceFolderId: (knowledgeBaseId) =>
      knowledgeBasesRef.current.find((kb) => kb.id === knowledgeBaseId)?.folderId ?? null,
    getRowLabel: (rowId) => {
      const parsed = parseFolderedRowId(rowId)
      return parsed.kind === 'folder'
        ? (foldersRef.current.find((f) => f.id === parsed.id)?.name ?? 'Folder')
        : (knowledgeBasesRef.current.find((kb) => kb.id === parsed.id)?.name ?? 'Knowledge base')
    },
    onMoveFolder: (folderId, targetFolderId) => void moveFolderTo(folderId, targetFolderId),
    onMoveResource: (knowledgeBaseId, targetFolderId) =>
      void moveKnowledgeBaseTo(knowledgeBaseId, targetFolderId),
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
    [handleOpenCreateModal, handleCreateFolder, createFolder.isPending, canEdit]
  )

  const listBreadcrumbs: BreadcrumbItem[] = useMemo(
    () =>
      folderBreadcrumbItems({
        rootLabel: ROOT_BREADCRUMB_LABEL,
        rootIcon: Database,
        breadcrumbs,
        onNavigate: setCurrentFolderId,
        currentFolderEditing:
          breadcrumbRename.editingId && breadcrumbRename.editingId === currentFolderId
            ? {
                isEditing: true,
                value: breadcrumbRename.editValue,
                onChange: breadcrumbRenameRef.current.setEditValue,
                onSubmit: breadcrumbRenameRef.current.submitRename,
                onCancel: breadcrumbRenameRef.current.cancelRename,
                disabled: breadcrumbRename.isSaving,
              }
            : undefined,
        currentFolderActions:
          canEdit && breadcrumbs.length > 0
            ? [
                {
                  label: 'Rename',
                  onClick: () => {
                    const folder = breadcrumbs[breadcrumbs.length - 1]
                    breadcrumbRenameRef.current.startRename(folder.id, folder.name)
                  },
                },
                {
                  label: 'Delete',
                  onClick: () => setFolderPendingDelete(breadcrumbs[breadcrumbs.length - 1]),
                },
              ]
            : undefined,
      }),
    [
      breadcrumbs,
      currentFolderId,
      setCurrentFolderId,
      canEdit,
      breadcrumbRename.editingId,
      breadcrumbRename.editValue,
      breadcrumbRename.isSaving,
    ]
  )

  const searchConfig: SearchConfig = useMemo(
    () => ({
      value: urlSearchQuery,
      onChange: setSearchQuery,
      onClearAll: () => setSearchQuery(''),
      placeholder: 'Search knowledge bases...',
    }),
    [urlSearchQuery, setSearchQuery]
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
      onSort: onSortColumn,
      onClear: onClearSort,
    }),
    [activeSort, onSortColumn, onClearSort]
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

  return (
    <>
      <Resource onContextMenu={handleContentContextMenu}>
        <Resource.Header
          icon={Database}
          title={ROOT_BREADCRUMB_LABEL}
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
          rowDragDrop={rowDragDropConfig}
          onRowClick={handleRowClick}
          onRowContextMenu={handleRowContextMenu}
        />
      </Resource>

      <KnowledgeListContextMenu
        isOpen={isListContextMenuOpen}
        position={listContextMenuPosition}
        onClose={closeListContextMenu}
        onAddKnowledgeBase={handleOpenCreateModal}
        onAddFolder={handleCreateFolder}
        disableAdd={!canEdit}
        disableAddFolder={createFolder.isPending || !canEdit}
      />

      {activeKnowledgeBase && (
        <KnowledgeBaseContextMenu
          isOpen={isRowContextMenuOpen}
          position={rowContextMenuPosition}
          onClose={closeRowContextMenu}
          onOpenInNewTab={handleOpenInNewTab}
          onViewTags={handleViewTags}
          onCopyId={handleCopyId}
          onTogglePin={handleToggleBasePin}
          pinned={pinnedBaseIds.has(activeKnowledgeBase.id)}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onMove={handleMoveKnowledgeBase}
          moveOptions={knowledgeBaseMoveOptions}
          showOpenInNewTab
          showViewTags
          showEdit
          showDelete
          disableEdit={!canEdit}
          disableDelete={!canEdit}
        />
      )}

      {activeFolder && (
        <FolderContextMenu
          isOpen={isFolderContextMenuOpen}
          position={folderContextMenuPosition}
          onClose={closeFolderContextMenu}
          onOpen={handleOpenFolder}
          onRename={handleRenameFolder}
          onDelete={handleRequestFolderDelete}
          onCopyId={handleCopyFolderId}
          onTogglePin={handleToggleFolderPin}
          pinned={pinnedFolderIds.has(activeFolder.id)}
          onMove={handleMoveFolder}
          moveOptions={folderMoveOptions}
          canEdit={canEdit}
        />
      )}

      <ChipConfirmModal
        open={folderPendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setFolderPendingDelete(null)
        }}
        srTitle='Delete folder'
        title='Delete folder'
        text={[
          'Are you sure you want to delete ',
          { text: folderPendingDelete?.name ?? 'this folder', bold: true },
          '? This also deletes the knowledge bases and folders inside it. You can restore them from Recently Deleted in Settings.',
        ]}
        confirm={{
          label: 'Delete',
          onClick: handleConfirmFolderDelete,
          pending: deleteFolder.isPending,
          pendingLabel: 'Deleting...',
        }}
      />

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
