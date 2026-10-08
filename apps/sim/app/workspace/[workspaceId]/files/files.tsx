'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Avatar,
  type ComboboxOption,
  Folder,
  FolderPlus,
  Loader,
  Pencil,
  Plus,
  Trash,
  toast,
  Upload,
  useCopyToClipboard,
} from '@sim/emcn'
import { Check, Clock, Download, Duplicate, Link, Send } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { useParams, useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { usePostHog } from 'posthog-js/react'
import { getDocumentIcon } from '@/components/icons/document-icons'
import type { FileCopySource } from '@/lib/api/contracts/file-copy-input'
import { useLimitUpgradeToast } from '@/lib/billing/client'
import { captureEvent } from '@/lib/posthog/client'
import { triggerArchiveDownload, triggerFileDownload } from '@/lib/uploads/client/download'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { MAX_WORKSPACE_FILE_SIZE } from '@/lib/uploads/shared/types'
import {
  formatFileSize,
  getFileExtension,
  getMimeTypeFromExtension,
  isArchiveFileName,
  isAudioFileType,
  isVideoFileType,
  resolveEffectiveMimeType,
} from '@/lib/uploads/utils/file-utils'
import { isSupportedExtension } from '@/lib/uploads/utils/validation'
import {
  FILE_BROWSER_COLUMNS,
  FILE_BROWSER_SIZE_BOUNDARIES,
  FILE_BROWSER_SORT_OPTIONS,
  FILE_ROW_DRAG_MIME,
  formatFileBrowserType,
} from '@/lib/workspace-files/browser'
import { FindBar } from '@/app/workspace/[workspaceId]/components/find-bar/find-bar'
import { useFindShortcut } from '@/app/workspace/[workspaceId]/components/find-bar/use-find-shortcut'
import type {
  MoveOptionNode,
  SortableResource,
} from '@/app/workspace/[workspaceId]/components/folders'
import {
  breadcrumbFolderChain,
  buildDescendantIndex,
  buildMoveOptionsExcludingSubtrees,
  EMPTY_LOCATION_CELL,
  FOLDER_LOCATION_COLUMN,
  FOLDERED_RESOURCE_HEADERS,
  folderBreadcrumbItems,
  folderedResourceListHref,
  folderLocationLabel,
  folderRowId,
  isSearchingResources,
  parseFolderedRowId,
  parseMoveOptionValue,
  scopeFolderedItems,
  sortResources,
  splitFolderedRowIds,
  useFolderRowDragDrop,
} from '@/app/workspace/[workspaceId]/components/folders'
import { ResourceActionBar } from '@/app/workspace/[workspaceId]/components/resource/components/action-bar'
import { ownerCell } from '@/app/workspace/[workspaceId]/components/resource/components/owner-cell'
import {
  FilesEmptyState,
  ResourceNoResults,
} from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state'
import type {
  BreadcrumbItem,
  ResourceAction,
} from '@/app/workspace/[workspaceId]/components/resource/components/resource-header'
import type {
  FilterTag,
  SearchConfig,
  SortConfig,
} from '@/app/workspace/[workspaceId]/components/resource/components/resource-options'
import { timeCell } from '@/app/workspace/[workspaceId]/components/resource/components/time-cell'
import { resourceListState } from '@/app/workspace/[workspaceId]/components/resource/is-resource-list-empty'
import type {
  ResourceColumn,
  ResourceRow,
  ResourceTableHandle,
} from '@/app/workspace/[workspaceId]/components/resource/resource'
import {
  EMPTY_CELL_PLACEHOLDER,
  Resource,
} from '@/app/workspace/[workspaceId]/components/resource/resource'
import { selectionLabel } from '@/app/workspace/[workspaceId]/components/resource/selection-label'
import { useResourceRowSelection } from '@/app/workspace/[workspaceId]/components/resource/use-resource-row-selection'
import { DeleteConfirmModal } from '@/app/workspace/[workspaceId]/files/components/delete-confirm-modal'
import { FileCopyModal } from '@/app/workspace/[workspaceId]/files/components/file-copy-modal'
import {
  FileDetail,
  useFileNavigation,
} from '@/app/workspace/[workspaceId]/files/components/file-detail'
import { FileExtractionModal } from '@/app/workspace/[workspaceId]/files/components/file-extraction-modal'
import { FileFilterControls } from '@/app/workspace/[workspaceId]/files/components/file-filter-controls'
import { FileHistoryModal } from '@/app/workspace/[workspaceId]/files/components/file-history-modal'
import { FileRowContextMenu } from '@/app/workspace/[workspaceId]/files/components/file-row-context-menu'
import { FileUploadOverlay } from '@/app/workspace/[workspaceId]/files/components/file-upload-overlay'
import { FilesListContextMenu } from '@/app/workspace/[workspaceId]/files/components/files-list-context-menu'
import { ShareModal } from '@/app/workspace/[workspaceId]/files/components/share-modal'
import { useFileUploadDrop, useWorkspaceFilesRoom } from '@/app/workspace/[workspaceId]/files/hooks'
import FilesLoading from '@/app/workspace/[workspaceId]/files/loading'
import {
  filesFilterParsers,
  filesFilterUrlKeys,
  filesListPreferenceConfig,
  filesParsers,
  filesSortParams,
  filesUrlKeys,
} from '@/app/workspace/[workspaceId]/files/search-params'
import {
  DEFAULT_UNTITLED_NAME,
  deriveMarkdownFileName,
  isUntitledName,
  uniqueMarkdownName,
} from '@/app/workspace/[workspaceId]/files/untitled-title'
import { getDroppedFiles, hasExternalFiles } from '@/app/workspace/[workspaceId]/files/utils'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { PermissionAccessBoundary } from '@/ee/access-requests/components/permission-access-boundary'
import { usePinItem, usePinnedIds, useUnpinItem } from '@/hooks/queries/pinned-items'
import { useWorkspaceMembersQuery, type WorkspaceMember } from '@/hooks/queries/workspace'
import {
  useBulkArchiveWorkspaceFileItems,
  useCreateWorkspaceFileFolder,
  useMoveWorkspaceFileItems,
  useUpdateWorkspaceFileFolder,
  useWorkspaceFileFolders,
  type WorkspaceFileFolderApi,
} from '@/hooks/queries/workspace-file-folders'
import {
  useCreateWorkspaceFile,
  useDeleteWorkspaceFile,
  useRenameWorkspaceFile,
  useUploadWorkspaceFile,
  useWorkspaceFiles,
} from '@/hooks/queries/workspace-files'
import { useContextMenu } from '@/hooks/use-context-menu'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { useInlineRename } from '@/hooks/use-inline-rename'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useResourceListPreferences } from '@/hooks/use-resource-list-preferences'
import { useSearchFilterValue } from '@/hooks/use-search-filter-value'
import { useUrlSort } from '@/hooks/use-url-sort'
import type { ResourceListPreference } from '@/stores/resource-list-preferences'

type FileResourceItem =
  | { kind: 'file'; id: string; file: WorkspaceFileRecord }
  | { kind: 'folder'; id: string; folder: WorkspaceFileFolderApi }

/** One row of the merged folder+file list, before it becomes a `ResourceRow`. */
type FileListEntry =
  | { kind: 'folder'; folder: WorkspaceFileFolderApi }
  | { kind: 'file'; file: WorkspaceFileRecord }

const logger = createLogger('Files')

const FILES_HEADER = FOLDERED_RESOURCE_HEADERS.file

const FOLDER_ICON = <Folder className='size-[14px]' />

/** Folders' value in the `type` column — also their sort key when that column is active. */
const FOLDER_TYPE_LABEL = 'Folder' as const

/**
 * Debounce window for `search` URL writes and filtering; the input itself stays
 * instant. Intentionally shorter than the shared `SEARCH_DEBOUNCE_MS` (300).
 */
const FILES_SEARCH_DEBOUNCE_MS = 200 as const

const COLUMNS: ResourceColumn[] = [...FILE_BROWSER_COLUMNS]

/**
 * Deliberately absent from {@link filesSortParams}, so the location column is not offered in
 * the sort menu — those columns are a URL contract, and ordering by path is not worth
 * persisting in a shared link before anyone asks for it.
 */
const SEARCH_COLUMNS: ResourceColumn[] = [...COLUMNS, FOLDER_LOCATION_COLUMN]

const EMPTY_WORKSPACE_FILES: WorkspaceFileRecord[] = []
const EMPTY_WORKSPACE_FILE_FOLDERS: WorkspaceFileFolderApi[] = []
const EMPTY_FIND_MATCH_IDS: readonly string[] = Object.freeze([])

export function Files() {
  return (
    <PermissionAccessBoundary configKey='hideFilesTab'>
      <FilesContent />
    </PermissionAccessBoundary>
  )
}

