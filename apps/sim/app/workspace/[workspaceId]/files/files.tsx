'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams, useRouter } from 'next/navigation'
import {
  Button,
  Columns2,
  Download,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Eye,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Pencil,
  Skeleton,
  Trash,
  Upload,
} from '@/components/emcn'
import { File as FilesIcon } from '@/components/emcn/icons'
import { getDocumentIcon } from '@/components/icons/document-icons'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import {
  downloadWorkspaceFile,
  formatFileSize,
  getFileExtension,
  getMimeTypeFromExtension,
} from '@/lib/uploads/utils/file-utils'
import {
  SUPPORTED_AUDIO_EXTENSIONS,
  SUPPORTED_DOCUMENT_EXTENSIONS,
  SUPPORTED_VIDEO_EXTENSIONS,
} from '@/lib/uploads/utils/validation'
import type {
  HeaderAction,
  ResourceColumn,
  ResourceRow,
  SearchConfig,
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
import { useInlineRename } from '@/hooks/use-inline-rename'

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

const logger = createLogger('Files')

const SUPPORTED_EXTENSIONS = [
  ...SUPPORTED_DOCUMENT_EXTENSIONS,
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
  const workspaceId = params?.workspaceId as string
  const fileIdFromRoute =
    typeof params?.fileId === 'string' && params.fileId.length > 0 ? params.fileId : null
  const userPermissions = useUserPermissionsContext()

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
  const [uploadProgress, setUploadProgress] = useState({ completed: 0, total: 0 })
  const [inputValue, setInputValue] = useState('')
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('')
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(null)

  const handleSearchChange = useCallback((value: string) => {
    setInputValue(value)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearchTerm(value)
    }, 200)
  }, [])

  const [creatingFile, setCreatingFile] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [previewMode, setPreviewMode] = useState<PreviewMode>(() => {
    if (fileIdFromRoute) {
      const file = files.find((f) => f.id === fileIdFromRoute)
      if (file && isPreviewable(file)) return 'preview'
      return 'editor'
    }
    return 'preview'
  })
  const [showUnsavedChangesAlert, setShowUnsavedChangesAlert] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [contextMenuFile, setContextMenuFile] = useState<WorkspaceFileRecord | null>(null)
  const [deleteTargetFile, setDeleteTargetFile] = useState<WorkspaceFileRecord | null>(null)

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
    if (!debouncedSearchTerm) return files
    const q = debouncedSearchTerm.toLowerCase()
    return files.filter((f) => f.name.toLowerCase().includes(q))
  }, [files, debouncedSearchTerm])

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
          updated: timeCell(file.uploadedAt),
        },
        sortValues: {
          size: file.size,
          created: -new Date(file.uploadedAt).getTime(),
          updated: -new Date(file.uploadedAt).getTime(),
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

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const list = e.target.files
      if (!list || list.length === 0 || !workspaceId) return

      try {
        setUploading(true)

        const filesToUpload = Array.from(list)
        const unsupported: string[] = []
        const allowedFiles = filesToUpload.filter((f) => {
          const ext = getFileExtension(f.name)
          const ok = SUPPORTED_EXTENSIONS.includes(ext as (typeof SUPPORTED_EXTENSIONS)[number])
          if (!ok) unsupported.push(f.name)
          return ok
        })

        if (unsupported.length > 0) {
          logger.warn('Unsupported file types skipped:', unsupported)
        }

        setUploadProgress({ completed: 0, total: allowedFiles.length })

        for (let i = 0; i < allowedFiles.length; i++) {
          try {
            await uploadFile.mutateAsync({ workspaceId, file: allowedFiles[i] })
            setUploadProgress({ completed: i + 1, total: allowedFiles.length })
          } catch (err) {
            logger.error('Error uploading file:', err)
          }
        }
      } catch (err) {
        logger.error('Error uploading file:', err)
      } finally {
        setUploading(false)
        setUploadProgress({ completed: 0, total: 0 })
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
      }
    },
    [workspaceId]
  )

  const handleDownload = useCallback(async (file: WorkspaceFileRecord) => {
    try {
      await downloadWorkspaceFile(file)
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
      setDeleteTargetFile(file)
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

  const handleDiscardChanges = useCallback(() => {
    setShowUnsavedChangesAlert(false)
    setIsDirty(false)
    setSaveStatus('idle')
    setPreviewMode('editor')
    router.push(`/workspace/${workspaceId}/files`)
  }, [router, workspaceId])

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
        router.push(`/workspace/${workspaceId}/files/${fileId}`)
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
        setContextMenuFile(file)
        openContextMenu(e)
      }
    },
    [openContextMenu]
  )

  const contextMenuFileRef = useRef(contextMenuFile)
  contextMenuFileRef.current = contextMenuFile

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
    setDeleteTargetFile(file)
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
      fileIdFromRoute != null && justCreatedFileIdRef.current === fileIdFromRoute
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

  /** Stable refs for values used in callbacks to avoid dependency churn */
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

  const handleSearchClearAll = useCallback(() => {
    handleSearchChange('')
  }, [handleSearchChange])

  const searchConfig: SearchConfig = useMemo(
    () => ({
      value: inputValue,
      onChange: handleSearchChange,
      onClearAll: handleSearchClearAll,
      placeholder: 'Search files...',
    }),
    [inputValue, handleSearchChange, handleSearchClearAll]
  )

  const createConfig = useMemo(
    () => ({
      label: 'New file',
      onClick: handleCreateFile,
      disabled: uploading || creatingFile || !canEdit,
    }),
    [handleCreateFile, uploading, creatingFile, canEdit]
  )

  const uploadButtonLabel = useMemo(
    () =>
      uploading && uploadProgress.total > 0
        ? `${uploadProgress.completed}/${uploadProgress.total}`
        : uploading
          ? 'Uploading...'
          : 'Upload',
    [uploading, uploadProgress.completed, uploadProgress.total]
  )

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

  const handleNavigateToFiles = useCallback(() => {
    router.push(`/workspace/${workspaceId}/files`)
  }, [router, workspaceId])

  const loadingBreadcrumbs = useMemo(
    () => [{ label: 'Files', onClick: handleNavigateToFiles }, { label: '...' }],
    [handleNavigateToFiles]
  )

  if (fileIdFromRoute && !selectedFile) {
    return (
      <div className='flex h-full flex-1 flex-col overflow-hidden bg-[var(--bg)]'>
        <ResourceHeader icon={FilesIcon} breadcrumbs={loadingBreadcrumbs} />
        <div className='flex flex-1 items-center justify-center'>
          <Skeleton className='h-[16px] w-[200px]' />
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
            autoFocus={justCreatedFileIdRef.current === selectedFile.id}
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
    <>
      <Resource
        icon={FilesIcon}
        title='Files'
        create={createConfig}
        search={searchConfig}
        defaultSort='created'
        headerActions={headerActionsConfig}
        columns={COLUMNS}
        rows={rows}
        onRowClick={handleRowClick}
        onRowContextMenu={handleRowContextMenu}
        isLoading={isLoading}
        onContextMenu={handleContentContextMenu}
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
    </>
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
            <span className='font-medium text-[var(--text-primary)]'>{fileName}</span>?{' '}
            <span className='text-[var(--text-tertiary)]'>
              You can restore it from Recently Deleted in Settings.
            </span>
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
