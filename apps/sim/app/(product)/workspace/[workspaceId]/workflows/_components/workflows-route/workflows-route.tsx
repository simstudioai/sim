'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { Breadcrumbs } from '@sim/emcn/breadcrumbs'
import { Button } from '@sim/emcn/button'
import { ActionMenu, type MenuAction } from '@sim/emcn/menu/action-menu'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { SearchField } from '@sim/emcn/search-field'
import { getErrorMessage } from '@sim/utils/errors'
import { usePathname, useSearchParams } from 'next/navigation'
import { parseAsString, useQueryStates } from 'nuqs'
import { toast } from '@/lib/toast/sink'
import { ControlBar } from '@/app/(product)/_components/control-bar/control-bar'
import {
  descendantIndex,
  folderLocation,
  folderPath,
  folderRowId,
  moveDestinations,
  parseRowId,
  type SortEntry,
  scopeItems,
  selectionAction,
  sortEntries,
  splitRowIds,
} from '@/app/(product)/workspace/[workspaceId]/_components/resource-table/folder-tree'
import {
  folderHref,
  folderTrail,
  noResults,
  sortActions,
} from '@/app/(product)/workspace/[workspaceId]/_components/resource-table/list-menus'
import {
  RenameDialog,
  useMinuteClock,
} from '@/app/(product)/workspace/[workspaceId]/_components/resource-table/rename-dialog'
import {
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
import {
  GlobalCommandsProvider,
  useRegisterGlobalCommands,
} from '@/app/(product)/workspace/[workspaceId]/workflows/_components/global-commands/global-commands'
import {
  useWorkflowListOperations,
  workflowEditorPath,
} from '@/app/(product)/workspace/[workspaceId]/workflows/_components/workflows-route/operations'
import {
  type ResourceFolder,
  SEARCH_DEBOUNCE_MS,
  useDebouncedSearchSetter,
  useFolderParam,
  useFolders,
  useInlineRename,
  useSearchFilterValue,
  useUpdateFolder,
  useUrlSort,
} from '@/platform/lib/data/folders'
import { usePinItem, usePinnedIds, useUnpinItem } from '@/platform/lib/data/pins'
import {
  createCommand,
  createSortParams,
  isFolderEffectivelyLocked,
  isFolderOrAncestorLocked,
  isWorkflowEffectivelyLocked,
  useCanDelete,
  useDeleteSelection,
  useExportSelection,
  useExportWorkflow,
  useUpdateWorkflow,
  useUserPermissionsContext,
  useWorkflows,
  type WorkflowMetadata,
} from '@/platform/lib/data/workflows'
import { platformHref, publicAssetPath } from '@/platform/lib/navigation'
import { formatRelativeTime } from '@/platform/shared/time'

const ROOT_LABEL = 'Workflows'
const ROW_MIME = 'application/x-sim-workspace-workflow-rows'
const EMPTY_WORKFLOWS: WorkflowMetadata[] = []
const EMPTY_FOLDERS: ResourceFolder[] = []
const NO_IDS: string[] = []
/** Legacy's rename inputs: a workflow's name takes 100 characters, a folder's 50. */
const WORKFLOW_NAME_MAX = 100
const FOLDER_NAME_MAX = 50
const LAST_WORKFLOW_REASON = 'A workspace keeps at least one workflow.'

const SORT_COLUMNS = ['name', 'created', 'updated'] as const
/** A clean URL lists the most recently updated first, as Tables does. */
const sortParams = createSortParams(SORT_COLUMNS, { column: 'updated', direction: 'desc' })
const listParsers = { search: parseAsString.withDefault('') }
/** Search and sort are view state: clean URLs, no back-stack churn. */
const URL_KEYS = { history: 'replace', clearOnDefault: true } as const

const SORTS = [
  { id: 'name', label: 'Name' },
  { id: 'created', label: 'Created' },
  { id: 'updated', label: 'Last Updated' },
] as const
const COLUMNS: readonly ResourceColumn[] = [
  { id: 'created', label: 'Created', optional: true },
  { id: 'updated', label: 'Last Updated', narrow: true },
]
const LOCATION_COLUMN: ResourceColumn = {
  id: 'location',
  label: 'Location',
  width: 'wide',
  optional: true,
}

type Item =
  | { kind: 'workflow'; workflow: WorkflowMetadata }
  | { kind: 'folder'; folder: ResourceFolder }

/** The rows a delete removes, named in the order the reader picked them. */
interface DeleteTarget {
  workflowIds: string[]
  folderIds: string[]
  names: string[]
  /** The open folder, deleted from its crumb: the list then steps up to its parent. */
  openFolder?: ResourceFolder
}

function timeOf(value: Date | string) {
  return new Date(value).getTime()
}

/** Legacy's delete modal, in words: its title by what is selected and how many. */
function deleteTitle(target: DeleteTarget) {
  const multiple = target.names.length > 1
  if (target.workflowIds.length && target.folderIds.length) return 'Delete items'
  if (target.folderIds.length) return multiple ? 'Delete folders' : 'Delete folder'
  return multiple ? 'Delete workflows' : 'Delete workflow'
}

function deleteDescription(target: DeleteTarget) {
  const names = target.names.join(', ')
  const subject = names ? names : 'the selected items'
  const warning =
    target.workflowIds.length && target.folderIds.length
      ? 'All selected workflows and folders, including their contents, will be archived.'
      : target.folderIds.length
        ? target.names.length > 1
          ? 'All workflows and contents within these folders will be archived.'
          : 'All associated workflows and contents will be archived.'
        : 'All associated blocks, executions, and configuration will be removed.'
  return `Are you sure you want to delete ${subject}? ${warning} You can restore it from Recently deleted in Settings.`
}

interface NewWorkflowShortcutProps {
  onCreate: () => void
}

/** Legacy's Mod+Shift+P: a new workflow, as the sidebar's command creates one. */
function NewWorkflowShortcut({ onCreate }: NewWorkflowShortcutProps) {
  useRegisterGlobalCommands(() => [createCommand({ id: 'add-workflow', handler: onCreate })])
  return null
}

interface WorkflowsRouteProps {
  workspaceId: string
}

/**
 * The workspace's workflows and workflow folders as one list. Folders open in place and workflows
 * open the editor; search spans every folder. Every command the legacy sidebar offers on a
 * workflow or folder works here (create, rename, lock, duplicate, export, import, move, delete with
 * the last-workflow rule), alongside pins, moves by drag and the selection's bulk commands.
 */
export function WorkflowsRoute({ workspaceId }: WorkflowsRouteProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const now = useMinuteClock()
  const permissions = useUserPermissionsContext()
  const canEdit = permissions.canEdit
  const canAdmin = permissions.canAdmin

  const workflowsQuery = useWorkflows(workspaceId)
  const allWorkflows = workflowsQuery.data ?? EMPTY_WORKFLOWS
  const workflows = useMemo(
    () => allWorkflows.filter((workflow) => workflow.workspaceId === workspaceId),
    [allWorkflows, workspaceId]
  )
  const foldersQuery = useFolders(workspaceId, { resourceType: 'workflow' })
  const folders = foldersQuery.data ?? EMPTY_FOLDERS
  const foldersResolved = foldersQuery.isSuccess && !foldersQuery.isPlaceholderData
  const folderById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders])
  const folderMap = useMemo(() => Object.fromEntries(folderById), [folderById])
  const workflowById = useMemo(
    () => new Map(workflows.map((workflow) => [workflow.id, workflow])),
    [workflows]
  )
  const descendants = useMemo(() => descendantIndex(folders), [folders])
  /** Folders holding a workflow anywhere beneath them: only those can be duplicated or exported. */
  const nonEmptyFolders = useMemo(() => {
    const result = new Set<string>()
    for (const workflow of workflows) {
      for (const folder of folderPath(folderById, workflow.folderId)) result.add(folder.id)
    }
    return result
  }, [workflows, folderById])
  const [folderId, setFolderId] = useFolderParam(foldersResolved ? folderById : null)
  const pinnedWorkflows = usePinnedIds(workspaceId, 'workflow')
  const pinnedFolders = usePinnedIds(workspaceId, 'folder')
  const pinItem = usePinItem()
  const unpinItem = useUnpinItem()

  const updateWorkflow = useUpdateWorkflow()
  const updateFolder = useUpdateFolder()
  const ops = useWorkflowListOperations(workspaceId)
  const { canDeleteWorkflows } = useCanDelete({ workspaceId })
  const exportWorkflow = useExportWorkflow({ workspaceId })
  const exportSelection = useExportSelection({ workspaceId })
  const exporting =
    exportWorkflow.isExporting || exportSelection.isExporting || ops.exportingFolderId !== null

  const [filters, setFilters] = useQueryStates(listParsers, URL_KEYS)
  const { sort, dir, onSort } = useUrlSort(sortParams, URL_KEYS)
  const setSearch = useDebouncedSearchSetter((value, options) =>
    setFilters({ search: value }, options)
  )
  const search = useSearchFilterValue(filters.search, SEARCH_DEBOUNCE_MS)
  const searching = search.trim().length > 0

  const [confirm, setConfirm] = useState<DeleteTarget | null>(null)
  const [renamingFolder, setRenamingFolder] = useState<ResourceFolder | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const deleteSelection = useDeleteSelection({
    workspaceId,
    workflowIds: confirm?.workflowIds ?? NO_IDS,
    folderIds: confirm?.folderIds ?? NO_IDS,
  })

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
          .mutateAsync({ workspaceId, id: row.id, updates: { name } })
          .catch((error: unknown) => {
            toast.error(getErrorMessage(error, 'Failed to rename folder'))
            throw error
          })
      return updateWorkflow
        .mutateAsync({ workspaceId, workflowId: row.id, metadata: { name } })
        .catch((error: unknown) => {
          toast.error(getErrorMessage(error, 'Failed to rename workflow'))
          throw error
        })
    },
  })

  const items = useMemo(() => {
    const parentOfWorkflow = (workflow: WorkflowMetadata) => {
      const parent = workflow.folderId ?? null
      return !foldersResolved || !parent || folderById.has(parent) ? parent : null
    }
    const shownFolders = scopeItems(folders, {
      folderId,
      search,
      parentOf: (folder) => folder.parentId ?? null,
      searchText: (folder) => [folder.name],
    })
    const shownWorkflows = scopeItems(workflows, {
      folderId,
      search,
      parentOf: parentOfWorkflow,
      searchText: (workflow) => [workflow.name],
    })
    const keyOf = (name: string, created: Date, updated: Date) =>
      sort === 'created' ? timeOf(created) : sort === 'updated' ? timeOf(updated) : name
    const entries: SortEntry<Item>[] = [
      ...shownFolders.map((folder) => ({
        item: { kind: 'folder' as const, folder },
        pinned: !searching && pinnedFolders.has(folder.id),
        name: folder.name,
        key: keyOf(folder.name, folder.createdAt, folder.updatedAt),
      })),
      ...shownWorkflows.map((workflow) => ({
        item: { kind: 'workflow' as const, workflow },
        pinned: !searching && pinnedWorkflows.has(workflow.id),
        name: workflow.name,
        key: keyOf(workflow.name, workflow.createdAt, workflow.lastModified),
      })),
    ]
    return sortEntries(entries, dir).map((entry) => entry.item)
  }, [
    folders,
    workflows,
    folderId,
    search,
    searching,
    folderById,
    foldersResolved,
    pinnedFolders,
    pinnedWorkflows,
    sort,
    dir,
  ])

  const rowIds = useMemo(
    () =>
      items.map((item) =>
        item.kind === 'folder' ? folderRowId(item.folder.id) : item.workflow.id
      ),
    [items]
  )

  /** Every workflow a delete would archive: the ones picked and the ones inside picked folders. */
  const affectedWorkflowIds = (workflowIds: readonly string[], folderIds: readonly string[]) => {
    const inFolders = new Set(folderIds)
    for (const id of folderIds)
      for (const nested of descendants.get(id) ?? []) inFolders.add(nested)
    const affected = new Set(workflowIds)
    for (const workflow of workflows)
      if (workflow.folderId && inFolders.has(workflow.folderId)) affected.add(workflow.id)
    return [...affected]
  }

  const isRowLocked = (rowId: string) => {
    const row = parseRowId(rowId)
    return row.kind === 'folder'
      ? isFolderEffectivelyLocked(folderById.get(row.id), folderMap)
      : isWorkflowEffectivelyLocked(workflowById.get(row.id), folderMap)
  }

  /** Why a delete cannot run, or `undefined` when it can. */
  const deleteBlock = (workflowIds: readonly string[], folderIds: readonly string[]) => {
    if (!canEdit) return 'You need edit access to delete.'
    if (
      workflowIds.some((id) => isRowLocked(id)) ||
      folderIds.some((id) => isRowLocked(folderRowId(id)))
    )
      return workflowIds.length + folderIds.length > 1
        ? 'Unlock the selected items to delete them.'
        : 'Unlock it to delete it.'
    const affected = affectedWorkflowIds(workflowIds, folderIds)
    if (affected.length > 0 && !canDeleteWorkflows(affected)) return LAST_WORKFLOW_REASON
    return undefined
  }

  const requestDelete = (
    workflowIds: string[],
    folderIds: string[],
    openFolderTarget?: ResourceFolder
  ) => {
    if (!workflowIds.length && !folderIds.length) return
    const blocked = deleteBlock(workflowIds, folderIds)
    if (blocked) {
      toast.error(blocked)
      return
    }
    setConfirm({
      workflowIds,
      folderIds,
      names: [
        ...folderIds.flatMap((id) => folderById.get(id)?.name ?? []),
        ...workflowIds.flatMap((id) => workflowById.get(id)?.name ?? []),
      ],
      openFolder: openFolderTarget,
    })
  }

  const requestBulkDelete = () => {
    const { folderIds, resourceIds } = splitRowIds(selection.selected)
    requestDelete(resourceIds, folderIds)
  }

  const selection = useResourceSelection({
    rowIds,
    onDelete: canEdit ? requestBulkDelete : undefined,
    keyboardBlocked: listRename.editingId !== null || confirm !== null || renamingFolder !== null,
  })

  const moveRows = (move: RowMove, target: string | null) => {
    const destination = target ? folderById.get(target) : undefined
    if (destination && isFolderEffectivelyLocked(destination, folderMap)) {
      toast.error(`${destination.name} is locked`)
      return
    }
    let lockedCount = 0
    const workflowIds = move.resourceIds.filter((id) => {
      const workflow = workflowById.get(id)
      if (!workflow || (workflow.folderId ?? null) === target) return false
      if (isWorkflowEffectivelyLocked(workflow, folderMap)) {
        lockedCount += 1
        return false
      }
      return true
    })
    const folderIds = move.folderIds.filter((id) => {
      const folder = folderById.get(id)
      if (!folder || (folder.parentId ?? null) === target) return false
      if (target && (id === target || descendants.get(id)?.has(target))) return false
      if (isFolderEffectivelyLocked(folder, folderMap)) {
        lockedCount += 1
        return false
      }
      return true
    })
    if (lockedCount)
      toast.error(
        lockedCount === 1
          ? 'A locked item was not moved.'
          : `${lockedCount} locked items were not moved.`
      )
    if (!workflowIds.length && !folderIds.length) return
    selection.clear()
    void ops.moveInto(workflowIds, folderIds, target)
  }

  const drag = useResourceDrag({
    mime: ROW_MIME,
    enabled: canEdit,
    renamingId: listRename.editingId,
    canDrag: (rowId) => !isRowLocked(rowId),
    rowIds,
    selection: canEdit ? selection : undefined,
    parentOf: (rowId) => {
      const row = parseRowId(rowId)
      return row.kind === 'folder'
        ? folderById.get(row.id)?.parentId
        : workflowById.get(row.id)?.folderId
    },
    descendants,
    labelOf: (rowId) => {
      const row = parseRowId(rowId)
      return row.kind === 'folder'
        ? (folderById.get(row.id)?.name ?? 'Folder')
        : (workflowById.get(row.id)?.name ?? 'Workflow')
    },
    onMove: moveRows,
    currentFolderId: folderId,
    bodyFolderId: searching ? undefined : folderId,
    onNavigate: (id, options) => setFolderId(id, options),
  })

  const currentFolder = folderId ? folderById.get(folderId) : undefined
  const currentLocked = isFolderEffectivelyLocked(currentFolder, folderMap)

  const createFolderIn = async (parentId: string | null) => {
    const folder = await ops.createFolder(parentId)
    if (!folder) return
    if (parentId !== folderId) openFolder(parentId)
    else setSearch('')
    listRename.startRename(folderRowId(folder.id), folder.name)
  }

  const editorHref = (workflowId: string) =>
    platformHref(workflowEditorPath(workspaceId, workflowId), searchParams)

  const togglePin = (resourceType: 'workflow' | 'folder', id: string, pinned: boolean) =>
    (pinned ? unpinItem : pinItem).mutate({ workspaceId, resourceType, resourceId: id })

  const copyId = (id: string) => {
    void navigator.clipboard.writeText(id).catch(() => toast.error('Failed to copy ID'))
  }

  const toggleWorkflowLock = (workflow: WorkflowMetadata) => {
    if (isFolderOrAncestorLocked(workflow.folderId, folderMap)) return
    updateWorkflow.mutate(
      { workspaceId, workflowId: workflow.id, metadata: { locked: !workflow.locked } },
      { onError: (error) => toast.error(getErrorMessage(error, 'Failed to update the lock')) }
    )
  }

  const toggleFolderLock = (folder: ResourceFolder) => {
    if (isFolderOrAncestorLocked(folder.parentId, folderMap)) return
    updateFolder.mutate(
      { workspaceId, id: folder.id, updates: { locked: !folder.locked } },
      { onError: (error) => toast.error(getErrorMessage(error, 'Failed to update the lock')) }
    )
  }

  /** Legacy's export: workflows as JSON (or a ZIP of several), one folder as its own ZIP. */
  const exportRows = async (workflowIds: string[], folderIds: string[]) => {
    try {
      if (folderIds.length === 0) await exportWorkflow.handleExportWorkflow(workflowIds)
      else if (workflowIds.length === 0 && folderIds.length === 1)
        await ops.exportFolder(folderIds[0])
      else await exportSelection.handleExportSelection(workflowIds, folderIds)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to export'))
    }
  }

  const hasExportable = (workflowIds: readonly string[], folderIds: readonly string[]) =>
    workflowIds.length > 0 || folderIds.some((id) => nonEmptyFolders.has(id))

  const lockActions = (options: {
    locked: boolean
    inherited: boolean
    noun: 'workflow' | 'folder'
    onToggle: () => void
  }): MenuAction => ({
    id: 'lock',
    label: options.locked ? 'Unlock' : 'Lock',
    icon: 'lock',
    disabled: !canAdmin || options.inherited,
    disabledReason: !canAdmin
      ? 'Only workspace admins can lock or unlock.'
      : options.inherited
        ? `A folder above this ${options.noun} is locked.`
        : undefined,
    onSelect: options.onToggle,
  })

  const deleteAction = (
    workflowIds: string[],
    folderIds: string[],
    label: string,
    options: { openFolder?: ResourceFolder; pending?: boolean } = {}
  ): MenuAction => {
    const blocked = canEdit ? deleteBlock(workflowIds, folderIds) : undefined
    return {
      id: 'delete',
      label,
      icon: 'I061',
      destructive: true,
      separatorBefore: true,
      disabled: !canEdit || blocked !== undefined || options.pending,
      disabledReason: blocked,
      onSelect: () => requestDelete(workflowIds, folderIds, options.openFolder),
    }
  }

  const selectionMove = (folderIds: readonly string[], workflowIds: readonly string[]) =>
    ({
      id: 'move',
      label: selectionAction('Move', folderIds.length + workflowIds.length, 'Move to'),
      icon: 'I100',
      children: moveDestinations({
        folders,
        rootLabel: ROOT_LABEL,
        exclude: folderIds,
        descendants,
        onMove: (target) =>
          moveRows({ folderIds: [...folderIds], resourceIds: [...workflowIds] }, target),
      }),
    }) satisfies MenuAction

  const multiActions = (): MenuAction[] => {
    const { folderIds, resourceIds } = splitRowIds(selection.selected)
    const count = selection.selected.size
    const exportable = hasExportable(resourceIds, folderIds)
    return [
      ...(canEdit ? [selectionMove(folderIds, resourceIds)] : []),
      {
        id: 'duplicate',
        label: selectionAction('Duplicate', count),
        icon: 'duplicate',
        disabled: !canEdit || ops.isDuplicating || !exportable,
        onSelect: () => void ops.duplicate(resourceIds, folderIds),
      },
      {
        id: 'export',
        label: selectionAction('Export', count),
        icon: 'I049',
        disabled: !canEdit || exporting || !exportable,
        onSelect: () => void exportRows(resourceIds, folderIds),
      },
      deleteAction(resourceIds, folderIds, selectionAction('Delete', count)),
    ]
  }

  const workflowActions = (workflow: WorkflowMetadata): MenuAction[] => {
    if (selection.selected.size > 1 && selection.selected.has(workflow.id)) return multiActions()
    const pinned = pinnedWorkflows.has(workflow.id)
    const locked = isWorkflowEffectivelyLocked(workflow, folderMap)
    const inherited = isFolderOrAncestorLocked(workflow.folderId, folderMap)
    return [
      {
        id: 'open-new-tab',
        label: 'Open in new tab',
        icon: 'I037',
        // A new window takes the URL as written, so it needs the base path the router adds.
        onSelect: () => void window.open(publicAssetPath(editorHref(workflow.id)), '_blank'),
      },
      {
        id: 'rename',
        label: 'Rename',
        icon: 'I036',
        disabled: !canEdit || locked,
        disabledReason: canEdit && locked ? 'Unlock it to rename it.' : undefined,
        onSelect: () => listRename.startRename(workflow.id, workflow.name),
      },
      lockActions({
        locked,
        inherited,
        noun: 'workflow',
        onToggle: () => toggleWorkflowLock(workflow),
      }),
      {
        id: 'duplicate',
        label: 'Duplicate',
        icon: 'duplicate',
        disabled: !canEdit || ops.isDuplicating,
        onSelect: () => void ops.duplicate([workflow.id], []),
      },
      {
        id: 'export',
        label: 'Export',
        icon: 'I049',
        disabled: !canEdit || exporting,
        onSelect: () => void exportRows([workflow.id], []),
      },
      ...(canEdit && !locked ? [selectionMove([], [workflow.id])] : []),
      {
        id: 'pin',
        label: pinned ? 'Unpin' : 'Pin',
        icon: 'I131',
        onSelect: () => togglePin('workflow', workflow.id, pinned),
      },
      { id: 'copy-id', label: 'Copy ID', icon: 'I006', onSelect: () => copyId(workflow.id) },
      deleteAction([workflow.id], [], 'Delete'),
    ]
  }

  const folderActions = (folder: ResourceFolder, inList: boolean): MenuAction[] => {
    if (inList && selection.selected.size > 1 && selection.selected.has(folderRowId(folder.id)))
      return multiActions()
    const pinned = pinnedFolders.has(folder.id)
    const locked = isFolderEffectivelyLocked(folder, folderMap)
    const inherited = isFolderOrAncestorLocked(folder.parentId, folderMap)
    const exportable = nonEmptyFolders.has(folder.id)
    const lockedReason = canEdit && locked ? 'Unlock the folder first.' : undefined
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
        id: 'rename',
        label: 'Rename',
        icon: 'I036',
        disabled: !canEdit || locked,
        disabledReason: lockedReason,
        onSelect: () =>
          inList
            ? listRename.startRename(folderRowId(folder.id), folder.name)
            : setRenamingFolder(folder),
      },
      {
        id: 'new-workflow',
        label: 'New workflow',
        icon: 'I074',
        disabled: !canEdit || locked || ops.isCreatingWorkflow,
        disabledReason: lockedReason,
        onSelect: () => ops.createWorkflow(folder.id),
      },
      {
        id: 'new-folder',
        label: 'New folder',
        icon: 'I100',
        disabled: !canEdit || locked || ops.isCreatingFolder,
        disabledReason: lockedReason,
        onSelect: () => void createFolderIn(folder.id),
      },
      lockActions({ locked, inherited, noun: 'folder', onToggle: () => toggleFolderLock(folder) }),
      {
        id: 'duplicate',
        label: 'Duplicate',
        icon: 'duplicate',
        disabled: !canEdit || ops.isDuplicating || !exportable,
        disabledReason: canEdit && !exportable ? 'This folder has no workflows.' : undefined,
        onSelect: () => void ops.duplicate([], [folder.id]),
      },
      {
        id: 'export',
        label: 'Export',
        icon: 'I049',
        disabled: !canEdit || exporting || !exportable,
        disabledReason: canEdit && !exportable ? 'This folder has no workflows.' : undefined,
        onSelect: () => void exportRows([], [folder.id]),
      },
      ...(inList && canEdit && !locked ? [selectionMove([folder.id], [])] : []),
      {
        id: 'pin',
        label: pinned ? 'Unpin' : 'Pin',
        icon: 'I131',
        onSelect: () => togglePin('folder', folder.id, pinned),
      },
      { id: 'copy-id', label: 'Copy ID', icon: 'I006', onSelect: () => copyId(folder.id) },
      deleteAction([], [folder.id], 'Delete', { openFolder: inList ? undefined : folder }),
    ]
  }

  const rows: ResourceRow[] = items.map((item) => {
    if (item.kind === 'folder') {
      const { folder } = item
      return {
        id: folderRowId(folder.id),
        name: folder.name,
        icon: 'I100',
        folder: true,
        pinned: pinnedFolders.has(folder.id),
        locked: isFolderEffectivelyLocked(folder, folderMap),
        onOpen: () => openFolder(folder.id),
        cells: {
          created: formatRelativeTime(timeOf(folder.createdAt), now),
          updated: formatRelativeTime(timeOf(folder.updatedAt), now),
          location: searching && folderLocation(folderById, folder.parentId, ROOT_LABEL),
        },
      }
    }
    const { workflow } = item
    return {
      id: workflow.id,
      name: workflow.name,
      icon: 'I118',
      pinned: pinnedWorkflows.has(workflow.id),
      locked: isWorkflowEffectivelyLocked(workflow, folderMap),
      href: editorHref(workflow.id),
      cells: {
        created: formatRelativeTime(timeOf(workflow.createdAt), now),
        updated: formatRelativeTime(timeOf(workflow.lastModified), now),
        location: searching && folderLocation(folderById, workflow.folderId, ROOT_LABEL),
      },
    }
  })
  const columns = searching ? [...COLUMNS, LOCATION_COLUMN] : COLUMNS

  const chain = folderPath(folderById, folderId)
  const hrefFor = (id: string | null) => folderHref(pathname, searchParams, id)
  const createBlocked = !canEdit || currentLocked

  const newWorkflowAction: MenuAction = {
    id: 'new-workflow',
    label: 'New workflow',
    icon: 'I074',
    disabled: createBlocked || ops.isCreatingWorkflow,
    onSelect: () => ops.createWorkflow(folderId),
  }
  const newFolderAction: MenuAction = {
    id: 'new-folder',
    label: 'New folder',
    icon: 'I100',
    disabled: createBlocked || ops.isCreatingFolder,
    onSelect: () => void createFolderIn(folderId),
  }

  const controls = (
    <ControlBar
      search={
        <SearchField
          variant='quiet'
          label='Search workflows'
          placeholder='Search workflows…'
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
      <ActionMenu
        label='Sort workflows'
        icon='I050'
        tooltip
        align='end'
        actions={sortActions({ columns: SORTS, sort, dir, onSort })}
      />
      <Button
        variant='quiet'
        size='compact'
        icon='I117'
        disabled={createBlocked || ops.isImporting}
        onClick={() => fileInput.current?.click()}
      >
        {ops.isImporting ? 'Importing…' : 'Import'}
      </Button>
      <Button
        variant='quiet'
        size='compact'
        icon='I100'
        disabled={createBlocked || ops.isCreatingFolder}
        onClick={() => void createFolderIn(folderId)}
      >
        New folder
      </Button>
      <Button
        variant='secondary'
        size='compact'
        icon='I074'
        disabled={createBlocked || ops.isCreatingWorkflow}
        onClick={() => ops.createWorkflow(folderId)}
      >
        New workflow
      </Button>
    </ControlBar>
  )

  const read: WorkspaceRead = workflowsQuery.isError
    ? {
        status: 'error',
        message: 'Workflows could not be loaded.',
        retrying: workflowsQuery.isFetching,
        onRetry: () => void workflowsQuery.refetch(),
      }
    : workflowsQuery.isPending ||
        workflowsQuery.isPlaceholderData ||
        !foldersResolved ||
        permissions.isLoading
      ? { status: 'pending' }
      : { status: 'ready' }

  const empty = searching ? (
    <WorkspaceEmpty
      title={noResults(search, false).title}
      description={noResults(search, false).description}
      action={{ label: noResults(search, false).action, onClick: () => setSearch('') }}
    />
  ) : folderId ? (
    <WorkspaceEmpty title='This folder is empty' />
  ) : (
    <WorkspaceEmpty
      title='No workflows yet'
      description={
        canEdit ? 'Create one to start building.' : 'Ask a workspace admin to create one.'
      }
      action={
        canEdit && !ops.isCreatingWorkflow
          ? { label: 'Create workflow', onClick: () => ops.createWorkflow(null) }
          : undefined
      }
    />
  )

  const editingKind = listRename.editingId ? parseRowId(listRename.editingId).kind : null
  const nameMax = editingKind === 'folder' ? FOLDER_NAME_MAX : WORKFLOW_NAME_MAX
  const bulk = splitRowIds(selection.selected)

  return (
    <LiveWorkspacePage
      workspaceId={workspaceId}
      current='workflows'
      controls={controls}
      read={read}
    >
      <GlobalCommandsProvider>
        <NewWorkflowShortcut
          onCreate={() => {
            if (!createBlocked && !ops.isCreatingWorkflow) ops.createWorkflow(folderId)
          }}
        />
      </GlobalCommandsProvider>
      <ResourceTable
        label='Workflows'
        columns={columns}
        rows={rows}
        rowActions={(row) => {
          const parsed = parseRowId(row.id)
          if (parsed.kind === 'folder') {
            const folder = folderById.get(parsed.id)
            return folder ? folderActions(folder, true) : []
          }
          const workflow = workflowById.get(parsed.id)
          return workflow ? workflowActions(workflow) : []
        }}
        backgroundActions={[newWorkflowAction, newFolderAction]}
        selection={canEdit ? selection : undefined}
        bulkActions={
          canEdit
            ? [
                selectionMove(bulk.folderIds, bulk.resourceIds),
                {
                  id: 'duplicate',
                  label: 'Duplicate',
                  disabled: ops.isDuplicating || !hasExportable(bulk.resourceIds, bulk.folderIds),
                  onSelect: () => void ops.duplicate(bulk.resourceIds, bulk.folderIds),
                },
                {
                  id: 'export',
                  label: 'Export',
                  disabled: exporting || !hasExportable(bulk.resourceIds, bulk.folderIds),
                  onSelect: () => void exportRows(bulk.resourceIds, bulk.folderIds),
                },
                deleteAction(bulk.resourceIds, bulk.folderIds, 'Delete', {
                  pending: deleteSelection.isDeleting,
                }),
              ]
            : undefined
        }
        rename={
          listRename.editingId
            ? {
                rowId: listRename.editingId,
                value: listRename.editValue,
                saving: listRename.isSaving,
                onChange: (value) => listRename.setEditValue(value.slice(0, nameMax)),
                onSubmit: () => void listRename.submitRename(),
                onCancel: listRename.cancelRename,
              }
            : null
        }
        drag={drag}
        empty={empty}
      />
      <input
        ref={fileInput}
        type='file'
        accept='.json,.zip'
        multiple
        hidden
        disabled={createBlocked || ops.isImporting}
        onChange={(event) => void ops.importFiles(event, folderId)}
      />
      <ConfirmDialog
        target={confirm}
        onClose={() => setConfirm(null)}
        title={deleteTitle}
        description={deleteDescription}
        confirmLabel='Delete'
        pendingLabel='Deleting…'
        onConfirm={async (target) => {
          await deleteSelection.handleDeleteSelection()
          selection.clear()
          if (target.openFolder && folderId === target.openFolder.id)
            setFolderId(target.openFolder.parentId, { history: 'replace' })
        }}
      />
      <RenameDialog
        target={renamingFolder}
        noun='folder'
        maxLength={FOLDER_NAME_MAX}
        onClose={() => setRenamingFolder(null)}
        onRename={(id, name) => updateFolder.mutateAsync({ workspaceId, id, updates: { name } })}
      />
    </LiveWorkspacePage>
  )
}
