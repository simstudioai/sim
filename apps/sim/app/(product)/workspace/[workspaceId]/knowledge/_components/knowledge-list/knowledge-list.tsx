'use client'

import { useCallback, useMemo, useState } from 'react'
import { Breadcrumbs } from '@sim/emcn/breadcrumbs'
import { Button } from '@sim/emcn/button'
import { Icon } from '@sim/emcn/icon'
import { ActionMenu, type MenuAction } from '@sim/emcn/menu/action-menu'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { SearchField } from '@sim/emcn/search-field'
import { Stack } from '@sim/emcn/stack'
import { getErrorMessage } from '@sim/utils/errors'
import { usePathname, useSearchParams } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { toast } from '@/lib/toast/sink'
import { usePageCommands } from '@/app/(product)/_components/command-menu/page-commands'
import { ControlBar } from '@/app/(product)/_components/control-bar/control-bar'
import { openInNewTabAction } from '@/app/(product)/_components/sidebar/row-links'
import { AccessRequired } from '@/app/(product)/workspace/[workspaceId]/_components/access-required/access-required'
import {
  descendantIndex,
  folderLocation,
  folderPath,
  folderRowId,
  moveDestinations,
  nextFolderName,
  parseRowId,
  reportBulkOutcome,
  type SortEntry,
  scopeItems,
  selectionAction,
  selectionName,
  sortEntries,
  splitRowIds,
} from '@/app/(product)/workspace/[workspaceId]/_components/resource-table/folder-tree'
import {
  folderHref,
  folderTrail,
  type ListPreference,
  noResults,
  sortActions,
} from '@/app/(product)/workspace/[workspaceId]/_components/resource-table/list-menus'
import {
  RenameDialog,
  useMinuteClock,
} from '@/app/(product)/workspace/[workspaceId]/_components/resource-table/rename-dialog'
import {
  OwnerCell,
  type ResourceColumn,
  type ResourceRow,
  ResourceTable,
} from '@/app/(product)/workspace/[workspaceId]/_components/resource-table/resource-table'
import {
  type RowMove,
  useResourceDrag,
} from '@/app/(product)/workspace/[workspaceId]/_components/resource-table/use-resource-drag'
import { useResourceSelection } from '@/app/(product)/workspace/[workspaceId]/_components/resource-table/use-resource-selection'
import {
  LiveWorkspacePage,
  WorkspaceEmpty,
} from '@/app/(product)/workspace/[workspaceId]/_components/workspace-page/workspace-page'
import type { WorkspaceRead } from '@/app/(product)/workspace/[workspaceId]/_components/workspace-session/model'
import { BaseTagsModal } from '@/app/(product)/workspace/[workspaceId]/knowledge/_components/base-tags-modal/base-tags-modal'
import { CreateBaseModal } from '@/app/(product)/workspace/[workspaceId]/knowledge/_components/create-base-modal/create-base-modal'
import { DeleteBaseModal } from '@/app/(product)/workspace/[workspaceId]/knowledge/_components/delete-base-modal/delete-base-modal'
import { EditBaseModal } from '@/app/(product)/workspace/[workspaceId]/knowledge/_components/edit-base-modal/edit-base-modal'
import {
  type ResourceFolder,
  SEARCH_DEBOUNCE_MS,
  useCreateFolder,
  useDebouncedSearchSetter,
  useDeleteFolderMutation,
  useFolderParam,
  useFolders,
  useInlineRename,
  useResourceListAccess,
  useResourceListPreferences,
  useSearchFilterValue,
  useUpdateFolder,
  useUrlSort,
  useWorkspaceMembersQuery,
} from '@/platform/lib/data/folders'
import {
  connectorDisplayName,
  downloadKnowledgeBaseExport,
  type KnowledgeBaseData,
  knowledgeListPreferenceConfig,
  knowledgeParsers,
  knowledgeSortParams,
  knowledgeUrlKeys,
  MAX_KNOWLEDGE_BATCH_ITEMS,
  useBulkDeleteKnowledgeBases,
  useBulkMoveKnowledgeBases,
  useKnowledgeBasesQuery,
  useUpdateKnowledgeBase,
} from '@/platform/lib/data/knowledge'
import { usePinItem, usePinnedIds, useUnpinItem } from '@/platform/lib/data/pins'
import { platformHref } from '@/platform/lib/navigation'
import { workspacePath } from '@/platform/lib/workspace-navigation'
import { formatRelativeTime } from '@/platform/shared/time'

