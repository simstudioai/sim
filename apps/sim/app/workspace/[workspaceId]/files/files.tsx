'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  Button,
  Columns2,
  Combobox,
  type ComboboxOption,
  Download,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Eye,
  Loader,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Pencil,
  Trash,
  toast,
  Upload,
} from '@/components/emcn'
import { File as FilesIcon } from '@/components/emcn/icons'
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
  SUPPORTED_VIDEO_EXTENSIONS,
} from '@/lib/uploads/utils/validation'
import type {
  FilterTag,
  HeaderAction,
  ResourceColumn,
  ResourceRow,
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
import type { PreviewMode } from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import {
  FileViewer,
  isPreviewable,
  isTextEditable,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import { FilesListContextMenu } from '@/app/workspace/[workspaceId]/files/components/files-list-context-menu'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { useWorkspaceMembersQuery } from '@/hooks/queries/workspace'
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

const logger = createLogger('Files')

const SUPPORTED_EXTENSIONS = [
  ...SUPPORTED_DOCUMENT_EXTENSIONS,
  ...SUPPORTED_CODE_EXTENSIONS,
  ...SUPPORTED_AUDIO_EXTENSIONS,
  ...SUPPORTED_VIDEO_EXTENSIONS,
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

function formatFileType(mimeType: string | null, filename: string): string {
  if (mimeType && MIME_TYPE_LABELS[mimeType]) {
    return MIME_TYPE_LABELS[mimeType]
  }

  if (mimeType?.startsWith('audio/')) return 'Audio'
  if (mimeType?.startsWith('video/')) return 'Video'

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
  const workspaceId = params?.workspaceId as string

  const fileIdFromRoute =
    typeof params?.fileId === 'string' && params.fileId.length > 0 ? params.fileId : null
  const userPermissions = useUserPermissionsContext()
  const { config: permissionConfig } = usePermissionConfig()

  useEffect(() => {
    if (permissionConfig.hideFilesTab) {
      router.replace(`/workspace/${workspaceId}`)
    }
  }, [permissionConfig.hideFilesTab, router, workspaceId])

  const { data: files = [], isLoading, error } = useWorkspaceFiles(workspaceId)
  const { data: members } = useWorkspaceMembersQuery(workspaceId)
  const uploadFile = useUploadWorkspaceFile()
  const deleteFile = useDeleteWorkspaceFile()
  const renameFile = useRenameWorkspaceFile()

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
  const contextMenuFileRef = useRef<WorkspaceFileRecord | null>(null)
  const [deleteTargetFile, setDeleteTargetFile] = useState<{ id: string; name: string } | null>(
    null
  )

  const listRename = useInlineRename({
    onSave: (fileId, name) => renameFile.mutate({ workspaceId, fileId, name }),
  })

  const headerRename = useInlineRename({
    onSave: (fileId, name) => {
      renameFile.mutate({ workspaceId, fileId, name })
    },
  })

  const selectedFile = useMemo(
    () => (fileIdFromRoute ? files.find((f) => f.id === fileIdFromRoute) : null),
    [fileIdFromRoute, files]
  )
  const selectedFileRef = useRef(selectedFile)
  selectedFileRef.current = selectedFile

  const filteredFiles = useMemo(() => {
    let result = debouncedSearchTerm
      ? files.filter((f) => f.name.toLowerCase().includes(debouncedSearchTerm.toLowerCase()))
      : files

    if (typeFilter.length > 0) {
      result = result.filter((f) => {
        const ext = getFileExtension(f.name)
        if (typeFilter.includes('document') && isSupportedExtension(ext)) return true
        if (typeFilter.includes('audio') && isAudioFileType(f.type)) return true
        if (typeFilter.includes('video') && isVideoFileType(f.type)) return true
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
  }, [files, debouncedSearchTerm, typeFilter, sizeFilter, uploadedByFilter, activeSort, members])

  const rowCacheRef = useRef(
    new Map<string, { row: ResourceRow; file: WorkspaceFileRecord; members: typeof members }>()
  )

  const baseRows: ResourceRow[] = useMemo(() => {
    const prevCache = rowCacheRef.current
    const nextCache = new Map<
      string,
      { row: ResourceRow; file: WorkspaceFileRecord; members: typeof members }
    >()

    const result = filteredFiles.map((file) => {
      const cached = prevCache.get(file.id)
      if (cached && cached.file === file && cached.members === members) {
        nextCache.set(file.id, cached)
        return cached.row
      }
      const Icon = getDocumentIcon(file.type || '', file.name)
      const row: ResourceRow = {
        id: file.id,
        cells: {
          name: {
            icon: <Icon className='h-[14px] w-[14px]' />,
            label: file.name,
          },
          size: {
            label: formatFileSize(file.size, { includeBytes: true }),
          },
          type: {
            icon: <Icon className='h-[14px] w-[14px]' />,
            label: formatFileType(file.type, file.name),
          },
          created: timeCell(file.uploadedAt),
          owner: ownerCell(file.uploadedBy, members),
          updated: timeCell(file.updatedAt),
        },
      }
      nextCache.set(file.id, { row, file, members })
      return row
    })

    rowCacheRef.current = nextCache
    return result
  }, [filteredFiles, members])

  const rows: ResourceRow[] = useMemo(() => {
    if (!listRename.editingId) return baseRows
    return baseRows.map((row) => {
      if (row.id !== listRename.editingId) return row
      const file = filteredFiles.find((f) => f.id === row.id)
      if (!file) return row
      const Icon = getDocumentIcon(file.type || '', file.name)
      return {
        ...row,
        cells: {
          ...row.cells,
          name: {
            ...row.cells.name,
            content: (
              <span className='flex min-w-0 items-center gap-3 font-medium text-[var(--text-body)] text-sm'>
                <span className='flex-shrink-0 text-[var(--text-icon)]'>
                  <Icon className='h-[14px] w-[14px]' />
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
  }, [
    baseRows,
    listRename.editingId,
    listRename.editValue,
    listRename.setEditValue,
    listRename.submitRename,
    listRename.cancelRename,
    filteredFiles,
  ])

  const uploadFiles = async (filesToUpload: File[]) => {
    if (!workspaceId || filesToUpload.length === 0) return

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
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files
    if (!list || list.length === 0) return
    await uploadFiles(Array.from(list))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current++
    if (e.dataTransfer.types.includes('Files')) setIsDraggingOver(true)
  }

  const handleDragLeave = () => {
    dragCounterRef.current--
    if (dragCounterRef.current === 0) setIsDraggingOver(false)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  const handleDrop = async (e: React.DragEvent) => {
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

  const deleteTargetFileRef = useRef(deleteTargetFile)
  deleteTargetFileRef.current = deleteTargetFile
  const fileIdFromRouteRef = useRef(fileIdFromRoute)
  fileIdFromRouteRef.current = fileIdFromRoute

  const handleDelete = useCallback(async () => {
    const target = deleteTargetFileRef.current
    if (!target) return

    try {
      await deleteFile.mutateAsync({
        workspaceId,
        fileId: target.id,
      })
      setShowDeleteConfirm(false)
      setDeleteTargetFile(null)
      if (fileIdFromRouteRef.current === target.id) {
        setIsDirty(false)
        setSaveStatus('idle')
        router.push(`/workspace/${workspaceId}/files`)
      }
    } catch (err) {
      logger.error('Failed to delete file:', err)
    }
  }, [workspaceId, router])

  const isDirtyRef = useRef(isDirty)
  isDirtyRef.current = isDirty
  const saveStatusRef = useRef(saveStatus)
  saveStatusRef.current = saveStatus

  const handleSave = useCallback(async () => {
    if (!saveRef.current || !isDirtyRef.current || saveStatusRef.current === 'saving') return
    await saveRef.current()
  }, [])

  const handleBackAttempt = useCallback(() => {
    if (isDirtyRef.current) {
      setShowUnsavedChangesAlert(true)
    } else {
      setPreviewMode('editor')
      router.push(`/workspace/${workspaceId}/files`)
    }
  }, [router, workspaceId])

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
      setDeleteTargetFile({ id: file.id, name: file.name })
      setShowDeleteConfirm(true)
    }
  }, [])

  const fileDetailBreadcrumbs = useMemo(
    () =>
      selectedFile
        ? [
            { label: 'Files', onClick: handleBackAttempt },
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
                {
                  label: 'Rename',
                  icon: Pencil,
                  onClick: handleStartHeaderRename,
                },
                {
                  label: 'Download',
                  icon: Download,
                  onClick: handleDownloadSelected,
                },
                {
                  label: 'Delete',
                  icon: Trash,
                  onClick: handleDeleteSelected,
                },
              ],
            },
          ]
        : [],
    [
      selectedFile,
      handleBackAttempt,
      headerRename.editingId,
      headerRename.editValue,
      handleStartHeaderRename,
      handleDownloadSelected,
      handleDeleteSelected,
    ]
  )

  const handleDiscardChanges = () => {
    setShowUnsavedChangesAlert(false)
    setIsDirty(false)
    setSaveStatus('idle')
    setPreviewMode('editor')
    router.push(`/workspace/${workspaceId}/files`)
  }

  const creatingFileRef = useRef(creatingFile)
  creatingFileRef.current = creatingFile

  const handleCreateFile = useCallback(async () => {
    if (creatingFileRef.current) return
    setCreatingFile(true)

    try {
      const existingNames = new Set(filesRef.current.map((f) => f.name))
      let name = 'untitled.md'
      let counter = 1
      while (existingNames.has(name)) {
        name = `untitled (${counter}).md`
        counter++
      }

      const mimeType = getMimeTypeFromExtension('md')
      const blob = new Blob([''], { type: mimeType })
      const file = new File([blob], name, { type: mimeType })
      const result = await uploadFile.mutateAsync({ workspaceId, file })
      const fileId = result.file?.id
      if (fileId) {
        justCreatedFileIdRef.current = fileId
        router.push(`/workspace/${workspaceId}/files/${fileId}?new=1`)
      }
    } catch (err) {
      logger.error('Failed to create file:', err)
    } finally {
      setCreatingFile(false)
    }
  }, [workspaceId, router])

  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent, rowId: string) => {
      const file = filesRef.current.find((f) => f.id === rowId)
      if (file) {
        contextMenuFileRef.current = file
        openContextMenu(e)
      }
    },
    [openContextMenu]
  )

  const handleContextMenuOpen = useCallback(() => {
    const file = contextMenuFileRef.current
    if (!file) return
    router.push(`/workspace/${workspaceId}/files/${file.id}`)
    closeContextMenu()
  }, [closeContextMenu, router, workspaceId])

  const handleContextMenuDownload = useCallback(() => {
    const file = contextMenuFileRef.current
    if (!file) return
    handleDownload(file)
    closeContextMenu()
  }, [handleDownload, closeContextMenu])

  const handleContextMenuRename = useCallback(() => {
    const file = contextMenuFileRef.current
    if (file) listRename.startRename(file.id, file.name)
    closeContextMenu()
  }, [listRename.startRename, closeContextMenu])

  const handleContextMenuDelete = useCallback(() => {
    const file = contextMenuFileRef.current
    if (!file) return
    setDeleteTargetFile({ id: file.id, name: file.name })
    setShowDeleteConfirm(true)
    closeContextMenu()
  }, [closeContextMenu])

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
    fileInputRef.current?.click()
    closeListContextMenu()
  }, [closeListContextMenu])

  const prevFileIdRef = useRef(fileIdFromRoute)
  if (fileIdFromRoute !== prevFileIdRef.current) {
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
    if (nextMode !== previewMode) {
      setPreviewMode(nextMode)
    }
  }

  useEffect(() => {
    if (isNewFile && fileIdFromRoute) {
      router.replace(`/workspace/${workspaceId}/files/${fileIdFromRoute}`)
    }
  }, [isNewFile, fileIdFromRoute, router, workspaceId])

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
      {
        label: 'Delete',
        icon: Trash,
        onClick: handleDeleteSelected,
      },
    ]
  }, [
    selectedFile,
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
    (id: string) => {
      if (listRenameRef.current.editingId !== id && !headerRenameRef.current.editingId) {
        router.push(`/workspace/${workspaceId}/files/${id}`)
      }
    },
    [router, workspaceId]
  )

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const canEdit = userPermissions.canEdit === true

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
      },
    ],
    [uploadButtonLabel, handleUploadClick]
  )

  const handleNavigateToFiles = () => {
    router.push(`/workspace/${workspaceId}/files`)
  }

  const loadingBreadcrumbs = [{ label: 'Files', onClick: handleNavigateToFiles }, { label: '...' }]

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
            className='h-[14px] w-[14px] rounded-full border border-[var(--border)] object-cover'
          />
        ) : (
          <span className='flex h-[14px] w-[14px] items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-3)] font-medium text-[8px] text-[var(--text-secondary)]'>
            {m.name.charAt(0).toUpperCase()}
          </span>
        ),
      })),
    [members]
  )

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

  const filterContent = useMemo(() => {
    const typeDisplayLabel =
      typeFilter.length === 0
        ? 'All'
        : typeFilter.length === 1
          ? (({ document: 'Documents', audio: 'Audio', video: 'Video' } as Record<string, string>)[
              typeFilter[0]
            ] ?? typeFilter[0])
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
            size='sm'
            onClick={() => {
              setTypeFilter([])
              setSizeFilter([])
              setUploadedByFilter([])
            }}
            className='h-[32px] w-full text-[var(--text-secondary)] text-caption hover-hover:bg-[var(--surface-active)]'
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
          <Loader className='h-[20px] w-[20px] text-[var(--text-secondary)]' animate />
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
            autoFocus={isNewFile || justCreatedFileIdRef.current === selectedFile.id}
            onDirtyChange={setIsDirty}
            onSaveStatusChange={setSaveStatus}
            saveRef={saveRef}
          />

          <Modal open={showUnsavedChangesAlert} onOpenChange={setShowUnsavedChangesAlert}>
            <ModalContent size='sm'>
              <ModalHeader>Unsaved Changes</ModalHeader>
              <ModalBody>
                <p className='text-[var(--text-secondary)]'>
                  You have unsaved changes. Are you sure you want to discard them?
                </p>
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
          fileName={deleteTargetFile?.name}
          onDelete={handleDelete}
          isPending={deleteFile.isPending}
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
        create={createConfig}
        search={searchConfig}
        sort={sortConfig}
        filter={filterContent}
        filterTags={filterTags}
        headerActions={headerActionsConfig}
        columns={COLUMNS}
        rows={rows}
        onRowClick={handleRowClick}
        onRowContextMenu={handleRowContextMenu}
        isLoading={isLoading}
        onContextMenu={handleContentContextMenu}
        overlay={
          isDraggingOver ? (
            <div className='pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center gap-2 border border-[var(--accent)] border-dashed bg-[var(--surface-4)] transition-colors'>
              <Upload className='h-5 w-5 text-[var(--accent)]' />
              <div className='flex flex-col gap-0.5 text-center'>
                <p className='font-medium text-[14px] text-[var(--accent)]'>Drop to upload</p>
                <p className='text-[11px] text-[var(--text-tertiary)]'>
                  Release files here to add them to this workspace
                </p>
              </div>
            </div>
          ) : null
        }
      />

      <FilesListContextMenu
        isOpen={isListContextMenuOpen}
        position={listContextMenuPosition}
        onClose={closeListContextMenu}
        onCreateFile={handleCreateFile}
        onUploadFile={handleListUploadFile}
        disableCreate={uploading || creatingFile || !canEdit}
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
        canEdit={canEdit}
      />

      <DeleteConfirmModal
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        fileName={deleteTargetFile?.name}
        onDelete={handleDelete}
        isPending={deleteFile.isPending}
      />

      <input
        ref={fileInputRef}
        type='file'
        className='hidden'
        onChange={handleFileChange}
        disabled={uploading}
        accept={ACCEPT_ATTR}
        multiple
      />
    </div>
  )
}

