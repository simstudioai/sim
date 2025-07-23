'use client'

import { useState } from 'react'
import { AlertCircle, Download, File, FileText, Image, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/lib/logs/console-logger'
import type { ExecutionFileMetadata } from '@/lib/workflows/execution-files-types'

const logger = createLogger('ExecutionFilesDisplay')

interface ExecutionFilesDisplayProps {
  executionId: string
  files?: ExecutionFileMetadata[]
}

/**
 * Format file size for display
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
}

/**
 * Get appropriate icon for file type
 */
function getFileIcon(fileType: string) {
  if (fileType.startsWith('image/')) {
    return <Image className='h-4 w-4' />
  }
  if (fileType.includes('pdf') || fileType.includes('document') || fileType.includes('text')) {
    return <FileText className='h-4 w-4' />
  }
  return <File className='h-4 w-4' />
}

/**
 * Check if file is expired
 */
function isFileExpired(expiresAt: string): boolean {
  return new Date(expiresAt) < new Date()
}

/**
 * Individual file item component
 */
function FileItem({
  file,
  onDownload,
}: {
  file: ExecutionFileMetadata
  onDownload: (file: ExecutionFileMetadata) => void
}) {
  const [isDownloading, setIsDownloading] = useState(false)
  const expired = isFileExpired(file.expiresAt)

  const handleDownload = async () => {
    if (expired || isDownloading) return

    setIsDownloading(true)
    try {
      await onDownload(file)
    } finally {
      setIsDownloading(false)
    }
  }

  return (
    <div className='flex items-center justify-between rounded-md border bg-card p-3'>
      <div className='flex min-w-0 flex-1 items-center gap-3'>
        <div className='flex-shrink-0 text-muted-foreground'>{getFileIcon(file.fileType)}</div>

        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-2'>
            <p className='truncate font-medium text-sm' title={file.fileName}>
              {file.fileName}
            </p>
            {expired && (
              <Badge variant='destructive' className='text-xs'>
                Expired
              </Badge>
            )}
          </div>
          <div className='flex items-center gap-2 text-muted-foreground text-xs'>
            <span>{formatFileSize(file.fileSize)}</span>
            <span>•</span>
            <span>{file.fileType}</span>
          </div>
        </div>
      </div>

      <div className='flex-shrink-0'>
        {expired ? (
          <div className='flex items-center gap-1 text-muted-foreground text-xs'>
            <AlertCircle className='h-3 w-3' />
            <span>Expired</span>
          </div>
        ) : (
          <Button
            variant='ghost'
            size='sm'
            onClick={handleDownload}
            disabled={isDownloading}
            className='h-8 w-8 p-0'
            title={`Download ${file.fileName}`}
          >
            {isDownloading ? (
              <Loader2 className='h-4 w-4 animate-spin' />
            ) : (
              <Download className='h-4 w-4' />
            )}
          </Button>
        )}
      </div>
    </div>
  )
}

/**
 * Main execution files display component
 */
export function ExecutionFilesDisplay({ executionId, files = [] }: ExecutionFilesDisplayProps) {
  const handleDownload = async (file: ExecutionFileMetadata) => {
    try {
      logger.info(`Requesting NEW presigned URL for file: ${file.fileName}`)

      // Get download URL from our secure endpoint using combined execution and file ID
      const downloadId = `${executionId}_${file.id}`
      // Add cache-busting parameter to ensure fresh presigned URL generation
      const response = await fetch(`/api/files/download/${downloadId}?t=${Date.now()}`)

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('File not found or has been deleted')
        }
        if (response.status === 410) {
          throw new Error('File has expired')
        }
        throw new Error(`Failed to get download URL: ${response.statusText}`)
      }

      const downloadData = await response.json()

      // Debug logging to verify we're getting a fresh URL
      logger.info(`Received download URL from API:`, {
        url: downloadData.downloadUrl,
        fileName: downloadData.fileName,
        expiresIn: downloadData.expiresIn,
        isS3Url: downloadData.downloadUrl.includes('s3'),
        hasShortExpiry:
          downloadData.downloadUrl.includes('Expires=300') || downloadData.expiresIn === 300,
      })

      // Create a temporary link and trigger download
      const link = document.createElement('a')
      link.href = downloadData.downloadUrl
      link.download = downloadData.fileName
      link.target = '_blank'

      // Append to body, click, and remove
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      logger.info(`Successfully initiated download with fresh presigned URL for: ${file.fileName}`)
    } catch (error) {
      logger.error(`Failed to download file ${file.fileName}:`, error)

      // Show user-friendly error message
      const errorMessage = error instanceof Error ? error.message : 'Failed to download file'

      // You could replace this with a toast notification system
      alert(`Download failed: ${errorMessage}`)
    }
  }

  if (files.length === 0) {
    return null
  }

  const expiredCount = files.filter((f) => isFileExpired(f.expiresAt)).length
  const activeCount = files.length - expiredCount

  return (
    <div className='w-full'>
      <div className='mb-2 flex items-center justify-between'>
        <h3 className='font-medium text-muted-foreground text-xs'>
          Execution Files ({files.length})
        </h3>
        {expiredCount > 0 && (
          <Badge variant='outline' className='text-xs'>
            {expiredCount} expired
          </Badge>
        )}
      </div>

      <div className='space-y-2'>
        {files.map((file) => (
          <FileItem key={file.id} file={file} onDownload={handleDownload} />
        ))}
      </div>

      {activeCount > 0 && (
        <p className='mt-2 text-muted-foreground text-xs'>
          Click the download button to get a secure 5-minute download link
        </p>
      )}
    </div>
  )
}
