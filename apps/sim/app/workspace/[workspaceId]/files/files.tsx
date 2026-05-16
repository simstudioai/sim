'use client'

import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  Button,
  Columns2,
  Combobox,
  type ComboboxOption,
  Download,
  Eye,
  File as FilesIcon,
  Folder,
  FolderPlus,
  Loader,
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  Pencil,
  Trash2,
  toast,
  Upload,
} from '@/components/emcn'
import { getDocumentIcon } from '@/components/icons/document-icons'
import { triggerFileDownload } from '@/lib/uploads/client/download'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { MAX_WORKSPACE_FILE_SIZE } from '@/lib/uploads/shared/types'
import {
  formatFileSize,
  getFileExtension,
  getMimeTypeFromExtension,
  isAudioFileType,
  isVideoFileType,
} from '@/lib/uploads/utils/file-utils'
import {
  isSupportedExtension,
  SUPPORTED_AUDIO_EXTENSIONS,
  SUPPORTED_CODE_EXTENSIONS,
  SUPPORTED_DOCUMENT_EXTENSIONS,
  SUPPORTED_IMAGE_EXTENSIONS,
  SUPPORTED_VIDEO_EXTENSIONS,
} from '@/lib/uploads/utils/validation'
import type {
  BreadcrumbItem,
  FilterTag,
  HeaderAction,
  ResourceColumn,
  ResourceRow,
  RowDragDropConfig,
  SearchConfig,
  SortConfig,
} from '@/app/workspace/[workspaceId]/components'
import {
  InlineRenameInput,
  ownerCell,
  Resource,
  ResourceHeader,
  timeCell,
} from '@/app/workspace/[workspaceId]/components'
import { FilesActionBar } from '@/app/workspace/[workspaceId]/files/components/action-bar'
import { DeleteConfirmModal } from '@/app/workspace/[workspaceId]/files/components/delete-confirm-modal'
import { FileRowContextMenu } from '@/app/workspace/[workspaceId]/files/components/file-row-context-menu'
import type { PreviewMode } from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import {
  FileViewer,
  isPreviewable,
  isTextEditable,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import { FilesListContextMenu } from '@/app/workspace/[workspaceId]/files/components/files-list-context-menu'
import type { MoveOptionNode } from '@/app/workspace/[workspaceId]/files/move-options'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { useWorkspaceMembersQuery } from '@/hooks/queries/workspace'
import {
  useBulkArchiveWorkspaceFileItems,
  useCreateWorkspaceFileFolder,
  useMoveWorkspaceFileItems,
  useUpdateWorkspaceFileFolder,
  useWorkspaceFileFolders,
  type WorkspaceFileFolderApi,
} from '@/hooks/queries/workspace-file-folders'
import {
  useDeleteWorkspaceFile,
  useRenameWorkspaceFile,
  useUploadWorkspaceFile,
  useWorkspaceFiles,
} from '@/hooks/queries/workspace-files'
import { useDebounce } from '@/hooks/use-debounce'
import { useInlineRename } from '@/hooks/use-inline-rename'
import { usePermissionConfig } from '@/hooks/use-permission-config'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'
type FileResourceItem =
  | { kind: 'file'; id: string; file: WorkspaceFileRecord }
  | { kind: 'folder'; id: string; folder: WorkspaceFileFolderApi }

const logger = createLogger('Files')

const SUPPORTED_EXTENSIONS = [
  ...SUPPORTED_DOCUMENT_EXTENSIONS,
  ...SUPPORTED_CODE_EXTENSIONS,
  ...SUPPORTED_AUDIO_EXTENSIONS,
  ...SUPPORTED_VIDEO_EXTENSIONS,
  ...SUPPORTED_IMAGE_EXTENSIONS,
] as const

const ACCEPT_ATTR = SUPPORTED_EXTENSIONS.map((ext) => `.${ext}`).join(',')

const COLUMNS: ResourceColumn[] = [
  { id: 'name', header: 'Name' },
  { id: 'size', header: 'Size' },
  { id: 'type', header: 'Type' },
  { id: 'created', header: 'Created' },
  { id: 'owner', header: 'Owner' },
  { id: 'updated', header: 'Last Updated' },
]

const MIME_TYPE_LABELS: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/msword': 'Word',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
  'application/vnd.ms-excel': 'Excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
  'application/vnd.ms-powerpoint': 'PowerPoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PowerPoint',
  'application/json': 'JSON',
  'application/x-yaml': 'YAML',
  'text/csv': 'CSV',
  'text/plain': 'Text',
  'text/html': 'HTML',
  'text/markdown': 'Markdown',
}

const EMPTY_WORKSPACE_FILES: WorkspaceFileRecord[] = []
const EMPTY_WORKSPACE_FILE_FOLDERS: WorkspaceFileFolderApi[] = []

const fileRowId = (id: string) => `file:${id}`
const folderRowId = (id: string) => `folder:${id}`
const parseRowId = (rowId: string): { kind: 'file' | 'folder'; id: string } => {
  if (rowId.startsWith('folder:')) return { kind: 'folder', id: rowId.slice('folder:'.length) }
  if (rowId.startsWith('file:')) return { kind: 'file', id: rowId.slice('file:'.length) }
  return { kind: 'file', id: rowId }
}

const hasExternalFiles = (dataTransfer: DataTransfer): boolean =>
  dataTransfer.types.includes('Files')

function formatFileType(mimeType: string | null, filename: string): string {
  if (mimeType && MIME_TYPE_LABELS[mimeType]) {
    return MIME_TYPE_LABELS[mimeType]
  }

  if (mimeType?.startsWith('audio/')) return 'Audio'
  if (mimeType?.startsWith('video/')) return 'Video'
  if (mimeType?.startsWith('image/')) return 'Image'

  const ext = getFileExtension(filename)
  if (ext) return ext.toUpperCase()

  return mimeType ?? 'File'
}

