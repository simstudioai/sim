'use client'

import { useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { ArrowDown, Loader2, Plus, Search, X } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  Trash,
} from '@/components/emcn'
import { Input, Skeleton } from '@/components/ui'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import { cn } from '@/lib/core/utils/cn'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { getFileExtension } from '@/lib/uploads/utils/file-utils'
import { getDocumentIcon } from '@/app/workspace/[workspaceId]/knowledge/components'
import { useWorkspacePermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  useDeleteWorkspaceFile,
  useStorageInfo,
  useUploadWorkspaceFile,
  useWorkspaceFiles,
} from '@/hooks/queries/workspace-files'

const logger = createLogger('FileUploadsSettings')
const isBillingEnabled = isTruthy(getEnv('NEXT_PUBLIC_BILLING_ENABLED'))

const SUPPORTED_EXTENSIONS = [
  // Documents
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
  // Audio formats
  'mp3',
  'm4a',
  'wav',
  'webm',
  'ogg',
  'flac',
  'aac',
  'opus',
  // Video formats
  'mp4',
  'mov',
  'avi',
  'mkv',
] as const
const ACCEPT_ATTR =
  '.pdf,.csv,.doc,.docx,.txt,.md,.xlsx,.xls,.html,.htm,.pptx,.ppt,.json,.yaml,.yml,.mp3,.m4a,.wav,.webm,.ogg,.flac,.aac,.opus,.mp4,.mov,.avi,.mkv'

const PLAN_NAMES = {
  enterprise: 'Enterprise',
  team: 'Team',
  pro: 'Pro',
  free: 'Free',
} as const

