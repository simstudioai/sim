'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, Search } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button, Tooltip, Trash } from '@/components/emcn'
import { Input, Progress, Skeleton } from '@/components/ui'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getEnv, isTruthy } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { getFileExtension } from '@/lib/uploads/utils/file-utils'
import { cn } from '@/lib/utils'
import { getDocumentIcon } from '@/app/workspace/[workspaceId]/knowledge/components'
import { useUserPermissions } from '@/hooks/use-user-permissions'
import { useWorkspacePermissions } from '@/hooks/use-workspace-permissions'

const logger = createLogger('FileUploadsSettings')
const isBillingEnabled = isTruthy(getEnv('NEXT_PUBLIC_BILLING_ENABLED'))

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
] as const
const ACCEPT_ATTR =
  '.pdf,.csv,.doc,.docx,.txt,.md,.xlsx,.xls,.html,.htm,.pptx,.ppt,.json,.yaml,.yml'

interface StorageInfo {
  usedBytes: number
  limitBytes: number
  percentUsed: number
}

export function Files() {
  const params = useParams()
  const workspaceId = params?.workspaceId as string
  const [files, setFiles] = useState<WorkspaceFileRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState({ completed: 0, total: 0 })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null)
  const [planName, setPlanName] = useState<string>('free')
  const [storageLoading, setStorageLoading] = useState(true)

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

  const loadStorageInfo = async () => {
    if (!isBillingEnabled) {
      setStorageLoading(false)
      return
    }

    try {
      setStorageLoading(true)
      const response = await fetch('/api/users/me/usage-limits')
      const data = await response.json()

      if (data.success && data.storage) {
        setStorageInfo(data.storage)
        if (data.usage?.plan) {
          setPlanName(data.usage.plan)
        }
      }
    } catch (error) {
      logger.error('Error loading storage info:', error)
    } finally {
      setStorageLoading(false)
    }
  }

  useEffect(() => {
    void loadFiles()
    void loadStorageInfo()
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

      setUploadProgress({ completed: 0, total: allowedFiles.length })
      let lastError: string | null = null

      for (let i = 0; i < allowedFiles.length; i++) {
        const selectedFile = allowedFiles[i]
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
          } else {
            setUploadProgress({ completed: i + 1, total: allowedFiles.length })
          }
        } catch (err) {
          logger.error('Error uploading file:', err)
          lastError = 'Upload failed'
        }
      }

      await loadFiles()
      if (isBillingEnabled) {
        await loadStorageInfo()
      }
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
      setUploadProgress({ completed: 0, total: 0 })
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleDownload = async (file: WorkspaceFileRecord) => {
    if (!workspaceId) return

    window.open(`/workspace/${workspaceId}/files/${file.id}/view`, '_blank')
  }

  const handleDelete = async (file: WorkspaceFileRecord) => {
    if (!workspaceId) return

    try {
      setDeletingFileId(file.id)

      const previousFiles = files
      const previousStorageInfo = storageInfo

      setFiles((prev) => prev.filter((f) => f.id !== file.id))

      if (isBillingEnabled && storageInfo) {
        const newUsedBytes = Math.max(0, storageInfo.usedBytes - file.size)
        const newPercentUsed = (newUsedBytes / storageInfo.limitBytes) * 100
        setStorageInfo({
          ...storageInfo,
          usedBytes: newUsedBytes,
          percentUsed: newPercentUsed,
        })
      }

      const response = await fetch(`/api/workspaces/${workspaceId}/files/${file.id}`, {
        method: 'DELETE',
      })

      const data = await response.json()

      if (!data.success) {
        setFiles(previousFiles)
        setStorageInfo(previousStorageInfo)
        logger.error('Failed to delete file:', data.error)
      }
    } catch (error) {
      logger.error('Error deleting file:', error)
      await loadFiles()
      if (isBillingEnabled) {
        await loadStorageInfo()
      }
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

  const formatStorageSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }

  const PLAN_NAMES = {
    enterprise: 'Enterprise',
    team: 'Team',
    pro: 'Pro',
    free: 'Free',
  } as const

  const displayPlanName = PLAN_NAMES[planName as keyof typeof PLAN_NAMES] || 'Free'

  const GRADIENT_TEXT_STYLES =
    'gradient-text bg-gradient-to-b from-gradient-primary via-gradient-secondary to-gradient-primary'

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
          {isBillingEnabled && (
            <>
              {storageLoading ? (
                <Skeleton className='h-4 w-32' />
              ) : storageInfo ? (
                <div className='flex flex-col items-end gap-1'>
                  <div className='flex items-center gap-2 text-sm'>
                    <span
                      className={cn(
                        'font-medium',
                        planName === 'free' ? 'text-foreground' : GRADIENT_TEXT_STYLES
                      )}
                    >
                      {displayPlanName}
                    </span>
                    <span className='text-muted-foreground tabular-nums'>
                      {formatStorageSize(storageInfo.usedBytes)} /{' '}
                      {formatStorageSize(storageInfo.limitBytes)}
                    </span>
                  </div>
                  <Progress
                    value={Math.min(storageInfo.percentUsed, 100)}
                    className='h-1 w-full'
                    indicatorClassName='bg-black dark:bg-white'
                  />
                </div>
              ) : null}
            </>
          )}
          {userPermissions.canEdit && (
            <div className='flex items-center'>
              <input
                ref={fileInputRef}
                type='file'
                className='hidden'
                onChange={handleFileChange}
                disabled={uploading}
                accept={ACCEPT_ATTR}
                multiple
              />
              <Button
                onClick={handleUploadClick}
                disabled={uploading}
                variant='ghost'
                className='h-9 rounded-[8px] border bg-background px-3 shadow-xs hover:bg-muted focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
              >
                {uploading && uploadProgress.total > 0
                  ? `Uploading ${uploadProgress.completed}/${uploadProgress.total}...`
                  : uploading
                    ? 'Uploading...'
                    : 'Upload File'}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Error message */}
      {uploadError && (
        <div className='px-6 pb-2'>
          <div className='text-[#DC2626] text-[12px] leading-tight dark:text-[#F87171]'>
            {uploadError}
          </div>
        </div>
      )}

      {/* Files Table */}
      <div className='min-h-0 flex-1 overflow-y-auto px-6'>
        {loading ? (
          <div className='py-8 text-center text-muted-foreground text-sm'>Loading files...</div>
        ) : files.length === 0 ? (
          <div className='py-8 text-center text-muted-foreground text-sm'>
            No files uploaded yet
          </div>
        ) : (
          <Table className='table-auto text-[13px]'>
            <TableHeader>
              <TableRow className='hover:bg-transparent'>
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
                        <button
                          onClick={() => handleDownload(file)}
                          className='min-w-0 truncate text-left font-normal hover:underline'
                          title={file.name}
                        >
                          {truncateMiddle(file.name)}
                        </button>
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
                        <Tooltip.Root>
                          <Tooltip.Trigger asChild>
                            <Button
                              variant='ghost'
                              onClick={() => handleDownload(file)}
                              className='h-6 w-6 p-0'
                              aria-label={`Download ${file.name}`}
                            >
                              <ArrowDown className='h-[14px] w-[14px]' />
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
                                className='h-6 w-6 p-0'
                                disabled={deletingFileId === file.id}
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
    </div>
  )
}
