'use client'

import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Breadcrumbs } from '@sim/emcn/breadcrumbs'
import { Button } from '@sim/emcn/button'
import { Icon, type IconName } from '@sim/emcn/icon'
import { ActionMenu, type MenuAction } from '@sim/emcn/menu/action-menu'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { SearchField } from '@sim/emcn/search-field'
import { getErrorMessage } from '@sim/utils/errors'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { FindBar } from '@/components/find-bar/find-bar'
import { workspacePath } from '@/lib/navigation/paths'
import { toast } from '@/lib/toast/sink'
import { usePageCommands } from '@/app/(product)/_components/command-menu/page-commands'
import { ControlBar } from '@/app/(product)/_components/control-bar/control-bar'
import { RenameDialog } from '@/app/(product)/_components/rename-dialog/rename-dialog'
import { AccessRequired } from '@/app/(product)/_components/workspace/access-required/access-required'
import { ShareModal } from '@/app/(product)/_components/workspace/files/share-modal/share-modal'
import {
  descendantIndex,
  folderLocation,
  folderPath,
  folderRowId,
  moveDestinations,
  parseRowId,
  selectionAction,
  selectionName,
  splitRowIds,
} from '@/app/(product)/_components/workspace/resource-table/folder-tree'
import {
  filterActions,
  filterSummary,
  folderHref,
  folderTrail,
  type ListPreference,
  noResults,
  sortActions,
} from '@/app/(product)/_components/workspace/resource-table/list-menus'
import {
  OwnerCell,
  type ResourceColumn,
  type ResourceRow,
  ResourceTable,
} from '@/app/(product)/_components/workspace/resource-table/resource-table'
import {
  type RowMove,
  useResourceDrag,
} from '@/app/(product)/_components/workspace/resource-table/use-resource-drag'
import { useResourceSelection } from '@/app/(product)/_components/workspace/resource-table/use-resource-selection'
import {
  LiveWorkspacePage,
  WorkspaceEmpty,
} from '@/app/(product)/_components/workspace/workspace-page/workspace-page'
import type { WorkspaceRead } from '@/app/(product)/_components/workspace/workspace-session/model'
import styles from '@/app/(product)/workspace/[workspaceId]/files/_components/file-browser/file-browser.module.css'
import { mergeFileEntries } from '@/app/(product)/workspace/[workspaceId]/files/_components/file-browser/merge-entries'
import { useMinuteClock } from '@/platform/lib/data/clock'
import {
  DEFAULT_UNTITLED_NAME,
  fileBrowserTypeLabel,
  filesBrowserListParams,
  filesFilterParsers,
  filesFilterUrlKeys,
  filesListPreferenceConfig,
  filesParsers,
  filesSortParams,
  filesUrlKeys,
  formatFileSize,
  getMimeTypeFromExtension,
  isArchiveFileName,
  MAX_WORKSPACE_FILE_SIZE,
  triggerArchiveDownload,
  triggerFileDownload,
  useCreateWorkspaceFile,
  useDeleteWorkspaceFile,
  useInFlightUploadsStore,
  usePinnedWorkspaceFiles,
  useRenameWorkspaceFile,
  useUploadWorkspaceFile,
  useWorkspaceFileFolderSizes,
  useWorkspaceFileList,
  useWorkspaceFileRecord,
  useWorkspaceFilesRoom,
  type WorkspaceFileRecord,
} from '@/platform/lib/data/files'
import {
  useBulkArchiveWorkspaceFileItems,
  useCreateWorkspaceFileFolder,
  useDebouncedSearchSetter,
  useExtractWorkspaceFile,
  useFolderParam,
  useInlineRename,
  useMoveWorkspaceFileItems,
  useResourceListAccess,
  useResourceListPreferences,
  useSearchFilterValue,
  useUpdateWorkspaceFileFolder,
  useUrlSort,
  useWorkspaceFileFolders,
  useWorkspaceMembersQuery,
  type WorkspaceFileFolderApi,
} from '@/platform/lib/data/folders'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { usePinItem, usePinnedIds, useUnpinItem } from '@/platform/lib/data/pins'
import { platformHref } from '@/platform/lib/navigation'
import { useSurfaceScope } from '@/platform/lib/surface-scope'
import { formatRelativeTime } from '@/platform/shared/time'

const ROOT_LABEL = 'Files'
const ROW_MIME = 'application/x-sim-workspace-file-rows'
/** Shorter than the shared debounce, as legacy's file search is: it queries the server. */
const SEARCH_DEBOUNCE = 200
const EMPTY_FILES: WorkspaceFileRecord[] = []
const EMPTY_FOLDERS: WorkspaceFileFolderApi[] = []

