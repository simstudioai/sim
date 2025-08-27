import { memo, useState } from 'react'
import { FileText, Image } from 'lucide-react'
import type { MessageFileAttachment } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/user-input/user-input'

interface FileAttachmentDisplayProps {
  fileAttachments: MessageFileAttachment[]
}

export const FileAttachmentDisplay = memo(({ fileAttachments }: FileAttachmentDisplayProps) => {
  const [fileUrls, setFileUrls] = useState<Record<string, string>>({})

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${Math.round((bytes / k ** i) * 10) / 10} ${sizes[i]}`
  }

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

  const getFileUrl = (file: MessageFileAttachment) => {
    const cacheKey = file.key
    if (fileUrls[cacheKey]) {
      return fileUrls[cacheKey]
    }

    const url = `/api/files/serve/${encodeURIComponent(file.key)}?bucket=copilot`
    setFileUrls((prev) => ({ ...prev, [cacheKey]: url }))
    return url
  }

  const handleFileClick = (file: MessageFileAttachment) => {
    const serveUrl = getFileUrl(file)
    window.open(serveUrl, '_blank')
  }

  const isImageFile = (mediaType: string) => {
    return mediaType.startsWith('image/')
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
          {isImageFile(file.media_type) ? (
            // For images, show actual thumbnail
            <img
              src={getFileUrl(file)}
              alt={file.filename}
              className='h-full w-full object-cover'
              onError={(e) => {
                // If image fails to load, replace with icon
                const target = e.target as HTMLImageElement
                target.style.display = 'none'
                const parent = target.parentElement
                if (parent) {
                  const iconContainer = document.createElement('div')
                  iconContainer.className =
                    'flex items-center justify-center w-full h-full bg-background/50'
                  iconContainer.innerHTML =
                    '<svg class="h-5 w-5 text-muted-foreground" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>'
                  parent.appendChild(iconContainer)
                }
              }}
            />
          ) : (
            // For other files, show icon centered
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