const ROOT_LABEL = 'Knowledge bases'
const ROW_MIME = 'application/x-sim-workspace-knowledge-rows'
const EMPTY_BASES: KnowledgeBaseData[] = []
const EMPTY_FOLDERS: ResourceFolder[] = []
const SEARCH_INDEX_FOLDER = 'Delete the search knowledge base first'

const COLUMNS: readonly ResourceColumn[] = [
  { id: 'documents', label: 'Documents', numeric: true, width: 'compact' },
  { id: 'tokens', label: 'Tokens', numeric: true, width: 'compact', optional: true },
  { id: 'connectors', label: 'Connectors', width: 'compact', optional: true },
  { id: 'created', label: 'Created', optional: true },
  { id: 'owner', label: 'Owner', optional: true },
  { id: 'updated', label: 'Last Updated', narrow: true },
]
const SEARCH_COLUMNS: readonly ResourceColumn[] = [
  ...COLUMNS,
  { id: 'location', label: 'Location', width: 'wide', optional: true },
]
const SORTS = [
  { id: 'name', label: 'Name' },
  { id: 'documents', label: 'Documents' },
  { id: 'tokens', label: 'Tokens' },
  { id: 'connectors', label: 'Connectors' },
  { id: 'created', label: 'Created' },
  { id: 'owner', label: 'Owner' },
  { id: 'updated', label: 'Last Updated' },
] as const
const CONNECTOR_FILTERS = [
  { value: 'all', label: 'All connectors' },
  { value: 'connected', label: 'With connectors' },
  { value: 'unconnected', label: 'Without connectors' },
]
const CONTENT_FILTERS = [
  { value: 'all', label: 'All content' },
  { value: 'has-docs', label: 'Has documents' },
  { value: 'empty', label: 'Empty' },
]

type Item = { kind: 'base'; base: KnowledgeBaseData } | { kind: 'folder'; folder: ResourceFolder }
type Confirm =
  | { kind: 'folder'; folder: ResourceFolder }
  | { kind: 'bulk'; baseIds: string[]; folderIds: string[]; name: string }

function timeOf(value: Date | string) {
  return new Date(value).getTime()
}

interface KnowledgeListProps {
  workspaceId: string
}

/**
 * The workspace's knowledge bases and their folders as one list, with the legacy page's search
 * (name and description), filters, sort, pins, moves, deletes and its create, edit and tag dialogs.
 */
