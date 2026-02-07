'use client'

import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { ArrowDown, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/emcn'
import { extractWorkspaceIdFromExecutionKey, getViewerUrl } from '@/lib/uploads/utils/file-utils'

const logger = createLogger('FileCards')

interface FileData {
  id?: string
  name: string
  size: number
  type: string
  key: string
  url: string
  uploadedAt: string
  expiresAt: string
  storageProvider?: 's3' | 'blob' | 'local'
  bucketName?: string
}

interface FileCardsProps {
  files: FileData[]
  isExecutionFile?: boolean
  workspaceId?: string
}

interface FileCardProps {
  file: FileData
  isExecutionFile?: boolean
  workspaceId?: string
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`
}

function FileCard({ file, isExecutionFile = false, workspaceId }: FileCardProps) {
  const [isDownloading, setIsDownloading] = useState(false)
  const router = useRouter()

  const handleDownload = () => {
    if (isDownloading) return

    setIsDownloading(true)

    try {
      logger.info(`Initiating download for file: ${file.name}`)

      if (file.key.startsWith('url/')) {
        if (file.url) {
          window.open(file.url, '_blank')
          logger.info(`Opened URL-type file directly: ${file.url}`)
          return
        }
        throw new Error('URL is required for URL-type files')
      }

      let resolvedWorkspaceId = workspaceId
      if (!resolvedWorkspaceId && isExecutionFile) {
        resolvedWorkspaceId = extractWorkspaceIdFromExecutionKey(file.key) || undefined
      } else if (!resolvedWorkspaceId) {
        const segments = file.key.split('/')
        if (segments.length >= 2 && /^[a-f0-9-]{36}$/.test(segments[0])) {
          resolvedWorkspaceId = segments[0]
        }
      }

      if (isExecutionFile) {
        const serveUrl = `/api/files/serve/${encodeURIComponent(file.key)}?context=execution`
        window.open(serveUrl, '_blank')
        logger.info(`Opened execution file serve URL: ${serveUrl}`)
      } else {
        const viewerUrl = resolvedWorkspaceId ? getViewerUrl(file.key, resolvedWorkspaceId) : null

        if (viewerUrl) {
          router.push(viewerUrl)
          logger.info(`Navigated to viewer URL: ${viewerUrl}`)
        } else {
          logger.warn(
            `Could not construct viewer URL for file: ${file.name}, falling back to serve URL`
          )
          const serveUrl = `/api/files/serve/${encodeURIComponent(file.key)}?context=workspace`
          window.open(serveUrl, '_blank')
        }
      }
    } catch (error) {
      logger.error(`Failed to download file ${file.name}:`, error)
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <div className='flex flex-col gap-[4px] rounded-[6px] bg-[var(--surface-1)] px-[8px] py-[6px]'>
      <div className='flex min-w-0 items-center justify-between gap-[8px]'>
        <span className='min-w-0 flex-1 truncate font-medium text-[12px] text-[var(--text-secondary)]'>
          {file.name}
        </span>
        <span className='flex-shrink-0 font-medium text-[12px] text-[var(--text-tertiary)]'>
          {formatFileSize(file.size)}
        </span>
      </div>

      <div className='flex items-center justify-between'>
        <span className='font-medium text-[11px] text-[var(--text-subtle)]'>{file.type}</span>
        <Button
          variant='ghost'
          className='!h-[20px] !px-[6px] !py-0 text-[11px]'
          onClick={handleDownload}
          disabled={isDownloading}
        >
          {isDownloading ? (
            <Loader2 className='mr-[4px] h-[10px] w-[10px] animate-spin' />
          ) : (
            <ArrowDown className='mr-[4px] h-[10px] w-[10px]' />
          )}
          {isDownloading ? 'Opening...' : 'Download'}
        </Button>
      </div>
    </div>
  )
}

export function FileCards({ files, isExecutionFile = false, workspaceId }: FileCardsProps) {
  if (!files || files.length === 0) {
    return null
  }

  return (
    <div className='mt-[4px] flex flex-col gap-[6px] rounded-[6px] border border-[var(--border)] bg-[var(--surface-2)] px-[10px] py-[8px] dark:bg-transparent'>
      <span className='font-medium text-[12px] text-[var(--text-tertiary)]'>
        Files ({files.length})
      </span>
      {files.map((file, index) => (
        <FileCard
          key={file.id || `file-${index}`}
          file={file}
          isExecutionFile={isExecutionFile}
          workspaceId={workspaceId}
        />
      ))}
    </div>
  )
}

export function FileDownload({
  file,
  isExecutionFile = false,
  className,
  workspaceId,
}: {
  file: FileData
  isExecutionFile?: boolean
  className?: string
  workspaceId?: string
}) {
  const [isDownloading, setIsDownloading] = useState(false)
  const router = useRouter()

  const handleDownload = () => {
    if (isDownloading) return

    setIsDownloading(true)

    try {
      logger.info(`Initiating download for file: ${file.name}`)

      if (file.key.startsWith('url/')) {
        if (file.url) {
          window.open(file.url, '_blank')
          logger.info(`Opened URL-type file directly: ${file.url}`)
          return
        }
        throw new Error('URL is required for URL-type files')
      }

      let resolvedWorkspaceId = workspaceId
      if (!resolvedWorkspaceId && isExecutionFile) {
        resolvedWorkspaceId = extractWorkspaceIdFromExecutionKey(file.key) || undefined
      } else if (!resolvedWorkspaceId) {
        const segments = file.key.split('/')
        if (segments.length >= 2 && /^[a-f0-9-]{36}$/.test(segments[0])) {
          resolvedWorkspaceId = segments[0]
        }
      }

      if (isExecutionFile) {
        const serveUrl = `/api/files/serve/${encodeURIComponent(file.key)}?context=execution`
        window.open(serveUrl, '_blank')
        logger.info(`Opened execution file serve URL: ${serveUrl}`)
      } else {
        const viewerUrl = resolvedWorkspaceId ? getViewerUrl(file.key, resolvedWorkspaceId) : null

        if (viewerUrl) {
          router.push(viewerUrl)
          logger.info(`Navigated to viewer URL: ${viewerUrl}`)
        } else {
          logger.warn(
            `Could not construct viewer URL for file: ${file.name}, falling back to serve URL`
          )
          const serveUrl = `/api/files/serve/${encodeURIComponent(file.key)}?context=workspace`
          window.open(serveUrl, '_blank')
        }
      }
    } catch (error) {
      logger.error(`Failed to download file ${file.name}:`, error)
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <Button
      variant='ghost'
      className={`h-7 px-2 text-xs ${className}`}
      onClick={handleDownload}
      disabled={isDownloading}
    >
      {isDownloading ? (
        <Loader2 className='h-3 w-3 animate-spin' />
      ) : (
        <ArrowDown className='h-[14px] w-[14px]' />
      )}
      {isDownloading ? 'Downloading...' : 'Download'}
    </Button>
  )
}

export default FileCards
