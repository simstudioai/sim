'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChipDropdownOption } from '@sim/emcn'
import { Button, ChipConfirmModal, ChipDropdown, Tooltip, toast } from '@sim/emcn'
import { Database, FolderPlus, Pencil, Plus, Trash } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useParams, useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { MAX_KNOWLEDGE_BATCH_ITEMS } from '@/lib/knowledge/constants'
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
  FILTER_SECTION_LABEL_CLASS,
  OwnerAvatar,
  ownerCell,
  Resource,
  reportBulkOutcome,
  resourceListState,
  selectionLabel,
  timeCell,
  useResourceRowSelection,
} from '@/app/workspace/[workspaceId]/components'
import type {
  MoveOptionNode,
  SortableResource,
} from '@/app/workspace/[workspaceId]/components/folders'
import {
  buildDescendantIndex,
  buildMoveOptions,
  buildMoveOptionsExcludingSubtrees,
  EMPTY_LOCATION_CELL,
  FOLDER_LOCATION_COLUMN,
  FOLDERED_RESOURCE_HEADERS,
  FolderContextMenu,
  folderBreadcrumbItems,
  folderLocationLabel,
  folderRow,
  folderRowId,
  isSearchingResources,
  nextUntitledFolderName,
  parseFolderedRowId,
  parseMoveOptionValue,
  scopeFolderedItems,
  sortResources,
  splitFolderedRowIds,
  useFolderNavigation,
  useFolderRowDragDrop,
} from '@/app/workspace/[workspaceId]/components/folders'
import { ResourceActionBar } from '@/app/workspace/[workspaceId]/components/resource/components/action-bar'
import {
  KnowledgeEmptyState,
  ResourceNoResults,
} from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state'
import { BaseTagsModal } from '@/app/workspace/[workspaceId]/knowledge/[id]/components/base-tags-modal'
import {
  CreateBaseModal,
  DeleteKnowledgeBaseModal,
  EditKnowledgeBaseModal,
  KnowledgeBaseContextMenu,
  KnowledgeListContextMenu,
} from '@/app/workspace/[workspaceId]/knowledge/components'
import KnowledgeLoading from '@/app/workspace/[workspaceId]/knowledge/loading'
import { canDeleteKnowledgeBase } from '@/app/workspace/[workspaceId]/knowledge/permissions'
import {
  knowledgeListPreferenceConfig,
  knowledgeParsers,
  knowledgeSortParams,
  knowledgeUrlKeys,
} from '@/app/workspace/[workspaceId]/knowledge/search-params'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { BrandIcon } from '@/blocks/brand-icon'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import { useKnowledgeBasesList } from '@/hooks/kb/use-knowledge'
import { useCreateFolder, useDeleteFolderMutation, useUpdateFolder } from '@/hooks/queries/folders'
import {
  useBulkDeleteKnowledgeBases,
  useBulkMoveKnowledgeBases,
  useDeleteKnowledgeBase,
  useUpdateKnowledgeBase,
} from '@/hooks/queries/kb/knowledge'
import { usePinItem, usePinnedIds, useUnpinItem } from '@/hooks/queries/pinned-items'
import { useWorkspaceMembersQuery, type WorkspaceMember } from '@/hooks/queries/workspace'
import { useContextMenu } from '@/hooks/use-context-menu'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { useInlineRename } from '@/hooks/use-inline-rename'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useResourceListPreferences } from '@/hooks/use-resource-list-preferences'
import { useSearchFilterValue } from '@/hooks/use-search-filter-value'
import { useUrlSort } from '@/hooks/use-url-sort'
import type { WorkflowFolder } from '@/stores/folders/types'
import type { ResourceListPreference } from '@/stores/resource-list-preferences'

const logger = createLogger('Knowledge')

/** A list row, resolved to the entity it refers to. */
type KnowledgeResourceItem =
  | { kind: 'base'; base: KnowledgeBaseData }
  | { kind: 'folder'; folder: WorkflowFolder }

const COLUMNS: ResourceColumn[] = [
  { id: 'name', header: 'Name' },
  { id: 'documents', header: 'Documents', widthMultiplier: 0.6 },
  { id: 'tokens', header: 'Tokens', widthMultiplier: 0.6 },
  { id: 'connectors', header: 'Connectors', widthMultiplier: 0.7 },
  { id: 'created', header: 'Created' },
  { id: 'owner', header: 'Owner' },
  { id: 'updated', header: 'Last Updated' },
]

const SEARCH_COLUMNS: ResourceColumn[] = [...COLUMNS, FOLDER_LOCATION_COLUMN]

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

/** This list's private drag MIME, so a drag started on another list is never mistaken for one
 *  of these rows. */
