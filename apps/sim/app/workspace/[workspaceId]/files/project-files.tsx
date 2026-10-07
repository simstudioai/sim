'use client'

import { useMemo, useRef, useState } from 'react'
import { Avatar, Chip, Folder, FolderPlus, Plus, toast, Upload } from '@sim/emcn'
import { Clock, Download, Duplicate, Pencil, Send, Trash } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import { useParams, useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { getDocumentIcon } from '@/components/icons/document-icons'
import type { FileCopySource } from '@/lib/api/contracts/mothership-file-copy'
import type { Project } from '@/lib/api/contracts/projects'
import { triggerArchiveDownload, triggerProjectFileDownload } from '@/lib/uploads/client/download'
import { formatFileSize, isArchiveFileName } from '@/lib/uploads/utils/file-utils'
import {
  FILE_BROWSER_COLUMNS,
  FILE_BROWSER_SIZES,
  FILE_BROWSER_SORT_OPTIONS,
  FILE_BROWSER_TYPES,
  FILE_ROW_DRAG_MIME,
} from '@/lib/workspace-files/browser'
import { MAX_WORKSPACE_FILE_BULK_REQUEST_IDS } from '@/lib/workspace-files/limits'
import {
  buildDescendantIndex,
  buildMoveOptionsExcludingSubtrees,
  parseFolderedRowId,
  parseMoveOptionValue,
  splitFolderedRowIds,
  useFolderRowDragDrop,
} from '@/app/workspace/[workspaceId]/components/folders'
import { ResourceActionBar } from '@/app/workspace/[workspaceId]/components/resource/components/action-bar'
import type {
  BreadcrumbItem,
  ResourceAction,
} from '@/app/workspace/[workspaceId]/components/resource/components/resource-header'
import { timeCell } from '@/app/workspace/[workspaceId]/components/resource/components/time-cell'
import {
  Resource,
  type ResourceColumn,
  type ResourceRow,
} from '@/app/workspace/[workspaceId]/components/resource/resource'
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
import { ShareModal } from '@/app/workspace/[workspaceId]/files/components/share-modal'
import { useFileUploadDrop, useProjectFileUpload } from '@/app/workspace/[workspaceId]/files/hooks'
import FilesLoading from '@/app/workspace/[workspaceId]/files/loading'
import {
  filesFilterUrlKeys,
  filesParsers,
  filesSortParams,
  filesUrlKeys,
  projectFileFilterParsers,
  projectFilesScopeParsers,
  serializeProjectFilesLocation,
} from '@/app/workspace/[workspaceId]/files/search-params'
import { hasExternalFiles } from '@/app/workspace/[workspaceId]/files/utils'
import {
  useArchiveProjectFileItems,
  useCreateProjectFile,
  useCreateProjectFileFolder,
  useMoveProjectFileItems,
  useProjectFile,
  useProjectFileFolders,
  useProjectFiles,
  useRenameProjectFile,
  useRestoreProjectFileItems,
  useUpdateProjectFileFolder,
} from '@/hooks/queries/project-files'
import { useContextMenu } from '@/hooks/use-context-menu'
import { useDebouncedSearchSetter } from '@/hooks/use-debounced-search-setter'
import { useFileListRoom } from '@/hooks/use-file-list-room'
import { useInlineRename } from '@/hooks/use-inline-rename'
import { useSearchFilterValue } from '@/hooks/use-search-filter-value'
import { useUrlSort } from '@/hooks/use-url-sort'

const FILES_SEARCH_DEBOUNCE_MS = 200
const COLUMNS: ResourceColumn[] = [...FILE_BROWSER_COLUMNS]

interface ProjectFilesProps {
  project: Project
  workspaceId: string
}

export function ProjectFiles(props: ProjectFilesProps) {
  const [{ scope }] = useQueryStates(projectFilesScopeParsers)
  return <ProjectFilesContent key={`${props.project.id}:${scope}`} {...props} />
}

function ProjectFilesContent({ project, workspaceId }: ProjectFilesProps) {
  useFileListRoom({ entityType: 'project', entityId: project.id })
  const uploadInput = useRef<HTMLInputElement>(null)
  const downloadInFlight = useRef(false)
  const navigation = useFileNavigation({ entityType: 'project', entityId: project.id })
  const [isDownloading, setIsDownloading] = useState(false)
  const [extractTarget, setExtractTarget] = useState<{ id: string; name: string } | null>(null)
  const [contextRowId, setContextRowId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{
    fileIds: string[]
    folderIds: string[]
    name?: string
  } | null>(null)
  const router = useRouter()
  const { fileId } = useParams<{ fileId?: string }>()
  const [{ folderId, shareFileId, historyFileId }, setNavigation] = useQueryStates(
    filesParsers,
    filesUrlKeys
  )
  const [{ search, type: types, size: sizes, uploadedBy: creatorIds }, setFilters] = useQueryStates(
    projectFileFilterParsers,
    filesFilterUrlKeys
  )
  const sort = useUrlSort(filesSortParams, filesFilterUrlKeys)
  const [{ scope }, setScope] = useQueryStates(projectFilesScopeParsers)
  const archived = scope === 'archived'
  const searchFilter = useSearchFilterValue(search, FILES_SEARCH_DEBOUNCE_MS)
  const list = useProjectFiles(project.id, {
    scope,
    folderId: searchFilter || archived ? undefined : (folderId ?? undefined),
    search: searchFilter || undefined,
    types,
    sizes,
    creatorIds,
    sortBy: sort.sort,
    sortOrder: sort.dir,
    limit: 100,
  })
  const folders = useProjectFileFolders(project.id, scope)
  const detail = useProjectFile(project.id, fileId)
  const historyFile = useProjectFile(project.id, historyFileId ?? undefined)
  const sharedFile = useProjectFile(project.id, shareFileId ?? undefined)
  const [copySource, setCopySource] = useState<FileCopySource | null>(null)
  const createFile = useCreateProjectFile(project.id)
  const createFolder = useCreateProjectFileFolder(project.id)
  const renameFile = useRenameProjectFile(project.id)
  const updateFolder = useUpdateProjectFileFolder(project.id)
  const moveItems = useMoveProjectFileItems(project.id)
  const archiveItems = useArchiveProjectFileItems(project.id)
  const restoreItems = useRestoreProjectFileItems(project.id)
  const menu = useContextMenu()
  const rename = useInlineRename({
    onSave: async (id, name) => {
      try {
        return id.startsWith('folder:')
          ? await updateFolder.mutateAsync({ folderId: id.slice('folder:'.length), body: { name } })
          : await renameFile.mutateAsync({ fileId: id, name })
      } catch (error) {
        toast.error(getErrorMessage(error, 'Unable to rename this item'))
        throw error
      }
    },
  })
  const file = detail.data?.file
  const canWrite = file
    ? detail.data?.capabilities.canWrite
    : (list.data?.pages[0]?.capabilities.canWrite ?? folders.data?.capabilities.canWrite)
  const upload = useProjectFileUpload(project.id, Boolean(canWrite) && !archived)
  const files = list.data?.pages.flatMap((page) => page.files) ?? []
  const filesById = new Map(files.map((file) => [file.id, file]))
  const items = list.data?.pages.flatMap((page) => page.items) ?? []
  const creators = list.data?.pages[0]?.creators ?? []
  const shareFile = sharedFile.isError ? undefined : sharedFile.data?.file
  const allFolders = folders.data?.folders ?? []
  const folderById = useMemo(
    () => new Map(allFolders.map((folder) => [folder.id, folder])),
    [allFolders]
  )
  const contextFolder = contextRowId?.startsWith('folder:')
    ? folderById.get(contextRowId.slice('folder:'.length))
    : undefined
  const contextFile = contextFolder ? undefined : files.find((item) => item.id === contextRowId)
  const contextItem = contextFolder
    ? { kind: 'folder' as const, ...contextFolder }
    : contextFile
      ? { kind: 'file' as const, ...contextFile }
      : null
  const currentFolder = allFolders.find((folder) => folder.id === folderId)
  const base = `/workspace/${encodeURIComponent(workspaceId)}/files`
  const locationState = {
    owner: 'project' as const,
    projectId: project.id,
    folderId,
    search,
    type: types,
    size: sizes,
    uploadedBy: creatorIds,
    sort: sort.sort,
    dir: sort.dir,
    scope,
  }
  const searchSetter = useDebouncedSearchSetter(
    (value, options) => {
      void setFilters({ search: value }, options)
    },
    { debounceMs: FILES_SEARCH_DEBOUNCE_MS }
  )

  function navigateToFolder(nextFolderId: string | null) {
    if (fileId) {
      navigation.navigate(
        serializeProjectFilesLocation(base, {
          ...locationState,
          folderId: nextFolderId,
          search: '',
        })
      )
      return
    }
    searchSetter('')
    void setNavigation({ folderId: nextFolderId, new: null })
  }

  function openFile(id: string) {
    const target = filesById.get(id)
    if (target && isArchiveFileName(target.name) && canWrite && !archived) {
      setExtractTarget({ id, name: target.name })
      return
    }
    navigation.navigate(
      serializeProjectFilesLocation(`${base}/${encodeURIComponent(id)}`, locationState)
    )
  }

  function editing(id: string) {
    return rename.editingId === id
      ? {
          isEditing: true,
          value: rename.editValue,
          onChange: rename.setEditValue,
          onSubmit: () => void rename.submitRename(),
          onCancel: rename.cancelRename,
          disabled: rename.isSaving,
        }
      : undefined
  }

  async function moveItem(optionValue: string) {
    if (!canWrite || archived || selectedRowIds.size === 0) return
    try {
      await moveItems.mutateAsync({
        ...selectedItems,
        targetFolderId: parseMoveOptionValue(optionValue),
      })
      clearSelection()
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to move this item'))
    }
  }

  async function deleteItem() {
    if (!deleteTarget) return
    try {
      await archiveItems.mutateAsync({
        fileIds: deleteTarget.fileIds,
        folderIds: deleteTarget.folderIds,
      })
      setDeleteTarget(null)
      clearSelection()
      if (fileId) router.push(serializeProjectFilesLocation(base, locationState))
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to delete this item'))
    }
  }

  async function restoreItem(kind: 'file' | 'folder', id: string) {
    try {
      await restoreItems.mutateAsync({ kind, id })
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to restore this item'))
    }
  }

  async function createDocument() {
    try {
      const result = await createFile.mutateAsync({
        name: 'Untitled.md',
        content: '',
        contentType: 'text/markdown',
        encoding: 'utf-8',
        folderId: folderId ?? undefined,
      })
      openFile(result.file.id)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to create this document'))
    }
  }

  async function addFolder() {
    try {
      const result = await createFolder.mutateAsync({ name: 'New Folder', parentId: folderId })
      navigateToFolder(result.folder.id)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to create this folder'))
    }
  }

  function uploadFiles(files: File[], targetFolderId: string | null = folderId) {
    if (!canWrite || archived || upload.uploading) return
    void setFilters({ search: '' })
    void upload.uploadFiles(files, targetFolderId)
  }

  async function downloadFile() {
    if (!file) return
    try {
      await triggerProjectFileDownload(file, navigation.downloadSourceRef.current)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to download this file'))
    }
  }

  async function downloadSelection() {
    if (
      archived ||
      downloadInFlight.current ||
      selectedRowIds.size === 0 ||
      selectedRowIds.size > MAX_WORKSPACE_FILE_BULK_REQUEST_IDS
    ) {
      return
    }
    downloadInFlight.current = true
    setIsDownloading(true)
    try {
      const singleFile =
        selectedItems.folderIds.length === 0 && selectedItems.fileIds.length === 1
          ? files.find((item) => item.id === selectedItems.fileIds[0])
          : undefined
      if (singleFile) {
        await triggerProjectFileDownload(singleFile)
      } else {
        await triggerArchiveDownload({
          owner: { entityType: 'project', entityId: project.id },
          ...selectedItems,
        })
      }
    } catch (error) {
      toast.error(getErrorMessage(error, 'Unable to download the selected files'))
    } finally {
      downloadInFlight.current = false
      setIsDownloading(false)
    }
  }

  const breadcrumbs: BreadcrumbItem[] = [
    { label: project.name, onClick: () => navigateToFolder(null) },
    { label: 'Files', folderId: null, onClick: () => navigateToFolder(null) },
  ]
  const ancestors: BreadcrumbItem[] = []
  const visited = new Set<string>()
  let ancestor = file?.folderId ? folderById.get(file.folderId) : currentFolder
  while (ancestor && !visited.has(ancestor.id)) {
    const id = ancestor.id
    visited.add(id)
    ancestors.unshift({
      label: ancestor.name,
      folderId: id,
      onClick: () => navigateToFolder(id),
    })
    ancestor = ancestor.parentId ? folderById.get(ancestor.parentId) : undefined
  }
  breadcrumbs.push(...ancestors)
  if (file) breadcrumbs.push({ label: file.name, editing: editing(file.id) })
  const actions: ResourceAction[] = file
    ? [
        { id: 'download', text: 'Download', icon: Download, onSelect: () => void downloadFile() },
        {
          id: 'history',
          text: 'Version History',
          icon: Clock,
          onSelect: () => void setNavigation({ historyFileId: file.id }, { history: 'replace' }),
        },
        {
          id: 'copy',
          text: 'Copy to...',
          icon: Duplicate,
          onSelect: () => setCopySource({ owner: file.owner, fileIds: [file.id], folderIds: [] }),
        },
        ...(canWrite
          ? [
              {
                id: 'rename',
                text: 'Rename',
                icon: Pencil,
                onSelect: () => rename.startRename(file.id, file.name),
              },
              {
                id: 'share',
                text: 'Share',
                icon: Send,
                onSelect: () =>
                  void setNavigation({ shareFileId: file.id }, { history: 'replace' }),
              },
              {
                id: 'delete',
                text: 'Delete',
                icon: Trash,
                onSelect: () =>
                  setDeleteTarget({ fileIds: [file.id], folderIds: [], name: file.name }),
              },
            ]
          : []),
      ]
    : [
        {
          id: 'upload',
          text: upload.label,
          icon: Upload,
          onSelect: () => uploadInput.current?.click(),
          disabled: archived || !canWrite || upload.uploading,
        },
        {
          id: 'create',
          text: 'New file',
          icon: Plus,
          onSelect: () => void createDocument(),
          disabled: archived || !canWrite || createFile.isPending || upload.uploading,
        },
        {
          id: 'folder',
          text: 'New folder',
          icon: FolderPlus,
          onSelect: () => void addFolder(),
          disabled: archived || !canWrite || createFolder.isPending,
        },
      ]
  const rows: ResourceRow[] = items.map((item) => {
    const rowId = item.kind === 'folder' ? `folder:${item.id}` : item.id
    const file = item.kind === 'file' ? filesById.get(item.id) : undefined
    const Icon = file ? getDocumentIcon(file.type, file.name) : Folder
    return {
      id: rowId,
      cells: {
        name: { label: item.name, icon: <Icon className='size-[14px]' />, editing: editing(rowId) },
        size: { label: formatFileSize(item.size, { includeBytes: true }) },
        type: { label: item.type, icon: <Icon className='size-[14px]' /> },
        created: timeCell(item.createdAt),
        owner: {
          label: item.creator?.name ?? 'Deleted user',
          icon: item.creator ? (
            <Avatar size='xs' name={item.creator.name} src={item.creator.image} aria-hidden />
          ) : undefined,
        },
        updated: timeCell(item.updatedAt),
        restore: {
          content: canWrite && (
            <Chip
              disabled={restoreItems.isPending}
              onClick={() => void restoreItem(item.kind, item.id)}
            >
              Restore
            </Chip>
          ),
        },
      },
    }
  })

  const visibleRowIds = useMemo(
    () =>
      list.data?.pages.flatMap((page) =>
        page.items.map((item) => (item.kind === 'folder' ? `folder:${item.id}` : item.id))
      ) ?? [],
    [list.data?.pages]
  )
  const { selectedRowIds, selectable, clearSelection, replaceSelection } = useResourceRowSelection({
    visibleRowIds,
    isKeyboardBlocked: () => Boolean(fileId || rename.editingId || deleteTarget || archived),
    onDeleteSelected: canWrite ? () => setDeleteTarget(selectedItems) : undefined,
  })
  const selectedItems = useMemo(() => {
    const { resourceIds, folderIds } = splitFolderedRowIds(selectedRowIds)
    return { fileIds: resourceIds, folderIds }
  }, [selectedRowIds])
  const moveOptions = buildMoveOptionsExcludingSubtrees({
    folders: allFolders,
    rootLabel: 'Project files',
    excludeFolderIds: selectedItems.folderIds,
    descendantsByFolderId: buildDescendantIndex(allFolders),
  })

  const rowDragDrop = useFolderRowDragDrop({
    dragMime: FILE_ROW_DRAG_MIME,
    owner: { entityType: 'project', entityId: project.id },
    canEdit: Boolean(canWrite) && !archived && !upload.uploading && !moveItems.isPending,
    editingRowId: rename.editingId,
    descendantsByFolderId: buildDescendantIndex(allFolders),
    getFolderParentId: (id) => folderById.get(id)?.parentId,
    getResourceFolderId: (id) => filesById.get(id)?.folderId,
    getRowLabel: (rowId) => {
      const row = parseFolderedRowId(rowId)
      return row.kind === 'folder'
        ? (folderById.get(row.id)?.name ?? 'Folder')
        : (filesById.get(row.id)?.name ?? 'File')
    },
    onMoveRows: ({ folderIds, resourceIds }, targetFolderId) => {
      void moveItems
        .mutateAsync({ folderIds, fileIds: resourceIds, targetFolderId })
        .then(() => clearSelection())
        .catch((error) => toast.error(getErrorMessage(error, 'Unable to move the selected files')))
    },
    selection: { selectedRowIds, visibleRowIds, replaceSelection },
    onSpringOpenFolder: (folderId, options) => void setNavigation({ folderId }, options),
    currentFolderId: folderId,
    bodyDropFolderId: searchFilter ? undefined : folderId,
    externalDrop: {
      matches: hasExternalFiles,
      onDropIntoFolder: (dataTransfer, targetFolderId) => {
        uploadDrop.dismiss()
        uploadFiles(Array.from(dataTransfer.files), targetFolderId)
      },
    },
  })
  const uploadDrop = useFileUploadDrop({
    enabled: Boolean(canWrite) && !archived && !fileId && !upload.uploading,
    onDrop: (files) => {
      rowDragDrop.externalDropHandled()
      uploadFiles(files)
    },
  })

  if (fileId && detail.isPending) return <FilesLoading />
  const error = fileId ? detail.error : (list.error ?? folders.error)
  if (error || (fileId && !file)) {
    return (
      <div role='status' className='p-6 text-small'>
        {getErrorMessage(error, 'This Project file is unavailable')}
      </div>
    )
  }

  return (
    <div className='relative flex h-full flex-col overflow-hidden' {...uploadDrop.handlers}>
      {file ? (
        <FileDetail
          key={file.id}
          header={{ breadcrumbs, actions }}
          showSaveAction
          viewer={{
            owner: file.owner,
            file,
            canEdit: Boolean(canWrite),
            collaborative: true,
            enableFind: true,
          }}
        />
      ) : (
        <Resource>
          <Resource.Header
            breadcrumbs={breadcrumbs}
            actions={actions}
            breadcrumbDrop={rowDragDrop.breadcrumb}
          />
          <Resource.Options
            search={{ value: search, onChange: searchSetter, placeholder: 'Search files' }}
            sort={{
              options: [...FILE_BROWSER_SORT_OPTIONS],
              active: sort.activeSort,
              onSort: sort.onSort,
              onClear: sort.onClear,
            }}
            filter={{
              content: (
                <FileFilterControls
                  types={types}
                  sizes={sizes}
                  creatorIds={creatorIds}
                  creators={creators.map((creator) => ({
                    value: creator.id,
                    label: creator.name,
                    iconElement: (
                      <Avatar size='xs' name={creator.name} src={creator.image} aria-hidden />
                    ),
                  }))}
                  onTypes={(values) =>
                    void setFilters({
                      type: FILE_BROWSER_TYPES.filter((type) => values.includes(type)),
                    })
                  }
                  onSizes={(values) =>
                    void setFilters({
                      size: FILE_BROWSER_SIZES.filter((size) => values.includes(size)),
                    })
                  }
                  onCreators={(values) => void setFilters({ uploadedBy: values })}
                  onClear={() => void setFilters({ type: [], size: [], uploadedBy: [] })}
                />
              ),
            }}
            filterTags={[
              ...(types.length
                ? [
                    {
                      label: `Type: ${types.join(', ')}`,
                      onRemove: () => void setFilters({ type: [] }),
                    },
                  ]
                : []),
              ...(sizes.length
                ? [
                    {
                      label: `Size: ${sizes.join(', ')}`,
                      onRemove: () => void setFilters({ size: [] }),
                    },
                  ]
                : []),
              ...(creatorIds.length
                ? [
                    {
                      label: `Uploaded by: ${creatorIds.length} selected`,
                      onRemove: () => void setFilters({ uploadedBy: [] }),
                    },
                  ]
                : []),
            ]}
            aside={
              <Chip
                active={archived}
                onClick={() => void setScope({ scope: archived ? 'active' : 'archived' })}
              >
                Recently Deleted
              </Chip>
            }
          />
          {upload.progress && (
            <p role='status' className='px-6 py-2 text-[var(--text-muted)] text-small'>
              Uploading to{' '}
              {upload.progress.folderId
                ? (folderById.get(upload.progress.folderId)?.name ?? 'the selected folder')
                : project.name}
            </p>
          )}
          <Resource.Table
            rowDragDrop={rowDragDrop}
            overlay={
              uploadDrop.isDraggingOver ? (
                <FileUploadOverlay destination={currentFolder?.name ?? project.name} />
              ) : undefined
            }
            columns={archived ? [...COLUMNS, { id: 'restore', header: '' }] : COLUMNS}
            rows={rows}
            selectable={
              !archived ? { ...selectable, selectAllLabel: 'Select loaded rows' } : undefined
            }
            onRowClick={(id) =>
              archived
                ? undefined
                : id.startsWith('folder:')
                  ? navigateToFolder(id.slice('folder:'.length))
                  : openFile(id)
            }
            onRowContextMenu={
              archived
                ? undefined
                : (event, id) => {
                    setContextRowId(id)
                    if (!selectedRowIds.has(id)) replaceSelection([id])
                    menu.handleContextMenu(event)
                  }
            }
            onLoadMore={() => void list.fetchNextPage()}
            hasMore={list.hasNextPage}
            isLoadingMore={list.isFetchingNextPage}
            emptyState={
              <p className='p-6 text-[var(--text-muted)] text-small'>
                {list.isPending
                  ? 'Loading files...'
                  : search || types.length || sizes.length || creatorIds.length
                    ? 'No matching files'
                    : 'No files in this folder'}
              </p>
            }
          />
          {list.hasNextPage && !archived && (
            <p className='px-6 py-2 text-[var(--text-muted)] text-small'>
              Selection includes loaded rows only.
            </p>
          )}
          {!archived && (
            <ResourceActionBar
              selectedCount={selectedRowIds.size}
              onDownload={() => void downloadSelection()}
              onCopy={() =>
                setCopySource({
                  owner: { entityType: 'project', entityId: project.id },
                  ...selectedItems,
                })
              }
              onMove={canWrite ? (value) => void moveItem(value) : undefined}
              moveOptions={moveOptions}
              onDelete={canWrite ? () => setDeleteTarget(selectedItems) : undefined}
              isLoading={isDownloading || moveItems.isPending || archiveItems.isPending}
              maxSelectable={MAX_WORKSPACE_FILE_BULK_REQUEST_IDS}
            />
          )}
        </Resource>
      )}
      <input
        ref={uploadInput}
        type='file'
        multiple
        className='hidden'
        aria-label='Upload Project files'
        disabled={!canWrite || archived || upload.uploading}
        onChange={(event) => {
          uploadFiles(Array.from(event.target.files ?? []))
          event.target.value = ''
        }}
      />
      <FileRowContextMenu
        isOpen={menu.isOpen && Boolean(contextItem)}
        position={menu.position}
        onClose={menu.closeMenu}
        onOpen={() => {
          if (contextItem?.kind === 'folder') navigateToFolder(contextItem.id)
          else if (contextItem) openFile(contextItem.id)
        }}
        onShare={
          contextFile && !archived
            ? () => void setNavigation({ shareFileId: contextFile.id }, { history: 'replace' })
            : undefined
        }
        onCopy={() => {
          setCopySource({
            owner: { entityType: 'project', entityId: project.id },
            ...selectedItems,
          })
          menu.closeMenu()
        }}
        onHistory={
          contextFile
            ? () => {
                void setNavigation({ historyFileId: contextFile.id }, { history: 'replace' })
                menu.closeMenu()
              }
            : undefined
        }
        onDownload={() => void downloadSelection()}
        onRename={() => {
          if (contextRowId && contextItem) rename.startRename(contextRowId, contextItem.name)
        }}
        onDelete={() => {
          if (contextItem)
            setDeleteTarget({
              ...selectedItems,
              name: selectedRowIds.size === 1 ? contextItem.name : undefined,
            })
        }}
        onMove={(value) => void moveItem(value)}
        moveOptions={moveOptions}
        pinned={false}
        canEdit={Boolean(canWrite)}
        selectedCount={selectedRowIds.size}
      />
      {shareFile && !archived && (
        <ShareModal
          open
          owner={{ entityType: 'project', entityId: project.id }}
          fileId={shareFile.id}
          fileName={shareFile.name}
          onOpenChange={(open) => {
            if (!open) void setNavigation({ shareFileId: null }, { history: 'replace' })
          }}
        />
      )}
      {historyFileId && historyFile.data && !archived && (
        <FileHistoryModal
          key={`${project.id}:${historyFileId}`}
          owner={historyFile.data.file.owner}
          fileId={historyFileId}
          fileName={historyFile.data.file.name}
          canWrite={historyFile.data.capabilities.canWrite}
          onClose={() => void setNavigation({ historyFileId: null }, { history: 'replace' })}
        />
      )}
      {extractTarget && !archived && (
        <FileExtractionModal
          key={extractTarget.id}
          owner={{ entityType: 'project', entityId: project.id }}
          fileId={extractTarget.id}
          fileName={extractTarget.name}
          canWrite={Boolean(canWrite)}
          onClose={() => setExtractTarget(null)}
        />
      )}
      {copySource && <FileCopyModal source={copySource} onClose={() => setCopySource(null)} />}
      <DeleteConfirmModal
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        fileName={deleteTarget?.name}
        fileCount={deleteTarget?.fileIds.length ?? 0}
        folderCount={deleteTarget?.folderIds.length ?? 0}
        onDelete={() => void deleteItem()}
        isPending={archiveItems.isPending}
      />
    </div>
  )
}
