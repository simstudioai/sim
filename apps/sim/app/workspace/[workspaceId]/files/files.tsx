'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Download, Files as FilesIcon, Upload } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDivider,
  PopoverItem,
  Skeleton,
  Trash2,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { getFileExtension } from '@/lib/uploads/utils/file-utils'
import type { ResourceColumn, ResourceRow } from '@/app/workspace/[workspaceId]/components'
import {
  ownerCell,
  Resource,
  ResourceHeader,
  ResourceOptionsBar,
  timeCell,
} from '@/app/workspace/[workspaceId]/components'
import { CreateFileModal } from '@/app/workspace/[workspaceId]/files/components/create-file-modal'
import { FileViewer } from '@/app/workspace/[workspaceId]/files/components/file-viewer'
import { getDocumentIcon } from '@/app/workspace/[workspaceId]/knowledge/components'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { useWorkspaceMembersQuery } from '@/hooks/queries/workspace'
import {
  useDeleteWorkspaceFile,
  useUploadWorkspaceFile,
  useWorkspaceFiles,
} from '@/hooks/queries/workspace-files'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'

type SaveStatus = 'idle' | 'saving' | 'saved'

const logger = createLogger('Files')

const SUPPORTED_EXTENSIONS = [
  'pdf',
  'csv',
  'doc',
  'docx',
  'txt',
  'md',
  'xlsx',
  'xls',
  'html',
  'htm',
  'pptx',
  'ppt',
  'json',
  'yaml',
  'yml',
  'mp3',
  'm4a',
  'wav',
  'webm',
  'ogg',
  'flac',
  'aac',
  'opus',
  'mp4',
  'mov',
  'avi',
  'mkv',
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

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
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [showUnsavedChangesAlert, setShowUnsavedChangesAlert] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [contextMenuFile, setContextMenuFile] = useState<WorkspaceFileRecord | null>(null)
  const [deleteTargetFile, setDeleteTargetFile] = useState<WorkspaceFileRecord | null>(null)

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
            },
            size: {
              label: formatFileSize(file.size),
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
    [filteredFiles, members]
  )

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
  }

  const handleDownload = useCallback(
    async (file: WorkspaceFileRecord) => {
      try {
        await downloadFile(file)
      } catch (err) {
        logger.error('Failed to download file:', err)
      }
    },
    []
  )

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
        setSelectedFileId(null)
      }
    } catch (err) {
      logger.error('Failed to delete file:', err)
    }
  }, [deleteTargetFile, workspaceId, selectedFileId])

  const handleSave = useCallback(async () => {
    if (!saveRef.current) return

    setSaveStatus('saving')
    try {
      await saveRef.current()
      setSaveStatus('saved')
    } catch {
      setSaveStatus('idle')
    }
  }, [])

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
    setSelectedFileId(null)
  }, [])

  const handleFileCreated = useCallback((fileId: string) => {
    setSelectedFileId(fileId)
  }, [])

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

  const handleContextMenuDelete = useCallback(() => {
    if (!contextMenuFile) return
    setDeleteTargetFile(contextMenuFile)
    setShowDeleteConfirm(true)
    closeContextMenu()
  }, [contextMenuFile, closeContextMenu])

  useEffect(() => {
    if (saveStatus !== 'saved') return
    const timer = setTimeout(() => setSaveStatus('idle'), 2000)
    return () => clearTimeout(timer)
  }, [saveStatus])

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
    const saveLabel = saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : 'Save'

    return (
      <div className='flex h-full flex-1 flex-col overflow-hidden bg-white dark:bg-[var(--bg)]'>
        <ResourceHeader
          icon={FilesIcon}
          breadcrumbs={[
            { label: 'Files', onClick: handleBackAttempt },
            { label: selectedFile.name },
          ]}
        />
        <ResourceOptionsBar
          toolbarActions={
            <div className='flex items-center gap-[6px]'>
              <Button
                variant='subtle'
                className={cn(
                  'px-[8px] py-[4px] text-[12px]',
                  !isDirty && saveStatus === 'idle' && 'opacity-50'
                )}
                onClick={handleSave}
                disabled={(!isDirty && saveStatus === 'idle') || saveStatus === 'saving'}
              >
                {saveLabel}
              </Button>
              <Button
                variant='subtle'
                className='px-[8px] py-[4px] text-[12px]'
                onClick={() => handleDownload(selectedFile)}
              >
                <Download className='mr-[6px] h-[14px] w-[14px]' />
                Download
              </Button>
              <Button
                variant='subtle'
                className={cn(
                  'px-[8px] py-[4px] text-[12px]',
                  'text-[var(--text-muted)] hover:text-red-500'
                )}
                onClick={() => {
                  setDeleteTargetFile(selectedFile)
                  setShowDeleteConfirm(true)
                }}
                disabled={userPermissions.canEdit !== true || deleteFile.isPending}
              >
                <Trash2 className='mr-[6px] h-[14px] w-[14px]' />
                Delete
              </Button>
            </div>
          }
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

        <Modal open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
          <ModalContent size='sm'>
            <ModalHeader>Delete File</ModalHeader>
            <ModalBody>
              <p className='text-[13px] text-[var(--text-secondary)]'>
                Are you sure you want to delete{' '}
                <span className='font-medium text-[var(--text-primary)]'>
                  {deleteTargetFile?.name}
                </span>
                ?{' '}
                <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
              </p>
            </ModalBody>
            <ModalFooter>
              <Button
                variant='default'
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleteFile.isPending}
              >
                Cancel
              </Button>
              <Button
                variant='destructive'
                onClick={handleDelete}
                disabled={deleteFile.isPending}
              >
                {deleteFile.isPending ? 'Deleting...' : 'Delete'}
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </div>
    )
  }

  const uploadLabel =
    uploading && uploadProgress.total > 0
      ? `${uploadProgress.completed}/${uploadProgress.total}`
      : uploading
        ? 'Uploading...'
        : 'New file'

  return (
    <>
      <Resource
        icon={FilesIcon}
        title='Files'
        create={{
          label: uploadLabel,
          onClick: () => setCreateModalOpen(true),
          disabled: uploading || userPermissions.canEdit !== true,
        }}
        search={{
          value: searchTerm,
          onChange: setSearchTerm,
          placeholder: 'Search files...',
        }}
        defaultSort='created'
        onSort={() => {}}
        onFilter={() => {}}
        toolbarActions={
          <Button
            variant='subtle'
            className='px-[8px] py-[4px] text-[12px]'
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || userPermissions.canEdit !== true}
          >
            <Upload className='mr-[6px] h-[14px] w-[14px]' />
            Upload
          </Button>
        }
        columns={COLUMNS}
        rows={rows}
        onRowClick={(id) => setSelectedFileId(id)}
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
              <PopoverItem onClick={handleContextMenuDelete}>Delete</PopoverItem>
            </>
          )}
        </PopoverContent>
      </Popover>

      {!selectedFile && (
        <Modal open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
          <ModalContent size='sm'>
            <ModalHeader>Delete File</ModalHeader>
            <ModalBody>
              <p className='text-[13px] text-[var(--text-secondary)]'>
                Are you sure you want to delete{' '}
                <span className='font-medium text-[var(--text-primary)]'>
                  {deleteTargetFile?.name}
                </span>
                ?{' '}
                <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
              </p>
            </ModalBody>
            <ModalFooter>
              <Button
                variant='default'
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleteFile.isPending}
              >
                Cancel
              </Button>
              <Button
                variant='destructive'
                onClick={handleDelete}
                disabled={deleteFile.isPending}
              >
                {deleteFile.isPending ? 'Deleting...' : 'Delete'}
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}

      <input
        ref={fileInputRef}
        type='file'
        className='hidden'
        onChange={handleFileChange}
        disabled={uploading}
        accept={ACCEPT_ATTR}
        multiple
      />

      <CreateFileModal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        onCreated={handleFileCreated}
        workspaceId={workspaceId}
      />
    </>
  )
}