const COLUMNS: readonly ResourceColumn[] = [
  { id: 'size', label: 'Size', numeric: true, width: 'compact' },
  { id: 'type', label: 'Type', optional: true },
  { id: 'created', label: 'Created', optional: true },
  { id: 'owner', label: 'Owner', optional: true },
  { id: 'updated', label: 'Last updated', narrow: true },
]
const SEARCH_COLUMNS: readonly ResourceColumn[] = [
  ...COLUMNS,
  { id: 'location', label: 'Location', width: 'wide', optional: true },
]
const SORTS = [
  { id: 'name', label: 'Name' },
  { id: 'size', label: 'Size' },
  { id: 'type', label: 'Type' },
  { id: 'created', label: 'Created' },
  { id: 'updated', label: 'Last updated' },
  { id: 'owner', label: 'Owner' },
] as const
const TYPES = [
  { value: 'document', label: 'Documents' },
  { value: 'image', label: 'Images' },
  { value: 'audio', label: 'Audio' },
  { value: 'video', label: 'Video' },
] as const
const SIZES = [
  { value: 'small', label: 'Small (< 1 MB)' },
  { value: 'medium', label: 'Medium (1–10 MB)' },
  { value: 'large', label: 'Large (> 10 MB)' },
] as const
const isType = (value: string): value is (typeof TYPES)[number]['value'] =>
  TYPES.some((type) => type.value === value)
const isSize = (value: string): value is (typeof SIZES)[number]['value'] =>
  SIZES.some((size) => size.value === value)

/** Each record's Type label, computed once per cached record. */
const TYPE_LABELS = new WeakMap<WorkspaceFileRecord, string>()
function typeOf(file: WorkspaceFileRecord) {
  let label = TYPE_LABELS.get(file)
  if (label === undefined) {
    label = fileBrowserTypeLabel(file.type, file.name)
    TYPE_LABELS.set(file, label)
  }
  return label
}

function fileIcon(file: WorkspaceFileRecord): IconName {
  if (isArchiveFileName(file.name)) return 'I061'
  if (file.type.startsWith('image/')) return 'I059'
  if (file.type.startsWith('audio/')) return 'I083'
  if (file.type.startsWith('text/') || /\.(md|txt|csv|json)$/i.test(file.name)) return 'I075'
  return 'I015'
}

function timeOf(value: Date | string) {
  return new Date(value).getTime()
}

const hasDesktopFiles = (data: DataTransfer) => data.types.includes('Files')

/** The dropped files; a dropped folder is refused, as legacy refuses it. */
function droppedFiles(data: DataTransfer): File[] {
  if (data.items.length === 0) return Array.from(data.files)
  const files: File[] = []
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file') continue
    const entry = item.webkitGetAsEntry?.()
    if (entry?.isDirectory) {
      toast.error(`Cannot upload the folder "${entry.name}"`, {
        description: 'Create a folder in Files, then upload the files inside it.',
      })
      continue
    }
    const file = item.getAsFile()
    if (file) files.push(file)
  }
  return files
}

interface DeleteTarget {
  fileIds: string[]
  folderIds: string[]
  name: string
}

interface FileBrowserProps {
  workspaceId: string
}

/**
 * The workspace's files and folders, a server-sorted page at a time, with legacy's uploads (picker,
 * drop onto the page or a folder, queued with progress), new files and folders, search across every
 * folder, filters, find in list, unzip, share, download, pins, moves and deletes.
 */
