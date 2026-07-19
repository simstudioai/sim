'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ChipDropdownOption } from '@sim/emcn'
import { ChipConfirmModal, ChipDropdown } from '@sim/emcn'
import { Panels, Plus } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { useParams, useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import type { InterfaceDefinition } from '@/lib/interfaces'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import type {
  FilterConfig,
  FilterTag,
  ResourceAction,
  ResourceColumn,
  ResourceRow,
  SearchConfig,
  SortConfig,
} from '@/app/workspace/[workspaceId]/components'
import { ownerCell, Resource, timeCell } from '@/app/workspace/[workspaceId]/components'
import {
  InterfaceContextMenu,
  InterfacesListContextMenu,
} from '@/app/workspace/[workspaceId]/interfaces/components'
import {
  interfacesParsers,
  interfacesSortParams,
  interfacesUrlKeys,
} from '@/app/workspace/[workspaceId]/interfaces/search-params'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import {
  useCreateInterface,
  useDeleteInterface,
  useInterfacesList,
  useRenameInterface,
} from '@/hooks/queries/interfaces'
import { useWorkspaceMembersQuery, type WorkspaceMember } from '@/hooks/queries/workspace'
import { useDebounce } from '@/hooks/use-debounce'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { useInlineRename } from '@/hooks/use-inline-rename'
import { useUrlSort } from '@/hooks/use-url-sort'

const logger = createLogger('Interfaces')

const COLUMNS: ResourceColumn[] = [
  { id: 'name', header: 'Name' },
  { id: 'modules', header: 'Modules', widthMultiplier: 0.6 },
  { id: 'created', header: 'Created' },
  { id: 'owner', header: 'Owner' },
  { id: 'updated', header: 'Last Updated' },
]

const INTERFACE_ICON = <Panels className='size-[14px]' />

const FILTER_SECTION_LABEL_CLASS = 'text-[var(--text-muted)] text-small'

/** Stable identity for the no-filters case so the memoized options bar can bail. */
const NO_FILTER_TAGS: FilterTag[] = []

const BASE_INTERFACE_NAME = 'Interface'

/**
 * First unused default name — `Interface`, then `Interface 2`, `Interface 3`, …
 * Compared case-insensitively so a new interface never reads as a duplicate of
 * an existing row. Terminates within `existingNames.length + 1` iterations.
 */
function generateUniqueInterfaceName(existingNames: readonly string[]): string {
  const taken = new Set(existingNames.map((name) => name.toLowerCase()))
  let candidate = BASE_INTERFACE_NAME
  let suffix = 1
  while (taken.has(candidate.toLowerCase())) {
    suffix += 1
    candidate = `${BASE_INTERFACE_NAME} ${suffix}`
  }
  return candidate
}

/**
 * Interfaces list. An interface is a 2x2 canvas of chat/form/table/file modules;
 * this page owns the collection (create, rename, delete, search, sort, filter)
 * and hands off to `interfaces/[interfaceId]` for authoring.
 *
 * Only the `active` scope is listed — deleting archives, and archived
 * interfaces are restored from Recently Deleted in Settings.
 */
export function Interfaces() {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const router = useRouter()

  const userPermissions = useUserPermissionsContext()
  const canEdit = userPermissions.canEdit === true

  const { data: interfaces = [], error } = useInterfacesList(workspaceId)
  const { data: members } = useWorkspaceMembersQuery(workspaceId)

  useEffect(() => {
    if (error) {
      logger.error('Failed to load interfaces', { error })
    }
  }, [error])

  const createInterface = useCreateInterface(workspaceId)
  const renameInterface = useRenameInterface(workspaceId)
  const deleteInterface = useDeleteInterface(workspaceId)

  const interfaceRename = useInlineRename({
    onSave: (interfaceId, name) => renameInterface.mutateAsync({ interfaceId, name }),
  })

  /** The right-clicked row — drives the row context menu and the delete dialog. */
  const [activeInterface, setActiveInterface] = useState<InterfaceDefinition | null>(null)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  const [{ search: urlSearchTerm, owner: ownerFilter }, setInterfaceFilters] = useQueryStates(
    interfacesParsers,
    interfacesUrlKeys
  )

  const {
    sort: sortColumn,
    dir: sortDirection,
    activeSort,
    onSort,
    onClear,
  } = useUrlSort(interfacesSortParams, interfacesUrlKeys)

  /**
   * The input is controlled directly by the instant nuqs value; only the URL
   * write is debounced. The in-memory filter below reads a debounced value so
   * it doesn't recompute on every keystroke.
   */
  const setSearchTerm = useDebouncedSearchSetter((value, options) =>
    setInterfaceFilters({ search: value }, options)
  )
  const debouncedSearchTerm = useDebounce(urlSearchTerm, SEARCH_DEBOUNCE_MS)

  const setOwnerFilter = useCallback(
    (next: string[]) => setInterfaceFilters({ owner: next }),
    [setInterfaceFilters]
  )

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

  /** Indexed once so the owner comparator and every owner cell stay O(1). */
  const membersById = useMemo(() => {
    const byId = new Map<string, WorkspaceMember>()
    for (const member of members ?? []) {
      byId.set(member.userId, member)
    }
    return byId
  }, [members])

  const processedInterfaces = useMemo(() => {
    const query = debouncedSearchTerm.trim().toLowerCase()
    let result = query
      ? interfaces.filter(
          (definition) =>
            definition.name.toLowerCase().includes(query) ||
            definition.description?.toLowerCase().includes(query)
        )
      : interfaces

    if (ownerFilter.length > 0) {
      const owners = new Set(ownerFilter)
      result = result.filter((definition) => owners.has(definition.createdBy))
    }

    return [...result].sort((a, b) => {
      let cmp = 0
      switch (sortColumn) {
        case 'name':
          cmp = a.name.localeCompare(b.name)
          break
        case 'modules':
          cmp = a.layout.modules.length - b.layout.modules.length
          break
        case 'created':
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          break
        case 'updated':
          cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
          break
        case 'owner':
          cmp = (membersById.get(a.createdBy)?.name ?? '').localeCompare(
            membersById.get(b.createdBy)?.name ?? ''
          )
          break
      }
      return sortDirection === 'asc' ? cmp : -cmp
    })
  }, [interfaces, debouncedSearchTerm, ownerFilter, sortColumn, sortDirection, membersById])

  const rows: ResourceRow[] = useMemo(
    () =>
      processedInterfaces.map((definition) => ({
        id: definition.id,
        cells: {
          name: {
            icon: INTERFACE_ICON,
            label: definition.name,
            editing:
              interfaceRename.editingId === definition.id
                ? {
                    value: interfaceRename.editValue,
                    onChange: interfaceRename.setEditValue,
                    onSubmit: interfaceRename.submitRename,
                    onCancel: interfaceRename.cancelRename,
                    disabled: interfaceRename.isSaving,
                  }
                : undefined,
          },
          modules: { label: String(definition.layout.modules.length) },
          created: timeCell(definition.createdAt),
          owner: ownerCell(definition.createdBy, membersById),
          updated: timeCell(definition.updatedAt),
        },
      })),
    [
      processedInterfaces,
      membersById,
      interfaceRename.editingId,
      interfaceRename.editValue,
      interfaceRename.isSaving,
      interfaceRename.setEditValue,
      interfaceRename.submitRename,
      interfaceRename.cancelRename,
    ]
  )

  /**
   * `mutateAsync` is stable in TanStack Query v5 — extracted so the callbacks
   * below can list it as a dep instead of the unstable mutation object.
   */
  const createInterfaceAsync = createInterface.mutateAsync
  const handleCreateInterface = useCallback(async () => {
    const name = generateUniqueInterfaceName(interfaces.map((definition) => definition.name))
    try {
      const result = await createInterfaceAsync({ name })
      router.push(`/workspace/${workspaceId}/interfaces/${result.data.id}`)
    } catch (err) {
      logger.error('Failed to create interface', { error: err })
    }
  }, [interfaces, router, workspaceId, createInterfaceAsync])

  const deleteInterfaceAsync = deleteInterface.mutateAsync
  const handleDelete = useCallback(async () => {
    if (!activeInterface) return
    try {
      await deleteInterfaceAsync(activeInterface.id)
      setIsDeleteDialogOpen(false)
      setActiveInterface(null)
    } catch (err) {
      logger.error('Failed to delete interface', { error: err })
    }
  }, [activeInterface, deleteInterfaceAsync])

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

  const handleRowClick = useCallback(
    (rowId: string) => {
      if (!isRowContextMenuOpen) {
        router.push(`/workspace/${workspaceId}/interfaces/${rowId}`)
      }
    },
    [isRowContextMenuOpen, router, workspaceId]
  )

  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent, rowId: string) => {
      closeListContextMenu()
      setActiveInterface(interfaces.find((definition) => definition.id === rowId) ?? null)
      handleRowCtxMenu(e)
    },
    [interfaces, closeListContextMenu, handleRowCtxMenu]
  )

  const handleRenameActive = useCallback(() => {
    if (activeInterface) {
      interfaceRename.startRename(activeInterface.id, activeInterface.name)
    }
  }, [activeInterface, interfaceRename.startRename])

  const handleCopyActiveId = useCallback(() => {
    if (activeInterface) {
      navigator.clipboard.writeText(activeInterface.id)
    }
  }, [activeInterface])

  const handleRequestDelete = useCallback(() => setIsDeleteDialogOpen(true), [])

  const headerActions: ResourceAction[] = useMemo(
    () => [
      {
        text: 'New interface',
        icon: Plus,
        onSelect: handleCreateInterface,
        disabled: !canEdit || createInterface.isPending,
        variant: 'primary',
      },
    ],
    [handleCreateInterface, canEdit, createInterface.isPending]
  )

  const searchConfig: SearchConfig = useMemo(
    () => ({
      value: urlSearchTerm,
      onChange: setSearchTerm,
      onClearAll: () => setSearchTerm(''),
      placeholder: 'Search interfaces...',
    }),
    [urlSearchTerm, setSearchTerm]
  )

  const sortConfig: SortConfig = useMemo(
    () => ({
      options: [
        { id: 'name', label: 'Name' },
        { id: 'modules', label: 'Modules' },
        { id: 'created', label: 'Created' },
        { id: 'owner', label: 'Owner' },
        { id: 'updated', label: 'Last Updated' },
      ],
      active: activeSort,
      onSort,
      onClear,
    }),
    [activeSort, onSort, onClear]
  )

  const memberOptions: ChipDropdownOption[] = useMemo(
    () =>
      (members ?? []).map((member) => ({
        value: member.userId,
        label: member.name,
        iconElement: member.image ? (
          <img
            src={member.image}
            alt={member.name}
            referrerPolicy='no-referrer'
            className='size-[14px] rounded-full border border-[var(--border)] object-cover'
          />
        ) : (
          <span className='flex size-[14px] items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-3)] font-medium text-[8px] text-[var(--text-secondary)]'>
            {member.name.charAt(0).toUpperCase()}
          </span>
        ),
      })),
    [members]
  )

  /** The dropdown's own "All" row clears the selection, so there is no extra clear control. */
  const filterContent = useMemo(
    () => (
      <div className='flex w-[260px] flex-col gap-3 p-3'>
        <div className='flex flex-col gap-2'>
          <div className='flex h-5 items-center'>
            <span className={FILTER_SECTION_LABEL_CLASS}>Owner</span>
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
      </div>
    ),
    [memberOptions, ownerFilter, setOwnerFilter]
  )

  const filterConfig: FilterConfig = useMemo(() => ({ content: filterContent }), [filterContent])

  const filterTags: FilterTag[] = useMemo(() => {
    if (ownerFilter.length === 0) return NO_FILTER_TAGS
    const label =
      ownerFilter.length === 1
        ? `Owner: ${membersById.get(ownerFilter[0])?.name ?? '1 member'}`
        : `Owner: ${ownerFilter.length} members`
    return [{ label, onRemove: () => setOwnerFilter([]) }]
  }, [ownerFilter, membersById, setOwnerFilter])

  const activeModuleCount = activeInterface?.layout.modules.length ?? 0

  return (
    <>
      <Resource onContextMenu={handleContentContextMenu}>
        <Resource.Header icon={Panels} title='Interfaces' actions={headerActions} />
        <Resource.Options
          search={searchConfig}
          sort={sortConfig}
          filterTags={filterTags}
          filter={filterConfig}
        />
        <Resource.Table
          columns={COLUMNS}
          rows={rows}
          onRowClick={handleRowClick}
          onRowContextMenu={handleRowContextMenu}
        />
      </Resource>

      <InterfacesListContextMenu
        isOpen={isListContextMenuOpen}
        position={listContextMenuPosition}
        onClose={closeListContextMenu}
        onCreateInterface={handleCreateInterface}
        disableCreate={!canEdit || createInterface.isPending}
      />

      <InterfaceContextMenu
        isOpen={isRowContextMenuOpen}
        position={rowContextMenuPosition}
        onClose={closeRowContextMenu}
        onRename={handleRenameActive}
        onCopyId={handleCopyActiveId}
        onDelete={handleRequestDelete}
        disableRename={!canEdit}
        disableDelete={!canEdit}
      />

      <ChipConfirmModal
        open={isDeleteDialogOpen}
        onOpenChange={(open) => {
          setIsDeleteDialogOpen(open)
          if (!open) setActiveInterface(null)
        }}
        srTitle='Delete Interface'
        title='Delete Interface'
        text={[
          'Are you sure you want to delete ',
          { text: activeInterface?.name ?? 'this interface', bold: true },
          '?',
          activeModuleCount > 0 && {
            text: ` Its ${activeModuleCount} module${activeModuleCount === 1 ? '' : 's'} will be removed.`,
            error: true,
          },
          ' You can restore it from Recently Deleted in Settings.',
        ]}
        confirm={{
          label: 'Delete',
          onClick: handleDelete,
          pending: deleteInterface.isPending,
          pendingLabel: 'Deleting...',
        }}
      />
    </>
  )
}
