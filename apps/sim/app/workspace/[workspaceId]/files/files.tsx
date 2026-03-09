'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams } from 'next/navigation'
import {
  Button,
  Download,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Pencil,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDivider,
  PopoverItem,
  Skeleton,
  Trash,
  Upload,
} from '@/components/emcn'
import { File as FilesIcon } from '@/components/emcn/icons'
import { getDocumentIcon } from '@/components/icons/document-icons'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import {
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
} from '@/app/workspace/[workspaceId]/components'
import {
  InlineRenameInput,
  ownerCell,
  Resource,
  ResourceHeader,
  timeCell,
} from '@/app/workspace/[workspaceId]/components'
import {
  FileViewer,
  TEXT_EDITABLE_EXTENSIONS,
} from '@/app/workspace/[workspaceId]/files/components/file-viewer'
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

async function downloadFile(file: WorkspaceFileRecord) {
  const serveUrl = `/api/files/serve/${encodeURIComponent(file.key)}?context=workspace`
  const response = await fetch(serveUrl)
  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.statusText}`)
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function Files() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const saveRef = useRef<(() => Promise<void>) | null>(null)

  const params = useParams()
  const workspaceId = params?.workspaceId as string
  const userPermissions = useUserPermissionsContext()

  const { data: files = [], isLoading, error } = useWorkspaceFiles(workspaceId)
  const { data: members } = useWorkspaceMembersQuery(workspaceId)
  const uploadFile = useUploadWorkspaceFile()
  const deleteFile = useDeleteWorkspaceFile()
  const renameFile = useRenameWorkspaceFile()

  const {
    isOpen: isContextMenuOpen,
    position: contextMenuPosition,
    menuRef: contextMenuRef,
    handleContextMenu: openContextMenu,
    closeMenu: closeContextMenu,
  } = useContextMenu()

  if (error) {
    logger.error('Failed to load files:', error)
  }

  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState({ completed: 0, total: 0 })
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
  const [creatingFile, setCreatingFile] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [showUnsavedChangesAlert, setShowUnsavedChangesAlert] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [contextMenuFile, setContextMenuFile] = useState<WorkspaceFileRecord | null>(null)
  const [deleteTargetFile, setDeleteTargetFile] = useState<WorkspaceFileRecord | null>(null)

  const listRename = useInlineRename({
    onSave: (fileId, name) => renameFile.mutate({ workspaceId, fileId, name }),
  })

  const headerRename = useInlineRename({
    onSave: (_id, name) => {
      if (selectedFile) renameFile.mutate({ workspaceId, fileId: selectedFile.id, name })
    },
  })

  const selectedFile = useMemo(
    () => (selectedFileId ? files.find((f) => f.id === selectedFileId) : null),
    [selectedFileId, files]
  )

  const filteredFiles = useMemo(() => {
    if (!searchTerm) return files
    const q = searchTerm.toLowerCase()
    return files.filter((f) => f.name.toLowerCase().includes(q))
  }, [files, searchTerm])

  const rows: ResourceRow[] = useMemo(
    () =>
      filteredFiles.map((file) => {
        const Icon = getDocumentIcon(file.type || '', file.name)
        return {
          id: file.id,
          cells: {
            name: {
              icon: <Icon className='h-[14px] w-[14px]' />,
              label: file.name,
              content:
                listRename.editingId === file.id ? (
                  <span className='flex min-w-0 items-center gap-[12px] font-medium text-[14px] text-[var(--text-body)]'>
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
                ) : undefined,
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
      }),
    [filteredFiles, members, listRename.editingId, listRename.editValue]
  )

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
      await downloadFile(file)
    } catch (err) {
      logger.error('Failed to download file:', err)
    }
  }, [])

  const handleDelete = useCallback(async () => {
    const target = deleteTargetFile
    if (!target) return

    try {
      await deleteFile.mutateAsync({
        workspaceId,
        fileId: target.id,
        fileSize: target.size,
      })
      setShowDeleteConfirm(false)
      setDeleteTargetFile(null)
      if (selectedFileId === target.id) {
        setIsDirty(false)
        setSaveStatus('idle')
        setSelectedFileId(null)
      }
    } catch (err) {
      logger.error('Failed to delete file:', err)
    }
  }, [deleteTargetFile, workspaceId, selectedFileId])

  const handleSave = useCallback(async () => {
    if (!saveRef.current || !isDirty || saveStatus === 'saving') return

    setSaveStatus('saving')
    try {
      await saveRef.current()
      setSaveStatus('saved')
    } catch {
      setSaveStatus('error')
    }
  }, [isDirty, saveStatus])

  const handleBackAttempt = useCallback(() => {
    if (isDirty) {
      setShowUnsavedChangesAlert(true)
    } else {
      setSelectedFileId(null)
    }
  }, [isDirty])

  const handleDiscardChanges = useCallback(() => {
    setShowUnsavedChangesAlert(false)
    setIsDirty(false)
    setSaveStatus('idle')
    setSelectedFileId(null)
  }, [])

  const handleCreateFile = useCallback(async () => {
    if (creatingFile) return
    setCreatingFile(true)

    try {
      const existingNames = new Set(files.map((f) => f.name))
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
        setSelectedFileId(fileId)
      }
    } catch (err) {
      logger.error('Failed to create file:', err)
    } finally {
      setCreatingFile(false)
    }
  }, [creatingFile, files, workspaceId])

  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent, rowId: string) => {
      const file = files.find((f) => f.id === rowId)
      if (file) {
        setContextMenuFile(file)
        openContextMenu(e)
      }
    },
    [files, openContextMenu]
  )

  const handleContextMenuOpen = useCallback(() => {
    if (!contextMenuFile) return
    setSelectedFileId(contextMenuFile.id)
    closeContextMenu()
  }, [contextMenuFile, closeContextMenu])

  const handleContextMenuDownload = useCallback(() => {
    if (!contextMenuFile) return
    handleDownload(contextMenuFile)
    closeContextMenu()
  }, [contextMenuFile, handleDownload, closeContextMenu])

  const handleContextMenuRename = useCallback(() => {
    if (contextMenuFile) listRename.startRename(contextMenuFile.id, contextMenuFile.name)
    closeContextMenu()
  }, [contextMenuFile, listRename, closeContextMenu])

  const handleContextMenuDelete = useCallback(() => {
    if (!contextMenuFile) return
    setDeleteTargetFile(contextMenuFile)
    setShowDeleteConfirm(true)
    closeContextMenu()
  }, [contextMenuFile, closeContextMenu])

  useEffect(() => {
    if (saveStatus !== 'saved' && saveStatus !== 'error') return
    const timer = setTimeout(() => setSaveStatus('idle'), 2000)
    return () => clearTimeout(timer)
  }, [saveStatus])

  useEffect(() => {
    if (!selectedFile) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedFile, handleSave])

  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  if (selectedFileId && !selectedFile) {
    return (
      <div className='flex h-full flex-1 flex-col overflow-hidden bg-white dark:bg-[var(--bg)]'>
        <ResourceHeader
          icon={FilesIcon}
          breadcrumbs={[
            { label: 'Files', onClick: () => setSelectedFileId(null) },
            { label: '...' },
          ]}
        />
        <div className='flex flex-1 items-center justify-center'>
          <Skeleton className='h-[16px] w-[200px]' />
        </div>
      </div>
    )
  }

  if (selectedFile) {
    const isTextEditable = TEXT_EDITABLE_EXTENSIONS.has(getFileExtension(selectedFile.name))
    const saveLabel =
      saveStatus === 'saving'
        ? 'Saving...'
        : saveStatus === 'saved'
          ? 'Saved'
          : saveStatus === 'error'
            ? 'Save failed'
            : 'Save'

    const fileActions: HeaderAction[] = [
      ...(isTextEditable
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
      {
        label: 'Download',
        icon: Download,
        onClick: () => handleDownload(selectedFile),
      },
      {
        label: 'Delete',
        icon: Trash,
        onClick: () => {
          setDeleteTargetFile(selectedFile)
          setShowDeleteConfirm(true)
        },
      },
    ]

    return (
      <>
        <div className='flex h-full flex-1 flex-col overflow-hidden bg-white dark:bg-[var(--bg)]'>
          <ResourceHeader
            icon={FilesIcon}
            breadcrumbs={[
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
                    onClick: () => headerRename.startRename(selectedFile.id, selectedFile.name),
                  },
                  {
                    label: 'Download',
                    icon: Download,
                    onClick: () => handleDownload(selectedFile),
                  },
                  {
                    label: 'Delete',
                    icon: Trash,
                    onClick: () => {
                      setDeleteTargetFile(selectedFile)
                      setShowDeleteConfirm(true)
                    },
                  },
                ],
              },
            ]}
            actions={fileActions}
          />
          <FileViewer
            key={selectedFile.id}
            file={selectedFile}
            workspaceId={workspaceId}
            canEdit={userPermissions.canEdit === true}
            onDirtyChange={setIsDirty}
            saveRef={saveRef}
          />

          <Modal open={showUnsavedChangesAlert} onOpenChange={setShowUnsavedChangesAlert}>
            <ModalContent size='sm'>
              <ModalHeader>Unsaved Changes</ModalHeader>
              <ModalBody>
                <p className='text-[13px] text-[var(--text-secondary)]'>
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

  const uploadButtonLabel =
    uploading && uploadProgress.total > 0
      ? `${uploadProgress.completed}/${uploadProgress.total}`
      : uploading
        ? 'Uploading...'
        : 'Upload'

  return (
    <>
      <Resource
        icon={FilesIcon}
        title='Files'
        create={{
          label: 'New file',
          onClick: handleCreateFile,
          disabled: uploading || creatingFile || userPermissions.canEdit !== true,
        }}
        search={{
          value: searchTerm,
          onChange: setSearchTerm,
          placeholder: 'Search files...',
        }}
        defaultSort='created'
        headerActions={[
          {
            label: uploadButtonLabel,
            icon: Upload,
            onClick: () => fileInputRef.current?.click(),
          },
        ]}
        columns={COLUMNS}
        rows={rows}
        onRowClick={(id) => {
          if (listRename.editingId !== id) setSelectedFileId(id)
        }}
        onRowContextMenu={handleRowContextMenu}
        isLoading={isLoading}
      />

      <Popover
        open={isContextMenuOpen}
        onOpenChange={(open) => !open && closeContextMenu()}
        variant='secondary'
        size='sm'
      >
        <PopoverAnchor
          style={{
            position: 'fixed',
            left: `${contextMenuPosition.x}px`,
            top: `${contextMenuPosition.y}px`,
            width: '1px',
            height: '1px',
          }}
        />
        <PopoverContent ref={contextMenuRef} align='start' side='bottom' sideOffset={4}>
          <PopoverItem onClick={handleContextMenuOpen}>Open</PopoverItem>
          <PopoverItem onClick={handleContextMenuDownload}>Download</PopoverItem>
          {userPermissions.canEdit === true && (
            <>
              <PopoverDivider />
              <PopoverItem onClick={handleContextMenuRename}>Rename</PopoverItem>
              <PopoverItem onClick={handleContextMenuDelete}>Delete</PopoverItem>
            </>
          )}
        </PopoverContent>
      </Popover>

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

interface DeleteConfirmModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fileName?: string
  onDelete: () => void
  isPending: boolean
}

function DeleteConfirmModal({
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
          <p className='text-[13px] text-[var(--text-secondary)]'>
            Are you sure you want to delete{' '}
            <span className='font-medium text-[var(--text-primary)]'>{fileName}</span>?{' '}
            <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
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
}