export function FileBrowser({ workspaceId }: FileBrowserProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const scope = useSurfaceScope()
  const now = useMinuteClock()
  const access = useResourceListAccess(workspaceId, 'hideFilesTab')
  const canEdit = access.canEdit

  // A `workspace-files-changed` broadcast refetches the browser, as legacy's does.
  useWorkspaceFilesRoom(workspaceId)
  const foldersQuery = useWorkspaceFileFolders(workspaceId)
  const folders = foldersQuery.data ?? EMPTY_FOLDERS
  const foldersResolved = foldersQuery.data !== undefined && !foldersQuery.isPlaceholderData
  const folderById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders])
  const descendants = useMemo(() => descendantIndex(folders), [folders])
  const [folderId, setFolderId] = useFolderParam(foldersResolved ? folderById : null)
  const membersQuery = useWorkspaceMembersQuery(workspaceId)
  const memberById = useMemo(
    () => new Map((membersQuery.data ?? []).map((member) => [member.userId, member])),
    [membersQuery.data]
  )
  const pinnedFiles = usePinnedIds(workspaceId, 'file')
  const pinnedFolders = usePinnedIds(workspaceId, 'folder')
  const pinItem = usePinItem()
  const unpinItem = useUnpinItem()

  const uploadFile = useUploadWorkspaceFile()
  const createFile = useCreateWorkspaceFile()
  const deleteFile = useDeleteWorkspaceFile()
  const renameFile = useRenameWorkspaceFile()
  const createFolder = useCreateWorkspaceFileFolder()
  const updateFolder = useUpdateWorkspaceFileFolder()
  const extractFile = useExtractWorkspaceFile()
  const moveItems = useMoveWorkspaceFileItems()
  const archiveItems = useBulkArchiveWorkspaceFileItems()

  const [filters, setFilters] = useQueryStates(filesFilterParsers, filesFilterUrlKeys)
  const { sort, dir, onSort: applySort } = useUrlSort(filesSortParams, filesFilterUrlKeys)
  const preference = useMemo(
    () => ({
      sort: { column: sort, direction: dir },
      filters: { type: filters.type, size: filters.size, uploadedBy: filters.uploadedBy },
    }),
    [sort, dir, filters.type, filters.size, filters.uploadedBy]
  )
  const preferences = useResourceListPreferences({
    workspaceId,
    config: filesListPreferenceConfig,
    preference,
    applyPreference: useCallback(
      (next: ListPreference) => {
        void setFilters({
          type: (next.filters.type ?? []).filter(isType),
          size: (next.filters.size ?? []).filter(isSize),
          uploadedBy: [...(next.filters.uploadedBy ?? [])],
        })
        applySort(next.sort.column, next.sort.direction)
      },
      [applySort, setFilters]
    ),
  })
  const setSearch = useDebouncedSearchSetter(
    (value, options) => setFilters({ search: value }, options),
    { debounceMs: SEARCH_DEBOUNCE }
  )
  const search = useSearchFilterValue(filters.search, SEARCH_DEBOUNCE)
  const searching = search.trim().length > 0
  const filtered =
    filters.type.length > 0 || filters.size.length > 0 || filters.uploadedBy.length > 0
  const listOpen = preferences.isReady && !access.hidden

  const fileList = useWorkspaceFileList(
    workspaceId,
    filesBrowserListParams({
      folderId,
      search,
      sort,
      dir,
      type: filters.type,
      size: filters.size,
      uploadedBy: filters.uploadedBy,
    }),
    { enabled: listOpen }
  )
  const pagedFiles = fileList.data?.files ?? EMPTY_FILES
  const pinsLead = !searching && !filtered
  const pinnedInFolder = usePinnedWorkspaceFiles(workspaceId, folderId, {
    enabled: listOpen && pinsLead,
  })
  const leadingPins = pinsLead ? pinnedInFolder.files : EMPTY_FILES
  const fileById = useMemo(() => {
    const byId = new Map<string, WorkspaceFileRecord>()
    for (const file of leadingPins) byId.set(file.id, file)
    for (const file of pagedFiles) byId.set(file.id, file)
    return byId
  }, [leadingPins, pagedFiles])

  const visibleFolders = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return needle
      ? folders.filter((folder) => folder.name.toLowerCase().includes(needle))
      : folders.filter((folder) => (folder.parentId ?? null) === folderId)
  }, [folders, folderId, search])
  const sizes = useWorkspaceFileFolderSizes(
    workspaceId,
    searching ? visibleFolders.map((folder) => folder.parentId ?? null) : [folderId],
    { enabled: listOpen }
  )

  const entries = useMemo(
    () =>
      mergeFileEntries({
        folders: visibleFolders,
        files: pagedFiles,
        pinnedFiles: leadingPins,
        hasMore: Boolean(fileList.hasNextPage),
        pinnedFolderIds: pinsLead ? pinnedFolders : new Set<string>(),
        pinnedFileIds: pinsLead ? pinnedFiles : new Set<string>(),
        folderKey: (folder) =>
          sort === 'size'
            ? (sizes.get(folder.id)?.sizeBytes ?? 0)
            : sort === 'type'
              ? 'Folder'
              : sort === 'created'
                ? timeOf(folder.createdAt)
                : sort === 'updated'
                  ? timeOf(folder.updatedAt)
                  : sort === 'owner'
                    ? (memberById.get(folder.userId)?.name ?? null)
                    : folder.name,
        fileKey: (file) =>
          sort === 'size'
            ? file.size
            : sort === 'type'
              ? typeOf(file)
              : sort === 'created'
                ? timeOf(file.uploadedAt)
                : sort === 'updated'
                  ? timeOf(file.updatedAt)
                  : sort === 'owner'
                    ? (memberById.get(file.uploadedBy)?.name ?? null)
                    : file.name,
        direction: dir,
      }),
    [
      visibleFolders,
      pagedFiles,
      leadingPins,
      fileList.hasNextPage,
      pinsLead,
      pinnedFolders,
      pinnedFiles,
      sizes,
      memberById,
      sort,
      dir,
    ]
  )

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [unzipTarget, setUnzipTarget] = useState<WorkspaceFileRecord | null>(null)
  /** The file whose share dialog is open, deep-linked as legacy's `shareFileId`. */
  const [{ shareFileId }, setFilesParams] = useQueryStates(filesParsers, filesUrlKeys)
  const shareRecord = useWorkspaceFileRecord(workspaceId, shareFileId ?? '', {
    enabled: Boolean(shareFileId),
  })
  const shareTarget = shareFileId ? (shareRecord.data ?? null) : null
  const setShareTarget = (file: WorkspaceFileRecord | null) =>
    void setFilesParams({ shareFileId: file?.id ?? null }, { history: 'replace' })
  const [renamingFolder, setRenamingFolder] = useState<WorkspaceFileFolderApi | null>(null)
  const [progress, setProgress] = useState({ done: 0, total: 0, percent: 0 })
  const uploading = progress.total > 0
  const [creatingFile, setCreatingFile] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const downloadingRef = useRef(false)
  const uploadQueue = useRef<Promise<void>>(Promise.resolve())
  const fileInput = useRef<HTMLInputElement>(null)
  /** The page-level "Drop to upload" overlay for files dragged in from the desktop. */
  const [dropping, setDropping] = useState(false)
  const dropDepth = useRef(0)

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
      return row.kind === 'folder'
        ? updateFolder.mutateAsync({ workspaceId, folderId: row.id, updates: { name } })
        : renameFile.mutateAsync({ workspaceId, fileId: row.id, name })
    },
  })

  const rowIds = useMemo(
    () =>
      entries.map((entry) =>
        entry.kind === 'folder' ? folderRowId(entry.folder.id) : entry.file.id
      ),
    [entries]
  )

  // Find in list: Cmd/Ctrl+F marks matching names on screen and steps through them.
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findIndex, setFindIndex] = useState(0)
  const findInput = useRef<HTMLInputElement>(null)
  const needle = findQuery.trim().toLowerCase()
  const findMatches = useMemo(
    () =>
      findOpen && needle
        ? entries.flatMap((entry) => {
            const name = entry.kind === 'folder' ? entry.folder.name : entry.file.name
            return name.toLowerCase().includes(needle)
              ? [entry.kind === 'folder' ? folderRowId(entry.folder.id) : entry.file.id]
              : []
          })
        : [],
    [entries, findOpen, needle]
  )
  const activeMatch = findMatches.length
    ? findMatches[Math.min(findIndex, findMatches.length - 1)]
    : null
  const step = (by: number) => {
    if (!findMatches.length) return
    setFindIndex((current) => (current + by + findMatches.length) % findMatches.length)
  }
  const closeFind = () => {
    setFindOpen(false)
    setFindQuery('')
    setFindIndex(0)
  }
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'f') return
      if (document.querySelector('dialog[open]')) return
      event.preventDefault()
      setFindOpen(true)
      requestAnimationFrame(() => {
        findInput.current?.focus()
        findInput.current?.select()
      })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const requestDelete = (fileIds: string[], folderIds: string[]) => {
    if (!fileIds.length && !folderIds.length) return
    setDeleteTarget({
      fileIds,
      folderIds,
      name: selectionName(
        fileIds.length + folderIds.length,
        fileIds.length ? fileById.get(fileIds[0])?.name : folderById.get(folderIds[0])?.name
      ),
    })
  }
  const requestBulkDelete = () => {
    const { folderIds, resourceIds } = splitRowIds(selection.selected)
    requestDelete(resourceIds, folderIds)
  }
  const dialogOpen =
    deleteTarget !== null || unzipTarget !== null || shareTarget !== null || renamingFolder !== null
  const selection = useResourceSelection({
    rowIds,
    onDelete: canEdit ? requestBulkDelete : undefined,
    keyboardBlocked: listRename.editingId !== null || dialogOpen,
  })

  const moveRows = (move: RowMove, target: string | null) => {
    const fileIds = move.resourceIds.filter((id) => (fileById.get(id)?.folderId ?? null) !== target)
    const folderIds = move.folderIds.filter(
      (id) => (folderById.get(id)?.parentId ?? null) !== target
    )
    if (!fileIds.length && !folderIds.length) return
    moveItems
      .mutateAsync({ workspaceId, fileIds, folderIds, targetFolderId: target })
      .then(() => selection.clear())
      .catch((error: unknown) => toast.error(getErrorMessage(error, 'Failed to move items')))
  }

  const notifyStorageLimit = (message: string) =>
    toast.error(message, {
      action: {
        label: 'Upgrade',
        onClick: () =>
          router.push(
            platformHref(surfaceHref(scope, '/settings/billing/plans?reason=storage'), searchParams)
          ),
      },
    })

  const uploadFiles = (chosen: File[], target: string | null = folderId) => {
    const batch = async () => {
      if (!chosen.length || !canEdit) return
      setSearch('')
      const oversized = chosen.filter((file) => file.size > MAX_WORKSPACE_FILE_SIZE)
      if (oversized.length)
        toast.error(
          oversized.length === 1
            ? `${oversized[0].name} exceeds the 5 GiB upload limit`
            : `${oversized.length} files exceed the 5 GiB upload limit`
        )
      const allowed = chosen.filter((file) => file.size <= MAX_WORKSPACE_FILE_SIZE)
      if (!allowed.length) return
      try {
        setProgress({ done: 0, total: allowed.length, percent: 0 })
        for (let index = 0; index < allowed.length; index++) {
          try {
            await uploadFile.mutateAsync({
              workspaceId,
              file: allowed[index],
              folderId: target,
              onProgress: ({ percent }: { percent: number }) =>
                setProgress((current) => ({ ...current, percent })),
            })
          } catch (error) {
            const message = getErrorMessage(error)
            if (/storage limit/i.test(message)) notifyStorageLimit(message)
            else toast.error(`Failed to upload "${allowed[index].name}"`, { description: message })
          } finally {
            setProgress({ done: index + 1, total: allowed.length, percent: 0 })
          }
        }
      } finally {
        setProgress({ done: 0, total: 0, percent: 0 })
      }
    }
    // Counted from the moment it queues, since the batch runs on after this page unmounts.
    const release = useInFlightUploadsStore.getState().begin()
    uploadQueue.current = uploadQueue.current
      .then(batch)
      .catch((error: unknown) => {
        toast.error(getErrorMessage(error, 'Failed to upload files'))
      })
      .finally(release)
    return uploadQueue.current
  }

  const drag = useResourceDrag({
    mime: ROW_MIME,
    enabled: canEdit,
    renamingId: listRename.editingId,
    rowIds,
    selection,
    parentOf: (rowId) => {
      const row = parseRowId(rowId)
      return row.kind === 'folder'
        ? folderById.get(row.id)?.parentId
        : fileById.get(row.id)?.folderId
    },
    descendants,
    labelOf: (rowId) => {
      const row = parseRowId(rowId)
      return row.kind === 'folder'
        ? (folderById.get(row.id)?.name ?? 'Folder')
        : (fileById.get(row.id)?.name ?? 'File')
    },
    onMove: moveRows,
    currentFolderId: folderId,
    bodyFolderId: searching ? undefined : folderId,
    onNavigate: (id, options) => setFolderId(id, options),
    external: {
      matches: hasDesktopFiles,
      onDropIntoFolder: (data, target) => {
        setDropping(false)
        dropDepth.current = 0
        const files = droppedFiles(data)
        if (files.length) void uploadFiles(files, target)
      },
    },
  })

  const pageDrop = canEdit
    ? {
        onDragEnter: (event: DragEvent<HTMLElement>) => {
          if (!hasDesktopFiles(event.dataTransfer)) return
          event.preventDefault()
          dropDepth.current += 1
          setDropping(true)
        },
        onDragLeave: (event: DragEvent<HTMLElement>) => {
          if (!hasDesktopFiles(event.dataTransfer)) return
          dropDepth.current -= 1
          if (dropDepth.current <= 0) {
            dropDepth.current = 0
            setDropping(false)
          }
        },
        onDragOver: (event: DragEvent<HTMLElement>) => {
          if (!hasDesktopFiles(event.dataTransfer)) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        },
        onDrop: (event: DragEvent<HTMLElement>) => {
          if (!hasDesktopFiles(event.dataTransfer)) return
          event.preventDefault()
          drag.externalHandled()
          dropDepth.current = 0
          setDropping(false)
          const files = droppedFiles(event.dataTransfer)
          if (files.length) void uploadFiles(files)
        },
      }
    : {}

  const download = async (file: WorkspaceFileRecord) => {
    try {
      await triggerFileDownload(file)
    } catch (error) {
      toast.error(getErrorMessage(error, `Failed to download "${file.name}"`))
    }
  }
  const downloadArchive = async (items: { fileIds?: string[]; folderIds?: string[] }) => {
    if (downloadingRef.current) return
    downloadingRef.current = true
    setDownloading(true)
    try {
      await triggerArchiveDownload({ workspaceId, ...items })
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to download the selected files'))
    } finally {
      downloadingRef.current = false
      setDownloading(false)
    }
  }
  const downloadRows = (rows: Iterable<string>) => {
    const { folderIds, resourceIds } = splitRowIds(rows)
    const files = resourceIds.flatMap((id) => {
      const file = fileById.get(id)
      return file ? [file] : []
    })
    if (files.length === 1 && !folderIds.length) return void download(files[0])
    if (!resourceIds.length && !folderIds.length) return
    void downloadArchive({ fileIds: resourceIds, folderIds })
  }

  const handleCreateFile = async () => {
    if (creatingFile) return
    setCreatingFile(true)
    try {
      const result = await createFile.mutateAsync({
        workspaceId,
        name: DEFAULT_UNTITLED_NAME,
        contentType: getMimeTypeFromExtension('md'),
        folderId: folderId ?? undefined,
      })
      const query = new URLSearchParams({ new: '1' })
      if (folderId) query.set('folderId', folderId)
      router.push(
        platformHref(
          `${workspacePath(workspaceId, 'files')}/${encodeURIComponent(result.file.id)}?${query}`,
          searchParams
        )
      )
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to create file'))
    } finally {
      setCreatingFile(false)
    }
  }

  const handleCreateFolder = async () => {
    const taken = new Set(
      folders
        .filter((folder) => (folder.parentId ?? null) === folderId)
        .map((folder) => folder.name)
    )
    let name = 'New folder'
    for (let counter = 1; taken.has(name); counter++) name = `New folder (${counter})`
    try {
      const folder = await createFolder.mutateAsync({ workspaceId, name, parentId: folderId })
      setSearch('')
      listRename.startRename(folderRowId(folder.id), folder.name)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to create folder'))
    }
  }

  const fileHref = (file: WorkspaceFileRecord) => {
    const base = `${workspacePath(workspaceId, 'files')}/${encodeURIComponent(file.id)}`
    return platformHref(file.folderId ? `${base}?folderId=${file.folderId}` : base, searchParams)
  }
  const absoluteHref = (file: WorkspaceFileRecord) =>
    new URL(
      `${workspacePath(workspaceId, 'files')}/${encodeURIComponent(file.id)}`,
      window.location.origin
    ).href
  const togglePin = (resourceType: 'file' | 'folder', id: string, pinned: boolean) =>
    (pinned ? unpinItem : pinItem).mutate({ workspaceId, resourceType, resourceId: id })
  const copy = (text: string, success?: string) => {
    void navigator.clipboard.writeText(text).then(
      () => success && toast.success(success),
      () => toast.error('Failed to copy')
    )
  }

  const moveAction = (rows: ReadonlySet<string> | readonly string[]): MenuAction => {
    const { folderIds, resourceIds } = splitRowIds(rows)
    const count = folderIds.length + resourceIds.length
    return {
      id: 'move',
      label: selectionAction('Move', count, 'Move to'),
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

  const rowActions = (row: ResourceRow): MenuAction[] => {
    const multi = selection.selected.size > 1 && selection.selected.has(row.id)
    const count = multi ? selection.selected.size : 1
    const targets = multi ? selection.selected : [row.id]
    const parsed = parseRowId(row.id)
    const file = parsed.kind === 'resource' ? fileById.get(parsed.id) : undefined
    const folder = parsed.kind === 'folder' ? folderById.get(parsed.id) : undefined
    const pinned = file ? pinnedFiles.has(file.id) : folder ? pinnedFolders.has(folder.id) : false
    const single = !multi
    return [
      ...(single
        ? [
            {
              id: 'open',
              label: 'Open',
              icon: 'eye' as const,
              onSelect: () => {
                if (folder) openFolder(folder.id)
                else if (file) router.push(fileHref(file))
              },
            },
          ]
        : []),
      ...(single && file
        ? [
            {
              id: 'copy-link',
              label: 'Copy link',
              icon: 'link' as const,
              onSelect: () => copy(absoluteHref(file), 'Copied link to clipboard'),
            },
          ]
        : []),
      {
        id: 'download',
        label: selectionAction('Download', count),
        icon: 'I049',
        disabled: downloading,
        onSelect: () => downloadRows(targets),
      },
      ...(single
        ? [
            {
              id: 'pin',
              label: pinned ? 'Unpin' : 'Pin',
              icon: 'I131' as const,
              onSelect: () =>
                file
                  ? togglePin('file', file.id, pinned)
                  : folder && togglePin('folder', folder.id, pinned),
            },
          ]
        : []),
      ...(single && folder
        ? [
            {
              id: 'copy-id',
              label: 'Copy ID',
              icon: 'I006' as const,
              onSelect: () => copy(folder.id),
            },
          ]
        : []),
      ...(canEdit
        ? [
            ...(single
              ? [
                  {
                    id: 'rename',
                    label: 'Rename',
                    icon: 'I036' as const,
                    onSelect: () => listRename.startRename(row.id, row.name),
                  },
                ]
              : []),
            ...(single && file
              ? [
                  {
                    id: 'share',
                    label: 'Share',
                    icon: 'I030' as const,
                    onSelect: () => setShareTarget(file),
                  },
                ]
              : []),
            moveAction(targets),
            {
              id: 'delete',
              label: selectionAction('Delete', count),
              icon: 'I061' as const,
              destructive: true,
              separatorBefore: true,
              onSelect: () => {
                const { folderIds, resourceIds } = splitRowIds(targets)
                requestDelete(resourceIds, folderIds)
              },
            },
          ]
        : []),
    ]
  }

  const currentFolder = folderId ? folderById.get(folderId) : undefined
  const crumbActions = (folder: WorkspaceFileFolderApi): MenuAction[] => {
    const pinned = pinnedFolders.has(folder.id)
    return [
      {
        id: 'pin',
        label: pinned ? 'Unpin' : 'Pin',
        icon: 'I131',
        onSelect: () => togglePin('folder', folder.id, pinned),
      },
      { id: 'copy-id', label: 'Copy ID', icon: 'I006', onSelect: () => copy(folder.id) },
      ...(canEdit
        ? [
            {
              id: 'rename',
              label: 'Rename',
              icon: 'I036' as const,
              onSelect: () => setRenamingFolder(folder),
            },
            {
              id: 'delete',
              label: 'Delete',
              icon: 'I061' as const,
              destructive: true,
              separatorBefore: true,
              onSelect: () => requestDelete([], [folder.id]),
            },
          ]
        : []),
    ]
  }

  const rows: ResourceRow[] = entries.map((entry) => {
    if (entry.kind === 'folder') {
      const { folder } = entry
      const owner = memberById.get(folder.userId)
      const total = sizes.get(folder.id)?.sizeBytes ?? 0
      return {
        id: folderRowId(folder.id),
        name: folder.name,
        icon: 'I100',
        folder: true,
        pinned: pinnedFolders.has(folder.id),
        onOpen: () => openFolder(folder.id),
        cells: {
          size: total > 0 ? formatFileSize(total, { includeBytes: true }) : undefined,
          type: 'Folder',
          created: formatRelativeTime(timeOf(folder.createdAt), now),
          owner: owner && <OwnerCell name={owner.name} image={owner.image} />,
          updated: formatRelativeTime(timeOf(folder.updatedAt), now),
          location: searching && folderLocation(folderById, folder.parentId, ROOT_LABEL),
        },
      }
    }
    const { file } = entry
    const owner = memberById.get(file.uploadedBy)
    // Only an editor can unzip; a reader opens an archive like any other file.
    const archive = canEdit && isArchiveFileName(file.name)
    return {
      id: file.id,
      name: file.name,
      icon: fileIcon(file),
      pinned: pinnedFiles.has(file.id),
      href: archive ? undefined : fileHref(file),
      onOpen: archive ? () => setUnzipTarget(file) : undefined,
      cells: {
        size: formatFileSize(file.size, { includeBytes: true }),
        type: typeOf(file),
        created: formatRelativeTime(timeOf(file.uploadedAt), now),
        owner: owner && <OwnerCell name={owner.name} image={owner.image} />,
        updated: formatRelativeTime(timeOf(file.updatedAt), now),
        location: searching && folderLocation(folderById, file.folderId, ROOT_LABEL),
      },
    }
  })

  const uploadLabel = uploading
    ? progress.percent > 0 && progress.percent < 100
      ? `${progress.done}/${progress.total} · ${progress.percent}%`
      : `${progress.done}/${progress.total}`
    : 'Upload'
  const memberOptions = (membersQuery.data ?? []).map((member) => ({
    value: member.userId,
    label: member.name,
  }))
  const chain = folderPath(folderById, folderId)
  const hrefFor = (id: string | null) => folderHref(pathname, searchParams, id)
  const chooseFiles = () => {
    if (canEdit && !uploading) fileInput.current?.click()
  }

  usePageCommands(
    canEdit && !access.hidden
      ? [
          {
            id: 'files-new-file',
            label: 'New file',
            run: () => {
              if (!uploading) void handleCreateFile()
            },
          },
          {
            id: 'files-new-folder',
            label: 'New folder',
            run: () => {
              if (!createFolder.isPending) void handleCreateFolder()
            },
          },
          { id: 'files-upload', label: 'Upload', run: chooseFiles },
        ]
      : []
  )

  const controls = !access.hidden && (
    <ControlBar
      search={
        <SearchField
          variant='quiet'
          label='Search files'
          placeholder='Search files…'
          value={filters.search}
          onValueChange={setSearch}
        />
      }
      trail={
        chain.length > 0 && (
          <Breadcrumbs
            label='Location'
            items={folderTrail({
              rootLabel: ROOT_LABEL,
              chain,
              hrefFor,
              currentActions: currentFolder && crumbActions(currentFolder),
              drop: drag.crumb,
            })}
          />
        )
      }
    >
      {filtered && (
        <Button variant='quiet' size='compact' onClick={preferences.clearFilters}>
          Clear filters
        </Button>
      )}
      <ActionMenu
        label='File type'
        triggerText={filterSummary(TYPES, filters.type, 'All types', 'types')}
        actions={filterActions({
          choices: TYPES,
          selected: filters.type,
          onChange: (next) => preferences.setFilter('type', next),
        })}
      />
      <ActionMenu
        label='Size'
        triggerText={filterSummary(SIZES, filters.size, 'All sizes', 'sizes')}
        actions={filterActions({
          choices: SIZES,
          selected: filters.size,
          onChange: (next) => preferences.setFilter('size', next),
        })}
      />
      {memberOptions.length > 0 && (
        <MultiSelect
          variant='text'
          label='Uploaded by'
          labelHidden
          options={memberOptions}
          value={filters.uploadedBy}
          onValueChange={(next) => preferences.setFilter('uploadedBy', next)}
          placeholder='All uploaders'
          searchLabel='Search members'
        />
      )}
      <ActionMenu
        label='Sort files'
        icon='I050'
        tooltip
        align='end'
        actions={sortActions({ columns: SORTS, sort, dir, onSort: preferences.setSort })}
      />
      {canEdit && (
        <Button
          variant='quiet'
          size='compact'
          icon='I117'
          disabled={uploading}
          onClick={chooseFiles}
        >
          {uploadLabel}
        </Button>
      )}
      {canEdit && (
        <Button
          variant='quiet'
          size='compact'
          icon='I100'
          disabled={createFolder.isPending}
          onClick={() => void handleCreateFolder()}
        >
          New folder
        </Button>
      )}
      {canEdit && (
        <Button
          variant='secondary'
          size='compact'
          icon='I074'
          disabled={uploading || creatingFile}
          onClick={() => void handleCreateFile()}
        >
          New file
        </Button>
      )}
    </ControlBar>
  )

  const failedRead = [fileList, foldersQuery].find(
    (query) => query.isError && query.data === undefined
  )
  /**
   * An applied member filter keeps narrowing the list while a failed members read hides its
   * control, so that failure is the list's own until it reads again.
   */
  const failedMembersRead =
    filters.uploadedBy.length > 0 && membersQuery.isError && membersQuery.data === undefined
  const read: WorkspaceRead = failedRead
    ? {
        status: 'error',
        message: 'Files could not be loaded.',
        retrying: failedRead.isFetching,
        onRetry: () => void failedRead.refetch(),
      }
    : failedMembersRead
      ? {
          status: 'error',
          message: 'Workspace members could not be loaded.',
          retrying: membersQuery.isFetching,
          onRetry: () => void membersQuery.refetch(),
        }
      : !access.settled ||
          (!access.hidden && (fileList.isPending || !foldersResolved || !preferences.isReady))
        ? { status: 'pending' }
        : { status: 'ready' }

  const copyText = noResults(search, filtered, 'files')
  const empty =
    searching || filtered ? (
      <WorkspaceEmpty
        title={copyText.title}
        description={copyText.description}
        action={{
          label: copyText.action,
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
        title='No files yet'
        description='Upload files to share them across your team and every agent.'
      />
    )

  return (
    <LiveWorkspacePage workspaceId={workspaceId} current='files' controls={controls} read={read}>
      {access.hidden ? (
        <AccessRequired workspaceId={workspaceId} gate='hideFilesTab' onRefresh={access.refresh} />
      ) : (
        <div
          className={styles.browser}
          onDragEnter={pageDrop.onDragEnter}
          onDragLeave={pageDrop.onDragLeave}
          onDragOver={pageDrop.onDragOver}
          onDrop={pageDrop.onDrop}
        >
          {findOpen && (
            <div className={styles.findFrame}>
              <FindBar
                label='Find in files'
                query={findQuery}
                onQueryChange={(value) => {
                  setFindQuery(value)
                  setFindIndex(0)
                }}
                inputRef={findInput}
                results={{
                  index: Math.min(findIndex, Math.max(0, findMatches.length - 1)),
                  count: findMatches.length,
                }}
                onStep={step}
                onClose={closeFind}
              />
            </div>
          )}
          <ResourceTable
            label='Files'
            columns={searching ? SEARCH_COLUMNS : COLUMNS}
            rows={rows}
            rowActions={rowActions}
            backgroundActions={
              canEdit
                ? [
                    {
                      id: 'upload',
                      label: 'Upload',
                      icon: 'I117',
                      disabled: uploading,
                      onSelect: chooseFiles,
                    },
                    {
                      id: 'new-folder',
                      label: 'New folder',
                      icon: 'I100',
                      disabled: createFolder.isPending,
                      onSelect: () => void handleCreateFolder(),
                    },
                    {
                      id: 'new-file',
                      label: 'New file',
                      icon: 'I074',
                      disabled: uploading || creatingFile,
                      onSelect: () => void handleCreateFile(),
                    },
                  ]
                : undefined
            }
            selection={selection}
            bulkActions={[
              {
                id: 'download',
                label: 'Download',
                disabled: downloading,
                onSelect: () => downloadRows(selection.selected),
              },
              ...(canEdit
                ? [
                    moveAction(selection.selected),
                    {
                      id: 'delete',
                      label: 'Delete',
                      destructive: true,
                      disabled: archiveItems.isPending || moveItems.isPending,
                      onSelect: requestBulkDelete,
                    },
                  ]
                : []),
            ]}
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
            loadMore={{ hasMore: Boolean(fileList.hasNextPage), onLoadMore: fileList.loadMore }}
            find={findOpen ? { query: findQuery, activeId: activeMatch } : undefined}
            empty={empty}
          />
          {dropping && (
            <div className={styles.dropOverlay} aria-hidden='true'>
              <Icon name='I117' />
              <span data-type='T060'>Drop to upload</span>
              <span className={styles.dropHint} data-type='T052'>
                Release files here to add them to this workspace
              </span>
            </div>
          )}
          <input
            ref={fileInput}
            className={styles.fileInput}
            type='file'
            multiple
            disabled={!canEdit || uploading}
            onChange={(event) => {
              const chosen = Array.from(event.currentTarget.files ?? [])
              event.currentTarget.value = ''
              void uploadFiles(chosen)
            }}
          />
        </div>
      )}
      <ConfirmDialog
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={(target) => {
          const total = target.fileIds.length + target.folderIds.length
          return total > 1
            ? 'Delete items'
            : target.folderIds.length
              ? 'Delete folder'
              : 'Delete file'
        }}
        description={(target) => {
          const total = target.fileIds.length + target.folderIds.length
          const consequence = target.folderIds.length
            ? total > 1
              ? 'This will also delete files and folders inside any selected folders.'
              : 'This will also delete files and folders inside it.'
            : total > 1
              ? 'You can restore them from Recently Deleted in Settings.'
              : 'You can restore it from Recently Deleted in Settings.'
          return `Are you sure you want to delete ${target.name}? ${consequence}`
        }}
        confirmLabel='Delete'
        pendingLabel='Deleting…'
        onConfirm={async (target) => {
          if (target.folderIds.length || target.fileIds.length > 1)
            await archiveItems.mutateAsync({
              workspaceId,
              fileIds: target.fileIds,
              folderIds: target.folderIds,
            })
          else await deleteFile.mutateAsync({ workspaceId, fileId: target.fileIds[0] })
          selection.clear()
          if (folderId && target.folderIds.includes(folderId))
            setFolderId(folderById.get(folderId)?.parentId ?? null, { history: 'replace' })
        }}
      />
      <ConfirmDialog
        target={unzipTarget}
        onClose={() => setUnzipTarget(null)}
        title='Unzip archive'
        description={(target) => `This will unzip ${target.name} into a new folder beside it.`}
        confirmLabel='Unzip'
        pendingLabel='Unzipping…'
        safe
        confirmDisabled={!canEdit}
        onConfirm={(target) =>
          extractFile.mutateAsync({ workspaceId, fileId: target.id, fileName: target.name })
        }
      />
      {shareTarget && (
        <ShareModal
          open
          onOpenChange={(open) => {
            if (!open) setShareTarget(null)
          }}
          workspaceId={workspaceId}
          fileId={shareTarget.id}
          fileName={shareTarget.name}
          initialShare={shareTarget.share ?? null}
        />
      )}
      <RenameDialog
        target={renamingFolder}
        noun='folder'
        onClose={() => setRenamingFolder(null)}
        onRename={(id, name) =>
          updateFolder.mutateAsync({ workspaceId, folderId: id, updates: { name } })
        }
      />
    </LiveWorkspacePage>
  )
}
