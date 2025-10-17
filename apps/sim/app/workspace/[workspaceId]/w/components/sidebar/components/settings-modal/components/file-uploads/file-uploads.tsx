'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, File as FileIcon, Trash2, Upload } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { createLogger } from '@/lib/logs/console/logger'
import type { WorkspaceFileRecord } from '@/lib/uploads/workspace-files'
import { useUserPermissions } from '@/hooks/use-user-permissions'
import { useWorkspacePermissions } from '@/hooks/use-workspace-permissions'

const logger = createLogger('FileUploadsSettings')

export function FileUploads() {
  const params = useParams()
  const workspaceId = params?.workspaceId as string
  const [files, setFiles] = useState<WorkspaceFileRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Use existing permissions hooks
  const { permissions: workspacePermissions, loading: permissionsLoading } =
    useWorkspacePermissions(workspaceId)
  const userPermissions = useUserPermissions(workspacePermissions, permissionsLoading)

  // Load workspace files
  const loadFiles = async () => {
    if (!workspaceId) return

    try {
      setLoading(true)
      const response = await fetch(`/api/workspaces/${workspaceId}/files`)
      const data = await response.json()

      if (data.success) {
        setFiles(data.files)
      }
    } catch (error) {
      logger.error('Error loading workspace files:', error)
    } finally {
      setLoading(false)
    }
  }

  // Load files on mount
  useEffect(() => {
    void loadFiles()
  }, [workspaceId])

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (!selectedFile || !workspaceId) return

    try {
      setUploading(true)
      setUploadError(null)

      const formData = new FormData()
      formData.append('file', selectedFile)

      const response = await fetch(`/api/workspaces/${workspaceId}/files`, {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()

      if (data.success) {
        await loadFiles() // Reload list
        setUploadError(null)
      } else {
        const errorMessage = data.error || 'Upload failed'
        setUploadError(errorMessage)
      }
    } catch (error) {
      logger.error('Error uploading file:', error)
      setUploadError('Upload failed')
      setTimeout(() => setUploadError(null), 5000)
    } finally {
      setUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleDownload = async (file: WorkspaceFileRecord) => {
    if (!workspaceId) return

    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/files/${file.id}/download`, {
        method: 'POST',
      })
      const data = await response.json()

      if (data.success && data.downloadUrl) {
        // Trigger download
        window.open(data.downloadUrl, '_blank')
      }
    } catch (error) {
      logger.error('Error downloading file:', error)
    }
  }

  const handleDelete = async (file: WorkspaceFileRecord) => {
    if (!workspaceId) return

    try {
      setDeletingFileId(file.id)

      const response = await fetch(`/api/workspaces/${workspaceId}/files/${file.id}`, {
        method: 'DELETE',
      })

      const data = await response.json()

      if (data.success) {
        await loadFiles() // Reload list
      }
    } catch (error) {
      logger.error('Error deleting file:', error)
    } finally {
      setDeletingFileId(null)
    }
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const formatDate = (date: Date | string): string => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  return (
    <div className='flex h-full flex-col space-y-6 p-6'>
      <div>
        <h2 className='font-semibold text-lg'>File Uploads</h2>
        <p className='text-muted-foreground text-sm'>
          Manage files for this workspace. Files accesible via the file block.
        </p>
      </div>

      {/* Upload Button */}
      <div className='flex items-center justify-between'>
        <div className='text-muted-foreground text-sm'>{files.length} file(s)</div>
        {userPermissions.canEdit && (
          <div>
            <input
              ref={fileInputRef}
              type='file'
              className='hidden'
              onChange={handleFileChange}
              disabled={uploading}
            />
            <Button onClick={handleUploadClick} disabled={uploading} size='sm'>
              <Upload className='mr-2 h-4 w-4' />
              {uploading ? 'Uploading...' : 'Upload File'}
            </Button>
          </div>
        )}
      </div>

      {/* Error message */}
      {uploadError && (
        <div className='rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-destructive text-sm'>
          {uploadError}
        </div>
      )}

      {/* Files Table */}
      <div className='flex-1 overflow-auto rounded-md border'>
        {loading ? (
          <div className='flex h-32 items-center justify-center text-muted-foreground text-sm'>
            Loading files...
          </div>
        ) : files.length === 0 ? (
          <div className='flex h-32 items-center justify-center text-muted-foreground text-sm'>
            No files uploaded yet
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-[40%] text-center'>Name</TableHead>
                <TableHead className='w-[15%] text-center'>Size</TableHead>
                <TableHead className='w-[20%] text-center'>Uploaded</TableHead>
                <TableHead className='w-[25%] text-center'>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.map((file) => (
                <TableRow key={file.id} className='group'>
                  <TableCell>
                    <div className='flex items-center gap-2'>
                      <FileIcon className='h-4 w-4 flex-shrink-0 text-muted-foreground' />
                      <span className='truncate font-medium' title={file.name}>
                        {file.name}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className='text-center text-muted-foreground text-sm'>
                    {formatFileSize(file.size)}
                  </TableCell>
                  <TableCell className='text-center text-muted-foreground text-sm'>
                    {formatDate(file.uploadedAt)}
                  </TableCell>
                  <TableCell>
                    <div className='flex items-center justify-end gap-1'>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => handleDownload(file)}
                        title='Download'
                      >
                        <Download className='h-4 w-4' />
                      </Button>
                      {userPermissions.canEdit && (
                        <Button
                          variant='ghost'
                          size='sm'
                          onClick={() => handleDelete(file)}
                          className='text-destructive hover:text-destructive'
                          disabled={deletingFileId === file.id}
                          title='Delete'
                        >
                          <Trash2 className='h-4 w-4' />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
