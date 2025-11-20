import { memo, useState } from 'react'
import { FileText, Image } from 'lucide-react'
import type { MessageFileAttachment } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/copilot/components/user-input/hooks/use-file-attachments'

/**
 * File size units for formatting
 */
const FILE_SIZE_UNITS = ['B', 'KB', 'MB', 'GB'] as const

/**
 * Kilobyte multiplier
 */
const KILOBYTE = 1024

/**
 * Props for the FileAttachmentDisplay component
 */
interface FileAttachmentDisplayProps {
  /** Array of file attachments to display */
  fileAttachments: MessageFileAttachment[]
}

/**
 * FileAttachmentDisplay shows thumbnails or icons for attached files
 * Displays image previews or appropriate icons based on file type
 *
 * @param props - Component props
 * @returns Grid of file attachment thumbnails
 */
export const FileAttachmentDisplay = memo(({ fileAttachments }: FileAttachmentDisplayProps) => {
  const [fileUrls, setFileUrls] = useState<Record<string, string>>({})
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set())

  /**
   * Formats file size in bytes to human-readable format
   * @param bytes - File size in bytes
   * @returns Formatted string (e.g., "2.5 MB")
   */
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const i = Math.floor(Math.log(bytes) / Math.log(KILOBYTE))
    return `${Math.round((bytes / KILOBYTE ** i) * 10) / 10} ${FILE_SIZE_UNITS[i]}`
  }

  /**
   * Returns appropriate icon based on file media type
   * @param mediaType - MIME type of the file
   * @returns Icon component
   */
  const getFileIcon = (mediaType: string) => {
    if (mediaType.startsWith('image/')) {
      return <Image className='h-5 w-5 text-muted-foreground' />
    }
    if (mediaType.includes('pdf')) {
      return <FileText className='h-5 w-5 text-red-500' />
    }
    if (mediaType.includes('text') || mediaType.includes('json') || mediaType.includes('xml')) {
      return <FileText className='h-5 w-5 text-blue-500' />
    }
    return <FileText className='h-5 w-5 text-muted-foreground' />
  }

  /**
   * Gets or generates the file URL from cache
   * @param file - File attachment object
   * @returns URL to serve the file
   */
  const getFileUrl = (file: MessageFileAttachment) => {
    const cacheKey = file.key
    if (fileUrls[cacheKey]) {
      return fileUrls[cacheKey]
    }

    const url = `/api/files/serve/${encodeURIComponent(file.key)}?context=copilot`
    setFileUrls((prev) => ({ ...prev, [cacheKey]: url }))
    return url
  }

  /**
   * Handles click on a file attachment - opens in new tab
   * @param file - File attachment object
   */
  const handleFileClick = (file: MessageFileAttachment) => {
    const serveUrl = getFileUrl(file)
    window.open(serveUrl, '_blank')
  }

  /**
   * Checks if a file is an image based on media type
   * @param mediaType - MIME type of the file
   * @returns True if file is an image
   */
  const isImageFile = (mediaType: string) => {
    return mediaType.startsWith('image/')
  }

  /**
   * Handles image loading errors
   * @param fileId - ID of the file that failed to load
   */
  const handleImageError = (fileId: string) => {
    setFailedImages((prev) => new Set(prev).add(fileId))
  }

  return (
    <>
      {fileAttachments.map((file) => (
        <div
          key={file.id}
          className='group relative h-16 w-16 cursor-pointer overflow-hidden rounded-md border border-border/50 bg-muted/20 transition-all hover:bg-muted/40'
          onClick={() => handleFileClick(file)}
          title={`${file.filename} (${formatFileSize(file.size)})`}
        >
          {isImageFile(file.media_type) && !failedImages.has(file.id) ? (
            <img
              src={getFileUrl(file)}
              alt={file.filename}
              className='h-full w-full object-cover'
              onError={() => handleImageError(file.id)}
            />
          ) : (
            <div className='flex h-full w-full items-center justify-center bg-background/50'>
              {getFileIcon(file.media_type)}
            </div>
          )}

          {/* Hover overlay effect */}
          <div className='pointer-events-none absolute inset-0 bg-black/10 opacity-0 transition-opacity group-hover:opacity-100' />
        </div>
      ))}
    </>
  )
})

FileAttachmentDisplay.displayName = 'FileAttachmentDisplay'
