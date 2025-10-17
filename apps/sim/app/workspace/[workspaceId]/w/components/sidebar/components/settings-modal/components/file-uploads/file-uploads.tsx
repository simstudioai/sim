'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, Search, Trash2, Upload } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Input } from '@/components/ui'
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
import { getFileExtension } from '@/lib/uploads/file-utils'
import type { WorkspaceFileRecord } from '@/lib/uploads/workspace-files'
import { getDocumentIcon } from '@/app/workspace/[workspaceId]/knowledge/components'
import { useUserPermissions } from '@/hooks/use-user-permissions'
import { useWorkspacePermissions } from '@/hooks/use-workspace-permissions'

const logger = createLogger('FileUploadsSettings')

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
] as const
const ACCEPT_ATTR = '.pdf,.csv,.doc,.docx,.txt,.md,.xlsx,.xls,.html,.htm,.pptx,.ppt'

export function FileUploads() {
  const params = useParams()
  const workspaceId = params?.workspaceId as string
  const [files, setFiles] = useState<WorkspaceFileRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { permissions: workspacePermissions, loading: permissionsLoading } =
    useWorkspacePermissions(workspaceId)
  const userPermissions = useUserPermissions(workspacePermissions, permissionsLoading)

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

  useEffect(() => {
    void loadFiles()
  }, [workspaceId])

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files
    if (!list || list.length === 0 || !workspaceId) return

    try {
      setUploading(true)
      setUploadError(null)

      const filesToUpload = Array.from(list)
      const unsupported: string[] = []
      const allowedFiles = filesToUpload.filter((f) => {
        const ext = getFileExtension(f.name)
        const ok = SUPPORTED_EXTENSIONS.includes(ext as (typeof SUPPORTED_EXTENSIONS)[number])
        if (!ok) unsupported.push(f.name)
        return ok
      })
      let lastError: string | null = null

      for (const selectedFile of allowedFiles) {
        try {
          const formData = new FormData()
          formData.append('file', selectedFile)

          const response = await fetch(`/api/workspaces/${workspaceId}/files`, {
            method: 'POST',
            body: formData,
          })

          const data = await response.json()
          if (!data.success) {
            lastError = data.error || 'Upload failed'
          }
        } catch (err) {
          logger.error('Error uploading file:', err)
          lastError = 'Upload failed'
        }
      }

      await loadFiles()
      if (unsupported.length) {
        lastError = `Unsupported file type: ${unsupported.join(', ')}`
      }
      if (lastError) setUploadError(lastError)
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
        await loadFiles()
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
    const d = new Date(date)
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const yy = String(d.getFullYear()).slice(2)
    return `${mm}/${dd}/${yy}`
  }

  const [search, setSearch] = useState('')
  const filteredFiles = useMemo(() => {
    if (!search) return files
    const q = search.toLowerCase()
    return files.filter((f) => f.name.toLowerCase().includes(q))
  }, [files, search])

  const truncateMiddle = (text: string, start = 24, end = 12) => {
    if (!text) return ''
    if (text.length <= start + end + 3) return text
    return `${text.slice(0, start)}...${text.slice(-end)}`
  }

  return (
    <div className='relative flex h-full flex-col'>
      {/* Header: search left, file count + Upload right */}
      <div className='flex items-center justify-between px-6 pt-4 pb-2'>
        <div className='flex h-9 w-56 items-center gap-2 rounded-[8px] border bg-transparent pr-2 pl-3'>
          <Search className='h-4 w-4 flex-shrink-0 text-muted-foreground' strokeWidth={2} />
          <Input
            placeholder='Search files...'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className='flex-1 border-0 bg-transparent px-0 font-[380] font-sans text-base text-foreground leading-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
          />
        </div>
        <div className='flex items-center gap-3'>
          <div className='text-muted-foreground text-sm'>
            {files.length} {files.length === 1 ? 'file' : 'files'}
          </div>
          {userPermissions.canEdit && (
            <div className='flex items-center'>
              <input
                ref={fileInputRef}
                type='file'
                className='hidden'
                onChange={handleFileChange}
                disabled={uploading}
                accept={ACCEPT_ATTR}
              />
              <Button
                onClick={handleUploadClick}
                disabled={uploading}
                variant='ghost'
                className='h-9 rounded-[8px] border bg-background px-3 shadow-xs hover:bg-muted focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
              >
                <Upload className='mr-2 h-4 w-4 stroke-[2px]' />
                {uploading ? 'Uploading...' : 'Upload File'}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Error message */}
      {uploadError && <div className='px-6 pb-2 text-red-600 text-sm'>{uploadError}</div>}

      {/* Files Table */}
      <div className='scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent min-h-0 flex-1 overflow-y-auto px-6'>
        {loading ? (
          <div className='py-8 text-center text-muted-foreground text-sm'>Loading files...</div>
        ) : files.length === 0 ? (
          <div className='py-8 text-center text-muted-foreground text-sm'>
            No files uploaded yet
          </div>
        ) : (
          <Table className='table-auto text-[13px]'>
            <TableHeader>
              <TableRow>
                <TableHead className='w-[56%] px-3 text-xs'>Name</TableHead>
                <TableHead className='w-[14%] px-3 text-left text-xs'>Size</TableHead>
                <TableHead className='w-[15%] px-3 text-left text-xs'>Uploaded</TableHead>
                <TableHead className='w-[15%] px-3 text-left text-xs'>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredFiles.map((file) => {
                const Icon = getDocumentIcon(file.type || '', file.name)
                return (
                  <TableRow key={file.id} className='hover:bg-muted/50'>
                    <TableCell className='px-3'>
                      <div className='flex min-w-0 items-center gap-2'>
                        <Icon className='h-3.5 w-3.5 shrink-0 text-muted-foreground' />
                        <span className='min-w-0 truncate font-normal' title={file.name}>
                          {truncateMiddle(file.name)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className='whitespace-nowrap px-3 text-[12px] text-muted-foreground'>
                      {formatFileSize(file.size)}
                    </TableCell>
                    <TableCell className='whitespace-nowrap px-3 text-[12px] text-muted-foreground'>
                      {formatDate(file.uploadedAt)}
                    </TableCell>
                    <TableCell className='px-3'>
                      <div className='flex items-center gap-1'>
                        <Button
                          variant='ghost'
                          size='icon'
                          onClick={() => handleDownload(file)}
                          title='Download'
                          className='h-6 w-6'
                          aria-label={`Download ${file.name}`}
                        >
                          <Download className='h-3.5 w-3.5 text-muted-foreground' />
                        </Button>
                        {userPermissions.canEdit && (
                          <Button
                            variant='ghost'
                            size='icon'
                            onClick={() => handleDelete(file)}
                            className='h-6 w-6 text-destructive hover:text-destructive'
                            disabled={deletingFileId === file.id}
                            title='Delete'
                            aria-label={`Delete ${file.name}`}
                          >
                            <Trash2 className='h-3.5 w-3.5' />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}