interface FileRowContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  onOpen: () => void
  onDownload: () => void
  onRename: () => void
  onDelete: () => void
  canEdit: boolean
}

const FileRowContextMenu = memo(function FileRowContextMenu({
  isOpen,
  position,
  onClose,
  onOpen,
  onDownload,
  onRename,
  onDelete,
  canEdit,
}: FileRowContextMenuProps) {
  return (
    <DropdownMenu open={isOpen} onOpenChange={(open) => !open && onClose()} modal={false}>
      <DropdownMenuTrigger asChild>
        <div
          style={{
            position: 'fixed',
            left: `${position.x}px`,
            top: `${position.y}px`,
            width: '1px',
            height: '1px',
            pointerEvents: 'none',
          }}
          tabIndex={-1}
          aria-hidden
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='start'
        side='bottom'
        sideOffset={4}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DropdownMenuItem onSelect={onOpen}>
          <Eye />
          Open
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onDownload}>
          <Download />
          Download
        </DropdownMenuItem>
        {canEdit && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onRename}>
              <Pencil />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDelete}>
              <Trash />
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})

interface DeleteConfirmModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fileName?: string
  onDelete: () => void
  isPending: boolean
}

const DeleteConfirmModal = memo(function DeleteConfirmModal({
  open,
  onOpenChange,
  fileName,
  onDelete,
  isPending,
}: DeleteConfirmModalProps) {
  return (
    <Modal open={open} onOpenChange={onOpenChange}>
      <ModalContent size='sm'>
        <ModalHeader>Delete File</ModalHeader>
        <ModalBody>
          <p className='text-[var(--text-secondary)]'>
            Are you sure you want to delete{' '}
            <span className='font-medium text-[var(--text-primary)]'>{fileName}</span>? You can
            restore it from Recently Deleted in Settings.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant='default' onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button variant='destructive' onClick={onDelete} disabled={isPending}>
            {isPending ? 'Deleting...' : 'Delete'}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
})
