'use client'

import { useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Files as FilesIcon } from 'lucide-react'
import { useParams } from 'next/navigation'
import { getFileExtension } from '@/lib/uploads/utils/file-utils'
import type { ResourceColumn, ResourceRow } from '@/app/workspace/[workspaceId]/components'
import { ownerCell, Resource, timeCell } from '@/app/workspace/[workspaceId]/components'
import { getDocumentIcon } from '@/app/workspace/[workspaceId]/knowledge/components'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { useWorkspaceMembersQuery } from '@/hooks/queries/workspace'
import { useUploadWorkspaceFile, useWorkspaceFiles } from '@/hooks/queries/workspace-files'

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

const ACCEPT_ATTR =
  '.pdf,.csv,.doc,.docx,.txt,.md,.xlsx,.xls,.html,.htm,.pptx,.ppt,.json,.yaml,.yml,.mp3,.m4a,.wav,.webm,.ogg,.flac,.aac,.opus,.mp4,.mov,.avi,.mkv'

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

  const ext = filename.split('.').pop()?.toLowerCase()
  if (ext) return ext.toUpperCase()

  return mimeType ?? 'File'
}

export function Files() {
  const params = useParams()
  const workspaceId = params?.workspaceId as string
  const userPermissions = useUserPermissionsContext()

  const { data: files = [], isLoading, error } = useWorkspaceFiles(workspaceId)
  const { data: members } = useWorkspaceMembersQuery(workspaceId)
  const uploadFile = useUploadWorkspaceFile()

  if (error) {
    logger.error('Failed to load files:', error)
  }

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState({ completed: 0, total: 0 })
  const [searchTerm, setSearchTerm] = useState('')

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
          onClick: () => fileInputRef.current?.click(),
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
        columns={COLUMNS}
        rows={rows}
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
    </>
  )
}