export function KnowledgeList({ workspaceId }: KnowledgeListProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const now = useMinuteClock()
  const access = useResourceListAccess(workspaceId, 'hideKnowledgeBaseTab')
  const { canEdit, canAdmin } = access

  const basesQuery = useKnowledgeBasesQuery(workspaceId, { includeCounts: true })
  const bases = basesQuery.data ?? EMPTY_BASES
  const membersQuery = useWorkspaceMembersQuery(workspaceId)
  const foldersQuery = useFolders(workspaceId, { resourceType: 'knowledge_base' })
  const folders = foldersQuery.data ?? EMPTY_FOLDERS
  const foldersResolved = foldersQuery.isSuccess && !foldersQuery.isPlaceholderData
  const folderById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders])
  const memberById = useMemo(
    () => new Map((membersQuery.data ?? []).map((member) => [member.userId, member])),
    [membersQuery.data]
  )
  const baseById = useMemo(() => new Map(bases.map((base) => [base.id, base])), [bases])
  const descendants = useMemo(() => descendantIndex(folders), [folders])
  const [folderId, setFolderId] = useFolderParam(foldersResolved ? folderById : null)
  const pinnedBases = usePinnedIds(workspaceId, 'knowledge_base')
  const pinnedFolders = usePinnedIds(workspaceId, 'folder')
  const pinItem = usePinItem()
  const unpinItem = useUnpinItem()

  const updateBase = useUpdateKnowledgeBase()
  const bulkMove = useBulkMoveKnowledgeBases(workspaceId)
  const bulkDelete = useBulkDeleteKnowledgeBases(workspaceId)
  const createFolder = useCreateFolder()
  const updateFolder = useUpdateFolder()
  const deleteFolder = useDeleteFolderMutation()

  const [filters, setFilters] = useQueryStates(knowledgeParsers, knowledgeUrlKeys)
  const { sort, dir, onSort: applySort } = useUrlSort(knowledgeSortParams, knowledgeUrlKeys)
  const preference = useMemo(
    () => ({
      sort: { column: sort, direction: dir },
      filters: { connector: filters.connector, content: filters.content, owner: filters.owner },
    }),
    [sort, dir, filters.connector, filters.content, filters.owner]
  )
  const preferences = useResourceListPreferences({
    workspaceId,
    config: knowledgeListPreferenceConfig,
    preference,
    applyPreference: useCallback(
      (next: ListPreference) => {
        void setFilters({
          connector: [...(next.filters.connector ?? [])],
          content: [...(next.filters.content ?? [])],
          owner: [...(next.filters.owner ?? [])],
        })
        applySort(next.sort.column, next.sort.direction)
      },
      [applySort, setFilters]
    ),
  })
  const setSearch = useDebouncedSearchSetter((value, options) =>
    setFilters({ search: value }, options)
  )
  const search = useSearchFilterValue(filters.search, SEARCH_DEBOUNCE_MS)
  const searching = search.trim().length > 0
  const filtered =
    filters.connector.length > 0 || filters.content.length > 0 || filters.owner.length > 0

  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<KnowledgeBaseData | null>(null)
  const [deleting, setDeleting] = useState<KnowledgeBaseData | null>(null)
  const [tagsFor, setTagsFor] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [renamingFolder, setRenamingFolder] = useState<ResourceFolder | null>(null)

  /** Folders holding the workspace search index: deleting one would take the index with it. */
  const searchIndexFolders = useMemo(() => {
    const held = new Set<string>()
    for (const base of bases) {
      if (!base.isSearchIndex) continue
      let current = base.folderId
      while (current && !held.has(current)) {
        held.add(current)
        current = folderById.get(current)?.parentId ?? null
      }
    }
    return held
  }, [bases, folderById])
  const canDeleteBase = (base: KnowledgeBaseData | undefined) =>
    Boolean(base && canEdit && (!base.isSearchIndex || canAdmin))
  const canDeleteFolder = (id: string) => canEdit && !searchIndexFolders.has(id)

  const openFolder = useCallback(
    (id: string | null) => {
      setSearch('')
      setFolderId(id)
    },
    [setFolderId, setSearch]
  )

  const listRename = useInlineRename({
    onSave: (rowId, name) => {
      const row = parseRowId(rowId)
      if (row.kind === 'folder')
        return updateFolder
          .mutateAsync({
            workspaceId,
            resourceType: 'knowledge_base',
            id: row.id,
            updates: { name },
          })
          .catch((error: unknown) => {
            toast.error(getErrorMessage(error, 'Failed to rename folder'))
            throw error
          })
      return updateBase.mutateAsync({ knowledgeBaseId: row.id, updates: { name } })
    },
  })

  const items = useMemo(() => {
    const shownFolders = scopeItems(folders, {
      folderId,
      search,
      parentOf: (folder) => folder.parentId ?? null,
      searchText: (folder) => [folder.name],
    })
    const shownBases = scopeItems(bases, {
      folderId,
      search,
      parentOf: (base) => {
        const parent = base.folderId ?? null
        return !foldersResolved || !parent || folderById.has(parent) ? parent : null
      },
      searchText: (base) => [base.name, base.description],
    }).filter((base) => {
      const connected = (base.connectorTypes?.length ?? 0) > 0
      const documents = base.docCount ?? 0
      return (
        (!filters.connector.length ||
          (filters.connector.includes('connected') && connected) ||
          (filters.connector.includes('unconnected') && !connected)) &&
        (!filters.content.length ||
          (filters.content.includes('has-docs') && documents > 0) ||
          (filters.content.includes('empty') && documents === 0)) &&
        (!filters.owner.length || filters.owner.includes(base.userId))
      )
    })
    const pinsLead = !searching && !filtered
    const ownerName = (userId: string) => memberById.get(userId)?.name ?? null
    const entries: SortEntry<Item>[] = [
      ...shownFolders.map((folder) => ({
        item: { kind: 'folder' as const, folder },
        pinned: pinsLead && pinnedFolders.has(folder.id),
        name: folder.name,
        key:
          sort === 'documents' || sort === 'tokens' || sort === 'connectors'
            ? null
            : sort === 'created'
              ? timeOf(folder.createdAt)
              : sort === 'updated'
                ? timeOf(folder.updatedAt)
                : sort === 'owner'
                  ? ownerName(folder.userId)
                  : folder.name,
      })),
      ...shownBases.map((base) => ({
        item: { kind: 'base' as const, base },
        pinned: pinsLead && pinnedBases.has(base.id),
        name: base.name,
        key:
          sort === 'documents'
            ? (base.docCount ?? 0)
            : sort === 'tokens'
              ? (base.tokenCount ?? 0)
              : sort === 'connectors'
                ? (base.connectorTypes?.length ?? 0)
                : sort === 'created'
                  ? timeOf(base.createdAt)
                  : sort === 'updated'
                    ? timeOf(base.updatedAt)
                    : sort === 'owner'
                      ? ownerName(base.userId)
                      : base.name,
      })),
    ]
    return sortEntries(entries, dir).map((entry) => entry.item)
  }, [
    folders,
    bases,
    folderId,
    search,
    searching,
    filtered,
    filters.connector,
    filters.content,
    filters.owner,
    folderById,
    foldersResolved,
    memberById,
    pinnedFolders,
    pinnedBases,
    sort,
    dir,
  ])

  const rowIds = useMemo(
    () =>
      items.map((item) => (item.kind === 'folder' ? folderRowId(item.folder.id) : item.base.id)),
    [items]
  )
  const selectionDeletable = (ids: Iterable<string>) => {
    const { folderIds, resourceIds } = splitRowIds(ids)
    return (
      canEdit &&
      resourceIds.every((id) => canDeleteBase(baseById.get(id))) &&
      folderIds.every(canDeleteFolder)
    )
  }
  const requestBulkDelete = () => {
    const { folderIds, resourceIds } = splitRowIds(selection.selected)
    if (!folderIds.length && !resourceIds.length) return
    if (!selectionDeletable(selection.selected)) return
    if (folderIds.length + resourceIds.length > MAX_KNOWLEDGE_BATCH_ITEMS) {
      toast.error(`Select ${MAX_KNOWLEDGE_BATCH_ITEMS} or fewer items to delete at once`)
      return
    }
    setConfirm({
      kind: 'bulk',
      baseIds: resourceIds,
      folderIds,
      name: selectionName(
        folderIds.length + resourceIds.length,
        resourceIds.length ? baseById.get(resourceIds[0])?.name : folderById.get(folderIds[0])?.name
      ),
    })
  }
  const dialogOpen =
    creating ||
    editing !== null ||
    deleting !== null ||
    tagsFor !== null ||
    confirm !== null ||
    renamingFolder !== null
  const selection = useResourceSelection({
    rowIds,
    onDelete: canEdit ? requestBulkDelete : undefined,
    keyboardBlocked: listRename.editingId !== null || dialogOpen,
  })

  const moveRows = (move: RowMove, target: string | null) => {
    const knowledgeBaseIds = move.resourceIds.filter(
      (id) => (baseById.get(id)?.folderId ?? null) !== target
    )
    const folderIds = move.folderIds.filter(
      (id) => (folderById.get(id)?.parentId ?? null) !== target
    )
    if (!knowledgeBaseIds.length && !folderIds.length) return
    if (knowledgeBaseIds.length + folderIds.length > MAX_KNOWLEDGE_BATCH_ITEMS) {
      toast.error(`Select ${MAX_KNOWLEDGE_BATCH_ITEMS} or fewer items to move at once`)
      return
    }
    bulkMove.mutate(
      { knowledgeBaseIds, folderIds, targetFolderId: target },
      {
        onSuccess: (result) => {
          selection.clear()
          reportBulkOutcome(result, 'moved')
        },
      }
    )
  }

  const drag = useResourceDrag({
    mime: ROW_MIME,
    enabled: canEdit,
    renamingId: listRename.editingId,
    rowIds,
    selection: canEdit ? selection : undefined,
    parentOf: (rowId) => {
      const row = parseRowId(rowId)
      return row.kind === 'folder'
        ? folderById.get(row.id)?.parentId
        : baseById.get(row.id)?.folderId
    },
    descendants,
    labelOf: (rowId) => {
      const row = parseRowId(rowId)
      return row.kind === 'folder'
        ? (folderById.get(row.id)?.name ?? 'Folder')
        : (baseById.get(row.id)?.name ?? 'Knowledge base')
    },
    onMove: moveRows,
    currentFolderId: folderId,
    bodyFolderId: searching ? undefined : folderId,
    onNavigate: (id, options) => setFolderId(id, options),
  })

  const handleCreateFolder = async () => {
    try {
      const folder = await createFolder.mutateAsync({
        workspaceId,
        resourceType: 'knowledge_base',
        name: nextFolderName(folders, folderId),
        parentId: folderId ?? undefined,
      })
      setSearch('')
      listRename.startRename(folderRowId(folder.id), folder.name)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to create folder'))
    }
  }

  const baseHref = (id: string) =>
    platformHref(
      `${workspacePath(workspaceId, 'knowledge')}/${encodeURIComponent(id)}`,
      searchParams
    )
  const togglePin = (resourceType: 'knowledge_base' | 'folder', id: string, pinned: boolean) =>
    (pinned ? unpinItem : pinItem).mutate({ workspaceId, resourceType, resourceId: id })
  const copyId = (id: string) => {
    void navigator.clipboard.writeText(id).catch(() => toast.error('Failed to copy ID'))
  }

  const selectionMove = (): MenuAction => {
    const { folderIds, resourceIds } = splitRowIds(selection.selected)
    return {
      id: 'move',
      label: selectionAction('Move', selection.selected.size, 'Move to'),
      icon: 'I100',
      children: moveDestinations({
        folders,
        rootLabel: ROOT_LABEL,
        exclude: folderIds,
        descendants,
        onMove: (target) => moveRows({ folderIds, resourceIds }, target),
      }),
    }
  }
  const multiActions = (): MenuAction[] => [
    ...(canEdit ? [selectionMove()] : []),
    ...(selectionDeletable(selection.selected)
      ? [
          {
            id: 'delete',
            label: selectionAction('Delete', selection.selected.size),
            icon: 'I061' as const,
            destructive: true,
            separatorBefore: canEdit,
            onSelect: requestBulkDelete,
          },
        ]
      : []),
  ]

  const baseActions = (base: KnowledgeBaseData): MenuAction[] => {
    if (selection.selected.size > 1 && selection.selected.has(base.id)) return multiActions()
    const pinned = pinnedBases.has(base.id)
    return [
      openInNewTabAction(baseHref(base.id)),
      { id: 'tags', label: 'View tags', icon: 'I075', onSelect: () => setTagsFor(base.id) },
      { id: 'copy-id', label: 'Copy ID', icon: 'I006', onSelect: () => copyId(base.id) },
      ...(access.exportDisabled
        ? []
        : [
            {
              id: 'export',
              label: 'Export',
              icon: 'I049' as const,
              onSelect: () => downloadKnowledgeBaseExport(base.id),
            },
          ]),
      {
        id: 'pin',
        label: pinned ? 'Unpin' : 'Pin',
        icon: 'I131',
        onSelect: () => togglePin('knowledge_base', base.id, pinned),
      },
      {
        id: 'edit',
        label: 'Edit',
        icon: 'I036',
        disabled: !canEdit,
        onSelect: () => setEditing(base),
      },
      ...(canEdit
        ? [
            {
              id: 'move',
              label: 'Move to',
              icon: 'I100' as const,
              children: moveDestinations({
                folders,
                rootLabel: ROOT_LABEL,
                onMove: (target) => moveRows({ folderIds: [], resourceIds: [base.id] }, target),
              }),
            },
          ]
        : []),
      ...(!base.isSearchIndex || canDeleteBase(base)
        ? [
            {
              id: 'delete',
              label: 'Delete',
              icon: 'I061' as const,
              destructive: true,
              separatorBefore: true,
              disabled: !canEdit,
              onSelect: () => setDeleting(base),
            },
          ]
        : []),
    ]
  }

  const folderActions = (folder: ResourceFolder, inList: boolean): MenuAction[] => {
    if (inList && selection.selected.size > 1 && selection.selected.has(folderRowId(folder.id)))
      return multiActions()
    const pinned = pinnedFolders.has(folder.id)
    const holdsIndex = searchIndexFolders.has(folder.id)
    return [
      ...(inList
        ? [
            {
              id: 'open',
              label: 'Open',
              icon: 'eye' as const,
              onSelect: () => openFolder(folder.id),
            },
          ]
        : []),
      {
        id: 'pin',
        label: pinned ? 'Unpin' : 'Pin',
        icon: 'I131',
        onSelect: () => togglePin('folder', folder.id, pinned),
      },
      { id: 'copy-id', label: 'Copy ID', icon: 'I006', onSelect: () => copyId(folder.id) },
      ...(canEdit
        ? [
            {
              id: 'rename',
              label: 'Rename',
              icon: 'I036' as const,
              onSelect: () =>
                inList
                  ? listRename.startRename(folderRowId(folder.id), folder.name)
                  : setRenamingFolder(folder),
            },
            ...(inList
              ? [
                  {
                    id: 'move',
                    label: 'Move to',
                    icon: 'I100' as const,
                    children: moveDestinations({
                      folders,
                      rootLabel: ROOT_LABEL,
                      exclude: [folder.id],
                      descendants,
                      onMove: (target) =>
                        moveRows({ folderIds: [folder.id], resourceIds: [] }, target),
                    }),
                  },
                ]
              : []),
            {
              id: 'delete',
              label: 'Delete',
              icon: 'I061' as const,
              destructive: true,
              separatorBefore: true,
              disabled: holdsIndex,
              disabledReason: holdsIndex ? SEARCH_INDEX_FOLDER : undefined,
              onSelect: () => setConfirm({ kind: 'folder', folder }),
            },
          ]
        : []),
    ]
  }

  const connectorsCell = (types: readonly string[] | undefined) =>
    types?.length ? (
      <Stack
        label='Connectors'
        items={types.map((type) => ({
          id: type,
          label: connectorDisplayName(type),
          content: <Icon providerId={type} label={connectorDisplayName(type)} />,
        }))}
      />
    ) : undefined

  const rows: ResourceRow[] = items.map((item) => {
    if (item.kind === 'folder') {
      const { folder } = item
      const owner = memberById.get(folder.userId)
      return {
        id: folderRowId(folder.id),
        name: folder.name,
        icon: 'I100',
        folder: true,
        pinned: pinnedFolders.has(folder.id),
        onOpen: () => openFolder(folder.id),
        cells: {
          created: formatRelativeTime(timeOf(folder.createdAt), now),
          owner: owner && <OwnerCell name={owner.name} image={owner.image} />,
          updated: formatRelativeTime(timeOf(folder.updatedAt), now),
          location: searching && folderLocation(folderById, folder.parentId, ROOT_LABEL),
        },
      }
    }
    const { base } = item
    const owner = memberById.get(base.userId)
    return {
      id: base.id,
      name: base.name,
      icon: 'I004',
      pinned: pinnedBases.has(base.id),
      href: baseHref(base.id),
      cells: {
        documents: (base.docCount ?? 0).toLocaleString(),
        tokens: (base.tokenCount ?? 0).toLocaleString(),
        connectors: connectorsCell(base.connectorTypes),
        created: formatRelativeTime(timeOf(base.createdAt), now),
        owner: owner && <OwnerCell name={owner.name} image={owner.image} />,
        updated: formatRelativeTime(timeOf(base.updatedAt), now),
        location: searching && folderLocation(folderById, base.folderId, ROOT_LABEL),
      },
    }
  })

  const memberOptions = (membersQuery.data ?? []).map((member) => ({
    value: member.userId,
    label: member.name,
  }))
  const currentFolder = folderId ? folderById.get(folderId) : undefined
  const chain = folderPath(folderById, folderId)
  const hrefFor = (id: string | null) => folderHref(pathname, searchParams, id)

  usePageCommands(
    canEdit && !access.hidden
      ? [
          { id: 'knowledge-new-base', label: 'New base', run: () => setCreating(true) },
          {
            id: 'knowledge-new-folder',
            label: 'New folder',
            run: () => {
              if (!createFolder.isPending) void handleCreateFolder()
            },
          },
        ]
      : []
  )

  const controls = !access.hidden && (
    <ControlBar
      search={
        <SearchField
          variant='quiet'
          label='Search knowledge bases'
          placeholder='Search knowledge bases…'
          value={filters.search}
          onValueChange={setSearch}
        />
      }
      trail={
        <Breadcrumbs
          label='Location'
          items={folderTrail({
            rootLabel: ROOT_LABEL,
            chain,
            hrefFor,
            currentActions: currentFolder && folderActions(currentFolder, false),
            drop: drag.crumb,
          })}
        />
      }
    >
      {filtered && (
        <Button variant='quiet' size='compact' onClick={preferences.clearFilters}>
          Clear filters
        </Button>
      )}
      <ChoiceMenu
        label='Connectors'
        options={CONNECTOR_FILTERS}
        value={filters.connector[0] ?? 'all'}
        onValueChange={(value) =>
          preferences.setFilter('connector', value === 'all' ? [] : [value])
        }
      />
      <ChoiceMenu
        label='Content'
        options={CONTENT_FILTERS}
        value={filters.content[0] ?? 'all'}
        onValueChange={(value) => preferences.setFilter('content', value === 'all' ? [] : [value])}
      />
      {memberOptions.length > 0 && (
        <MultiSelect
          variant='text'
          label='Owner'
          labelHidden
          options={memberOptions}
          value={filters.owner}
          onValueChange={(next) => preferences.setFilter('owner', next)}
          placeholder='All owners'
          searchLabel='Search members'
        />
      )}
      <ActionMenu
        label='Sort knowledge bases'
        icon='I050'
        tooltip
        align='end'
        actions={sortActions({ columns: SORTS, sort, dir, onSort: preferences.setSort })}
      />
      <Button
        variant='quiet'
        size='compact'
        icon='I100'
        disabled={!canEdit || createFolder.isPending}
        onClick={() => void handleCreateFolder()}
      >
        New folder
      </Button>
      <Button
        variant='secondary'
        size='compact'
        icon='I074'
        disabled={!canEdit}
        onClick={() => setCreating(true)}
      >
        New base
      </Button>
    </ControlBar>
  )

  const read: WorkspaceRead = basesQuery.isError
    ? {
        status: 'error',
        message: 'Knowledge bases could not be loaded.',
        retrying: basesQuery.isFetching,
        onRetry: () => void basesQuery.refetch(),
      }
    : !access.settled ||
        (!access.hidden && (basesQuery.isPending || !foldersResolved || !preferences.isReady))
      ? { status: 'pending' }
      : { status: 'ready' }

  const copy = noResults(search, filtered)
  const empty =
    searching || filtered ? (
      <WorkspaceEmpty
        title={copy.title}
        description={copy.description}
        action={{
          label: copy.action,
          onClick: () => {
            setSearch('')
            preferences.clearFilters()
          },
        }}
      />
    ) : folderId ? (
      <WorkspaceEmpty title='This folder is empty' />
    ) : (
      <WorkspaceEmpty
        title='No knowledge bases yet'
        description='Upload documents to give your agents a memory they can search.'
      />
    )

  const deletableSelection = selectionDeletable(selection.selected)

  return (
    <LiveWorkspacePage
      workspaceId={workspaceId}
      current='knowledge'
      controls={controls}
      read={read}
    >
      {access.hidden ? (
        <AccessRequired
          workspaceId={workspaceId}
          gate='hideKnowledgeBaseTab'
          refreshing={access.refreshing}
          onRefresh={access.refresh}
        />
      ) : (
        <ResourceTable
          label='Knowledge bases'
          columns={searching ? SEARCH_COLUMNS : COLUMNS}
          rows={rows}
          rowActions={(row) => {
            const parsed = parseRowId(row.id)
            if (parsed.kind === 'folder') {
              const folder = folderById.get(parsed.id)
              return folder ? folderActions(folder, true) : []
            }
            const base = baseById.get(parsed.id)
            return base ? baseActions(base) : []
          }}
          backgroundActions={[
            {
              id: 'new-folder',
              label: 'New folder',
              icon: 'I100',
              disabled: !canEdit || createFolder.isPending,
              onSelect: () => void handleCreateFolder(),
            },
            {
              id: 'new-base',
              label: 'New base',
              icon: 'I074',
              disabled: !canEdit,
              onSelect: () => setCreating(true),
            },
          ]}
          selection={canEdit ? selection : undefined}
          bulkActions={
            canEdit
              ? [
                  selectionMove(),
                  {
                    id: 'delete',
                    label: 'Delete',
                    destructive: true,
                    disabled: !deletableSelection || bulkMove.isPending || bulkDelete.isPending,
                    disabledReason: deletableSelection
                      ? undefined
                      : 'Only an admin can delete the workspace search index.',
                    onSelect: requestBulkDelete,
                  },
                ]
              : undefined
          }
          bulkLimit={MAX_KNOWLEDGE_BATCH_ITEMS}
          rename={
            listRename.editingId
              ? {
                  rowId: listRename.editingId,
                  value: listRename.editValue,
                  saving: listRename.isSaving,
                  onChange: listRename.setEditValue,
                  onSubmit: () => void listRename.submitRename(),
                  onCancel: listRename.cancelRename,
                }
              : null
          }
          drag={drag}
          empty={empty}
        />
      )}
      <CreateBaseModal
        workspaceId={workspaceId}
        open={creating}
        onOpenChange={setCreating}
        folderId={folderId}
      />
      <EditBaseModal base={editing} onClose={() => setEditing(null)} />
      <DeleteBaseModal base={deleting} onClose={() => setDeleting(null)} />
      {tagsFor && (
        <BaseTagsModal
          open
          onOpenChange={(open) => {
            if (!open) setTagsFor(null)
          }}
          knowledgeBaseId={tagsFor}
        />
      )}
      <ConfirmDialog
        target={confirm}
        onClose={() => setConfirm(null)}
        title={(target) => (target.kind === 'folder' ? 'Delete folder' : 'Delete selected')}
        description={(target) =>
          target.kind === 'folder'
            ? `Are you sure you want to delete ${target.folder.name}? This also deletes the knowledge bases and folders inside it. You can restore them from Recently Deleted in Settings.`
            : `Are you sure you want to delete ${target.name}? ${
                target.folderIds.length
                  ? 'This also deletes the knowledge bases and folders inside the selected folders. '
                  : ''
              }You can restore them from Recently Deleted in Settings.`
        }
        confirmLabel='Delete'
        pendingLabel='Deleting…'
        onConfirm={async (target) => {
          if (target.kind === 'folder') {
            await deleteFolder.mutateAsync({
              workspaceId,
              resourceType: 'knowledge_base',
              id: target.folder.id,
            })
            if (folderId === target.folder.id)
              setFolderId(target.folder.parentId, { history: 'replace' })
            return
          }
          const result = await bulkDelete.mutateAsync({
            knowledgeBaseIds: target.baseIds,
            folderIds: target.folderIds,
          })
          selection.clear()
          reportBulkOutcome(result, 'deleted')
        }}
      />
      <RenameDialog
        target={renamingFolder}
        noun='folder'
        onClose={() => setRenamingFolder(null)}
        onRename={(id, name) =>
          updateFolder.mutateAsync({
            workspaceId,
            resourceType: 'knowledge_base',
            id,
            updates: { name },
          })
        }
      />
    </LiveWorkspacePage>
  )
}
