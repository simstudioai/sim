'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Chip, toast } from '@sim/emcn'
import { FolderPlus, Pencil, Plus, Trash, Upload, Workflow } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryStates } from 'nuqs'
import { EmptyState } from '@/components/empty-state/empty-state'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state'
import type { MoveOptionNode } from '@/app/workspace/[workspaceId]/components/folders'
import {
  buildDescendantIndex,
  buildMoveOptions,
  buildMoveOptionsExcludingSubtrees,
  EMPTY_LOCATION_CELL,
  FOLDER_LOCATION_COLUMN,
  folderBreadcrumbItems,
  folderLocationLabel,
  folderRow,
  folderRowId,
  isSearchingResources,
  nextUntitledFolderName,
  parseFolderedRowId,
  parseMoveOptionValue,
  scopeFolderedItems,
  useFolderNavigation,
} from '@/app/workspace/[workspaceId]/components/folders'
import { ResourceNoResults } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state'
import type {
  DropdownOption,
  ResourceAction,
} from '@/app/workspace/[workspaceId]/components/resource/components/resource-header'
import type { SearchConfig } from '@/app/workspace/[workspaceId]/components/resource/components/resource-options'
import { timeCell } from '@/app/workspace/[workspaceId]/components/resource/components/time-cell'
import { resourceListState } from '@/app/workspace/[workspaceId]/components/resource/is-resource-list-empty'
import type {
  ResourceColumn,
  ResourceRow,
} from '@/app/workspace/[workspaceId]/components/resource/resource'
import {
  EMPTY_CELL_PLACEHOLDER,
  Resource,
} from '@/app/workspace/[workspaceId]/components/resource/resource'
import {
  ResourceListHeader,
  useResourceRouter,
  useResourceWorkspaceId,
} from '@/app/workspace/[workspaceId]/components/resource/resource-navigation'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { ContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/context-menu/context-menu'
import { DeleteModal } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/delete-modal/delete-modal'
import { useWorkflowOperations } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { compareByOrder } from '@/app/workspace/[workspaceId]/w/components/sidebar/utils'
import {
  useCanDelete,
  useDeleteFolder,
  useDeleteWorkflow,
  useDuplicateFolder,
  useDuplicateWorkflow,
  useExportFolder,
  useExportWorkflow,
  useImportWorkflow,
} from '@/app/workspace/[workspaceId]/w/hooks'
import { workflowsParsers, workflowsUrlKeys } from '@/app/workspace/[workspaceId]/w/search-params'
import { useCreateFolder, useFolderMap, useUpdateFolder } from '@/hooks/queries/folders'
import {
  isFolderEffectivelyLocked,
  isWorkflowEffectivelyLocked,
} from '@/hooks/queries/utils/folder-tree'
import { useUpdateWorkflow, useWorkflows } from '@/hooks/queries/workflows'
import { useContextMenu } from '@/hooks/use-context-menu'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { useInlineRename } from '@/hooks/use-inline-rename'
import { useSearchFilterValue } from '@/hooks/use-search-filter-value'
import type { WorkflowFolder } from '@/stores/folders/types'
import type { WorkflowMetadata } from '@/stores/workflows/registry/types'

const logger = createLogger('WorkflowsList')

/** Mirrored by `workflows-list-loading.tsx`, so the fallback and the list line up. */
const WORKFLOW_COLUMNS: ResourceColumn[] = [
  { id: 'name', header: 'Name', widthMultiplier: 1.4 },
  { id: 'status', header: 'Status', widthMultiplier: 0.7 },
  { id: 'updated', header: 'Last Updated' },
]

const SEARCH_COLUMNS: ResourceColumn[] = [...WORKFLOW_COLUMNS, FOLDER_LOCATION_COLUMN]

/** Root label for breadcrumbs and the "move to workspace root" destination. */
const ROOT_LABEL = 'Workflows'

const EMPTY_WORKFLOWS: WorkflowMetadata[] = []
const EMPTY_FOLDER_MAP: Record<string, WorkflowFolder> = {}
const NO_IDS: string[] = []

const WORKFLOW_ICON = <Workflow className='size-[14px]' />
const DEPLOYED_DOT = <span aria-hidden className='size-[6px] rounded-full bg-[var(--brand-blue)]' />
const DRAFT_DOT = (
  <span aria-hidden className='size-[6px] rounded-full border border-[var(--text-muted)]' />
)

/** A list row (and the right-clicked row), resolved to the entity it refers to. */
type WorkflowResourceItem =
  | { kind: 'workflow'; workflow: WorkflowMetadata }
  | { kind: 'folder'; folder: WorkflowFolder }

/**
 * The Workflows index page: the workspace's workflow folder tree in the content area, in the
 * shape of Files, Tables, and Knowledge. A row opens the canvas; a folder row opens the folder
 * (`?folderId=`, shared with every foldered list). The row menu offers what the workspace
 * sidebar's tree offered, through the sidebar's own action hooks, so the two surfaces never
 * disagree about what a workflow can do.
 */
export function WorkflowsList() {
  const router = useResourceRouter()
  const workspaceId = useResourceWorkspaceId()
  const importInputRef = useRef<HTMLInputElement>(null)

  const { canEdit } = useUserPermissionsContext()

  const {
    data: workflows = EMPTY_WORKFLOWS,
    isLoading,
    isPlaceholderData,
    error,
  } = useWorkflows(workspaceId)
  /** Lock helpers read a `Record`; the navigation hook hands back a `Map` of the same rows. */
  const { data: folderMap = EMPTY_FOLDER_MAP } = useFolderMap(workspaceId)

  const [{ search: urlSearchTerm }, setWorkflowFilters] = useQueryStates(
    workflowsParsers,
    workflowsUrlKeys
  )
  const setSearchTerm = useDebouncedSearchSetter((value, options) =>
    setWorkflowFilters({ search: value }, options)
  )
  const debouncedSearchTerm = useSearchFilterValue(urlSearchTerm, SEARCH_DEBOUNCE_MS)

  const {
    currentFolderId,
    setCurrentFolderId,
    openFolder,
    ancestors: folderChain,
    folders,
    folderById,
    foldersResolved,
  } = useFolderNavigation({
    resourceType: 'workflow',
    workspaceId,
    onBeforeOpenFolder: () => setSearchTerm(''),
  })

  useEffect(() => {
    if (error) logger.error('Failed to load workflows:', error)
  }, [error])

  const { handleCreateWorkflowInFolder, isCreatingWorkflow } = useWorkflowOperations({
    workspaceId,
  })
  const createFolder = useCreateFolder()
  const updateFolder = useUpdateFolder()
  const updateWorkflow = useUpdateWorkflow()
  const { isImporting, handleFileChange: handleImportFileChange } = useImportWorkflow({
    workspaceId,
  })
  const { canDeleteWorkflows, canDeleteFolder } = useCanDelete({ workspaceId })

  const [activeItem, setActiveItem] = useState<WorkflowResourceItem | null>(null)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)

  const {
    isOpen: isRowContextMenuOpen,
    position: rowContextMenuPosition,
    menuRef: rowContextMenuRef,
    handleContextMenu: handleRowCtxMenu,
    closeMenu: closeRowContextMenu,
  } = useContextMenu()

  const activeWorkflowIds = useMemo(
    () => (activeItem?.kind === 'workflow' ? [activeItem.workflow.id] : NO_IDS),
    [activeItem]
  )
  const activeFolderIds = useMemo(
    () => (activeItem?.kind === 'folder' ? [activeItem.folder.id] : NO_IDS),
    [activeItem]
  )
  const activeFolderId = activeItem?.kind === 'folder' ? activeItem.folder.id : ''

  const closeDeleteModal = useCallback(() => setIsDeleteModalOpen(false), [])

  const { isDeleting: isDeletingWorkflow, handleDeleteWorkflow } = useDeleteWorkflow({
    workspaceId,
    workflowIds: activeWorkflowIds,
    onSuccess: closeDeleteModal,
  })
  const { isDeleting: isDeletingFolder, handleDeleteFolder } = useDeleteFolder({
    workspaceId,
    folderIds: activeFolderIds,
    onSuccess: () => {
      /**
       * The open folder just disappeared — fall back to its parent rather than leaving a
       * `?folderId=` pointing at an archived folder. `history: 'replace'`: a forced
       * correction, not a navigation the user chose.
       */
      if (activeItem?.kind === 'folder' && currentFolderId === activeItem.folder.id) {
        setCurrentFolderId(activeItem.folder.parentId, { history: 'replace' })
      }
      closeDeleteModal()
    },
  })
  const { isDuplicating: isDuplicatingWorkflow, handleDuplicateWorkflow } = useDuplicateWorkflow({
    workspaceId,
  })
  const { isDuplicating: isDuplicatingFolder, handleDuplicateFolder } = useDuplicateFolder({
    workspaceId,
    folderIds: activeFolderIds,
  })
  const { handleExportWorkflow } = useExportWorkflow({ workspaceId })
  const { handleExportFolder } = useExportFolder({ workspaceId, folderId: activeFolderId })

  /**
   * One rename session multiplexed over both row kinds — the shared `Resource` table has a
   * single editing cell, so the id it carries has to resolve to either a folder or a
   * workflow. The hook restores the original name and keeps the field open on failure.
   */
  const listRename = useInlineRename({
    onSave: (rowId, name) => {
      const parsed = parseFolderedRowId(rowId)
      if (parsed.kind === 'folder') {
        return updateFolder
          .mutateAsync({ workspaceId, resourceType: 'workflow', id: parsed.id, updates: { name } })
          .catch((err: unknown) => {
            toast.error(getErrorMessage(err, 'Failed to rename folder'), { duration: 5000 })
            throw err
          })
      }
      return updateWorkflow
        .mutateAsync({ workspaceId, workflowId: parsed.id, metadata: { name } })
        .catch((err: unknown) => {
          toast.error(getErrorMessage(err, 'Failed to rename workflow'), { duration: 5000 })
          throw err
        })
    },
  })

  const breadcrumbRename = useInlineRename({
    onSave: (folderId, name) =>
      updateFolder
        .mutateAsync({ workspaceId, resourceType: 'workflow', id: folderId, updates: { name } })
        .catch((err: unknown) => {
          toast.error(getErrorMessage(err, 'Failed to rename folder'), { duration: 5000 })
          throw err
        }),
  })

  const workspaceWorkflows = useMemo(
    () => workflows.filter((workflow) => workflow.workspaceId === workspaceId),
    [workflows, workspaceId]
  )

  const workflowById = useMemo(() => {
    const byId = new Map<string, WorkflowMetadata>()
    for (const workflow of workspaceWorkflows) byId.set(workflow.id, workflow)
    return byId
  }, [workspaceWorkflows])

  const descendantFolderIds = useMemo(() => buildDescendantIndex(folders), [folders])

  /** A query stops scoping the list to the open folder — see {@link scopeFolderedItems}. */
  const isSearching = isSearchingResources(debouncedSearchTerm)

  const visibleFolders = useMemo(
    () =>
      scopeFolderedItems(folders, {
        currentFolderId,
        search: debouncedSearchTerm,
        getParentId: (folder) => folder.parentId ?? null,
        getSearchText: (folder) => [folder.name],
      }),
    [folders, currentFolderId, debouncedSearchTerm]
  )

  const visibleWorkflows = useMemo(
    () =>
      scopeFolderedItems(workspaceWorkflows, {
        currentFolderId,
        search: debouncedSearchTerm,
        /**
         * A `folderId` naming a folder that is no longer active would match no level at all
         * and leave the workflow unreachable. Fall it back to the root, but only once
         * `foldersResolved` says the index is the complete set for THIS workspace.
         */
        getParentId: (workflow) => {
          const folderId = workflow.folderId ?? null
          return !foldersResolved || !folderId || folderById.has(folderId) ? folderId : null
        },
        getSearchText: (workflow) => [workflow.name],
      }),
    [workspaceWorkflows, currentFolderId, debouncedSearchTerm, folderById, foldersResolved]
  )

  /**
   * Folders and workflows sort as ONE list in the order the workspace sidebar's tree read them:
   * the user's own `sortOrder`, then creation time. A search ranks the same way, since the
   * query already narrowed the set. Pinning does not exist for workflows, so no row floats.
   */
  const sortedEntries = useMemo((): { item: WorkflowResourceItem }[] => {
    const entries = [
      ...visibleFolders.map((folder) => ({
        id: folder.id,
        sortOrder: folder.sortOrder,
        createdAt: folder.createdAt,
        item: { kind: 'folder', folder } as const,
      })),
      ...visibleWorkflows.map((workflow) => ({
        id: workflow.id,
        sortOrder: workflow.sortOrder,
        createdAt: workflow.createdAt,
        item: { kind: 'workflow', workflow } as const,
      })),
    ]
    return entries.sort(compareByOrder)
  }, [visibleFolders, visibleWorkflows])

  const baseRows: ResourceRow[] = useMemo(
    () =>
      sortedEntries.map(({ item }): ResourceRow => {
        if (item.kind === 'folder') {
          return folderRow(item.folder, {
            cells: {
              status: { label: EMPTY_CELL_PLACEHOLDER },
              updated: timeCell(item.folder.updatedAt),
              /** A folder's location is its parent's path, not its own. */
              location: isSearching
                ? { label: folderLocationLabel(item.folder.parentId, folderById, ROOT_LABEL) }
                : EMPTY_LOCATION_CELL,
            },
          })
        }

        const { workflow } = item
        return {
          id: workflow.id,
          cells: {
            name: { icon: WORKFLOW_ICON, label: workflow.name },
            status: workflow.isDeployed
              ? { icon: DEPLOYED_DOT, label: 'Deployed' }
              : { icon: DRAFT_DOT, label: 'Draft' },
            updated: timeCell(workflow.lastModified),
            location: isSearching
              ? { label: folderLocationLabel(workflow.folderId, folderById, ROOT_LABEL) }
              : EMPTY_LOCATION_CELL,
          },
        }
      }),
    [sortedEntries, folderById, isSearching]
  )

  /** Layered over {@link baseRows} so a keystroke in the rename field rebuilds one cell. */
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

  const startFolderRename = useCallback(
    (folder: WorkflowFolder) => listRename.startRename(folderRowId(folder.id), folder.name),
    [listRename.startRename]
  )

  const currentFolder = currentFolderId ? folderById.get(currentFolderId) : undefined

  const currentFolderActions: DropdownOption[] | undefined = useMemo(() => {
    if (!currentFolder) return undefined
    return [
      {
        label: 'Rename',
        icon: Pencil,
        disabled: !canEdit,
        onClick: () => breadcrumbRename.startRename(currentFolder.id, currentFolder.name),
      },
      {
        label: 'Delete',
        icon: Trash,
        disabled: !canEdit,
        /** The only way to delete the folder you are inside — its own row is not in the list. */
        onClick: () => {
          setActiveItem({ kind: 'folder', folder: currentFolder })
          setIsDeleteModalOpen(true)
        },
      },
    ]
  }, [currentFolder, canEdit, breadcrumbRename.startRename])

  const currentFolderEditing = useMemo(() => {
    if (!currentFolderId || breadcrumbRename.editingId !== currentFolderId) return undefined
    return {
      isEditing: true,
      value: breadcrumbRename.editValue,
      onChange: breadcrumbRename.setEditValue,
      onSubmit: breadcrumbRename.submitRename,
      onCancel: breadcrumbRename.cancelRename,
      disabled: breadcrumbRename.isSaving,
    }
  }, [
    currentFolderId,
    breadcrumbRename.editingId,
    breadcrumbRename.editValue,
    breadcrumbRename.isSaving,
    breadcrumbRename.setEditValue,
    breadcrumbRename.submitRename,
    breadcrumbRename.cancelRename,
  ])

  const breadcrumbs = useMemo(
    () =>
      folderBreadcrumbItems({
        breadcrumbs: folderChain,
        rootLabel: ROOT_LABEL,
        rootIcon: Workflow,
        onNavigate: openFolder,
        currentFolderActions,
        currentFolderEditing,
      }),
    [folderChain, openFolder, currentFolderActions, currentFolderEditing]
  )

  const searchConfig: SearchConfig = useMemo(
    () => ({
      value: urlSearchTerm,
      onChange: setSearchTerm,
      onClearAll: () => setSearchTerm(''),
      placeholder: 'Search workflows...',
    }),
    [urlSearchTerm, setSearchTerm]
  )

  const listState = resourceListState({
    rowCount: rows.length,
    isLoading,
    isPlaceholderData,
    error,
    search: debouncedSearchTerm,
    filterCount: 0,
    folderId: currentFolderId,
    foldersResolved,
  })

  const handleRowClick = useCallback(
    (rowId: string) => {
      if (isRowContextMenuOpen || listRename.editingId === rowId) return
      const parsed = parseFolderedRowId(rowId)
      if (parsed.kind === 'folder') {
        openFolder(parsed.id)
        return
      }
      router.push(`/workspace/${workspaceId}/w/${parsed.id}`)
    },
    [isRowContextMenuOpen, listRename.editingId, router, workspaceId, openFolder]
  )

  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent, rowId: string) => {
      const parsed = parseFolderedRowId(rowId)
      if (parsed.kind === 'folder') {
        const folder = folderById.get(parsed.id)
        if (!folder) return
        setActiveItem({ kind: 'folder', folder })
      } else {
        const workflow = workflowById.get(parsed.id)
        if (!workflow) return
        setActiveItem({ kind: 'workflow', workflow })
      }
      handleRowCtxMenu(e)
    },
    [folderById, workflowById, handleRowCtxMenu]
  )

  const handleCreateWorkflow = useCallback(
    () => void handleCreateWorkflowInFolder(currentFolderId),
    [handleCreateWorkflowInFolder, currentFolderId]
  )

  const createFolderAsync = createFolder.mutateAsync
  const createFolderIn = useCallback(
    async (parentId: string | null) => {
      try {
        const folder = await createFolderAsync({
          workspaceId,
          resourceType: 'workflow',
          name: nextUntitledFolderName(folders, parentId),
          parentId: parentId ?? undefined,
        })
        /** A live search would hide the new row, and with it the rename field. */
        setSearchTerm('')
        if (parentId === currentFolderId) startFolderRename(folder)
      } catch (err) {
        logger.error('Failed to create folder:', err)
        toast.error(getErrorMessage(err, 'Failed to create folder'), { duration: 5000 })
      }
    },
    [workspaceId, folders, currentFolderId, createFolderAsync, setSearchTerm, startFolderRename]
  )
  const handleCreateFolder = useCallback(
    () => void createFolderIn(currentFolderId),
    [createFolderIn, currentFolderId]
  )

  const handleImportWorkflow = useCallback(() => importInputRef.current?.click(), [])

  /** Move targets: every folder for a workflow; for a folder, everything outside its subtree. */
  const moveOptions: MoveOptionNode[] = useMemo(() => {
    if (!activeItem) return []
    if (activeItem.kind === 'workflow') return buildMoveOptions({ folders, rootLabel: ROOT_LABEL })
    return buildMoveOptionsExcludingSubtrees({
      folders,
      rootLabel: ROOT_LABEL,
      excludeFolderIds: [activeItem.folder.id],
      descendantsByFolderId: descendantFolderIds,
    })
  }, [activeItem, folders, descendantFolderIds])

  const handleMove = useCallback(
    (optionValue: string) => {
      if (!activeItem) return
      const targetFolderId = parseMoveOptionValue(optionValue)
      if (activeItem.kind === 'workflow') {
        const current = workflowById.get(activeItem.workflow.id) ?? activeItem.workflow
        if ((current.folderId ?? null) === targetFolderId) return
        updateWorkflow.mutate({
          workspaceId,
          workflowId: activeItem.workflow.id,
          metadata: { folderId: targetFolderId },
        })
        return
      }
      const current = folderById.get(activeItem.folder.id) ?? activeItem.folder
      if ((current.parentId ?? null) === targetFolderId) return
      updateFolder.mutate(
        {
          workspaceId,
          resourceType: 'workflow',
          id: activeItem.folder.id,
          updates: { parentId: targetFolderId },
        },
        {
          onError: (err) =>
            toast.error(getErrorMessage(err, 'Failed to move folder'), { duration: 5000 }),
        }
      )
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutation objects are unstable; mutate is stable in v5
    [activeItem, workspaceId, workflowById, folderById]
  )

  const handleOpenActive = useCallback(() => {
    if (!activeItem) return
    if (activeItem.kind === 'folder') {
      openFolder(activeItem.folder.id)
      return
    }
    window.open(
      `/workspace/${workspaceId}/w/${activeItem.workflow.id}`,
      '_blank',
      'noopener,noreferrer'
    )
  }, [activeItem, openFolder, workspaceId])

  const handleRenameActive = useCallback(() => {
    if (!activeItem) return
    if (activeItem.kind === 'folder') startFolderRename(activeItem.folder)
    else listRename.startRename(activeItem.workflow.id, activeItem.workflow.name)
  }, [activeItem, startFolderRename, listRename.startRename])

  const handleDuplicateActive = useCallback(() => {
    if (!activeItem) return
    if (activeItem.kind === 'folder') void handleDuplicateFolder()
    else void handleDuplicateWorkflow([activeItem.workflow.id])
  }, [activeItem, handleDuplicateFolder, handleDuplicateWorkflow])

  const handleExportActive = useCallback(() => {
    if (!activeItem) return
    if (activeItem.kind === 'folder') void handleExportFolder()
    else void handleExportWorkflow([activeItem.workflow.id])
  }, [activeItem, handleExportFolder, handleExportWorkflow])

  const handleConfirmDelete = useCallback(async () => {
    if (!activeItem) return
    if (activeItem.kind === 'folder') await handleDeleteFolder()
    else await handleDeleteWorkflow()
  }, [activeItem, handleDeleteFolder, handleDeleteWorkflow])

  const activeLocked =
    activeItem?.kind === 'workflow'
      ? isWorkflowEffectivelyLocked(activeItem.workflow, folderMap)
      : activeItem?.kind === 'folder'
        ? isFolderEffectivelyLocked(activeItem.folder, folderMap)
        : false

  const activeCanDelete =
    activeItem?.kind === 'workflow'
      ? canDeleteWorkflows([activeItem.workflow.id])
      : activeItem?.kind === 'folder'
        ? canDeleteFolder(activeItem.folder.id)
        : false

  const headerActions: ResourceAction[] = useMemo(
    () => [
      {
        text: isImporting ? 'Importing...' : 'Import workflow',
        icon: Upload,
        onSelect: handleImportWorkflow,
        disabled: !canEdit || isImporting,
      },
      {
        text: 'New folder',
        icon: FolderPlus,
        onSelect: handleCreateFolder,
        disabled: !canEdit || createFolder.isPending,
      },
      {
        text: 'New workflow',
        icon: Plus,
        onSelect: handleCreateWorkflow,
        disabled: !canEdit || isCreatingWorkflow,
        variant: 'primary',
      },
    ],
    [
      isImporting,
      canEdit,
      handleImportWorkflow,
      handleCreateFolder,
      handleCreateWorkflow,
      createFolder.isPending,
      isCreatingWorkflow,
    ]
  )

  return (
    <>
      <Resource>
        <ResourceListHeader
          icon={Workflow}
          title={ROOT_LABEL}
          breadcrumbs={breadcrumbs}
          actions={headerActions}
        />
        <Resource.Options search={searchConfig} />
        <Resource.Table
          columns={isSearching ? SEARCH_COLUMNS : WORKFLOW_COLUMNS}
          rows={rows}
          emptyState={
            listState === 'empty' ? (
              <EmptyState
                title='Workflows'
                description='Connect blocks, models, and integrations into agent logic.'
                graphic={<Workflow className='size-[32px] text-[var(--text-icon)]' />}
                action={
                  <Chip
                    variant='primary'
                    leftIcon={Plus}
                    onClick={handleCreateWorkflow}
                    disabled={!canEdit || isCreatingWorkflow}
                  >
                    New workflow
                  </Chip>
                }
              />
            ) : listState === 'no-results' ? (
              <ResourceNoResults
                search={debouncedSearchTerm}
                filterCount={0}
                onClear={() => setSearchTerm('')}
              />
            ) : undefined
          }
          onRowClick={handleRowClick}
          onRowContextMenu={handleRowContextMenu}
        />
      </Resource>

      <input
        ref={importInputRef}
        type='file'
        accept='.json,.zip'
        multiple
        className='hidden'
        onChange={handleImportFileChange}
      />

      <ContextMenu
        isOpen={isRowContextMenuOpen}
        position={rowContextMenuPosition}
        menuRef={rowContextMenuRef}
        onClose={closeRowContextMenu}
        onOpenInNewTab={handleOpenActive}
        openInNewTabLabel={activeItem?.kind === 'folder' ? 'Open' : 'Open in new tab'}
        showOpenInNewTab
        onRename={handleRenameActive}
        showRename
        disableRename={!canEdit || activeLocked}
        onCreate={
          activeItem?.kind === 'folder'
            ? () => void handleCreateWorkflowInFolder(activeItem.folder.id)
            : undefined
        }
        showCreate={activeItem?.kind === 'folder'}
        disableCreate={!canEdit || activeLocked || isCreatingWorkflow}
        onCreateFolder={
          activeItem?.kind === 'folder'
            ? () => void createFolderIn(activeItem.folder.id)
            : undefined
        }
        showCreateFolder={activeItem?.kind === 'folder'}
        disableCreateFolder={!canEdit || activeLocked || createFolder.isPending}
        onDuplicate={handleDuplicateActive}
        showDuplicate
        disableDuplicate={!canEdit || isDuplicatingWorkflow || isDuplicatingFolder}
        onMove={canEdit && !activeLocked ? handleMove : undefined}
        moveOptions={moveOptions}
        onExport={handleExportActive}
        showExport
        disableExport={!canEdit}
        onDelete={() => setIsDeleteModalOpen(true)}
        showDelete={canEdit}
        disableDelete={!activeCanDelete || activeLocked}
      />

      <DeleteModal
        isOpen={isDeleteModalOpen}
        onClose={closeDeleteModal}
        onConfirm={handleConfirmDelete}
        isDeleting={isDeletingWorkflow || isDeletingFolder}
        itemType={activeItem?.kind === 'folder' ? 'folder' : 'workflow'}
        itemName={
          activeItem?.kind === 'folder' ? activeItem.folder.name : activeItem?.workflow.name
        }
      />
    </>
  )
}
