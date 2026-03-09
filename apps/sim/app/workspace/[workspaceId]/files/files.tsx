'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Download, Files as FilesIcon, Upload } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button, Trash2 } from '@/components/emcn'
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
import { useWorkspaceMembersQuery } from '@/hooks/queries/workspace'
import {
  useDeleteWorkspaceFile,
  useUploadWorkspaceFile,
  useWorkspaceFiles,
} from '@/hooks/queries/workspace-files'

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

  if (error) {
    logger.error('Failed to load files:', error)
  }

  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState({ completed: 0, total: 0 })
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

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

  const handleDownload = useCallback(async () => {
    if (!selectedFile) return

    try {
      const serveUrl = `/api/files/serve/${encodeURIComponent(selectedFile.key)}?context=workspace`
      const response = await fetch(serveUrl)
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = selectedFile.name
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      logger.error('Failed to download file:', err)
    }
  }, [selectedFile])

  const handleDelete = useCallback(async () => {
    if (!selectedFile) return

    try {
      await deleteFile.mutateAsync({
        workspaceId,
        fileId: selectedFile.id,
        fileSize: selectedFile.size,
      })
      setSelectedFileId(null)
    } catch (err) {
      logger.error('Failed to delete file:', err)
    }
  }, [selectedFile, workspaceId])

  const handleSave = useCallback(async () => {
    if (saveRef.current) {
      await saveRef.current()
    }
  }, [])

  const handleFileCreated = useCallback((fileId: string) => {
    setSelectedFileId(fileId)
  }, [])

  if (selectedFile) {
    return (
      <div className='flex h-full flex-1 flex-col overflow-hidden bg-white dark:bg-[var(--bg)]'>
        <ResourceHeader
          icon={FilesIcon}
          breadcrumbs={[
            { label: 'Files', onClick: () => setSelectedFileId(null) },
            { label: selectedFile.name },
          ]}
        />
        <ResourceOptionsBar
          toolbarActions={
            <div className='flex items-center gap-[6px]'>
              {isDirty && (
                <Button
                  variant='subtle'
                  className='px-[8px] py-[4px] text-[12px]'
                  onClick={handleSave}
                >
                  Save
                </Button>
              )}
              <Button
                variant='subtle'
                className='px-[8px] py-[4px] text-[12px]'
                onClick={handleDownload}
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
                onClick={handleDelete}
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
        isLoading={isLoading}
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

      <CreateFileModal
        open={createModalOpen}
        onOpenChange={setCreateModalOpen}
        onCreated={handleFileCreated}
        workspaceId={workspaceId}
      />
    </>
  )
}