const KNOWLEDGE_ROW_DRAG_MIME = 'application/x-sim-workspace-knowledge-rows'

const FOLDER_RESOURCE_TYPE = 'knowledge_base' as const
const ROOT_BREADCRUMB_LABEL = FOLDERED_RESOURCE_HEADERS[FOLDER_RESOURCE_TYPE].rootLabel

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
                <span className='flex size-5 shrink-0 items-center justify-center rounded-md bg-[var(--surface-4)]'>
                  <BrandIcon icon={Icon} className='size-[13px]' />
                </span>
              </Tooltip.Trigger>
              <Tooltip.Content>{def.name}</Tooltip.Content>
            </Tooltip.Root>
          )
        })}
        {hiddenEntries.length > 0 && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <span className='flex size-5 shrink-0 items-center justify-center rounded-md bg-[var(--surface-4)] font-medium text-[var(--text-muted)] text-micro'>
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

  const { knowledgeBases, isLoading, isPlaceholderData, error } = useKnowledgeBasesList(workspaceId)
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
  const canEdit = userPermissions.canEdit === true
  const canEditRef = useRef(canEdit)
  canEditRef.current = canEdit

  const { mutateAsync: updateKnowledgeBaseMutation } = useUpdateKnowledgeBase()
  const deleteKnowledgeBase = useDeleteKnowledgeBase()
  const bulkMoveKnowledgeBases = useBulkMoveKnowledgeBases(workspaceId)
  const bulkDeleteKnowledgeBases = useBulkDeleteKnowledgeBases(workspaceId)

  const {
    currentFolderId,
    setCurrentFolderId,
    openFolder,
    ancestors: breadcrumbs,
    folders,
    folderById,
    foldersResolved,
  } = useFolderNavigation({
    resourceType: FOLDER_RESOURCE_TYPE,
    workspaceId,
    /** Declared below; only ever called from a click, long after this render initializes it. */
    onBeforeOpenFolder: () => setSearchQuery(''),
  })

  const searchIndexFolders = useMemo(() => {
    const ancestors = new Set<string>()
    for (const knowledgeBase of knowledgeBases) {
      if (!knowledgeBase.isSearchIndex) continue
      let folderId = knowledgeBase.folderId
      while (folderId && !ancestors.has(folderId)) {
        ancestors.add(folderId)
        folderId = folderById.get(folderId)?.parentId ?? null
      }
    }
    return ancestors
  }, [knowledgeBases, folderById])
  const canDeleteFolder = useCallback(
    (folderId: string) => canEdit && !searchIndexFolders.has(folderId),
    [canEdit, searchIndexFolders]
  )

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
  const debouncedSearchQuery = useSearchFilterValue(urlSearchQuery, SEARCH_DEBOUNCE_MS)

  const {
    sort: sortColumn,
    dir: sortDirection,
    activeSort,
    onSort: applyUrlSort,
  } = useUrlSort(knowledgeSortParams, knowledgeUrlKeys)

  const currentListPreference = useMemo<ResourceListPreference>(
    () => ({
      sort: { column: sortColumn, direction: sortDirection },
      filters: {
        connector: connectorFilter,
        content: contentFilter,
        owner: ownerFilter,
      },
    }),
    [sortColumn, sortDirection, connectorFilter, contentFilter, ownerFilter]
  )

  const applyListPreference = useCallback(
    (preference: ResourceListPreference) => {
      void setKnowledgeFilters({
        connector: [...preference.filters.connector],
        content: [...preference.filters.content],
        owner: [...preference.filters.owner],
      })
      applyUrlSort(preference.sort.column, preference.sort.direction)
    },
    [applyUrlSort, setKnowledgeFilters]
  )

  const {
    isReady: isListPreferenceReady,
    setFilter: setListFilter,
    clearFilters: clearKnowledgeFilters,
    setSort: setListSort,
    clearSort: clearListSort,
  } = useResourceListPreferences({
    workspaceId,
    config: knowledgeListPreferenceConfig,
    preference: currentListPreference,
    applyPreference: applyListPreference,
  })

  const setConnectorFilter = useCallback(
    (next: string[]) => setListFilter('connector', next),
    [setListFilter]
  )
  const setContentFilter = useCallback(
    (next: string[]) => setListFilter('content', next),
    [setListFilter]
  )
  const setOwnerFilter = useCallback(
    (next: string[]) => setListFilter('owner', next),
    [setListFilter]
  )

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)

  const [activeKnowledgeBase, setActiveKnowledgeBase] = useState<KnowledgeBaseData | null>(null)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
  const [isBulkDeleteModalOpen, setIsBulkDeleteModalOpen] = useState(false)
  const [isTagsModalOpen, setIsTagsModalOpen] = useState(false)

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

  /**
   * Indexed once. These resolve a dragged row's current placement and run per dragged row inside
   * `dragover`, which fires continuously — a linear scan there is O(selection x resources) per
   * event, and the worst case (hesitating over the folder the selection already lives in) does
   * not short-circuit.
   */
  const knowledgeBaseById = useMemo(() => {
    const byId = new Map<string, KnowledgeBaseData>()
    for (const base of knowledgeBases) byId.set(base.id, base)
    return byId
  }, [knowledgeBases])
  const knowledgeBaseByIdRef = useRef(knowledgeBaseById)
  knowledgeBaseByIdRef.current = knowledgeBaseById
  const folderByIdRef = useRef(folderById)
  folderByIdRef.current = folderById

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
      const knowledgeBase = knowledgeBases.find((base) => base.id === id)
      if (!canDeleteKnowledgeBase(knowledgeBase, userPermissions)) return
      await deleteKnowledgeBase.mutateAsync({ knowledgeBaseId: id })
      logger.info(`Knowledge base deleted: ${id}`)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutation objects are unstable; mutateAsync is stable in v5
    [knowledgeBases, userPermissions.canEdit, userPermissions.canAdmin]
  )

  /**
   * Folders in the open folder, sorted independently of the bases below them.
   *
   * With no explicit sort the two blocks disagree on purpose — folders read best
   * alphabetically while bases read best most-recently-updated-first — which mirrors the
   * Files page. The resource filters (connectors/content/owner) describe properties a folder
   * does not have, so folders answer only to the search term.
   */
  /** A query stops scoping the list to the open folder — see {@link scopeFolderedItems}. */
  const isSearching = isSearchingResources(debouncedSearchQuery)

  const visibleFolders = useMemo(
    () =>
      scopeFolderedItems(folders, {
        currentFolderId,
        search: debouncedSearchQuery,
        getParentId: (folder) => folder.parentId ?? null,
        getSearchText: (folder) => [folder.name],
      }),
    [folders, currentFolderId, debouncedSearchQuery]
  )

  const processedKBs = useMemo(() => {
    let result = scopeFolderedItems(knowledgeBases, {
      currentFolderId,
      search: debouncedSearchQuery,
      /**
       * A `folderId` that no longer names an active folder — a base restored on its own out of
       * Recently Deleted while its folder stayed archived, or a cascade that failed partway —
       * would otherwise match no level at all and leave the base unreachable from every view.
       * Fall it back to the root instead — but only once `foldersResolved` says the index is the
       * complete set for THIS workspace. Gating on a loading flag instead would treat an errored
       * fetch, a disabled query, or the previous workspace's cached folders as "no such folder"
       * and drag every foldered base to the root.
       */
      getParentId: (kb) => {
        const folderId = kb.folderId ?? null
        return !foldersResolved || !folderId || folderById.has(folderId) ? folderId : null
      },
      /** A base is findable by its description as well as its name. */
      getSearchText: (kb) => [kb.name, kb.description],
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
      const docCount = (kb: KnowledgeBaseData) => kb.docCount ?? 0
      result = result.filter((kb) => {
        if (contentFilter.includes('has-docs') && docCount(kb) > 0) return true
        if (contentFilter.includes('empty') && docCount(kb) === 0) return true
        return false
      })
    }

    if (ownerFilter.length > 0) {
      result = result.filter((kb) => ownerFilter.includes(kb.userId))
    }

    return result
  }, [
    knowledgeBases,
    currentFolderId,
    folderById,
    foldersResolved,
    debouncedSearchQuery,
    connectorFilter,
    contentFilter,
    ownerFilter,
  ])

  /**
   * Folders and bases sort as ONE list — a folder never outranks a base it ties with, so a
   * pinned base reaches the top of the list rather than the top of the base section.
   *
   * Decorate-sort: each row's key + pinned flag is computed ONCE (O(N)) so the comparator
   * never re-runs Date parsing or member lookups per comparison. Folders carry no document,
   * token, or connector count, so those keys are `null` and land the folders last in both
   * directions — matching the em-dash they show in those cells.
   */
  const sortedEntries = useMemo(() => {
    const entries: SortableResource<KnowledgeResourceItem>[] = []

    for (const folder of visibleFolders) {
      entries.push({
        item: { kind: 'folder', folder },
        pinned: pinnedFolderIds.has(folder.id),
        name: folder.name,
        key:
          sortColumn === 'documents' || sortColumn === 'tokens' || sortColumn === 'connectors'
            ? null
            : sortColumn === 'created'
              ? new Date(folder.createdAt).getTime()
              : sortColumn === 'updated'
                ? new Date(folder.updatedAt).getTime()
                : sortColumn === 'owner'
                  ? (membersById.get(folder.userId)?.name ?? null)
                  : folder.name,
      })
    }

    for (const kb of processedKBs) {
      entries.push({
        item: { kind: 'base', base: kb },
        pinned: pinnedBaseIds.has(kb.id),
        name: kb.name,
        key:
          sortColumn === 'documents'
            ? (kb.docCount ?? 0)
            : sortColumn === 'tokens'
              ? (kb.tokenCount ?? 0)
              : sortColumn === 'connectors'
                ? (kb.connectorTypes?.length ?? 0)
                : sortColumn === 'created'
                  ? new Date(kb.createdAt).getTime()
                  : sortColumn === 'updated'
                    ? new Date(kb.updatedAt).getTime()
                    : sortColumn === 'owner'
                      ? (membersById.get(kb.userId)?.name ?? null)
                      : kb.name,
      })
    }

    return sortResources(entries, sortDirection)
  }, [
    visibleFolders,
    processedKBs,
    sortColumn,
    sortDirection,
    membersById,
    pinnedFolderIds,
    pinnedBaseIds,
  ])

  const baseRows: ResourceRow[] = useMemo(
    () =>
      sortedEntries.map(({ item, pinned }): ResourceRow => {
        if (item.kind === 'folder') {
          return folderRow(item.folder, {
            pinned,
            cells: {
              documents: { label: EMPTY_CELL_PLACEHOLDER },
              tokens: { label: EMPTY_CELL_PLACEHOLDER },
              connectors: { label: EMPTY_CELL_PLACEHOLDER },
              created: timeCell(item.folder.createdAt),
              owner: ownerCell(item.folder.userId, membersById),
              updated: timeCell(item.folder.updatedAt),
              /** A folder's location is its parent's path, not its own. */
              location: isSearching
                ? {
                    label: folderLocationLabel(
                      item.folder.parentId,
                      folderById,
                      ROOT_BREADCRUMB_LABEL
                    ),
                  }
                : EMPTY_LOCATION_CELL,
            },
          })
        }

        const { base } = item
        return {
          id: base.id,
          cells: {
            name: {
              icon: KNOWLEDGE_BASE_ICON,
              label: base.name,
              pinned,
            },
            documents: {
              label: String(base.docCount || 0),
            },
            tokens: {
              label: base.tokenCount ? base.tokenCount.toLocaleString() : '0',
            },
            connectors: connectorCell(base.connectorTypes),
            created: timeCell(base.createdAt),
            owner: ownerCell(base.userId, membersById),
            updated: timeCell(base.updatedAt),
            location: isSearching
              ? { label: folderLocationLabel(base.folderId, folderById, ROOT_BREADCRUMB_LABEL) }
              : EMPTY_LOCATION_CELL,
          },
        }
      }),
    [sortedEntries, membersById, folderById, isSearching]
  )

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

  /**
   * A dialog owns the keyboard while it is open. Without this, Escape closes the dialog AND
   * clears the selection behind it, so a bulk-delete confirm submits against a selection the
   * user just emptied; Delete and Cmd/Ctrl+A leak through the same way.
   */
  const isAnyDialogOpen = () =>
    isCreateModalOpen ||
    isEditModalOpen ||
    isDeleteModalOpen ||
    isBulkDeleteModalOpen ||
    isTagsModalOpen ||
    folderPendingDelete !== null

  const visibleRowIds = useMemo(() => rows.map((row) => row.id), [rows])

  const {
    selectedRowIds,
    selectable: selectableConfig,
    replaceSelection,
    clearSelection,
  } = useResourceRowSelection({
    visibleRowIds,
    isKeyboardBlocked: () =>
      !canEdit || listRenameRef.current.editingId !== null || isAnyDialogOpen(),
    onDeleteSelected: () => handleBulkDelete(),
  })

  const selectedRowIdsRef = useRef(selectedRowIds)
  selectedRowIdsRef.current = selectedRowIds

  /**
   * A context menu opened on a multi-row selection acts on the whole selection. Resolved inside
   * the menu handlers rather than at each menu prop, so the menus stay unaware selection exists.
   */
  const hasMultiSelection = selectedRowIds.size > 1
  const hasMultiSelectionRef = useRef(hasMultiSelection)
  hasMultiSelectionRef.current = hasMultiSelection

  const { folderIds: selectedFolderIds, resourceIds: selectedKnowledgeBaseIds } = useMemo(
    () => splitFolderedRowIds(selectedRowIds),
    [selectedRowIds]
  )
  const canDeleteSelection =
    canEdit &&
    selectedKnowledgeBaseIds.every((id) =>
      canDeleteKnowledgeBase(
        knowledgeBases.find((base) => base.id === id),
        userPermissions
      )
    ) &&
    selectedFolderIds.every(canDeleteFolder)

  const bulkDeleteCount = selectedKnowledgeBaseIds.length + selectedFolderIds.length
  const bulkDeleteFirstName =
    selectedKnowledgeBaseIds.length > 0
      ? knowledgeBases.find((kb) => kb.id === selectedKnowledgeBaseIds[0])?.name
      : folders.find((folder) => folder.id === selectedFolderIds[0])?.name
  const bulkDeleteLabel = selectionLabel(bulkDeleteCount, bulkDeleteFirstName)

  const handleRowClick = useCallback(
    (rowId: string) => {
      if (isRowContextMenuOpenRef.current || isFolderContextMenuOpenRef.current) return
      if (listRenameRef.current.editingId === rowId) return

      const parsed = parseFolderedRowId(rowId)
      if (parsed.kind === 'folder') {
        openFolder(parsed.id)
        return
      }

      const kb = knowledgeBasesRef.current.find((k) => k.id === parsed.id)
      if (!kb) return
      const urlParams = new URLSearchParams({ kbName: kb.name })
      router.push(`/workspace/${workspaceId}/knowledge/${parsed.id}?${urlParams.toString()}`)
    },
    [router, workspaceId, openFolder]
  )

  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent, rowId: string) => {
      /**
       * Right-clicking outside the selection retargets it, so the menu always acts on what is
       * highlighted. Right-clicking inside it leaves the selection alone and the menu switches
       * its move/delete entries to the bulk handlers.
       */
      if (canEditRef.current && !selectedRowIdsRef.current.has(rowId)) replaceSelection([rowId])

      const parsed = parseFolderedRowId(rowId)
      if (parsed.kind === 'folder') {
        const folder = foldersRef.current.find((item) => item.id === parsed.id)
        if (!folder) return
        setActiveFolder(folder)
        handleFolderCtxMenu(e)
        return
      }

      const kb = knowledgeBasesRef.current.find((k) => k.id === parsed.id)
      setActiveKnowledgeBase(kb ?? null)
      handleRowCtxMenu(e)
    },
    [handleRowCtxMenu, handleFolderCtxMenu]
  )

  const handleConfirmDelete = useCallback(async () => {
    const kb = activeKnowledgeBaseRef.current
    if (!kb || !canDeleteKnowledgeBase(kb, userPermissions)) return
    await handleDeleteKnowledgeBase(kb.id)
    setIsDeleteModalOpen(false)
    setActiveKnowledgeBase(null)
  }, [handleDeleteKnowledgeBase, userPermissions.canEdit, userPermissions.canAdmin])

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
    if (!canDeleteKnowledgeBase(activeKnowledgeBaseRef.current, userPermissions)) return
    setIsDeleteModalOpen(true)
  }, [userPermissions.canEdit, userPermissions.canAdmin])

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

  useRegisterGlobalCommands(() => [
    { id: 'knowledge-new-base', handler: () => handleOpenCreateModal() },
    { id: 'knowledge-new-folder', handler: () => void handleCreateFolder() },
  ])

  const handleRenameFolder = useCallback(() => {
    const folder = activeFolderRef.current
    if (!folder) return
    listRenameRef.current.startRename(folderRowId(folder.id), folder.name)
  }, [])

  const handleOpenFolder = useCallback(() => {
    const folder = activeFolderRef.current
    if (folder) openFolder(folder.id)
  }, [openFolder])

  const handleCopyFolderId = useCallback(() => {
    const folder = activeFolderRef.current
    if (folder) navigator.clipboard.writeText(folder.id)
  }, [])

  const handleRequestFolderDelete = useCallback(() => {
    if (!activeFolderRef.current || !canDeleteFolder(activeFolderRef.current.id)) return
    setFolderPendingDelete(activeFolderRef.current)
  }, [canDeleteFolder])

  const folderPendingDeleteRef = useRef(folderPendingDelete)
  folderPendingDeleteRef.current = folderPendingDelete

  const handleConfirmFolderDelete = useCallback(async () => {
    const folder = folderPendingDeleteRef.current
    if (!folder || !canDeleteFolder(folder.id)) return
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
      // parent instead. Not `openFolder`: this is a forced correction, so it must neither
      // clear an active search nor push a back-stack entry aimed at the deleted folder.
      if (currentFolderIdRef.current === folder.id) {
        setCurrentFolderId(folder.parentId, { history: 'replace' })
      }
    } catch (deleteError) {
      logger.error('Failed to delete folder', deleteError)
      toast.error(getErrorMessage(deleteError, 'Failed to delete folder'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, openFolder, canDeleteFolder])

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
  const folderMoveOptions: MoveOptionNode[] = useMemo(
    () =>
      activeFolder
        ? buildMoveOptionsExcludingSubtrees({
            folders,
            rootLabel: ROOT_BREADCRUMB_LABEL,
            excludeFolderIds: [activeFolder.id],
            descendantsByFolderId,
          })
        : [],
    [folders, activeFolder, descendantsByFolderId]
  )

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
      // move in between would otherwise skip the write the user just chose.
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
      // Same reasoning as `handleMoveFolder`: compare against the live row, not the snapshot.
      const current = knowledgeBasesRef.current.find((item) => item.id === kb.id) ?? kb
      if ((current.folderId ?? null) !== folderId) await moveKnowledgeBaseTo(kb.id, folderId)
      closeRowContextMenu()
    },
    [moveKnowledgeBaseTo, closeRowContextMenu]
  )

  /**
   * The one move path for every multi-row gesture — dropping a selection onto a folder row and
   * the action bar's "Move to" menu both land here, so a mixed selection of knowledge bases and
   * folders commits as a single operation instead of one request per row.
   */
  const moveRowsTo = useCallback(
    (rows: { knowledgeBaseIds: string[]; folderIds: string[] }, targetFolderId: string | null) => {
      if (rows.knowledgeBaseIds.length === 0 && rows.folderIds.length === 0) return
      if (rows.knowledgeBaseIds.length + rows.folderIds.length > MAX_KNOWLEDGE_BATCH_ITEMS) {
        toast.error(`Select ${MAX_KNOWLEDGE_BATCH_ITEMS} or fewer items to move at once`)
        return
      }
      bulkMoveKnowledgeBases.mutate(
        { ...rows, targetFolderId },
        {
          onSuccess: (result) => {
            clearSelection()
            reportBulkOutcome(result, 'moved')
          },
        }
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutation objects are unstable; mutate is stable in v5
    [clearSelection]
  )

  const handleBulkMove = useCallback(
    (optionValue: string) => {
      moveRowsTo(
        { knowledgeBaseIds: selectedKnowledgeBaseIds, folderIds: selectedFolderIds },
        parseMoveOptionValue(optionValue)
      )
    },
    [moveRowsTo, selectedKnowledgeBaseIds, selectedFolderIds]
  )

  /**
   * Enforced here rather than only on the action bar: the row context menu and the Delete key
   * reach the same operation, and the server rejects an over-cap request outright — so without
   * this the user confirms a delete that cannot succeed.
   */
  const exceedsBatchCap =
    selectedKnowledgeBaseIds.length + selectedFolderIds.length > MAX_KNOWLEDGE_BATCH_ITEMS

  const handleBulkDelete = useCallback(() => {
    if (!canDeleteSelection) return
    if (selectedKnowledgeBaseIds.length === 0 && selectedFolderIds.length === 0) return
    if (exceedsBatchCap) {
      toast.error(`Select ${MAX_KNOWLEDGE_BATCH_ITEMS} or fewer items to delete at once`)
      return
    }
    setIsBulkDeleteModalOpen(true)
  }, [selectedKnowledgeBaseIds, selectedFolderIds, exceedsBatchCap, canDeleteSelection])

  const confirmBulkDelete = useCallback(async () => {
    if (!canDeleteSelection) return
    try {
      const result = await bulkDeleteKnowledgeBases.mutateAsync({
        knowledgeBaseIds: selectedKnowledgeBaseIds,
        folderIds: selectedFolderIds,
      })
      setIsBulkDeleteModalOpen(false)
      clearSelection()
      reportBulkOutcome(result, 'deleted')
    } catch (deleteError) {
      // The mutation toasts the request failure itself; the modal stays open to allow a retry.
      logger.error('Failed to delete selected items', deleteError)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutation objects are unstable; mutateAsync is stable in v5
  }, [selectedKnowledgeBaseIds, selectedFolderIds, clearSelection, canDeleteSelection])

  /**
   * Destinations for the action bar's move menu. Every selected folder — and everything beneath
   * it — is excluded, since a folder cannot be filed into itself or its own subtree.
   */
  const bulkMoveOptions: MoveOptionNode[] = useMemo(
    () =>
      buildMoveOptionsExcludingSubtrees({
        folders,
        rootLabel: ROOT_BREADCRUMB_LABEL,
        excludeFolderIds: selectedFolderIds,
        descendantsByFolderId,
      }),
    [selectedFolderIds, folders, descendantsByFolderId]
  )

  const activeMoveOptions = hasMultiSelection ? bulkMoveOptions : knowledgeBaseMoveOptions
  const activeFolderMoveOptions = hasMultiSelection ? bulkMoveOptions : folderMoveOptions

  const handleDeleteFromMenu = useCallback(() => {
    if (hasMultiSelectionRef.current) return handleBulkDelete()
    return handleDelete()
  }, [handleBulkDelete, handleDelete])

  const handleFolderDeleteFromMenu = useCallback(() => {
    if (hasMultiSelectionRef.current) return handleBulkDelete()
    return handleRequestFolderDelete()
  }, [handleBulkDelete, handleRequestFolderDelete])

  const handleMoveKnowledgeBaseFromMenu = useCallback(
    (optionValue: string) => {
      if (hasMultiSelectionRef.current) return handleBulkMove(optionValue)
      return handleMoveKnowledgeBase(optionValue)
    },
    [handleBulkMove, handleMoveKnowledgeBase]
  )

  const handleMoveFolderFromMenu = useCallback(
    (optionValue: string) => {
      if (hasMultiSelectionRef.current) return handleBulkMove(optionValue)
      return handleMoveFolder(optionValue)
    },
    [handleBulkMove, handleMoveFolder]
  )

  const rowDragDropConfig = useFolderRowDragDrop({
    dragMime: KNOWLEDGE_ROW_DRAG_MIME,
    canEdit,
    editingRowId: listRename.editingId,
    descendantsByFolderId,
    getFolderParentId: (folderId) => folderByIdRef.current.get(folderId)?.parentId ?? null,
    getResourceFolderId: (knowledgeBaseId) =>
      knowledgeBaseByIdRef.current.get(knowledgeBaseId)?.folderId ?? null,
    getRowLabel: (rowId) => {
      const parsed = parseFolderedRowId(rowId)
      return parsed.kind === 'folder'
        ? (folderByIdRef.current.get(parsed.id)?.name ?? 'Folder')
        : (knowledgeBaseByIdRef.current.get(parsed.id)?.name ?? 'Knowledge base')
    },
    onMoveRows: ({ folderIds, resourceIds }, targetFolderId) =>
      moveRowsTo({ folderIds, knowledgeBaseIds: resourceIds }, targetFolderId),
    selection: { selectedRowIds, visibleRowIds, replaceSelection },
    onSpringOpenFolder: setCurrentFolderId,
    currentFolderId,
    bodyDropFolderId: isSearching ? undefined : currentFolderId,
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
        rootIcon: FOLDERED_RESOURCE_HEADERS[FOLDER_RESOURCE_TYPE].rootIcon,
        breadcrumbs,
        onNavigate: openFolder,
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
                  icon: Pencil,
                  onClick: () => {
                    const folder = breadcrumbs[breadcrumbs.length - 1]
                    breadcrumbRenameRef.current.startRename(folder.id, folder.name)
                  },
                },
                ...(canDeleteFolder(breadcrumbs[breadcrumbs.length - 1].id)
                  ? [
                      {
                        label: 'Delete',
                        icon: Trash,
                        onClick: () => setFolderPendingDelete(breadcrumbs[breadcrumbs.length - 1]),
                      },
                    ]
                  : []),
              ]
            : undefined,
      }),
    [
      breadcrumbs,
      currentFolderId,
      openFolder,
      canEdit,
      canDeleteFolder,
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
        { id: 'owner', label: 'Owner' },
        { id: 'updated', label: 'Last Updated' },
      ],
      active: activeSort,
      onSort: setListSort,
      onClear: clearListSort,
    }),
    [activeSort, setListSort, clearListSort]
  )

  const memberOptions: ChipDropdownOption[] = useMemo(
    () =>
      (members ?? []).map((m) => ({
        value: m.userId,
        label: m.name,
        iconElement: <OwnerAvatar name={m.name} image={m.image} />,
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
            />
          </div>
        )}
      </div>
    ),
    [
      connectorFilter,
      contentFilter,
      ownerFilter,
      memberOptions,
      setConnectorFilter,
      setContentFilter,
      setOwnerFilter,
    ]
  )

  /** Stable identity so the memoized `Resource.Options` can bail; an inline object cannot. */
  const filterConfig = useMemo(() => ({ content: filterContent }), [filterContent])

  /**
   * Memoized element, not inline JSX: `Resource.Table` is `memo`'d, and a fresh overlay element
   * every render would fail its shallow compare and re-render the whole list on any parent
   * render — during an upload or a drag, that is every frame.
   */
  const actionBar = useMemo(
    () => (
      <ResourceActionBar
        selectedCount={selectedRowIds.size}
        onMove={canEdit ? handleBulkMove : undefined}
        moveOptions={canEdit ? bulkMoveOptions : undefined}
        onDelete={canDeleteSelection ? handleBulkDelete : undefined}
        isLoading={bulkMoveKnowledgeBases.isPending || bulkDeleteKnowledgeBases.isPending}
        maxSelectable={MAX_KNOWLEDGE_BATCH_ITEMS}
      />
    ),
    [
      selectedRowIds.size,
      canEdit,
      canDeleteSelection,
      handleBulkMove,
      bulkMoveOptions,
      handleBulkDelete,
      bulkMoveKnowledgeBases.isPending,
      bulkDeleteKnowledgeBases.isPending,
    ]
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
  }, [
    connectorFilter,
    contentFilter,
    ownerFilter,
    members,
    setConnectorFilter,
    setContentFilter,
    setOwnerFilter,
  ])

  const listState = resourceListState({
    rowCount: rows.length,
    isLoading,
    isPlaceholderData,
    error,
    search: debouncedSearchQuery,
    filterCount: filterTags.length,
    folderId: currentFolderId,
    foldersResolved,
  })

  const clearSearchAndFilters = () => {
    setSearchQuery('')
    clearKnowledgeFilters()
  }

  if (!isListPreferenceReady) return <KnowledgeLoading />

  return (
    <>
      <Resource onContextMenu={handleContentContextMenu}>
        <Resource.Header
          icon={FOLDERED_RESOURCE_HEADERS[FOLDER_RESOURCE_TYPE].rootIcon}
          title={ROOT_BREADCRUMB_LABEL}
          breadcrumbs={listBreadcrumbs}
          actions={headerActions}
          breadcrumbDrop={rowDragDropConfig.breadcrumb}
        />
        <Resource.Options
          search={searchConfig}
          sort={sortConfig}
          filterTags={filterTags}
          filter={filterConfig}
        />
        <Resource.Table
          columns={isSearching ? SEARCH_COLUMNS : COLUMNS}
          rows={rows}
          emptyState={
            listState === 'empty' ? (
              <KnowledgeEmptyState onCreate={handleOpenCreateModal} createDisabled={!canEdit} />
            ) : listState === 'no-results' ? (
              <ResourceNoResults
                search={debouncedSearchQuery}
                filterCount={filterTags.length}
                onClear={clearSearchAndFilters}
              />
            ) : undefined
          }
          selectable={canEdit ? selectableConfig : undefined}
          rowDragDrop={rowDragDropConfig}
          onRowClick={handleRowClick}
          onRowContextMenu={handleRowContextMenu}
          overlay={actionBar}
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
          onDelete={handleDeleteFromMenu}
          onMove={handleMoveKnowledgeBaseFromMenu}
          moveOptions={activeMoveOptions}
          showOpenInNewTab
          showViewTags
          showEdit
          showDelete={
            hasMultiSelection
              ? canDeleteSelection
              : !activeKnowledgeBase.isSearchIndex ||
                canDeleteKnowledgeBase(activeKnowledgeBase, userPermissions)
          }
          disableEdit={!canEdit}
          disableDelete={!canEdit}
          selectedCount={selectedRowIds.size}
        />
      )}

      {activeFolder && (
        <FolderContextMenu
          isOpen={isFolderContextMenuOpen}
          position={folderContextMenuPosition}
          onClose={closeFolderContextMenu}
          onOpen={handleOpenFolder}
          onRename={handleRenameFolder}
          onDelete={handleFolderDeleteFromMenu}
          onCopyId={handleCopyFolderId}
          onTogglePin={handleToggleFolderPin}
          pinned={pinnedFolderIds.has(activeFolder.id)}
          onMove={handleMoveFolderFromMenu}
          moveOptions={activeFolderMoveOptions}
          canEdit={canEdit}
          canDelete={hasMultiSelection ? canDeleteSelection : canEdit}
          deleteDisabledReason={
            searchIndexFolders.has(activeFolder.id)
              ? 'Delete the search knowledge base first'
              : undefined
          }
          selectedCount={selectedRowIds.size}
        />
      )}

      <ChipConfirmModal
        open={folderPendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setFolderPendingDelete(null)
        }}
        srTitle='Delete Folder'
        title='Delete Folder'
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

      <ChipConfirmModal
        open={isBulkDeleteModalOpen}
        onOpenChange={setIsBulkDeleteModalOpen}
        srTitle='Delete Selected'
        title='Delete Selected'
        text={[
          'Are you sure you want to delete ',
          { text: bulkDeleteLabel, bold: true },
          selectedFolderIds.length > 0
            ? '? This also deletes the knowledge bases and folders inside the selected folders. You can restore them from Recently Deleted in Settings.'
            : '? You can restore them from Recently Deleted in Settings.',
        ]}
        confirm={{
          label: 'Delete',
          onClick: confirmBulkDelete,
          pending: bulkDeleteKnowledgeBases.isPending,
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
          isDeleting={deleteKnowledgeBase.isPending}
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
