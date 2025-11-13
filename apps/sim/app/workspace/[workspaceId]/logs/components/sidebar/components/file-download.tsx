'use client'

import { useState } from 'react'
import { ArrowDown, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/emcn'
import { createLogger } from '@/lib/logs/console/logger'
import { extractWorkspaceIdFromExecutionKey, getViewerUrl } from '@/lib/uploads/utils/file-utils'

const logger = createLogger('FileDownload')

interface FileDownloadProps {
  file: {
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
  isExecutionFile?: boolean // Flag to indicate this is an execution file
  className?: string
  workspaceId?: string // Optional workspace ID (can be extracted from file key if not provided)
}

export function FileDownload({
  file,
  isExecutionFile = false,
  className,
  workspaceId,
}: FileDownloadProps) {
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
        const serveUrl =
          file.url || `/api/files/serve/${encodeURIComponent(file.key)}?context=execution`
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
          const serveUrl =
            file.url || `/api/files/serve/${encodeURIComponent(file.key)}?context=workspace`
          window.open(serveUrl, '_blank')
        }
      }
    } catch (error) {
      logger.error(`Failed to download file ${file.name}:`, error)
      if (file.url) {
        window.open(file.url, '_blank')
      }
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