export function Files() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const saveRef = useRef<(() => Promise<void>) | null>(null)

  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const isNewFile = searchParams.get('new') === '1'
  const currentFolderId = searchParams.get('folderId')
  const workspaceId = params?.workspaceId as string

  const fileIdFromRoute =
    typeof params?.fileId === 'string' && params.fileId.length > 0 ? params.fileId : null
  const userPermissions = useUserPermissionsContext()
  const canEdit = userPermissions.canEdit === true
  const { config: permissionConfig } = usePermissionConfig()

  useEffect(() => {
    if (permissionConfig.hideFilesTab) {
      router.replace(`/workspace/${workspaceId}`)
    }
  }, [permissionConfig.hideFilesTab, router, workspaceId])

  const { data: files = EMPTY_WORKSPACE_FILES, isLoading, error } = useWorkspaceFiles(workspaceId)
  const { data: folders = EMPTY_WORKSPACE_FILE_FOLDERS, isLoading: foldersLoading } =
    useWorkspaceFileFolders(workspaceId)
  const { data: members } = useWorkspaceMembersQuery(workspaceId)
  const uploadFile = useUploadWorkspaceFile()
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
  const foldersRef = useRef(folders)
  foldersRef.current = folders

  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState({
    completed: 0,
    total: 0,
    currentPercent: 0,
  })
  const [isDraggingOver, setIsDraggingOver] = useState(false)
  const dragCounterRef = useRef(0)
  const [inputValue, setInputValue] = useState('')
  const debouncedSearchTerm = useDebounce(inputValue, 200)
  const [activeSort, setActiveSort] = useState<{
    column: string
    direction: 'asc' | 'desc'
  } | null>(null)
  const [typeFilter, setTypeFilter] = useState<string[]>([])
  const [sizeFilter, setSizeFilter] = useState<string[]>([])
  const [uploadedByFilter, setUploadedByFilter] = useState<string[]>([])

  const [creatingFile, setCreatingFile] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(() => new Set())
  const [activeDropTargetId, setActiveDropTargetId] = useState<string | null>(null)
  const [draggedRowIds, setDraggedRowIds] = useState<Set<string>>(() => new Set())
  const [previewMode, setPreviewMode] = useState<PreviewMode>(() => {
    if (isNewFile) return 'editor'
    if (fileIdFromRoute) {
      const file = files.find((f) => f.id === fileIdFromRoute)
      if (file && isPreviewable(file)) return 'preview'
      return 'editor'
    }
    return 'preview'
  })
  const [showUnsavedChangesAlert, setShowUnsavedChangesAlert] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const contextMenuItemRef = useRef<FileResourceItem | null>(null)
  const lastSelectedIndexRef = useRef<number>(-1)
  const draggedRowIdsRef = useRef<string[]>([])
  const dragGhostRef = useRef<HTMLElement | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{
    fileIds: string[]
    folderIds: string[]
    name: string
  } | null>(null)

  const listRename = useInlineRename({
    onSave: (rowId, name) => {
      const parsed = parseRowId(rowId)
      if (parsed.kind === 'folder') {
        updateFolder.mutate({ workspaceId, folderId: parsed.id, updates: { name } })
        return
      }
      renameFile.mutate({ workspaceId, fileId: parsed.id, name })
    },
  })

  const headerRename = useInlineRename({
    onSave: (fileId, name) => {
      renameFile.mutate({ workspaceId, fileId, name })
    },
  })

  const breadcrumbRename = useInlineRename({
    onSave: (folderId, name) => {
      updateFolder.mutate({ workspaceId, folderId, updates: { name } })
    },
  })

  const selectedFile = useMemo(
    () => (fileIdFromRoute ? files.find((f) => f.id === fileIdFromRoute) : null),
    [fileIdFromRoute, files]
  )
  const selectedFileRef = useRef(selectedFile)
  selectedFileRef.current = selectedFile

  const folderById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders])
  const currentFolder = currentFolderId ? (folderById.get(currentFolderId) ?? null) : null
  const currentFolderPath = currentFolder?.path ?? null

  const visibleFolders = useMemo(() => {
    const siblings = folders.filter((folder) => (folder.parentId ?? null) === currentFolderId)
    const searched = debouncedSearchTerm
      ? siblings.filter((folder) =>
          folder.name.toLowerCase().includes(debouncedSearchTerm.toLowerCase())
        )
      : siblings
    const col = activeSort?.column ?? 'name'
    const dir = activeSort?.direction ?? 'asc'
    return [...searched].sort((a, b) => {
      let cmp = 0
      if (col === 'updated') {
        cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
      } else if (col === 'created') {
        cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      } else {
        cmp = a.name.localeCompare(b.name)
      }
      return dir === 'asc' ? cmp : -cmp
    })
  }, [folders, currentFolderId, debouncedSearchTerm, activeSort])

  const filteredFiles = useMemo(() => {
    let result = debouncedSearchTerm
      ? files.filter(
          (f) =>
            (f.folderId ?? null) === currentFolderId &&
            f.name.toLowerCase().includes(debouncedSearchTerm.toLowerCase())
        )
      : files.filter((f) => (f.folderId ?? null) === currentFolderId)

    if (typeFilter.length > 0) {
      result = result.filter((f) => {
        const ext = getFileExtension(f.name)
        if (typeFilter.includes('document') && isSupportedExtension(ext)) return true
        if (typeFilter.includes('audio') && isAudioFileType(f.type)) return true
        if (typeFilter.includes('video') && isVideoFileType(f.type)) return true
        if (typeFilter.includes('image') && f.type?.startsWith('image/')) return true
        return false
      })
    }

    if (sizeFilter.length > 0) {
      result = result.filter((f) => {
        if (sizeFilter.includes('small') && f.size < 1_048_576) return true
        if (sizeFilter.includes('medium') && f.size >= 1_048_576 && f.size <= 10_485_760)
          return true
        if (sizeFilter.includes('large') && f.size > 10_485_760) return true
        return false
      })
    }

    if (uploadedByFilter.length > 0) {
      result = result.filter((f) => uploadedByFilter.includes(f.uploadedBy))
    }

    const col = activeSort?.column ?? 'updated'
    const dir = activeSort?.direction ?? 'desc'
    return [...result].sort((a, b) => {
      let cmp = 0
      switch (col) {
        case 'name':
          cmp = a.name.localeCompare(b.name)
          break
        case 'size':
          cmp = a.size - b.size
          break
        case 'type':
          cmp = formatFileType(a.type, a.name).localeCompare(formatFileType(b.type, b.name))
          break
        case 'created':
          cmp = new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime()
          break
        case 'updated':
          cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()
          break
        case 'owner':
          cmp = (members?.find((m) => m.userId === a.uploadedBy)?.name ?? '').localeCompare(
            members?.find((m) => m.userId === b.uploadedBy)?.name ?? ''
          )
          break
      }
      return dir === 'asc' ? cmp : -cmp
    })
  }, [
    files,
    currentFolderId,
    debouncedSearchTerm,
    typeFilter,
    sizeFilter,
    uploadedByFilter,
    activeSort,
    members,
  ])

  const baseRows: ResourceRow[] = useMemo(() => {
    const folderRows = visibleFolders.map((folder) => ({
      id: folderRowId(folder.id),
      cells: {
        name: {
          icon: <Folder className='size-[14px]' />,
          label: folder.name,
        },
        size: { label: 'Folder' },
        type: {
          icon: <Folder className='size-[14px]' />,
          label: 'Folder',
        },
        created: timeCell(folder.createdAt),
        owner: ownerCell(folder.userId, members),
        updated: timeCell(folder.updatedAt),
      },
      sortValues: {
        name: folder.name,
        size: -1,
        type: 'Folder',
        created: new Date(folder.createdAt).getTime(),
        updated: new Date(folder.updatedAt).getTime(),
        owner: members?.find((m) => m.userId === folder.userId)?.name ?? '',
      },
    }))

    const fileRows = filteredFiles.map((file) => {
      const Icon = getDocumentIcon(file.type || '', file.name)
      const row: ResourceRow = {
        id: fileRowId(file.id),
        cells: {
          name: {
            icon: <Icon className='size-[14px]' />,
            label: file.name,
          },
          size: {
            label: formatFileSize(file.size, { includeBytes: true }),
          },
          type: {
            icon: <Icon className='size-[14px]' />,
            label: formatFileType(file.type, file.name),
          },
          created: timeCell(file.uploadedAt),
          owner: ownerCell(file.uploadedBy, members),
          updated: timeCell(file.updatedAt),
        },
        sortValues: {
          name: file.name,
          size: file.size,
          type: formatFileType(file.type, file.name),
          created: new Date(file.uploadedAt).getTime(),
          updated: new Date(file.updatedAt).getTime(),
          owner: members?.find((m) => m.userId === file.uploadedBy)?.name ?? '',
        },
      }
      return row
    })

    return [...folderRows, ...fileRows]
  }, [visibleFolders, filteredFiles, members])

  const rows: ResourceRow[] = useMemo(() => {
    if (!listRename.editingId) return baseRows
    return baseRows.map((row) => {
      if (row.id !== listRename.editingId) return row
      const parsed = parseRowId(row.id)
      const file = parsed.kind === 'file' ? filteredFiles.find((f) => f.id === parsed.id) : null
      const Icon = file ? getDocumentIcon(file.type || '', file.name) : Folder
      return {
        ...row,
        cells: {
          ...row.cells,
          name: {
            ...row.cells.name,
            content: (
              <span className='flex min-w-0 items-center gap-3 font-medium text-[var(--text-body)] text-sm'>
                <span className='flex-shrink-0 text-[var(--text-icon)]'>
                  <Icon className='size-[14px]' />
                </span>
                <InlineRenameInput
                  value={listRename.editValue}
                  onChange={listRename.setEditValue}
                  onSubmit={listRename.submitRename}
                  onCancel={listRename.cancelRename}
                />
              </span>
            ),
          },
        },
      }
    })
  }, [baseRows, listRename.editingId, listRename.editValue, filteredFiles])

  const visibleRowIds = useMemo(() => rows.map((row) => row.id), [rows])

  const prevVisibleRowIdsRef = useRef(visibleRowIds)
  useEffect(() => {
    if (prevVisibleRowIdsRef.current === visibleRowIds) return
    prevVisibleRowIdsRef.current = visibleRowIds
    lastSelectedIndexRef.current = -1
    const visible = new Set(visibleRowIds)
    setSelectedRowIds((prev) => {
      if (prev.size === 0) return prev
      const next = new Set(Array.from(prev).filter((id) => visible.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [visibleRowIds])

  const isAllSelected =
    visibleRowIds.length > 0 && visibleRowIds.every((id) => selectedRowIds.has(id))
  const selectedFileIds = useMemo(
    () =>
      Array.from(selectedRowIds)
        .map(parseRowId)
        .filter((item) => item.kind === 'file')
        .map((item) => item.id),
    [selectedRowIds]
  )
  const selectedFolderIds = useMemo(
    () =>
      Array.from(selectedRowIds)
        .map(parseRowId)
        .filter((item) => item.kind === 'folder')
        .map((item) => item.id),
    [selectedRowIds]
  )

  const selectableConfig = useMemo(
    () => ({
      selectedIds: selectedRowIds,
      isAllSelected,
      onSelectRow: (rowId: string, checked: boolean, shiftKey?: boolean) => {
        const currentIndex = visibleRowIds.indexOf(rowId)
        if (shiftKey && lastSelectedIndexRef.current !== -1 && currentIndex !== -1) {
          const start = Math.min(lastSelectedIndexRef.current, currentIndex)
          const end = Math.max(lastSelectedIndexRef.current, currentIndex)
          setSelectedRowIds((prev) => {
            const next = new Set(prev)
            for (let i = start; i <= end; i++) next.add(visibleRowIds[i])
            return next
          })
          lastSelectedIndexRef.current = currentIndex
        } else {
          setSelectedRowIds((prev) => {
            const next = new Set(prev)
            if (checked) next.add(rowId)
            else next.delete(rowId)
            return next
          })
          if (checked) lastSelectedIndexRef.current = currentIndex
          else lastSelectedIndexRef.current = -1
        }
      },
      onSelectAll: (checked: boolean) => {
        lastSelectedIndexRef.current = -1
        setSelectedRowIds((prev) => {
          const next = new Set(prev)
          for (const rowId of visibleRowIds) {
            if (checked) next.add(rowId)
            else next.delete(rowId)
          }
          return next
        })
      },
      disabled: false,
    }),
    [selectedRowIds, isAllSelected, visibleRowIds]
  )

  const descendantFolderIdsByFolderId = useMemo(() => {
    const childrenByParent = new Map<string, string[]>()
    for (const folder of folders) {
      if (!folder.parentId) continue
      const children = childrenByParent.get(folder.parentId) ?? []
      children.push(folder.id)
      childrenByParent.set(folder.parentId, children)
    }

    const result = new Map<string, Set<string>>()
    const collect = (folderId: string, seen = new Set<string>()): Set<string> => {
      const cached = result.get(folderId)
      if (cached) return cached
      if (seen.has(folderId)) return new Set<string>()

      const nextSeen = new Set(seen)
      nextSeen.add(folderId)
      const descendants = new Set<string>()
      for (const childId of childrenByParent.get(folderId) ?? []) {
        if (nextSeen.has(childId)) continue
        descendants.add(childId)
        for (const nestedId of collect(childId, nextSeen)) {
          descendants.add(nestedId)
        }
      }
      result.set(folderId, descendants)
      return descendants
    }

    for (const folder of folders) {
      collect(folder.id)
    }
    return result
  }, [folders])

  const isInvalidDropTarget = useCallback(
    (targetRowId: string, sourceRowIds: string[]) => {
      const target = parseRowId(targetRowId)
      if (target.kind !== 'folder') return true

      for (const sourceRowId of sourceRowIds) {
        const source = parseRowId(sourceRowId)
        if (source.kind !== 'folder') continue
        if (source.id === target.id) return true
        if (descendantFolderIdsByFolderId.get(source.id)?.has(target.id)) return true
      }

      // Reject drop if every dragged item is already a direct child of the target
      const allAlreadyInTarget = sourceRowIds.every((sourceRowId) => {
        const source = parseRowId(sourceRowId)
        if (source.kind === 'file') {
          return filesRef.current.find((f) => f.id === source.id)?.folderId === target.id
        }
        return (foldersRef.current.find((f) => f.id === source.id)?.parentId ?? null) === target.id
      })
      if (allAlreadyInTarget) return true

      return false
    },
    [descendantFolderIdsByFolderId]
  )

  const uploadFiles = useCallback(
    async (filesToUpload: File[], targetFolderId = currentFolderId) => {
      if (!workspaceId || filesToUpload.length === 0 || !canEdit) return

      const oversized: string[] = []
      const sizeFiltered = filesToUpload.filter((f) => {
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

      const unsupported: string[] = []
      const allowedFiles = sizeFiltered.filter((f) => {
        const ext = getFileExtension(f.name)
        const ok = SUPPORTED_EXTENSIONS.includes(ext as (typeof SUPPORTED_EXTENSIONS)[number])
        if (!ok) unsupported.push(f.name)
        return ok
      })

      if (unsupported.length > 0) {
        logger.warn('Unsupported file types skipped:', unsupported)
      }

      if (allowedFiles.length === 0) return

      try {
        setUploading(true)
        setUploadProgress({ completed: 0, total: allowedFiles.length, currentPercent: 0 })

        for (let i = 0; i < allowedFiles.length; i++) {
          try {
            await uploadFile.mutateAsync({
              workspaceId,
              file: allowedFiles[i],
              folderId: targetFolderId,
              onProgress: ({ percent }) => {
                setUploadProgress((prev) => ({ ...prev, currentPercent: percent }))
              },
            })
            setUploadProgress({
              completed: i + 1,
              total: allowedFiles.length,
              currentPercent: 0,
            })
          } catch (err) {
            logger.error('Error uploading file:', err)
          }
        }
      } catch (err) {
        logger.error('Error uploading file:', err)
      } finally {
        setUploading(false)
        setUploadProgress({ completed: 0, total: 0, currentPercent: 0 })
      }
    },
    [workspaceId, canEdit, currentFolderId]
  )

  const rowDragDropConfig = useMemo<RowDragDropConfig>(
    () => ({
      activeDropTargetId,
      draggedRowIds,
      isAnyDragActive: draggedRowIds.size > 0,
      isRowDraggable: (rowId) => canEdit && listRename.editingId !== rowId,
      isRowDropTarget: (rowId) => canEdit && parseRowId(rowId).kind === 'folder',
      onDragStart: (e: DragEvent<HTMLTableRowElement>, rowId) => {
        if (!canEdit || listRename.editingId === rowId) {
          e.preventDefault()
          return
        }

        const sourceRowIds = selectedRowIds.has(rowId)
          ? visibleRowIds.filter((visibleRowId) => selectedRowIds.has(visibleRowId))
          : [rowId]

        draggedRowIdsRef.current = sourceRowIds
        setDraggedRowIds(new Set(sourceRowIds))
        if (!selectedRowIds.has(rowId)) {
          setSelectedRowIds(new Set([rowId]))
        }

        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData(
          'application/x-sim-workspace-file-rows',
          JSON.stringify(sourceRowIds)
        )
        e.dataTransfer.setData('text/plain', sourceRowIds.join(','))

        const count = sourceRowIds.length
        const firstParsed = parseRowId(sourceRowIds[0])
        const firstName =
          firstParsed.kind === 'file'
            ? filesRef.current.find((f) => f.id === firstParsed.id)?.name
            : foldersRef.current.find((f) => f.id === firstParsed.id)?.name
        const ghostLabel =
          count > 1 ? `${firstName ?? 'Items'} +${count - 1} more` : (firstName ?? 'Item')
        const ghost = document.createElement('div')
        ghost.style.cssText =
          'position:fixed;top:-500px;left:0;display:inline-flex;align-items:center;padding:4px 10px;background:var(--surface-active);border:1px solid var(--border);border-radius:8px;font-family:system-ui,-apple-system,sans-serif;font-size:13px;color:var(--text-body);white-space:nowrap;pointer-events:none;box-shadow:var(--shadow-medium);z-index:var(--z-toast)'
        const text = document.createElement('span')
        text.style.cssText = 'max-width:200px;overflow:hidden;text-overflow:ellipsis'
        text.textContent = ghostLabel
        ghost.appendChild(text)
        document.body.appendChild(ghost)
        void ghost.offsetHeight
        e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, ghost.offsetHeight / 2)
        dragGhostRef.current = ghost
      },
      onDragOver: (e: DragEvent<HTMLTableRowElement>, rowId) => {
        const sourceRowIds = draggedRowIdsRef.current
        const isExternalFileDrag = hasExternalFiles(e.dataTransfer)
        if (!isExternalFileDrag && isInvalidDropTarget(rowId, sourceRowIds)) return

        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = isExternalFileDrag ? 'copy' : 'move'
        setActiveDropTargetId(rowId)
      },
      onDragLeave: (e: DragEvent<HTMLTableRowElement>, rowId) => {
        const relatedTarget = e.relatedTarget
        if (relatedTarget instanceof Node && e.currentTarget.contains(relatedTarget)) return
        setActiveDropTargetId((current) => (current === rowId ? null : current))
      },
      onDrop: (e: DragEvent<HTMLTableRowElement>, rowId) => {
        e.preventDefault()
        e.stopPropagation()
        dragCounterRef.current = 0
        setIsDraggingOver(false)
        setActiveDropTargetId(null)
        const target = parseRowId(rowId)
        if (target.kind !== 'folder') return

        const droppedFiles = Array.from(e.dataTransfer.files ?? [])
        if (droppedFiles.length > 0) {
          void uploadFiles(droppedFiles, target.id)
          return
        }

        let sourceRowIds = draggedRowIdsRef.current
        const rawSource = e.dataTransfer.getData('application/x-sim-workspace-file-rows')
        if (rawSource) {
          try {
            const parsedSource = JSON.parse(rawSource)
            if (Array.isArray(parsedSource)) {
              sourceRowIds = parsedSource.filter(
                (source): source is string => typeof source === 'string' && source.length > 0
              )
            }
          } catch {
            sourceRowIds = draggedRowIdsRef.current
          }
        }

        if (isInvalidDropTarget(rowId, sourceRowIds)) return

        const fileIds = sourceRowIds
          .map(parseRowId)
          .filter((source) => source.kind === 'file')
          .map((source) => source.id)
        const folderIds = sourceRowIds
          .map(parseRowId)
          .filter((source) => source.kind === 'folder')
          .map((source) => source.id)

        if (fileIds.length === 0 && folderIds.length === 0) return

        void moveItems
          .mutateAsync({
            workspaceId,
            fileIds,
            folderIds,
            targetFolderId: target.id,
          })
          .then(() => {
            setSelectedRowIds(new Set())
          })
          .catch((error) => {
            logger.error('Failed to move items via drag and drop:', error)
          })
      },
      onDragEnd: () => {
        if (dragGhostRef.current) {
          dragGhostRef.current.remove()
          dragGhostRef.current = null
        }
        dragCounterRef.current = 0
        draggedRowIdsRef.current = []
        setDraggedRowIds(new Set())
        setIsDraggingOver(false)
        setActiveDropTargetId(null)
      },
    }),
    [
      activeDropTargetId,
      draggedRowIds,
      canEdit,
      listRename.editingId,
      selectedRowIds,
      visibleRowIds,
      isInvalidDropTarget,
      uploadFiles,
      workspaceId,
    ]
  )

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files
    if (!list || list.length === 0) return
    await uploadFiles(Array.from(list))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleDragEnter = (e: React.DragEvent) => {
    if (!hasExternalFiles(e.dataTransfer)) return
    e.preventDefault()
    dragCounterRef.current++
    setIsDraggingOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    if (!hasExternalFiles(e.dataTransfer)) return
    dragCounterRef.current--
    if (dragCounterRef.current === 0) setIsDraggingOver(false)
  }

  const handleDragOver = (e: React.DragEvent) => {
    if (!hasExternalFiles(e.dataTransfer)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  const handleDrop = async (e: React.DragEvent) => {
    if (!hasExternalFiles(e.dataTransfer)) return
    e.preventDefault()
    dragCounterRef.current = 0
    setIsDraggingOver(false)
    const dropped = Array.from(e.dataTransfer.files)
    if (dropped.length > 0) await uploadFiles(dropped)
  }

  const handleDownload = useCallback(async (file: WorkspaceFileRecord) => {
    try {
      await triggerFileDownload(file)
    } catch (err) {
      logger.error('Failed to download file:', err)
    }
  }, [])

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
      setSelectedRowIds(new Set())
      if (target.fileIds.includes(fileIdFromRouteRef.current ?? '')) {
        setIsDirty(false)
        setSaveStatus('idle')
        router.push(
          currentFolderId
            ? `/workspace/${workspaceId}/files?folderId=${currentFolderId}`
            : `/workspace/${workspaceId}/files`
        )
      }
    } catch (err) {
      logger.error('Failed to delete file:', err)
    }
  }, [workspaceId, router, currentFolderId])

  const isDirtyRef = useRef(isDirty)
  isDirtyRef.current = isDirty
  const saveStatusRef = useRef(saveStatus)
  saveStatusRef.current = saveStatus
  const pendingFileNavigationUrlRef = useRef<string | null>(null)

  const handleSave = useCallback(async () => {
    if (!saveRef.current || !isDirtyRef.current || saveStatusRef.current === 'saving') return
    await saveRef.current()
  }, [])

  const handleNavigateFromFileDetail = useCallback(
    (url: string) => {
      if (isDirtyRef.current) {
        pendingFileNavigationUrlRef.current = url
        setShowUnsavedChangesAlert(true)
        return
      }

      setPreviewMode('editor')
      router.push(url)
    },
    [router]
  )

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

  const handleBulkDelete = useCallback(() => {
    if (selectedFileIds.length === 0 && selectedFolderIds.length === 0) return
    setDeleteTarget({
      fileIds: selectedFileIds,
      folderIds: selectedFolderIds,
      name:
        selectedFileIds.length + selectedFolderIds.length === 1
          ? (files.find((file) => file.id === selectedFileIds[0])?.name ??
            folders.find((folder) => folder.id === selectedFolderIds[0])?.name ??
            'selected item')
          : `${selectedFileIds.length + selectedFolderIds.length} selected items`,
    })
    setShowDeleteConfirm(true)
  }, [selectedFileIds, selectedFolderIds, files, folders])

  const handleBulkDownload = useCallback(() => {
    const selectedFiles = files.filter((file) => selectedFileIds.includes(file.id))
    if (selectedFiles.length === 1 && selectedFolderIds.length === 0) {
      handleDownload(selectedFiles[0])
      return
    }

    const query = new URLSearchParams()
    for (const fileId of selectedFileIds) query.append('fileIds', fileId)
    for (const folderId of selectedFolderIds) query.append('folderIds', folderId)

    if (query.size === 0) return
    window.location.href = `/api/workspaces/${workspaceId}/files/download?${query.toString()}`
  }, [selectedFileIds, selectedFolderIds, files, handleDownload, workspaceId])

  const fileDetailBreadcrumbs = useMemo(() => {
    if (!selectedFile) return []

    const folderBreadcrumbs: BreadcrumbItem[] = []
    const visitedFolderIds = new Set<string>()
    let folderId = selectedFile.folderId

    while (folderId && !visitedFolderIds.has(folderId)) {
      visitedFolderIds.add(folderId)
      const folder = folderById.get(folderId)
      if (!folder) break

      folderBreadcrumbs.unshift({
        label: folder.name,
        onClick: () =>
          handleNavigateFromFileDetail(`/workspace/${workspaceId}/files?folderId=${folder.id}`),
      })
      folderId = folder.parentId
    }

    return [
      {
        label: 'Files',
        onClick: () => handleNavigateFromFileDetail(`/workspace/${workspaceId}/files`),
      },
      ...folderBreadcrumbs,
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
                { label: 'Delete', icon: Trash2, onClick: handleDeleteSelected },
              ]
            : []),
        ],
      },
    ]
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
    handleDeleteSelected,
  ])

  const handleDiscardChanges = () => {
    setShowUnsavedChangesAlert(false)
    setIsDirty(false)
    setSaveStatus('idle')
    setPreviewMode('editor')
    const folderId = selectedFileRef.current?.folderId
    const targetUrl =
      pendingFileNavigationUrlRef.current ??
      (folderId
        ? `/workspace/${workspaceId}/files?folderId=${folderId}`
        : `/workspace/${workspaceId}/files`)
    pendingFileNavigationUrlRef.current = null
    router.push(targetUrl)
  }

  const creatingFileRef = useRef(creatingFile)
  creatingFileRef.current = creatingFile

  const handleCreateFile = useCallback(async () => {
    if (creatingFileRef.current) return
    setCreatingFile(true)

    try {
      const existingNames = new Set(
        filesRef.current.filter((f) => (f.folderId ?? null) === currentFolderId).map((f) => f.name)
      )
      let name = 'untitled.md'
      let counter = 1
      while (existingNames.has(name)) {
        name = `untitled (${counter}).md`
        counter++
      }

      const mimeType = getMimeTypeFromExtension('md')
      const blob = new Blob([''], { type: mimeType })
      const file = new File([blob], name, { type: mimeType })
      const result = await uploadFile.mutateAsync({
        workspaceId,
        file,
        folderId: currentFolderId,
        skipToast: true,
      })
      const fileId = result.file?.id
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
      listRename.startRename(folderRowId(folder.id), folder.name)
    } catch (error) {
      logger.error('Failed to create folder:', error)
      toast.error(toError(error).message)
    }
  }, [workspaceId, folders, currentFolderId, listRename.startRename])

  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent, rowId: string) => {
      const parsed = parseRowId(rowId)
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
        lastSelectedIndexRef.current = visibleRowIds.indexOf(rowId)
        setSelectedRowIds(new Set([rowId]))
      }
      openContextMenu(e)
    },
    [folders, openContextMenu, selectedRowIds, visibleRowIds]
  )

  const handleContextMenuOpen = useCallback(() => {
    const item = contextMenuItemRef.current
    if (!item) return
    if (item.kind === 'folder') {
      router.push(`/workspace/${workspaceId}/files?folderId=${item.folder.id}`)
      closeContextMenu()
      return
    }
    router.push(
      item.file.folderId
        ? `/workspace/${workspaceId}/files/${item.file.id}?folderId=${item.file.folderId}`
        : `/workspace/${workspaceId}/files/${item.file.id}`
    )
    closeContextMenu()
  }, [closeContextMenu, router, workspaceId])

  const handleContextMenuDownload = useCallback(() => {
    const item = contextMenuItemRef.current
    if (!item) return
    const rowId = item.kind === 'file' ? fileRowId(item.file.id) : folderRowId(item.folder.id)
    if (selectedRowIds.has(rowId) && selectedRowIds.size > 1) {
      handleBulkDownload()
      closeContextMenu()
      return
    }
    if (item.kind === 'folder') {
      window.location.href = `/api/workspaces/${workspaceId}/files/download?folderIds=${encodeURIComponent(item.folder.id)}`
      closeContextMenu()
      return
    }
    handleDownload(item.file)
    closeContextMenu()
  }, [selectedRowIds, handleBulkDownload, closeContextMenu, workspaceId, handleDownload])

  const handleContextMenuRename = useCallback(() => {
    const item = contextMenuItemRef.current
    if (item?.kind === 'file') listRename.startRename(fileRowId(item.file.id), item.file.name)
    if (item?.kind === 'folder')
      listRename.startRename(folderRowId(item.folder.id), item.folder.name)
    closeContextMenu()
  }, [listRename.startRename, closeContextMenu])

  const handleContextMenuDelete = useCallback(() => {
    const item = contextMenuItemRef.current
    if (!item) return
    const rowId = item.kind === 'file' ? fileRowId(item.file.id) : folderRowId(item.folder.id)
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

  const handleContextMenuMove = useCallback(
    async (optionValue: string) => {
      const targetFolderId = optionValue === '__root__' ? null : optionValue
      try {
        await moveItems.mutateAsync({
          workspaceId,
          fileIds: selectedFileIds,
          folderIds: selectedFolderIds,
          targetFolderId,
        })
        setSelectedRowIds(new Set())
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

  const prevFileIdRef = useRef(fileIdFromRoute)
  useEffect(() => {
    if (fileIdFromRoute === prevFileIdRef.current) return
    prevFileIdRef.current = fileIdFromRoute
    const isJustCreated =
      isNewFile || (fileIdFromRoute != null && justCreatedFileIdRef.current === fileIdFromRoute)
    if (justCreatedFileIdRef.current && !isJustCreated) {
      justCreatedFileIdRef.current = null
    }
    const nextMode: PreviewMode = isJustCreated
      ? 'editor'
      : (() => {
          const file = fileIdFromRoute
            ? filesRef.current.find((f) => f.id === fileIdFromRoute)
            : null
          return file && isPreviewable(file) ? 'preview' : 'editor'
        })()
    setPreviewMode((current) => (nextMode === current ? current : nextMode))
  }, [fileIdFromRoute, isNewFile])

  useEffect(() => {
    if (isNewFile && fileIdFromRoute) {
      router.replace(
        currentFolderId
          ? `/workspace/${workspaceId}/files/${fileIdFromRoute}?folderId=${currentFolderId}`
          : `/workspace/${workspaceId}/files/${fileIdFromRoute}`
      )
    }
  }, [isNewFile, fileIdFromRoute, router, workspaceId, currentFolderId])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!fileIdFromRouteRef.current) return
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) return
      e.preventDefault()
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [handleSave])

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
        setSelectedRowIds(new Set())
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'a' && visibleRowIdsRef.current.length > 0) {
        e.preventDefault()
        setSelectedRowIds(new Set(visibleRowIdsRef.current))
      }
    }
    window.addEventListener('keydown', handleListKeyDown)
    return () => window.removeEventListener('keydown', handleListKeyDown)
  }, [])

  const handleCyclePreviewMode = useCallback(() => {
    setPreviewMode((prev) => {
      if (prev === 'editor') return 'split'
      if (prev === 'split') return 'preview'
      return 'editor'
    })
  }, [])

  const handleTogglePreview = useCallback(() => {
    setPreviewMode((prev) => (prev === 'preview' ? 'editor' : 'preview'))
  }, [])

  const fileActions = useMemo<HeaderAction[]>(() => {
    if (!selectedFile) return []
    const canEditText = isTextEditable(selectedFile)
    const canPreview = isPreviewable(selectedFile)
    const hasSplitView = canEditText && canPreview

    const saveLabel =
      saveStatus === 'saving'
        ? 'Saving...'
        : saveStatus === 'saved'
          ? 'Saved'
          : saveStatus === 'error'
            ? 'Save failed'
            : 'Save'

    const nextModeLabel =
      previewMode === 'editor' ? 'Split' : previewMode === 'split' ? 'Preview' : 'Edit'
    const nextModeIcon =
      previewMode === 'editor' ? Columns2 : previewMode === 'split' ? Eye : Pencil

    return [
      ...(canEditText
        ? [
            {
              label: saveLabel,
              onClick: handleSave,
              disabled:
                (!isDirty && saveStatus === 'idle') ||
                saveStatus === 'saving' ||
                saveStatus === 'saved',
            },
          ]
        : []),
      ...(hasSplitView
        ? [
            {
              label: nextModeLabel,
              icon: nextModeIcon,
              onClick: handleCyclePreviewMode,
            },
          ]
        : canPreview
          ? [
              {
                label: previewMode === 'preview' ? 'Edit' : 'Preview',
                icon: previewMode === 'preview' ? Pencil : Eye,
                onClick: handleTogglePreview,
              },
            ]
          : []),
      {
        label: 'Download',
        icon: Download,
        onClick: handleDownloadSelected,
      },
      ...(canEdit
        ? [
            {
              label: 'Delete',
              icon: Trash2,
              onClick: handleDeleteSelected,
            },
          ]
        : []),
    ]
  }, [
    selectedFile,
    canEdit,
    saveStatus,
    previewMode,
    isDirty,
    handleCyclePreviewMode,
    handleTogglePreview,
    handleSave,
    handleDownloadSelected,
    handleDeleteSelected,
  ])

  const listRenameRef = useRef(listRename)
  listRenameRef.current = listRename
  const headerRenameRef = useRef(headerRename)
  headerRenameRef.current = headerRename

  const handleRowClick = useCallback(
    (rowId: string) => {
      if (listRenameRef.current.editingId !== rowId && !headerRenameRef.current.editingId) {
        const parsed = parseRowId(rowId)
        if (parsed.kind === 'folder') {
          router.push(`/workspace/${workspaceId}/files?folderId=${parsed.id}`)
          return
        }
        router.push(
          currentFolderId
            ? `/workspace/${workspaceId}/files/${parsed.id}?folderId=${currentFolderId}`
            : `/workspace/${workspaceId}/files/${parsed.id}`
        )
      }
    },
    [router, workspaceId, currentFolderId]
  )

  const handleUploadClick = useCallback(() => {
    if (!canEdit || uploading) return
    fileInputRef.current?.click()
  }, [canEdit, uploading])

  const searchConfig: SearchConfig = {
    value: inputValue,
    onChange: setInputValue,
    onClearAll: () => setInputValue(''),
    placeholder: 'Search files...',
  }

  const createConfig = {
    label: 'New file',
    onClick: handleCreateFile,
    disabled: uploading || creatingFile || !canEdit,
  }

  const uploadButtonLabel =
    uploading && uploadProgress.total > 0
      ? uploadProgress.currentPercent > 0 && uploadProgress.currentPercent < 100
        ? `${uploadProgress.completed}/${uploadProgress.total} · ${uploadProgress.currentPercent}%`
        : `${uploadProgress.completed}/${uploadProgress.total}`
      : uploading
        ? 'Uploading...'
        : 'Upload'

  const headerActionsConfig = useMemo(
    () => [
      {
        label: uploadButtonLabel,
        icon: Upload,
        onClick: handleUploadClick,
        disabled: uploading || !canEdit,
      },
      {
        label: 'New folder',
        icon: FolderPlus,
        onClick: handleCreateFolder,
        disabled: createFolder.isPending || !canEdit,
      },
    ],
    [uploadButtonLabel, handleUploadClick, handleCreateFolder, createFolder.isPending, canEdit]
  )

  const handleNavigateToFiles = useCallback(() => {
    router.push(`/workspace/${workspaceId}/files`)
  }, [router, workspaceId])

  const loadingBreadcrumbs = useMemo(
    () => [{ label: 'Files', onClick: handleNavigateToFiles }, { label: '...' }],
    [handleNavigateToFiles]
  )

  const breadcrumbRenameRef = useRef(breadcrumbRename)
  breadcrumbRenameRef.current = breadcrumbRename

  const listBreadcrumbs = useMemo(() => {
    const breadcrumbs: BreadcrumbItem[] = [{ label: 'Files', onClick: handleNavigateToFiles }]
    if (!currentFolderPath) return breadcrumbs

    const segments = currentFolderPath.split('/')
    let parentId: string | null = null
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]
      const folder = folders.find(
        (item) => item.name === segment && (item.parentId ?? null) === parentId
      )
      if (!folder) continue
      const isCurrentFolder = folder.id === currentFolderId
      breadcrumbs.push({
        label: folder.name,
        onClick: isCurrentFolder
          ? undefined
          : () => router.push(`/workspace/${workspaceId}/files?folderId=${folder.id}`),
        editing:
          isCurrentFolder && breadcrumbRenameRef.current.editingId === folder.id
            ? {
                isEditing: true,
                value: breadcrumbRenameRef.current.editValue,
                onChange: breadcrumbRenameRef.current.setEditValue,
                onSubmit: breadcrumbRenameRef.current.submitRename,
                onCancel: breadcrumbRenameRef.current.cancelRename,
              }
            : undefined,
        dropdownItems:
          isCurrentFolder && canEdit
            ? [
                {
                  label: 'Rename',
                  onClick: () => breadcrumbRenameRef.current.startRename(folder.id, folder.name),
                },
              ]
            : undefined,
      })
      parentId = folder.id
    }
    return breadcrumbs
  }, [
    currentFolderPath,
    currentFolderId,
    folders,
    handleNavigateToFiles,
    router,
    workspaceId,
    canEdit,
    breadcrumbRename.editingId,
    breadcrumbRename.editValue,
  ])

  const memberOptions: ComboboxOption[] = useMemo(
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

  const contextMenuMoveOptions = useMemo((): MoveOptionNode[] => {
    const buildSubtree = (parentId: string | null): MoveOptionNode[] =>
      folders
        .filter((f) => {
          if ((f.parentId ?? null) !== parentId) return false
          if (selectedFolderIds.includes(f.id)) return false
          return selectedFolderIds.every(
            (sid) => !descendantFolderIdsByFolderId.get(sid)?.has(f.id)
          )
        })
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
        .map((f) => ({ value: f.id, label: f.name, children: buildSubtree(f.id) }))

    return [{ value: '__root__', label: 'Files', children: [] }, ...buildSubtree(null)]
  }, [folders, selectedFolderIds, descendantFolderIdsByFolderId])

  const sortConfig: SortConfig = useMemo(
    () => ({
      options: [
        { id: 'name', label: 'Name' },
        { id: 'size', label: 'Size' },
        { id: 'type', label: 'Type' },
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

  const hasActiveFilters =
    typeFilter.length > 0 || sizeFilter.length > 0 || uploadedByFilter.length > 0

  const emptyMessage = debouncedSearchTerm
    ? `No files match "${debouncedSearchTerm}"`
    : hasActiveFilters
      ? 'No files match the active filters'
      : currentFolderId
        ? 'This folder is empty'
        : 'No files yet'

  const filterContent = useMemo(() => {
    const typeDisplayLabel =
      typeFilter.length === 0
        ? 'All'
        : typeFilter.length === 1
          ? ((
              {
                document: 'Documents',
                image: 'Images',
                audio: 'Audio',
                video: 'Video',
              } as Record<string, string>
            )[typeFilter[0]] ?? typeFilter[0])
          : `${typeFilter.length} selected`

    const sizeDisplayLabel =
      sizeFilter.length === 0
        ? 'All'
        : sizeFilter.length === 1
          ? (({ small: 'Small', medium: 'Medium', large: 'Large' } as Record<string, string>)[
              sizeFilter[0]
            ] ?? sizeFilter[0])
          : `${sizeFilter.length} selected`

    const uploadedByDisplayLabel =
      uploadedByFilter.length === 0
        ? 'All'
        : uploadedByFilter.length === 1
          ? (members?.find((m) => m.userId === uploadedByFilter[0])?.name ?? '1 member')
          : `${uploadedByFilter.length} members`

    return (
      <div className='flex w-[240px] flex-col gap-3 p-3'>
        <div className='flex flex-col gap-1.5'>
          <span className='font-medium text-[var(--text-secondary)] text-caption'>File Type</span>
          <Combobox
            options={[
              { value: 'document', label: 'Documents' },
              { value: 'image', label: 'Images' },
              { value: 'audio', label: 'Audio' },
              { value: 'video', label: 'Video' },
            ]}
            multiSelect
            multiSelectValues={typeFilter}
            onMultiSelectChange={setTypeFilter}
            overlayContent={
              <span className='truncate text-[var(--text-primary)]'>{typeDisplayLabel}</span>
            }
            showAllOption
            allOptionLabel='All'
            size='sm'
            className='h-[32px] w-full rounded-md'
          />
        </div>
        <div className='flex flex-col gap-1.5'>
          <span className='font-medium text-[var(--text-secondary)] text-caption'>Size</span>
          <Combobox
            options={[
              { value: 'small', label: 'Small (< 1 MB)' },
              { value: 'medium', label: 'Medium (1–10 MB)' },
              { value: 'large', label: 'Large (> 10 MB)' },
            ]}
            multiSelect
            multiSelectValues={sizeFilter}
            onMultiSelectChange={setSizeFilter}
            overlayContent={
              <span className='truncate text-[var(--text-primary)]'>{sizeDisplayLabel}</span>
            }
            showAllOption
            allOptionLabel='All'
            size='sm'
            className='h-[32px] w-full rounded-md'
          />
        </div>
        {memberOptions.length > 0 && (
          <div className='flex flex-col gap-1.5'>
            <span className='font-medium text-[var(--text-secondary)] text-caption'>
              Uploaded By
            </span>
            <Combobox
              options={memberOptions}
              multiSelect
              multiSelectValues={uploadedByFilter}
              onMultiSelectChange={setUploadedByFilter}
              overlayContent={
                <span className='truncate text-[var(--text-primary)]'>
                  {uploadedByDisplayLabel}
                </span>
              }
              searchable
              searchPlaceholder='Search members...'
              showAllOption
              allOptionLabel='All'
              size='sm'
              className='h-[32px] w-full rounded-md'
            />
          </div>
        )}
        {hasActiveFilters && (
          <Button
            variant='ghost'
            onClick={() => {
              setTypeFilter([])
              setSizeFilter([])
              setUploadedByFilter([])
            }}
            className='h-[32px] w-full text-caption hover-hover:bg-[var(--surface-active)]'
          >
            Clear all filters
          </Button>
        )}
      </div>
    )
  }, [typeFilter, sizeFilter, uploadedByFilter, memberOptions, members, hasActiveFilters])

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
          ? `Uploaded by: ${members?.find((m) => m.userId === uploadedByFilter[0])?.name ?? '1 member'}`
          : `Uploaded by: ${uploadedByFilter.length} members`
      tags.push({ label, onRemove: () => setUploadedByFilter([]) })
    }
    return tags
  }, [typeFilter, sizeFilter, uploadedByFilter, members])

  if (fileIdFromRoute && !selectedFile && isLoading) {
    return (
      <div className='flex h-full flex-1 flex-col overflow-hidden bg-[var(--bg)]'>
        <ResourceHeader icon={FilesIcon} breadcrumbs={loadingBreadcrumbs} />
        <div className='flex flex-1 items-center justify-center bg-[var(--surface-1)]'>
          <Loader className='size-[20px] text-[var(--text-secondary)]' animate />
        </div>
      </div>
    )
  }

  if (selectedFile) {
    return (
      <>
        <div className='flex h-full flex-1 flex-col overflow-hidden bg-[var(--bg)]'>
          <ResourceHeader
            icon={FilesIcon}
            breadcrumbs={fileDetailBreadcrumbs}
            actions={fileActions}
          />
          <FileViewer
            key={selectedFile.id}
            file={selectedFile}
            workspaceId={workspaceId}
            canEdit={canEdit}
            previewMode={previewMode}
            onDirtyChange={setIsDirty}
            onSaveStatusChange={setSaveStatus}
            saveRef={saveRef}
          />

          <Modal open={showUnsavedChangesAlert} onOpenChange={setShowUnsavedChangesAlert}>
            <ModalContent size='sm'>
              <ModalHeader>Unsaved Changes</ModalHeader>
              <ModalBody>
                <ModalDescription className='text-[var(--text-secondary)]'>
                  You have unsaved changes. Are you sure you want to discard them?
                </ModalDescription>
              </ModalBody>
              <ModalFooter>
                <Button variant='default' onClick={() => setShowUnsavedChangesAlert(false)}>
                  Keep Editing
                </Button>
                <Button variant='destructive' onClick={handleDiscardChanges}>
                  Discard Changes
                </Button>
              </ModalFooter>
            </ModalContent>
          </Modal>
        </div>

        <DeleteConfirmModal
          open={showDeleteConfirm}
          onOpenChange={setShowDeleteConfirm}
          fileName={deleteTarget?.name}
          fileCount={deleteTarget?.fileIds.length ?? 0}
          folderCount={deleteTarget?.folderIds.length ?? 0}
          onDelete={handleDelete}
          isPending={deleteFile.isPending || bulkArchiveItems.isPending}
        />
      </>
    )
  }

  return (
    <div
      className='relative flex h-full flex-col overflow-hidden'
      onDragEnter={canEdit ? handleDragEnter : undefined}
      onDragLeave={canEdit ? handleDragLeave : undefined}
      onDragOver={canEdit ? handleDragOver : undefined}
      onDrop={canEdit ? handleDrop : undefined}
    >
      <Resource
        icon={FilesIcon}
        title='Files'
        breadcrumbs={listBreadcrumbs}
        create={createConfig}
        search={searchConfig}
        sort={sortConfig}
        filter={filterContent}
        filterTags={filterTags}
        headerActions={headerActionsConfig}
        columns={COLUMNS}
        rows={rows}
        selectable={selectableConfig}
        rowDragDrop={rowDragDropConfig}
        onRowClick={handleRowClick}
        onRowContextMenu={handleRowContextMenu}
        isLoading={isLoading || foldersLoading}
        onContextMenu={handleContentContextMenu}
        emptyMessage={emptyMessage}
        overlay={
          <>
            <FilesActionBar
              selectedCount={selectedRowIds.size}
              onDownload={handleBulkDownload}
              onMove={canEdit ? handleContextMenuMove : undefined}
              moveOptions={canEdit ? contextMenuMoveOptions : undefined}
              onDelete={canEdit ? handleBulkDelete : undefined}
              isLoading={bulkArchiveItems.isPending || moveItems.isPending}
            />
            {isDraggingOver ? (
              <div className='pointer-events-none absolute inset-0 z-[var(--z-dropdown)] flex flex-col items-center justify-center gap-2 border border-[var(--brand-secondary)] border-dashed bg-[var(--surface-4)] transition-colors'>
                <Upload className='size-5 text-[var(--brand-secondary)]' />
                <div className='flex flex-col gap-0.5 text-center'>
                  <p className='font-medium text-[14px] text-[var(--brand-secondary)]'>
                    Drop to upload
                  </p>
                  <p className='text-[11px] text-[var(--text-tertiary)]'>
                    Release files here to add them to this workspace
                  </p>
                </div>
              </div>
            ) : null}
          </>
        }
      />

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
        onDownload={handleContextMenuDownload}
        onRename={handleContextMenuRename}
        onDelete={handleContextMenuDelete}
        onMove={handleContextMenuMove}
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

      <input
        ref={fileInputRef}
        type='file'
        className='hidden'
        onChange={handleFileChange}
        disabled={uploading || !canEdit}
        accept={ACCEPT_ATTR}
        multiple
      />
    </div>
  )
}