function FilesContent() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [copySource, setCopySource] = useState<FileCopySource | null>(null)
  const uploadQueueRef = useRef<Promise<void>>(Promise.resolve())

  const params = useParams()
  const router = useRouter()
  const [
    { folderId: currentFolderId, new: isNewFile, shareFileId, historyFileId },
    setFilesParams,
  ] = useQueryStates(filesParsers, filesUrlKeys)
  const workspaceId = params?.workspaceId as string
  const {
    downloadSourceRef,
    setIsDirty,
    setSaveStatus,
    navigate: handleNavigateFromFileDetail,
  } = useFileNavigation({ owner: { entityType: 'workspace', entityId: workspaceId } })

  const posthog = usePostHog()
  const posthogRef = useRef(posthog)
  posthogRef.current = posthog

  const fileIdFromRoute =
    typeof params?.fileId === 'string' && params.fileId.length > 0 ? params.fileId : null
  const userPermissions = useUserPermissionsContext()
  const canEdit = userPermissions.canEdit === true
  const { config: permissionConfig } = usePermissionConfig()
  const { copied: copiedFileLink, copy: copyFileLink } = useCopyToClipboard({ resetMs: 1500 })

  // Joined for the live file tree: a `workspace-files-changed` broadcast invalidates the
  // browser. "Who's in this file" comes from the file-doc room (see FileDocRoomProvider),
  // not from who's browsing the Files section.
  useWorkspaceFilesRoom(workspaceId)

  useEffect(() => {
    if (permissionConfig.hideFilesTab) {
      router.replace(`/workspace/${workspaceId}`)
    }
  }, [permissionConfig.hideFilesTab, router, workspaceId])

  const {
    data: files = EMPTY_WORKSPACE_FILES,
    isLoading,
    isPlaceholderData,
    error,
  } = useWorkspaceFiles(workspaceId)
  const {
    data: folders = EMPTY_WORKSPACE_FILE_FOLDERS,
    isSuccess: foldersLoaded,
    isPlaceholderData: foldersArePlaceholder,
  } = useWorkspaceFileFolders(workspaceId)
  /** Matches `FolderNavigation.foldersResolved`, which the other resource pages read. */
  const foldersResolved = foldersLoaded && !foldersArePlaceholder
  const { data: members } = useWorkspaceMembersQuery(workspaceId)
  const pinnedFileIds = usePinnedIds(workspaceId, 'file')
  // Folders pin under their own resource type, so their pinned set is a separate query.
  const pinnedFolderIds = usePinnedIds(workspaceId, 'folder')
  const pinItem = usePinItem()
  const unpinItem = useUnpinItem()
  const membersById = useMemo(() => {
    const map = new Map<string, WorkspaceMember>()
    for (const member of members ?? []) map.set(member.userId, member)
    return map
  }, [members])
  const { mutateAsync: uploadFile } = useUploadWorkspaceFile()
  const createWorkspaceFile = useCreateWorkspaceFile()
  const notifyLimit = useLimitUpgradeToast()
  const deleteFile = useDeleteWorkspaceFile()
  const renameFile = useRenameWorkspaceFile()
  const createFolder = useCreateWorkspaceFileFolder()
  const updateFolder = useUpdateWorkspaceFileFolder()
  const moveItems = useMoveWorkspaceFileItems()
  const bulkArchiveItems = useBulkArchiveWorkspaceFileItems()

  const {
    isOpen: isContextMenuOpen,
    position: contextMenuPosition,
    handleContextMenu: openContextMenu,
    closeMenu: closeContextMenu,
  } = useContextMenu()

  const {
    isOpen: isListContextMenuOpen,
    position: listContextMenuPosition,
    handleContextMenu: handleListContextMenu,
    closeMenu: closeListContextMenu,
  } = useContextMenu()

  if (error) {
    logger.error('Failed to load files:', error)
  }

  const justCreatedFileIdRef = useRef<string | null>(null)
  const filesRef = useRef(files)
  filesRef.current = files
  /**
   * Indexed once. The drag hook resolves each dragged row's placement inside `dragover`, which
   * fires continuously — a linear scan there is O(selection x resources) per event.
   */
  const fileById = useMemo(() => {
    const byId = new Map<string, WorkspaceFileRecord>()
    for (const file of files) byId.set(file.id, file)
    return byId
  }, [files])
  const fileByIdRef = useRef(fileById)
  fileByIdRef.current = fileById

  const [uploadProgress, setUploadProgress] = useState({
    completed: 0,
    total: 0,
    currentPercent: 0,
  })
  /** An upload batch is in flight exactly while a total is set — matches the Tables page. */
  const uploading = uploadProgress.total > 0
  const [
    { search: urlSearchTerm, type: typeFilter, size: sizeFilter, uploadedBy: uploadedByFilter },
    setFileFilters,
  ] = useQueryStates(filesFilterParsers, filesFilterUrlKeys)

  /**
   * The input is controlled directly by the instant nuqs value; only the URL
   * write is debounced. The in-memory filter below still reads a debounced value
   * so it doesn't recompute on every keystroke.
   */
  const setSearchTerm = useDebouncedSearchSetter(
    (value, options) => setFileFilters({ search: value }, options),
    { debounceMs: FILES_SEARCH_DEBOUNCE_MS }
  )
  const debouncedSearchTerm = useSearchFilterValue(urlSearchTerm, FILES_SEARCH_DEBOUNCE_MS)

  /**
   * Files' equivalent of `useFolderNavigation`'s `openFolder`, which Tables and Knowledge
   * use — kept local because this page owns its own param group and has to clear `new` in
   * the same batch. Change the two together.
   *
   * Opens a folder, clearing any active query on the way in. Search spans every folder, so a
   * folder in the results is a destination the user picked out of them — not a narrower place
   * to keep searching. Carrying the term across would filter the folder they just opened down
   * to the same matches they were already looking at, which is how this read as "the folder is
   * empty".
   *
   * The writes land in one URL update: nuqs batches same-tick writes across param groups and
   * escalates the batch to `push`, so this stays a single history entry and Back returns to
   * the results that led here.
   */
  const navigateToFolder = useCallback(
    (folderId: string | null, options?: { history?: 'push' | 'replace' }) => {
      setSearchTerm('')
      void setFilesParams({ folderId, new: null }, options)
    },
    [setSearchTerm, setFilesParams]
  )

  const {
    sort: sortColumn,
    dir: sortDirection,
    activeSort,
    onSort: applyUrlSort,
  } = useUrlSort(filesSortParams, filesFilterUrlKeys)

  const currentListPreference = useMemo<ResourceListPreference>(
    () => ({
      sort: { column: sortColumn, direction: sortDirection },
      filters: {
        type: typeFilter,
        size: sizeFilter,
        uploadedBy: uploadedByFilter,
      },
    }),
    [sortColumn, sortDirection, typeFilter, sizeFilter, uploadedByFilter]
  )

  const applyListPreference = useCallback(
    (preference: ResourceListPreference) => {
      void setFileFilters({
        type: [...preference.filters.type],
        size: [...preference.filters.size],
        uploadedBy: [...preference.filters.uploadedBy],
      })
      applyUrlSort(preference.sort.column, preference.sort.direction)
    },
    [applyUrlSort, setFileFilters]
  )

  const {
    isReady: isListPreferenceReady,
    setFilter: setListFilter,
    clearFilters: clearFileFilters,
    setSort: setListSort,
    clearSort: clearListSort,
  } = useResourceListPreferences({
    workspaceId,
    config: filesListPreferenceConfig,
    preference: currentListPreference,
    applyPreference: applyListPreference,
    enabled: fileIdFromRoute === null,
  })

  const setTypeFilter = useCallback(
    (next: string[]) => setListFilter('type', next),
    [setListFilter]
  )
  const setSizeFilter = useCallback(
    (next: string[]) => setListFilter('size', next),
    [setListFilter]
  )
  const setUploadedByFilter = useCallback(
    (next: string[]) => setListFilter('uploadedBy', next),
    [setListFilter]
  )

  const [creatingFile, setCreatingFile] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [extractTargetId, setExtractTargetId] = useState<string | null>(null)
  const extractTarget = extractTargetId ? (fileById.get(extractTargetId) ?? null) : null
  const contextMenuItemRef = useRef<FileResourceItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{
    fileIds: string[]
    folderIds: string[]
    name: string
  } | null>(null)

  const listRename = useInlineRename({
    onSave: (rowId, name) => {
      const parsed = parseFolderedRowId(rowId)
      if (parsed.kind === 'folder') {
        return updateFolder.mutateAsync({ workspaceId, folderId: parsed.id, updates: { name } })
      }
      return renameFile.mutateAsync({ workspaceId, fileId: parsed.id, name })
    },
  })

  const headerRename = useInlineRename({
    onSave: (fileId, name) => renameFile.mutateAsync({ workspaceId, fileId, name }),
  })

  const breadcrumbRename = useInlineRename({
    onSave: (folderId, name) =>
      updateFolder.mutateAsync({ workspaceId, folderId, updates: { name } }),
  })

  const selectedFile = useMemo(
    () => (fileIdFromRoute ? files.find((f) => f.id === fileIdFromRoute) : null),
    [fileIdFromRoute, files]
  )
  const selectedFileRef = useRef(selectedFile)
  selectedFileRef.current = selectedFile

  /**
   * While a file is still untitled, name it after the leading heading the user types in its editor. The
   * editor reports the heading text (debounced); here we re-check the file is still untitled, derive a
   * unique `.md` name among its folder siblings, and rename. A no-op once the file has a real name.
   */
  const handleDeriveTitleFromHeading = useCallback(
    (headingText: string) => {
      const currentFile = selectedFileRef.current
      if (!currentFile || !isUntitledName(currentFile.name)) return
      const derived = deriveMarkdownFileName(headingText)
      if (!derived) return
      const siblingNames = new Set(
        filesRef.current
          .filter(
            (f) =>
              (f.folderId ?? null) === (currentFile.folderId ?? null) && f.id !== currentFile.id
          )
          .map((f) => f.name)
      )
      const name = uniqueMarkdownName(derived, siblingNames)
      if (name === currentFile.name) return
      renameFile
        .mutateAsync({ workspaceId, fileId: currentFile.id, name })
        .catch((err) => logger.error('Failed to auto-name file from heading:', err))
    },
    [workspaceId]
  )

  const historyFile = historyFileId ? files.find((file) => file.id === historyFileId) : undefined
  const browserModals = (
    <>
      {historyFile && (
        <FileHistoryModal
          key={`${workspaceId}:${historyFile.id}`}
          owner={{ entityType: 'workspace', entityId: workspaceId }}
          fileId={historyFile.id}
          fileName={historyFile.name}
          canWrite={canEdit}
          onClose={() => void setFilesParams({ historyFileId: null }, { history: 'replace' })}
        />
      )}
      {copySource && <FileCopyModal source={copySource} onClose={() => setCopySource(null)} />}
    </>
  )
  const shareFile = shareFileId ? (files.find((f) => f.id === shareFileId) ?? null) : null
  const shareModal = shareFile ? (
    <ShareModal
      open
      onOpenChange={(open) =>
        !open && setFilesParams({ shareFileId: null }, { history: 'replace' })
      }
      owner={{ entityType: 'workspace', entityId: workspaceId }}
      fileId={shareFile.id}
      fileName={shareFile.name}
      initialShare={shareFile.share ?? null}
    />
  ) : null

  const folderById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders])
  const folderByIdRef = useRef(folderById)
  folderByIdRef.current = folderById

  const folderSizeMap = useMemo(() => {
    const directSize = new Map<string, number>()
    for (const file of files) {
      if (file.folderId) {
        directSize.set(file.folderId, (directSize.get(file.folderId) ?? 0) + file.size)
      }
    }
    /**
     * Children indexed once rather than re-scanning `folders` per node — the roll-up visits
     * every folder, so the filter made this quadratic.
     */
    const childrenByParent = new Map<string, WorkspaceFileFolderApi[]>()
    for (const folder of folders) {
      if (!folder.parentId) continue
      const siblings = childrenByParent.get(folder.parentId)
      if (siblings) siblings.push(folder)
      else childrenByParent.set(folder.parentId, [folder])
    }

    const totalSize = new Map<string, number>()
    /**
     * `visiting` terminates a parent/child cycle. The optimistic folder-move write can produce
     * one in cache, and without the guard this recurses until the stack blows and takes the
     * whole page down — the same guard the shared folder helpers carry.
     */
    const visiting = new Set<string>()
    const getTotal = (folderId: string): number => {
      const cached = totalSize.get(folderId)
      if (cached !== undefined) return cached
      if (visiting.has(folderId)) return 0
      visiting.add(folderId)
      const size =
        (directSize.get(folderId) ?? 0) +
        (childrenByParent.get(folderId) ?? []).reduce((sum, child) => sum + getTotal(child.id), 0)
      visiting.delete(folderId)
      totalSize.set(folderId, size)
      return size
    }
    for (const folder of folders) getTotal(folder.id)
    return totalSize
  }, [files, folders])

  /**
   * A query stops scoping the list to the open folder — see {@link scopeFolderedItems}. A
   * matching folder anywhere in the workspace is a result in its own right, since opening it
   * is often what the user was looking for.
   */
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

  const filteredFiles = useMemo(() => {
    let result = scopeFolderedItems(files, {
      currentFolderId,
      search: debouncedSearchTerm,
      getParentId: (f) => f.folderId ?? null,
      getSearchText: (f) => [f.name],
    })

    if (typeFilter.length > 0) {
      result = result.filter((f) => {
        const ext = getFileExtension(f.name)
        // Matching the raw stored type would hide every file the browser uploaded as
        // `application/octet-stream` from the audio/video/image filters.
        const type = resolveEffectiveMimeType(f.type, f.name)
        if (typeFilter.includes('document') && isSupportedExtension(ext)) return true
        if (typeFilter.includes('audio') && isAudioFileType(type)) return true
        if (typeFilter.includes('video') && isVideoFileType(type)) return true
        if (typeFilter.includes('image') && type.startsWith('image/')) return true
        return false
      })
    }

    if (sizeFilter.length > 0) {
      result = result.filter((f) => {
        if (sizeFilter.includes('small') && f.size < FILE_BROWSER_SIZE_BOUNDARIES.small) return true
        if (
          sizeFilter.includes('medium') &&
          f.size >= FILE_BROWSER_SIZE_BOUNDARIES.small &&
          f.size <= FILE_BROWSER_SIZE_BOUNDARIES.medium
        )
          return true
        if (sizeFilter.includes('large') && f.size > FILE_BROWSER_SIZE_BOUNDARIES.medium)
          return true
        return false
      })
    }

    if (uploadedByFilter.length > 0) {
      result = result.filter(
        (f) => f.uploadedBy !== null && uploadedByFilter.includes(f.uploadedBy)
      )
    }

    return result
  }, [files, currentFolderId, debouncedSearchTerm, typeFilter, sizeFilter, uploadedByFilter])

  /**
   * Folders and files sort as ONE list — a folder never outranks a file it ties with, so a
   * pinned file reaches the top of the list rather than the top of the file section.
   *
   * Decorate-sort: each row's key + pinned flag is computed ONCE (O(N)) so the comparator
   * never re-runs Date parsing, `formatFileType`, or member lookups per comparison. Every
   * Files column has a folder equivalent (folders carry a size roll-up and sort as type
   * "Folder"), so no entry needs a null key here.
   */
  const sortedEntries = useMemo(() => {
    const entries: SortableResource<FileListEntry>[] = []

    for (const folder of visibleFolders) {
      entries.push({
        item: { kind: 'folder', folder },
        pinned: pinnedFolderIds.has(folder.id),
        name: folder.name,
        key:
          sortColumn === 'size'
            ? (folderSizeMap.get(folder.id) ?? 0)
            : sortColumn === 'type'
              ? FOLDER_TYPE_LABEL
              : sortColumn === 'created'
                ? new Date(folder.createdAt).getTime()
                : sortColumn === 'updated'
                  ? new Date(folder.updatedAt).getTime()
                  : sortColumn === 'owner'
                    ? (membersById.get(folder.userId ?? '')?.name ?? null)
                    : folder.name,
      })
    }

    for (const file of filteredFiles) {
      entries.push({
        item: { kind: 'file', file },
        pinned: pinnedFileIds.has(file.id),
        name: file.name,
        key:
          sortColumn === 'size'
            ? file.size
            : sortColumn === 'type'
              ? formatFileBrowserType(file.type, file.name)
              : sortColumn === 'created'
                ? new Date(file.uploadedAt).getTime()
                : sortColumn === 'updated'
                  ? new Date(file.updatedAt).getTime()
                  : sortColumn === 'owner'
                    ? (membersById.get(file.uploadedBy ?? '')?.name ?? null)
                    : file.name,
      })
    }

    return sortResources(entries, sortDirection)
  }, [
    visibleFolders,
    filteredFiles,
    sortColumn,
    sortDirection,
    membersById,
    folderSizeMap,
    pinnedFolderIds,
    pinnedFileIds,
  ])

  const baseRows: ResourceRow[] = useMemo(
    () =>
      sortedEntries.map(({ item, pinned }): ResourceRow => {
        if (item.kind === 'folder') {
          const { folder } = item
          const totalSize = folderSizeMap.get(folder.id) ?? 0
          return {
            id: folderRowId(folder.id),
            cells: {
              name: {
                icon: FOLDER_ICON,
                label: folder.name,
                pinned,
              },
              size: {
                label:
                  totalSize > 0
                    ? formatFileSize(totalSize, { includeBytes: true })
                    : EMPTY_CELL_PLACEHOLDER,
              },
              type: {
                icon: FOLDER_ICON,
                label: FOLDER_TYPE_LABEL,
              },
              created: timeCell(folder.createdAt),
              owner: folder.userId
                ? ownerCell(folder.userId, membersById)
                : { label: 'Deleted user' },
              updated: timeCell(folder.updatedAt),
              /**
               * A folder's location is its parent's path, not its own. Built only while
               * searching: the column is absent otherwise, so resolving an ancestor chain
               * per row would be work every row throws away.
               */
              location: isSearching
                ? {
                    label: folderLocationLabel(folder.parentId, folderById, FILES_HEADER.rootLabel),
                  }
                : EMPTY_LOCATION_CELL,
            },
          }
        }

        const { file } = item
        const Icon = getDocumentIcon(file.type || '', file.name)
        return {
          id: file.id,
          cells: {
            name: {
              icon: <Icon className='size-[14px]' />,
              label: file.name,
              pinned,
            },
            size: {
              label: formatFileSize(file.size, { includeBytes: true }),
            },
            type: {
              icon: <Icon className='size-[14px]' />,
              label: formatFileBrowserType(file.type, file.name),
            },
            created: timeCell(file.uploadedAt),
            owner: file.uploadedBy
              ? ownerCell(file.uploadedBy, membersById)
              : { label: 'Deleted user' },
            updated: timeCell(file.updatedAt),
            location: isSearching
              ? { label: folderLocationLabel(file.folderId, folderById, FILES_HEADER.rootLabel) }
              : EMPTY_LOCATION_CELL,
          },
        }
      }),
    [sortedEntries, membersById, folderSizeMap, folderById, isSearching]
  )

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
  }, [baseRows, listRename.editingId, listRename.editValue, listRename.isSaving])

  // Find (Cmd/Ctrl+F): the shared find bar over the visible list, stepping
  // through rows whose name matches. The list is client-side, so matching is
  // synchronous — no debounce or loading states.
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findIndex, setFindIndex] = useState(0)
  const findInputRef = useRef<HTMLInputElement>(null)
  const tableApiRef = useRef<ResourceTableHandle | null>(null)

  const trimmedFindQuery = findQuery.trim().toLowerCase()
  const findMatchIds = useMemo<readonly string[]>(() => {
    if (!findOpen || trimmedFindQuery.length === 0) return EMPTY_FIND_MATCH_IDS
    const ids = rows
      .filter((row) => (row.cells.name?.label ?? '').toLowerCase().includes(trimmedFindQuery))
      .map((row) => row.id)
    return ids.length > 0 ? ids : EMPTY_FIND_MATCH_IDS
  }, [rows, findOpen, trimmedFindQuery])
  const findMatchIdsRef = useRef(findMatchIds)
  findMatchIdsRef.current = findMatchIds
  const findIndexRef = useRef(findIndex)
  findIndexRef.current = findIndex

  const goToFindMatch = useCallback((index: number) => {
    const matches = findMatchIdsRef.current
    if (matches.length === 0) return
    const wrapped = ((index % matches.length) + matches.length) % matches.length
    setFindIndex(wrapped)
    tableApiRef.current?.scrollToRow(matches[wrapped])
  }, [])

  /**
   * A new term resets to and reveals its first match. Keyed on the term, not
   * the match set: rows regenerate on renames, uploads and SSE refreshes, and
   * re-revealing then would yank a user who has stepped elsewhere back to
   * match one.
   */
  useEffect(() => {
    setFindIndex(0)
    if (trimmedFindQuery.length === 0) return
    const first = findMatchIdsRef.current[0]
    if (first) tableApiRef.current?.scrollToRow(first)
  }, [trimmedFindQuery])

  const handleFindNext = useCallback(() => {
    goToFindMatch(findIndexRef.current + 1)
  }, [goToFindMatch])

  const handleFindPrev = useCallback(() => {
    goToFindMatch(findIndexRef.current - 1)
  }, [goToFindMatch])

  /** Closing clears the search: term, highlights and cursor all go. */
  const handleFindClose = useCallback(() => {
    setFindOpen(false)
    setFindQuery('')
    setFindIndex(0)
  }, [])

  /**
   * Rows for the table, with the active term tinted into matching name cells.
   * Layered over `rows` so selection, drag-drop and keyboard nav keep reading
   * the canonical list.
   */
  const displayRows: ResourceRow[] = useMemo(() => {
    if (findMatchIds.length === 0) return rows
    const matchSet = new Set(findMatchIds)
    return rows.map((row) =>
      matchSet.has(row.id)
        ? { ...row, cells: { ...row.cells, name: { ...row.cells.name, highlight: findQuery } } }
        : row
    )
  }, [rows, findMatchIds, findQuery])

  const visibleRowIds = useMemo(() => rows.map((row) => row.id), [rows])

  const {
    selectedRowIds,
    selectable: selectableConfig,
    replaceSelection,
    clearSelection,
  } = useResourceRowSelection({
    visibleRowIds,
    isKeyboardBlocked: () => Boolean(fileIdFromRoute) || listRename.editingId !== null,
    onDeleteSelected: () => handleBulkDelete(),
  })

  const { folderIds: selectedFolderIds, resourceIds: selectedFileIds } = useMemo(
    () => splitFolderedRowIds(selectedRowIds),
    [selectedRowIds]
  )

  const descendantFolderIdsByFolderId = useMemo(() => buildDescendantIndex(folders), [folders])

  const uploadFiles = (filesToUpload: File[], targetFolderId = currentFolderId) => {
    const uploadBatch = async () => {
      if (!workspaceId || filesToUpload.length === 0 || !canEdit) return

      /**
       * Uploads land in a folder, but a live query is showing results from across the
       * workspace and an uploaded name rarely matches it — the new rows would not render and
       * the upload would read as having failed. Cleared up front so the list is already
       * showing the destination as the progress counter runs.
       */
      setSearchTerm('')

      const oversized: string[] = []
      const allowedFiles = filesToUpload.filter((f) => {
        if (f.size > MAX_WORKSPACE_FILE_SIZE) {
          oversized.push(f.name)
          return false
        }
        return true
      })
      if (oversized.length > 0) {
        toast.error(
          oversized.length === 1
            ? `${oversized[0]} exceeds the 5 GiB upload limit`
            : `${oversized.length} files exceed the 5 GiB upload limit`
        )
      }

      if (allowedFiles.length === 0) return

      try {
        setUploadProgress({ completed: 0, total: allowedFiles.length, currentPercent: 0 })

        for (let i = 0; i < allowedFiles.length; i++) {
          try {
            await uploadFile({
              workspaceId,
              file: allowedFiles[i],
              folderId: targetFolderId,
              onProgress: ({ percent }) => {
                setUploadProgress((prev) => ({ ...prev, currentPercent: percent }))
              },
            })
          } catch (err) {
            logger.error('Error uploading file:', err)
            const message = getErrorMessage(err)
            if (/storage limit/i.test(message)) {
              notifyLimit('storage', message)
            } else {
              toast.error(`Failed to upload "${allowedFiles[i].name}"`, { description: message })
            }
          } finally {
            setUploadProgress({
              completed: i + 1,
              total: allowedFiles.length,
              currentPercent: 0,
            })
          }
        }
      } finally {
        setUploadProgress({ completed: 0, total: 0, currentPercent: 0 })
      }
    }
    uploadQueueRef.current = uploadQueueRef.current.then(uploadBatch).catch((error) => {
      logger.error('Error uploading files:', error)
      toast.error(getErrorMessage(error, 'Failed to upload files'))
    })
    return uploadQueueRef.current
  }

  const rowDragDropConfig = useFolderRowDragDrop({
    dragMime: FILE_ROW_DRAG_MIME,
    owner: { entityType: 'workspace', entityId: workspaceId },
    canEdit,
    editingRowId: listRename.editingId,
    descendantsByFolderId: descendantFolderIdsByFolderId,
    getFolderParentId: (folderId) => folderByIdRef.current.get(folderId)?.parentId,
    getResourceFolderId: (fileId) => fileByIdRef.current.get(fileId)?.folderId,
    getRowLabel: (rowId) => {
      const parsed = parseFolderedRowId(rowId)
      return parsed.kind === 'folder'
        ? (folderByIdRef.current.get(parsed.id)?.name ?? 'Folder')
        : (fileByIdRef.current.get(parsed.id)?.name ?? 'File')
    },
    onMoveRows: ({ folderIds, resourceIds }, targetFolderId) => {
      void moveItems
        .mutateAsync({ workspaceId, fileIds: resourceIds, folderIds, targetFolderId })
        .then(() => clearSelection())
        .catch((error) => logger.error('Failed to move items:', error))
    },
    selection: { selectedRowIds, visibleRowIds, replaceSelection },
    /**
     * Moves the folder without touching the query, unlike every other navigation here.
     *
     * A spring-open is a step inside a drag, not a destination the user chose, and it is
     * undone when the drag ends without a drop. Clearing the query on the way in would be
     * clearing it on the way back out too — the restore runs through this same callback —
     * so an abandoned drag would silently discard the search that produced the row being
     * dragged, with `history: 'replace'` leaving nothing for Back to recover.
     */
    onSpringOpenFolder: (folderId, options) => {
      void setFilesParams({ folderId, new: null }, options)
    },
    currentFolderId,
    bodyDropFolderId: isSearching ? undefined : currentFolderId,
    /**
     * The one thing this list does that the others do not. Folder rows still highlight and
     * spring open for an OS file drag — filing an upload into a nested folder is the same
     * gesture — while the body and breadcrumb decline so the page-level "Drop to upload"
     * overlay owns those regions instead of competing with them.
     */
    externalDrop: {
      matches: hasExternalFiles,
      onDropIntoFolder: (dataTransfer, targetFolderId) => {
        uploadDrop.dismiss()
        const dropped = getDroppedFiles(dataTransfer)
        if (dropped.length > 0) void uploadFiles(dropped, targetFolderId)
      },
    },
  })

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files
    if (!list || list.length === 0) return
    await uploadFiles(Array.from(list))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const uploadDrop = useFileUploadDrop({
    enabled: canEdit,
    onDrop: (files) => {
      rowDragDropConfig.externalDropHandled()
      if (files.length > 0) void uploadFiles(files)
    },
  })

  const handleDownload = useCallback(
    async (file: WorkspaceFileRecord) => {
      try {
        await triggerFileDownload(file, downloadSourceRef.current)
        captureEvent(posthogRef.current, 'file_downloaded', {
          workspace_id: workspaceId,
          is_bulk: false,
          file_count: 1,
        })
      } catch (err) {
        logger.error('Failed to download file:', err)
        toast.error(getErrorMessage(err, `Failed to download "${file.name}"`))
      }
    },
    [workspaceId]
  )

  const deleteTargetRef = useRef(deleteTarget)
  deleteTargetRef.current = deleteTarget
  const fileIdFromRouteRef = useRef(fileIdFromRoute)
  fileIdFromRouteRef.current = fileIdFromRoute

  const handleDelete = useCallback(async () => {
    const target = deleteTargetRef.current
    if (!target) return

    try {
      if (target.folderIds.length > 0 || target.fileIds.length > 1) {
        await bulkArchiveItems.mutateAsync({
          workspaceId,
          fileIds: target.fileIds,
          folderIds: target.folderIds,
        })
      } else if (target.fileIds.length === 1) {
        await deleteFile.mutateAsync({
          workspaceId,
          fileId: target.fileIds[0],
        })
      } else {
        setShowDeleteConfirm(false)
        setDeleteTarget(null)
        return
      }
      setShowDeleteConfirm(false)
      setDeleteTarget(null)
      clearSelection()
      if (target.fileIds.includes(fileIdFromRouteRef.current ?? '')) {
        setIsDirty(false)
        setSaveStatus('idle')
        router.push(folderedResourceListHref('file', workspaceId, currentFolderId))
      }
    } catch (err) {
      logger.error('Failed to delete file:', err)
    }
  }, [workspaceId, router, currentFolderId])

  const handleStartHeaderRename = useCallback(() => {
    const file = selectedFileRef.current
    if (file) headerRename.startRename(file.id, file.name)
  }, [headerRename.startRename])

  const handleDownloadSelected = useCallback(() => {
    const file = selectedFileRef.current
    if (file) handleDownload(file)
  }, [handleDownload])

  const handleDeleteSelected = useCallback(() => {
    const file = selectedFileRef.current
    if (file) {
      setDeleteTarget({ fileIds: [file.id], folderIds: [], name: file.name })
      setShowDeleteConfirm(true)
    }
  }, [])

  const handleShareSelected = useCallback(() => {
    const file = selectedFileRef.current
    if (file) setFilesParams({ shareFileId: file.id }, { history: 'replace' })
  }, [setFilesParams])

  const handleBulkDelete = useCallback(() => {
    if (selectedFileIds.length === 0 && selectedFolderIds.length === 0) return
    setDeleteTarget({
      fileIds: selectedFileIds,
      folderIds: selectedFolderIds,
      name: selectionLabel(
        selectedFileIds.length + selectedFolderIds.length,
        files.find((file) => file.id === selectedFileIds[0])?.name ??
          folders.find((folder) => folder.id === selectedFolderIds[0])?.name
      ),
    })
    setShowDeleteConfirm(true)
  }, [selectedFileIds, selectedFolderIds, files, folders])

  const [isDownloadingArchive, setIsDownloadingArchive] = useState(false)
  // Ref as well as state: two clicks in the same tick would both pass a state check,
  // and each concurrent archive holds the whole zip in tab memory.
  const archiveDownloadInFlightRef = useRef(false)

  const downloadArchive = useCallback(
    async (selection: { fileIds?: string[]; folderIds?: string[] }) => {
      if (archiveDownloadInFlightRef.current) return
      archiveDownloadInFlightRef.current = true
      setIsDownloadingArchive(true)
      try {
        await triggerArchiveDownload({ workspaceId, ...selection })
      } catch (err) {
        logger.error('Failed to download selection:', err)
        toast.error(getErrorMessage(err, 'Failed to download the selected files'))
      } finally {
        archiveDownloadInFlightRef.current = false
        setIsDownloadingArchive(false)
      }
    },
    [workspaceId]
  )

  const handleBulkDownload = useCallback(async () => {
    const selectedFiles = files.filter((file) => selectedFileIds.includes(file.id))
    if (selectedFiles.length === 1 && selectedFolderIds.length === 0) {
      handleDownload(selectedFiles[0])
      return
    }

    if (selectedFileIds.length === 0 && selectedFolderIds.length === 0) return
    captureEvent(posthogRef.current, 'file_downloaded', {
      workspace_id: workspaceId,
      is_bulk: true,
      file_count: selectedFileIds.length + selectedFolderIds.length,
    })
    await downloadArchive({ fileIds: selectedFileIds, folderIds: selectedFolderIds })
  }, [selectedFileIds, selectedFolderIds, files, handleDownload, downloadArchive, workspaceId])

  const fileDetailBreadcrumbs = useMemo((): BreadcrumbItem[] => {
    if (!selectedFile) return []

    return folderBreadcrumbItems({
      rootLabel: FILES_HEADER.rootLabel,
      rootIcon: FILES_HEADER.rootIcon,
      breadcrumbs: breadcrumbFolderChain(selectedFile.folderId, folderById),
      onNavigate: (folderId) =>
        handleNavigateFromFileDetail(folderedResourceListHref('file', workspaceId, folderId)),
      trailing: [
        {
          label: selectedFile.name,
          editing: headerRename.editingId
            ? {
                isEditing: true,
                value: headerRename.editValue,
                onChange: headerRename.setEditValue,
                onSubmit: headerRename.submitRename,
                onCancel: headerRename.cancelRename,
              }
            : undefined,
          dropdownItems: [
            { label: 'Download', icon: Download, onClick: handleDownloadSelected },
            ...(canEdit
              ? [
                  { label: 'Rename', icon: Pencil, onClick: handleStartHeaderRename },
                  { label: 'Share', icon: Send, onClick: handleShareSelected },
                  { label: 'Delete', icon: Trash, onClick: handleDeleteSelected },
                ]
              : []),
          ],
        },
      ],
    })
  }, [
    selectedFile,
    folderById,
    handleNavigateFromFileDetail,
    workspaceId,
    canEdit,
    headerRename.editingId,
    headerRename.editValue,
    handleStartHeaderRename,
    handleDownloadSelected,
    handleShareSelected,
    handleDeleteSelected,
  ])

  const creatingFileRef = useRef(creatingFile)
  creatingFileRef.current = creatingFile

  const handleCreateFile = useCallback(async () => {
    if (creatingFileRef.current) return
    setCreatingFile(true)

    try {
      const existingNames = new Set(
        filesRef.current.filter((f) => (f.folderId ?? null) === currentFolderId).map((f) => f.name)
      )
      const name = uniqueMarkdownName(DEFAULT_UNTITLED_NAME, existingNames)

      const mimeType = getMimeTypeFromExtension('md')
      const result = await createWorkspaceFile.mutateAsync({
        workspaceId,
        name,
        contentType: mimeType,
        folderId: currentFolderId ?? undefined,
      })
      const fileId = result.file.id
      if (fileId) {
        justCreatedFileIdRef.current = fileId
        const params = new URLSearchParams({ new: '1' })
        if (currentFolderId) params.set('folderId', currentFolderId)
        router.push(`/workspace/${workspaceId}/files/${fileId}?${params.toString()}`)
      }
    } catch (err) {
      logger.error('Failed to create file:', err)
    } finally {
      setCreatingFile(false)
    }
  }, [workspaceId, router, currentFolderId])

  const handleCreateFolder = useCallback(async () => {
    if (!workspaceId) return
    const existingNames = new Set(
      folders
        .filter((folder) => (folder.parentId ?? null) === currentFolderId)
        .map((folder) => folder.name)
    )
    let name = 'New folder'
    let counter = 1
    while (existingNames.has(name)) {
      name = `New folder (${counter})`
      counter++
    }

    try {
      const folder = await createFolder.mutateAsync({
        workspaceId,
        name,
        parentId: currentFolderId,
      })
      /**
       * The new folder goes into the open folder, but a live query is showing results from
       * across the workspace and "New folder" almost never matches it — the row would not
       * render and the rename it opens would have nothing to attach to, so creating would
       * read as having done nothing at all.
       */
      setSearchTerm('')
      listRename.startRename(folderRowId(folder.id), folder.name)
    } catch (error) {
      logger.error('Failed to create folder:', error)
      toast.error(toError(error).message)
    }
  }, [workspaceId, folders, currentFolderId, listRename.startRename, setSearchTerm])

  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent, rowId: string) => {
      const parsed = parseFolderedRowId(rowId)
      const item =
        parsed.kind === 'folder'
          ? folders.find((folder) => folder.id === parsed.id)
          : filesRef.current.find((file) => file.id === parsed.id)
      if (!item) return
      contextMenuItemRef.current =
        parsed.kind === 'folder'
          ? { kind: 'folder', id: parsed.id, folder: item as WorkspaceFileFolderApi }
          : { kind: 'file', id: parsed.id, file: item as WorkspaceFileRecord }
      if (!selectedRowIds.has(rowId)) {
        replaceSelection([rowId])
      }
      openContextMenu(e)
    },
    [folders, openContextMenu, selectedRowIds]
  )

  const handleContextMenuOpen = useCallback(() => {
    const item = contextMenuItemRef.current
    if (!item) return
    if (item.kind === 'folder') {
      navigateToFolder(item.folder.id)
      closeContextMenu()
      return
    }
    router.push(
      item.file.folderId
        ? `/workspace/${workspaceId}/files/${item.file.id}?folderId=${item.file.folderId}`
        : `/workspace/${workspaceId}/files/${item.file.id}`
    )
    closeContextMenu()
  }, [closeContextMenu, router, workspaceId, navigateToFolder])

  const handleContextMenuDownload = useCallback(() => {
    const item = contextMenuItemRef.current
    if (!item) return
    const rowId = item.kind === 'file' ? item.file.id : folderRowId(item.folder.id)
    if (selectedRowIds.has(rowId) && selectedRowIds.size > 1) {
      void handleBulkDownload()
      closeContextMenu()
      return
    }
    if (item.kind === 'folder') {
      const folderId = item.folder.id
      closeContextMenu()
      void downloadArchive({ folderIds: [folderId] })
      return
    }
    handleDownload(item.file)
    closeContextMenu()
  }, [selectedRowIds, handleBulkDownload, closeContextMenu, downloadArchive, handleDownload])

  const handleCopySelection = useCallback(() => {
    if (selectedFileIds.length + selectedFolderIds.length === 0) return
    setCopySource({
      owner: { entityType: 'workspace', entityId: workspaceId },
      fileIds: selectedFileIds,
      folderIds: selectedFolderIds,
    })
    closeContextMenu()
  }, [workspaceId, selectedFileIds, selectedFolderIds, closeContextMenu])

  const handleContextMenuHistory = useCallback(() => {
    const item = contextMenuItemRef.current
    if (item?.kind === 'file')
      void setFilesParams({ historyFileId: item.file.id }, { history: 'replace' })
    closeContextMenu()
  }, [setFilesParams, closeContextMenu])

  const handleContextMenuCopyLink = useCallback(() => {
    const item = contextMenuItemRef.current
    if (item?.kind === 'file') {
      void copyFileLink(
        `${window.location.origin}/workspace/${workspaceId}/files/${item.file.id}`
      ).then((copied) => {
        if (copied) toast.success('Copied link to clipboard')
        else toast.error('Failed to copy link')
      })
    }
    closeContextMenu()
  }, [closeContextMenu, copyFileLink, workspaceId])

  const handleContextMenuRename = useCallback(() => {
    const item = contextMenuItemRef.current
    if (item?.kind === 'file') listRename.startRename(item.file.id, item.file.name)
    if (item?.kind === 'folder')
      listRename.startRename(folderRowId(item.folder.id), item.folder.name)
    closeContextMenu()
  }, [listRename.startRename, closeContextMenu])

  const handleContextMenuShare = useCallback(() => {
    const item = contextMenuItemRef.current
    if (item?.kind === 'file') setFilesParams({ shareFileId: item.file.id }, { history: 'replace' })
    closeContextMenu()
  }, [closeContextMenu, setFilesParams])

  const handleContextMenuDelete = useCallback(() => {
    const item = contextMenuItemRef.current
    if (!item) return
    const rowId = item.kind === 'file' ? item.file.id : folderRowId(item.folder.id)
    if (selectedRowIds.has(rowId) && selectedRowIds.size > 1) {
      handleBulkDelete()
      closeContextMenu()
      return
    }
    setDeleteTarget(
      item.kind === 'file'
        ? { fileIds: [item.file.id], folderIds: [], name: item.file.name }
        : { fileIds: [], folderIds: [item.folder.id], name: item.folder.name }
    )
    setShowDeleteConfirm(true)
    closeContextMenu()
  }, [selectedRowIds, handleBulkDelete, closeContextMenu])

  const handleContextMenuTogglePin = useCallback(() => {
    const item = contextMenuItemRef.current
    if (!item) return
    const resourceType = item.kind === 'folder' ? 'folder' : 'file'
    const pinned =
      item.kind === 'folder' ? pinnedFolderIds.has(item.id) : pinnedFileIds.has(item.id)
    const mutation = pinned ? unpinItem : pinItem
    mutation.mutate({ workspaceId, resourceType, resourceId: item.id })
    closeContextMenu()
  }, [workspaceId, pinnedFolderIds, pinnedFileIds, closeContextMenu])

  const handleContextMenuMove = useCallback(
    async (optionValue: string) => {
      const targetFolderId = parseMoveOptionValue(optionValue)
      try {
        await moveItems.mutateAsync({
          workspaceId,
          fileIds: selectedFileIds,
          folderIds: selectedFolderIds,
          targetFolderId,
        })
        clearSelection()
        closeContextMenu()
      } catch (error) {
        logger.error('Failed to move items:', error)
      }
    },
    [workspaceId, selectedFileIds, selectedFolderIds, closeContextMenu]
  )

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

  const handleListUploadFile = useCallback(() => {
    if (!canEdit || uploading) return
    fileInputRef.current?.click()
    closeListContextMenu()
  }, [canEdit, uploading, closeListContextMenu])

  useEffect(() => {
    if (isNewFile && fileIdFromRoute) {
      void setFilesParams({ new: null }, { history: 'replace', scroll: false })
    }
  }, [isNewFile, fileIdFromRoute, setFilesParams])

  const selectedRowIdsRef = useRef(selectedRowIds)
  selectedRowIdsRef.current = selectedRowIds
  const visibleRowIdsRef = useRef(visibleRowIds)
  visibleRowIdsRef.current = visibleRowIds
  const listRenameActiveRef = useRef(listRename.editingId)
  listRenameActiveRef.current = listRename.editingId
  const handleBulkDeleteRef = useRef(handleBulkDelete)
  handleBulkDeleteRef.current = handleBulkDelete

  useEffect(() => {
    const handleListKeyDown = (e: KeyboardEvent) => {
      if (fileIdFromRouteRef.current) return
      const active = document.activeElement
      if (
        active &&
        (active.tagName === 'INPUT' ||
          active.tagName === 'TEXTAREA' ||
          (active as HTMLElement).isContentEditable)
      )
        return
      if (listRenameActiveRef.current) return

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRowIdsRef.current.size > 0) {
        e.preventDefault()
        handleBulkDeleteRef.current()
        return
      }

      if (e.key === 'Escape' && selectedRowIdsRef.current.size > 0) {
        e.preventDefault()
        clearSelection()
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'a' && visibleRowIdsRef.current.length > 0) {
        e.preventDefault()
        replaceSelection(visibleRowIdsRef.current)
      }
    }
    window.addEventListener('keydown', handleListKeyDown)
    return () => window.removeEventListener('keydown', handleListKeyDown)
  }, [])

  /**
   * Overrides the browser's Cmd/Ctrl+F with the in-list find while the list is
   * showing. Handed to the open file's editor instead once one is open.
   */
  const handleFindOpen = useCallback(() => setFindOpen(true), [])
  useFindShortcut({
    enabled: !fileIdFromRoute,
    inputRef: findInputRef,
    onOpen: handleFindOpen,
  })

  const fileActions = useMemo<ResourceAction[]>(() => {
    if (!selectedFile) return []
    return [
      {
        id: 'copy-link',
        text: copiedFileLink ? 'Copied!' : 'Copy Link',
        icon: copiedFileLink ? Check : Link,
        onSelect: () =>
          void copyFileLink(
            `${window.location.origin}/workspace/${workspaceId}/files/${selectedFile.id}`
          ),
      },
      {
        text: 'Download',
        icon: Download,
        onSelect: handleDownloadSelected,
      },
      {
        id: 'history',
        text: 'Version History',
        icon: Clock,
        onSelect: () =>
          void setFilesParams({ historyFileId: selectedFile.id }, { history: 'replace' }),
      },
      {
        id: 'copy',
        text: 'Copy to...',
        icon: Duplicate,
        onSelect: () =>
          setCopySource({
            owner: { entityType: 'workspace', entityId: workspaceId },
            fileIds: [selectedFile.id],
            folderIds: [],
          }),
      },
      ...(canEdit
        ? [
            {
              text: 'Share',
              icon: Send,
              onSelect: handleShareSelected,
            },
            {
              id: 'delete',
              text: 'Delete',
              icon: Trash,
              onSelect: handleDeleteSelected,
            },
          ]
        : []),
    ]
  }, [
    selectedFile,
    setFilesParams,
    canEdit,
    handleDownloadSelected,
    copiedFileLink,
    copyFileLink,
    workspaceId,
    handleShareSelected,
    handleDeleteSelected,
  ])

  const listRenameRef = useRef(listRename)
  listRenameRef.current = listRename
  const headerRenameRef = useRef(headerRename)
  headerRenameRef.current = headerRename

  const handleRowClick = useCallback(
    (rowId: string) => {
      if (listRenameRef.current.editingId !== rowId && !headerRenameRef.current.editingId) {
        const parsed = parseFolderedRowId(rowId)
        if (parsed.kind === 'folder') {
          navigateToFolder(parsed.id)
          return
        }
        const file = fileByIdRef.current.get(parsed.id)
        if (file && isArchiveFileName(file.name)) {
          setExtractTargetId(file.id)
          return
        }
        /**
         * The file's own folder, not the open one. A search result usually lives elsewhere,
         * and this param is what the viewer returns to on close or delete — carrying the open
         * folder would send the user to a folder the file was never in.
         */
        const fileFolderId = file?.folderId ?? null
        router.push(
          fileFolderId
            ? `/workspace/${workspaceId}/files/${parsed.id}?folderId=${fileFolderId}`
            : `/workspace/${workspaceId}/files/${parsed.id}`
        )
      }
    },
    [router, workspaceId, navigateToFolder]
  )

  const handleUploadClick = useCallback(() => {
    if (!canEdit || uploading) return
    fileInputRef.current?.click()
  }, [canEdit, uploading])

  useRegisterGlobalCommands(() => [
    { id: 'files-upload', handler: () => handleUploadClick() },
    { id: 'files-new-file', handler: () => void handleCreateFile() },
    { id: 'files-new-folder', handler: () => void handleCreateFolder() },
    { id: 'file-download', handler: () => handleDownloadSelected() },
    { id: 'file-rename', handler: () => handleStartHeaderRename() },
    { id: 'file-share', handler: () => handleShareSelected() },
    { id: 'file-delete', handler: () => handleDeleteSelected() },
  ])

  const searchConfig: SearchConfig = useMemo(
    () => ({
      value: urlSearchTerm,
      onChange: setSearchTerm,
      onClearAll: () => setSearchTerm(''),
      placeholder: 'Search files...',
    }),
    [urlSearchTerm, setSearchTerm]
  )

  const uploadButtonLabel = uploading
    ? uploadProgress.currentPercent > 0 && uploadProgress.currentPercent < 100
      ? `${uploadProgress.completed}/${uploadProgress.total} · ${uploadProgress.currentPercent}%`
      : `${uploadProgress.completed}/${uploadProgress.total}`
    : 'Upload'

  const headerActionsConfig = useMemo<ResourceAction[]>(
    () => [
      {
        text: uploadButtonLabel,
        icon: Upload,
        onSelect: handleUploadClick,
        disabled: uploading || !canEdit,
      },
      {
        text: 'New folder',
        icon: FolderPlus,
        onSelect: handleCreateFolder,
        disabled: createFolder.isPending || !canEdit,
      },
      {
        text: 'New file',
        icon: Plus,
        onSelect: handleCreateFile,
        disabled: uploading || creatingFile || !canEdit,
        variant: 'primary',
      },
    ],
    [
      uploadButtonLabel,
      handleUploadClick,
      handleCreateFolder,
      handleCreateFile,
      createFolder.isPending,
      canEdit,
      uploading,
      creatingFile,
    ]
  )

  const listFolderChain = useMemo(
    () => breadcrumbFolderChain(currentFolderId, folderById),
    [currentFolderId, folderById]
  )

  /**
   * The trail while a file's content loads. Holds the URL's open folder so arriving from a
   * list page inside `A/B` doesn't collapse to `Files / …` and jump back out once the file
   * lands; a cold deep-link has no `?folderId=` and no loaded file, so it starts at the root.
   *
   * Renders on the file *detail* route, so its crumbs navigate through the router like
   * {@link fileDetailBreadcrumbs} — a nuqs write would only requery this file's own URL.
   */
  const loadingBreadcrumbs = useMemo(
    (): BreadcrumbItem[] =>
      folderBreadcrumbItems({
        rootLabel: FILES_HEADER.rootLabel,
        rootIcon: FILES_HEADER.rootIcon,
        breadcrumbs: listFolderChain,
        onNavigate: (folderId) =>
          handleNavigateFromFileDetail(folderedResourceListHref('file', workspaceId, folderId)),
        trailing: [{ label: '…', terminal: true }],
      }),
    [listFolderChain, handleNavigateFromFileDetail, workspaceId]
  )

  const openListFolder = currentFolderId ? folderById.get(currentFolderId) : undefined

  const listBreadcrumbs = useMemo(
    (): BreadcrumbItem[] =>
      folderBreadcrumbItems({
        rootLabel: FILES_HEADER.rootLabel,
        rootIcon: FILES_HEADER.rootIcon,
        breadcrumbs: listFolderChain,
        onNavigate: navigateToFolder,
        currentFolderEditing:
          openListFolder && breadcrumbRename.editingId === openListFolder.id
            ? {
                isEditing: true,
                value: breadcrumbRename.editValue,
                onChange: breadcrumbRename.setEditValue,
                onSubmit: breadcrumbRename.submitRename,
                onCancel: breadcrumbRename.cancelRename,
              }
            : undefined,
        currentFolderActions:
          openListFolder && (canEdit || userPermissions.isLoading)
            ? [
                {
                  label: 'Rename',
                  icon: Pencil,
                  disabled: !canEdit,
                  onClick: () =>
                    breadcrumbRename.startRename(openListFolder.id, openListFolder.name),
                },
              ]
            : undefined,
      }),
    [
      listFolderChain,
      openListFolder,
      navigateToFolder,
      canEdit,
      userPermissions.isLoading,
      breadcrumbRename.editingId,
      breadcrumbRename.editValue,
      breadcrumbRename.setEditValue,
      breadcrumbRename.submitRename,
      breadcrumbRename.cancelRename,
      breadcrumbRename.startRename,
    ]
  )

  const memberOptions: ComboboxOption[] = useMemo(
    () =>
      (members ?? []).map((m) => ({
        value: m.userId,
        label: m.name,
        iconElement: <Avatar size='xs' name={m.name} src={m.image} aria-hidden />,
      })),
    [members]
  )

  const contextMenuMoveOptions = useMemo<MoveOptionNode[]>(
    () =>
      buildMoveOptionsExcludingSubtrees({
        folders,
        rootLabel: 'Files',
        excludeFolderIds: selectedFolderIds,
        descendantsByFolderId: descendantFolderIdsByFolderId,
      }),
    [folders, selectedFolderIds, descendantFolderIdsByFolderId]
  )

  const sortConfig: SortConfig = useMemo(
    () => ({
      options: [...FILE_BROWSER_SORT_OPTIONS],
      active: activeSort,
      onSort: setListSort,
      onClear: clearListSort,
    }),
    [activeSort, setListSort, clearListSort]
  )

  const filterContent = useMemo(
    () => (
      <FileFilterControls
        types={typeFilter}
        sizes={sizeFilter}
        creatorIds={uploadedByFilter}
        creators={memberOptions}
        onTypes={setTypeFilter}
        onSizes={setSizeFilter}
        onCreators={setUploadedByFilter}
        onClear={clearFileFilters}
      />
    ),
    [
      typeFilter,
      sizeFilter,
      uploadedByFilter,
      memberOptions,
      setTypeFilter,
      setSizeFilter,
      setUploadedByFilter,
      clearFileFilters,
    ]
  )

  /** Stable identity so the memoized `Resource.Options` can bail; an inline object cannot. */
  const filterConfig = useMemo(() => ({ content: filterContent }), [filterContent])

  const filterTags: FilterTag[] = useMemo(() => {
    const tags: FilterTag[] = []
    if (typeFilter.length > 0) {
      const typeLabels: Record<string, string> = {
        document: 'Documents',
        image: 'Images',
        audio: 'Audio',
        video: 'Video',
      }
      const label =
        typeFilter.length === 1
          ? `Type: ${typeLabels[typeFilter[0]]}`
          : `Type: ${typeFilter.length} selected`
      tags.push({ label, onRemove: () => setTypeFilter([]) })
    }
    if (sizeFilter.length > 0) {
      const sizeLabels: Record<string, string> = {
        small: 'Small',
        medium: 'Medium',
        large: 'Large',
      }
      const label =
        sizeFilter.length === 1
          ? `Size: ${sizeLabels[sizeFilter[0]]}`
          : `Size: ${sizeFilter.length} selected`
      tags.push({ label, onRemove: () => setSizeFilter([]) })
    }
    if (uploadedByFilter.length > 0) {
      const label =
        uploadedByFilter.length === 1
          ? `Uploaded by: ${membersById.get(uploadedByFilter[0])?.name ?? '1 member'}`
          : `Uploaded by: ${uploadedByFilter.length} members`
      tags.push({ label, onRemove: () => setUploadedByFilter([]) })
    }
    return tags
  }, [
    typeFilter,
    sizeFilter,
    uploadedByFilter,
    membersById,
    setTypeFilter,
    setSizeFilter,
    setUploadedByFilter,
  ])

  const listState = resourceListState({
    rowCount: rows.length,
    isLoading,
    isPlaceholderData,
    error,
    search: debouncedSearchTerm,
    filterCount: filterTags.length,
    folderId: currentFolderId,
    foldersResolved,
  })

  const clearSearchAndFilters = () => {
    setSearchTerm('')
    clearFileFilters()
  }

  if (!isListPreferenceReady) return <FilesLoading />

  if (fileIdFromRoute && !selectedFile && isLoading) {
    return (
      <Resource>
        <Resource.Header icon={FILES_HEADER.rootIcon} breadcrumbs={loadingBreadcrumbs} />
        <div className='flex flex-1 items-center justify-center bg-[var(--bg)]'>
          <Loader className='size-[20px] text-[var(--text-secondary)]' animate />
        </div>
      </Resource>
    )
  }

  if (selectedFile) {
    return (
      <>
        <FileDetail
          key={selectedFile.id}
          header={{
            icon: FILES_HEADER.rootIcon,
            breadcrumbs: fileDetailBreadcrumbs,
            actions: fileActions,
          }}
          viewer={{
            file: selectedFile,
            workspaceId,
            canEdit,
            autoFocus: isNewFile || justCreatedFileIdRef.current === selectedFile.id,
            collaborative: true,
            onDeriveTitleFromHeading: handleDeriveTitleFromHeading,
            enableFind: true,
          }}
        />

        <DeleteConfirmModal
          open={showDeleteConfirm}
          onOpenChange={setShowDeleteConfirm}
          fileName={deleteTarget?.name}
          fileCount={deleteTarget?.fileIds.length ?? 0}
          folderCount={deleteTarget?.folderIds.length ?? 0}
          onDelete={handleDelete}
          isPending={deleteFile.isPending || bulkArchiveItems.isPending}
        />

        {browserModals}
        {shareModal}
      </>
    )
  }

  /**
   * Read off the same ref the context-menu handlers use, so the menu's Pin/Unpin label
   * describes the row that was right-clicked. Opening the menu is a state change, so
   * this re-reads on the render that shows it.
   */
  const contextMenuItem = contextMenuItemRef.current
  const isContextMenuItemPinned = contextMenuItem
    ? (contextMenuItem.kind === 'folder' ? pinnedFolderIds : pinnedFileIds).has(contextMenuItem.id)
    : false

  return (
    <div className='relative flex h-full flex-col overflow-hidden' {...uploadDrop.handlers}>
      <Resource onContextMenu={handleContentContextMenu}>
        <Resource.Header
          icon={FILES_HEADER.rootIcon}
          title={FILES_HEADER.rootLabel}
          breadcrumbs={listBreadcrumbs}
          breadcrumbDrop={rowDragDropConfig.breadcrumb}
          actions={headerActionsConfig}
        />
        <Resource.Options
          search={searchConfig}
          sort={sortConfig}
          filterTags={filterTags}
          filter={filterConfig}
        />
        <Resource.Table
          columns={isSearching ? SEARCH_COLUMNS : COLUMNS}
          rows={displayRows}
          apiRef={tableApiRef}
          emptyState={
            listState === 'empty' ? (
              <FilesEmptyState
                onUpload={handleUploadClick}
                uploadDisabled={uploading || !canEdit}
              />
            ) : listState === 'no-results' ? (
              <ResourceNoResults
                search={debouncedSearchTerm}
                filterCount={filterTags.length}
                onClear={clearSearchAndFilters}
              />
            ) : undefined
          }
          selectable={selectableConfig}
          rowDragDrop={rowDragDropConfig}
          onRowClick={handleRowClick}
          onRowContextMenu={handleRowContextMenu}
          overlay={
            <>
              {findOpen && (
                <FindBar
                  ariaLabel='Find in files'
                  query={findQuery}
                  onQueryChange={setFindQuery}
                  onNext={handleFindNext}
                  onPrev={handleFindPrev}
                  onClose={handleFindClose}
                  count={findMatchIds.length}
                  currentIndex={Math.min(findIndex, Math.max(0, findMatchIds.length - 1))}
                  truncated={false}
                  isLoading={false}
                  inputRef={findInputRef}
                />
              )}
              <ResourceActionBar
                selectedCount={selectedRowIds.size}
                onDownload={handleBulkDownload}
                onCopy={handleCopySelection}
                onMove={canEdit ? handleContextMenuMove : undefined}
                moveOptions={canEdit ? contextMenuMoveOptions : undefined}
                onDelete={canEdit ? handleBulkDelete : undefined}
                isLoading={
                  bulkArchiveItems.isPending || moveItems.isPending || isDownloadingArchive
                }
              />
              {uploadDrop.isDraggingOver && <FileUploadOverlay destination='this workspace' />}
            </>
          }
        />
      </Resource>

      <FilesListContextMenu
        isOpen={isListContextMenuOpen}
        position={listContextMenuPosition}
        onClose={closeListContextMenu}
        onCreateFile={handleCreateFile}
        onCreateFolder={handleCreateFolder}
        onUploadFile={handleListUploadFile}
        disableCreate={uploading || creatingFile || !canEdit}
        disableCreateFolder={createFolder.isPending || !canEdit}
        disableUpload={uploading || !canEdit}
      />

      <FileRowContextMenu
        isOpen={isContextMenuOpen}
        position={contextMenuPosition}
        onClose={closeContextMenu}
        onOpen={handleContextMenuOpen}
        onCopyLink={contextMenuItem?.kind === 'file' ? handleContextMenuCopyLink : undefined}
        onDownload={handleContextMenuDownload}
        onCopy={handleCopySelection}
        onHistory={contextMenuItem?.kind === 'file' ? handleContextMenuHistory : undefined}
        onRename={handleContextMenuRename}
        onDelete={handleContextMenuDelete}
        onMove={handleContextMenuMove}
        onShare={canEdit && contextMenuItem?.kind === 'file' ? handleContextMenuShare : undefined}
        onTogglePin={handleContextMenuTogglePin}
        pinned={isContextMenuItemPinned}
        moveOptions={contextMenuMoveOptions}
        canEdit={canEdit}
        selectedCount={selectedRowIds.size}
      />

      <DeleteConfirmModal
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        fileName={deleteTarget?.name}
        fileCount={deleteTarget?.fileIds.length ?? 0}
        folderCount={deleteTarget?.folderIds.length ?? 0}
        onDelete={handleDelete}
        isPending={deleteFile.isPending || bulkArchiveItems.isPending}
      />

      {extractTarget && (
        <FileExtractionModal
          key={extractTarget.id}
          owner={{ entityType: 'workspace', entityId: workspaceId }}
          fileId={extractTarget.id}
          fileName={extractTarget.name}
          canWrite={canEdit}
          onClose={() => setExtractTargetId(null)}
        />
      )}

      {browserModals}
      {shareModal}

      <input
        ref={fileInputRef}
        type='file'
        className='hidden'
        onChange={handleFileChange}
        disabled={uploading || !canEdit}
        multiple
      />
    </div>
  )
}