export function Files() {
  const params = useParams()
  const workspaceId = params?.workspaceId as string

  // React Query hooks - with placeholderData to show cached data immediately
  const { data: files = [] } = useWorkspaceFiles(workspaceId)
  const { data: storageInfo } = useStorageInfo(isBillingEnabled)
  const uploadFile = useUploadWorkspaceFile()
  const deleteFile = useDeleteWorkspaceFile()

  // Local UI state
  const [uploading, setUploading] = useState(false)
  const [failedFiles, setFailedFiles] = useState<string[]>([])
  const [uploadProgress, setUploadProgress] = useState({ completed: 0, total: 0 })
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const { userPermissions, permissionsLoading } = useWorkspacePermissionsContext()

  const handleUploadClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files
    if (!list || list.length === 0 || !workspaceId) return

    try {
      setUploading(true)
      setFailedFiles([])

      const filesToUpload = Array.from(list)
      const unsupported: string[] = []
      const allowedFiles = filesToUpload.filter((f) => {
        const ext = getFileExtension(f.name)
        const ok = SUPPORTED_EXTENSIONS.includes(ext as (typeof SUPPORTED_EXTENSIONS)[number])
        if (!ok) unsupported.push(f.name)
        return ok
      })

      setUploadProgress({ completed: 0, total: allowedFiles.length })
      const failed: string[] = [...unsupported]

      for (let i = 0; i < allowedFiles.length; i++) {
        const selectedFile = allowedFiles[i]
        try {
          await uploadFile.mutateAsync({ workspaceId, file: selectedFile })
          setUploadProgress({ completed: i + 1, total: allowedFiles.length })
        } catch (err) {
          logger.error('Error uploading file:', err)
          failed.push(selectedFile.name)
        }
      }

      if (failed.length > 0) {
        setFailedFiles(failed)
      }
    } catch (error) {
      logger.error('Error uploading file:', error)
    } finally {
      setUploading(false)
      setUploadProgress({ completed: 0, total: 0 })
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleDownload = async (file: WorkspaceFileRecord) => {
    if (!workspaceId || downloadingFileId === file.id) return

    setDownloadingFileId(file.id)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/files/${file.id}/download`, {
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error('Failed to get download URL')
      }

      const data = await response.json()

      if (!data.success || !data.downloadUrl) {
        throw new Error('Invalid download response')
      }

      const link = document.createElement('a')
      link.href = data.downloadUrl
      link.download = data.fileName || file.name
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch (error) {
      logger.error('Error downloading file:', error)
    } finally {
      setDownloadingFileId(null)
    }
  }

  const handleDelete = async (file: WorkspaceFileRecord) => {
    if (!workspaceId) return

    try {
      await deleteFile.mutateAsync({
        workspaceId,
        fileId: file.id,
        fileSize: file.size,
      })
    } catch (error) {
      logger.error('Error deleting file:', error)
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

  const formatStorageSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  const planName = storageInfo?.plan || 'free'
  const displayPlanName = PLAN_NAMES[planName as keyof typeof PLAN_NAMES] || 'Free'

  const renderTableSkeleton = () => (
    <Table className='table-fixed text-[13px]'>
      <TableHeader>
        <TableRow className='hover:bg-transparent'>
          <TableHead className='w-[56%] px-[12px] py-[8px] text-[12px] text-[var(--text-secondary)]'>
            <Skeleton className='h-[12px] w-[40px]' />
          </TableHead>
          <TableHead className='w-[14%] px-[12px] py-[8px] text-left text-[12px] text-[var(--text-secondary)]'>
            <Skeleton className='h-[12px] w-[28px]' />
          </TableHead>
          <TableHead className='w-[15%] px-[12px] py-[8px] text-left text-[12px] text-[var(--text-secondary)]'>
            <Skeleton className='h-[12px] w-[56px]' />
          </TableHead>
          <TableHead className='w-[15%] px-[12px] py-[8px] text-left text-[12px] text-[var(--text-secondary)]'>
            <Skeleton className='h-[12px] w-[48px]' />
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: 3 }, (_, i) => (
          <TableRow key={i} className='hover:bg-transparent'>
            <TableCell className='px-[12px] py-[8px]'>
              <div className='flex min-w-0 items-center gap-[8px]'>
                <Skeleton className='h-[14px] w-[14px] rounded-[2px]' />
                <Skeleton className='h-[14px] w-[180px]' />
              </div>
            </TableCell>
            <TableCell className='whitespace-nowrap px-[12px] py-[8px] text-[12px]'>
              <Skeleton className='h-[12px] w-[48px]' />
            </TableCell>
            <TableCell className='whitespace-nowrap px-[12px] py-[8px] text-[12px]'>
              <Skeleton className='h-[12px] w-[56px]' />
            </TableCell>
            <TableCell className='px-[12px] py-[8px]'>
              <div className='flex items-center gap-[4px]'>
                <Skeleton className='h-[28px] w-[28px] rounded-[4px]' />
                <Skeleton className='h-[28px] w-[28px] rounded-[4px]' />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )

  return (
    <div className='flex h-full flex-col gap-[2px]'>
      {/* Search Input and Upload Button */}
      <div className='flex items-center gap-[8px]'>
        <div
          className={cn(
            'flex flex-1 items-center gap-[8px] rounded-[8px] border border-[var(--border)] bg-transparent px-[8px] py-[5px] transition-colors duration-100 dark:bg-[var(--surface-4)] dark:hover:border-[var(--border-1)] dark:hover:bg-[var(--surface-5)]',
            permissionsLoading && 'opacity-50'
          )}
        >
          <Search
            className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-tertiary)]'
            strokeWidth={2}
          />
          <Input
            placeholder='Search files...'
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={permissionsLoading}
            className='h-auto flex-1 border-0 bg-transparent p-0 font-base leading-none placeholder:text-[var(--text-tertiary)] focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-100'
          />
        </div>
        {(permissionsLoading || userPermissions.canEdit) && (
          <>
            <input
              ref={fileInputRef}
              type='file'
              className='hidden'
              onChange={handleFileChange}
              disabled={uploading || permissionsLoading}
              accept={ACCEPT_ATTR}
              multiple
            />
            <Button
              onClick={handleUploadClick}
              disabled={uploading || permissionsLoading}
              variant='tertiary'
            >
              <Plus className='mr-[6px] h-[13px] w-[13px]' />
              {uploading && uploadProgress.total > 0
                ? `${uploadProgress.completed}/${uploadProgress.total}`
                : uploading
                  ? 'Uploading...'
                  : 'Upload'}
            </Button>
          </>
        )}
      </div>

      {/* Scrollable Content */}
      <div ref={scrollContainerRef} className='min-h-0 flex-1 overflow-y-auto'>
        {permissionsLoading ? (
          renderTableSkeleton()
        ) : files.length === 0 && failedFiles.length === 0 ? (
          <div className='flex h-full items-center justify-center text-[13px] text-[var(--text-muted)]'>
            No files uploaded yet
          </div>
        ) : filteredFiles.length === 0 && failedFiles.length === 0 ? (
          <div className='py-[16px] text-center text-[13px] text-[var(--text-muted)]'>
            No files found matching "{search}"
          </div>
        ) : (
          <Table className='table-fixed text-[13px]'>
            <TableHeader>
              <TableRow className='hover:bg-transparent'>
                <TableHead className='w-[56%] px-[12px] py-[8px] text-[12px] text-[var(--text-secondary)]'>
                  Name
                </TableHead>
                <TableHead className='w-[14%] px-[12px] py-[8px] text-left text-[12px] text-[var(--text-secondary)]'>
                  Size
                </TableHead>
                <TableHead className='w-[15%] px-[12px] py-[8px] text-left text-[12px] text-[var(--text-secondary)]'>
                  Uploaded
                </TableHead>
                <TableHead className='w-[15%] px-[12px] py-[8px] text-left text-[12px] text-[var(--text-secondary)]'>
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {failedFiles.map((fileName, index) => {
                const Icon = getDocumentIcon('', fileName)
                return (
                  <TableRow
                    key={`failed-${fileName}-${index}`}
                    className='hover:bg-[var(--surface-2)]'
                  >
                    <TableCell className='px-[12px] py-[8px]'>
                      <div className='flex min-w-0 items-center gap-[8px]'>
                        <Icon className='h-[14px] w-[14px] shrink-0 text-[var(--text-error)]' />
                        <span
                          className='min-w-0 truncate text-[14px] text-[var(--text-error)]'
                          title={fileName}
                        >
                          {truncateMiddle(fileName)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className='whitespace-nowrap px-[12px] py-[8px] text-[12px] text-[var(--text-error)]'>
                      —
                    </TableCell>
                    <TableCell className='whitespace-nowrap px-[12px] py-[8px] text-[12px] text-[var(--text-error)]'>
                      —
                    </TableCell>
                    <TableCell className='px-[12px] py-[8px]'>
                      <Button
                        variant='ghost'
                        onClick={() => setFailedFiles((prev) => prev.filter((_, i) => i !== index))}
                        className='h-[28px] w-[28px] p-0'
                        aria-label={`Dismiss ${fileName}`}
                      >
                        <X className='h-[14px] w-[14px]' />
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
              {filteredFiles.map((file) => {
                const Icon = getDocumentIcon(file.type || '', file.name)
                return (
                  <TableRow key={file.id} className='hover:bg-[var(--surface-2)]'>
                    <TableCell className='px-[12px] py-[8px]'>
                      <div className='flex min-w-0 items-center gap-[8px]'>
                        <Icon className='h-[14px] w-[14px] shrink-0 text-[var(--text-muted)]' />
                        <button
                          onClick={() => handleDownload(file)}
                          disabled={downloadingFileId === file.id}
                          className='min-w-0 truncate text-left font-normal text-[14px] text-[var(--text-primary)] hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-50'
                          title={file.name}
                        >
                          {truncateMiddle(file.name)}
                        </button>
                      </div>
                    </TableCell>
                    <TableCell className='whitespace-nowrap px-[12px] py-[8px] text-[12px] text-[var(--text-muted)]'>
                      {formatFileSize(file.size)}
                    </TableCell>
                    <TableCell className='whitespace-nowrap px-[12px] py-[8px] text-[12px] text-[var(--text-muted)]'>
                      {formatDate(file.uploadedAt)}
                    </TableCell>
                    <TableCell className='px-[12px] py-[8px]'>
                      <div className='flex items-center gap-[4px]'>
                        <Tooltip.Root>
                          <Tooltip.Trigger asChild>
                            <Button
                              variant='ghost'
                              onClick={() => handleDownload(file)}
                              className='h-[28px] w-[28px] p-0'
                              disabled={downloadingFileId === file.id}
                              aria-label={`Download ${file.name}`}
                            >
                              {downloadingFileId === file.id ? (
                                <Loader2 className='h-[14px] w-[14px] animate-spin' />
                              ) : (
                                <ArrowDown className='h-[14px] w-[14px]' />
                              )}
                            </Button>
                          </Tooltip.Trigger>
                          <Tooltip.Content>Download file</Tooltip.Content>
                        </Tooltip.Root>
                        {userPermissions.canEdit && (
                          <Tooltip.Root>
                            <Tooltip.Trigger asChild>
                              <Button
                                variant='ghost'
                                onClick={() => handleDelete(file)}
                                className='h-[28px] w-[28px] p-0'
                                disabled={deleteFile.isPending}
                                aria-label={`Delete ${file.name}`}
                              >
                                <Trash className='h-[14px] w-[14px]' />
                              </Button>
                            </Tooltip.Trigger>
                            <Tooltip.Content>Delete file</Tooltip.Content>
                          </Tooltip.Root>
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

      {/* Storage Info - Fixed at bottom */}
      {isBillingEnabled &&
        (permissionsLoading ? (
          <div className='mt-auto flex flex-col gap-[8px] pt-[10px]'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-[6px]'>
                <Skeleton className='h-[14px] w-[32px] rounded-[2px]' />
                <div className='h-[14px] w-[1.5px] bg-[var(--divider)]' />
                <div className='flex items-center gap-[4px]'>
                  <Skeleton className='h-[12px] w-[40px] rounded-[2px]' />
                  <span className='font-medium text-[12px] text-[var(--text-tertiary)]'>/</span>
                  <Skeleton className='h-[12px] w-[32px] rounded-[2px]' />
                </div>
              </div>
            </div>
            <div className='flex items-center gap-[3px]'>
              {Array.from({ length: 12 }).map((_, i) => (
                <Skeleton key={i} className='h-[6px] flex-1 rounded-[2px]' />
              ))}
            </div>
          </div>
        ) : (
          storageInfo && (
            <div className='mt-auto flex flex-col gap-[8px] pt-[10px]'>
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-[6px]'>
                  <span className='font-medium text-[12px] text-[var(--text-primary)]'>
                    {displayPlanName}
                  </span>
                  <div className='h-[14px] w-[1.5px] bg-[var(--divider)]' />
                  <div className='flex items-center gap-[4px]'>
                    <span className='font-medium text-[12px] text-[var(--text-tertiary)] tabular-nums'>
                      {formatStorageSize(storageInfo.usedBytes)}
                    </span>
                    <span className='font-medium text-[12px] text-[var(--text-tertiary)]'>/</span>
                    <span className='font-medium text-[12px] text-[var(--text-tertiary)] tabular-nums'>
                      {formatStorageSize(storageInfo.limitBytes)}
                    </span>
                  </div>
                </div>
              </div>
              <div className='flex items-center gap-[3px]'>
                {Array.from({ length: 12 }).map((_, i) => {
                  const filledCount = Math.ceil((Math.min(storageInfo.percentUsed, 100) / 100) * 12)
                  const isFilled = i < filledCount
                  return (
                    <div
                      key={i}
                      className={cn(
                        'h-[6px] flex-1 rounded-[2px]',
                        isFilled ? 'bg-[var(--brand-secondary)]' : 'bg-[var(--surface-5)]'
                      )}
                    />
                  )
                })}
              </div>
            </div>
          )
        ))}
    </div>
  )
}
