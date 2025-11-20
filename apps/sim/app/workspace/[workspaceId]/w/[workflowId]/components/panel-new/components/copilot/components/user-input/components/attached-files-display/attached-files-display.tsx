'use client'

import { FileText, Image, Loader2, X } from 'lucide-react'
import { Button } from '@/components/emcn'

interface AttachedFile {
  id: string
  name: string
  size: number
  type: string
  path: string
  key?: string
  uploading: boolean
  previewUrl?: string
}

interface AttachedFilesDisplayProps {
  /** Array of attached files to display */
  files: AttachedFile[]
  /** Callback when a file is clicked to open/preview */
  onFileClick: (file: AttachedFile) => void
  /** Callback when a file is removed */
  onFileRemove: (fileId: string) => void
  /** Format file size helper from hook */
  formatFileSize: (bytes: number) => string
  /** Get file icon type helper from hook */
  getFileIconType: (mediaType: string) => 'image' | 'pdf' | 'text' | 'default'
}

/**
 * Returns icon component for file type
 *
 * @param iconType - The file icon type
 * @returns React icon component
 */
function getFileIconComponent(iconType: 'image' | 'pdf' | 'text' | 'default') {
  switch (iconType) {
    case 'image':
      return <Image className='h-5 w-5 text-muted-foreground' />
    case 'pdf':
      return <FileText className='h-5 w-5 text-red-500' />
    case 'text':
      return <FileText className='h-5 w-5 text-blue-500' />
    default:
      return <FileText className='h-5 w-5 text-muted-foreground' />
  }
}

/**
 * Displays attached files with thumbnails, loading states, and remove buttons.
 * Shows image previews for image files and icons for other file types.
 *
 * @param props - Component props
 * @returns Rendered file attachments or null if no files
 */
export function AttachedFilesDisplay({
  files,
  onFileClick,
  onFileRemove,
  formatFileSize,
  getFileIconType,
}: AttachedFilesDisplayProps) {
  if (files.length === 0) {
    return null
  }

  const isImageFile = (type: string) => type.startsWith('image/')

  return (
    <div className='mb-2 flex gap-1.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
      {files.map((file) => (
        <div
          key={file.id}
          className='group relative h-16 w-16 flex-shrink-0 cursor-pointer overflow-hidden rounded-md border border-border/50 bg-muted/20 transition-all hover:bg-muted/40'
          title={`${file.name} (${formatFileSize(file.size)})`}
          onClick={() => onFileClick(file)}
        >
          {isImageFile(file.type) && file.previewUrl ? (
            /* For images, show actual thumbnail */
            <img src={file.previewUrl} alt={file.name} className='h-full w-full object-cover' />
          ) : isImageFile(file.type) && file.key ? (
            /* For uploaded images without preview URL, use storage URL */
            <img
              src={file.previewUrl || file.path}
              alt={file.name}
              className='h-full w-full object-cover'
            />
          ) : (
            /* For other files, show icon centered */
            <div className='flex h-full w-full items-center justify-center bg-background/50'>
              {getFileIconComponent(getFileIconType(file.type))}
            </div>
          )}

          {/* Loading overlay */}
          {file.uploading && (
            <div className='absolute inset-0 flex items-center justify-center bg-black/50'>
              <Loader2 className='h-4 w-4 animate-spin text-white' />
            </div>
          )}

          {/* Remove button */}
          {!file.uploading && (
            <Button
              variant='ghost'
              onClick={(e) => {
                e.stopPropagation()
                onFileRemove(file.id)
              }}
              className='absolute top-0.5 right-0.5 h-5 w-5 p-0 opacity-0 transition-opacity group-hover:opacity-100'
            >
              <X className='h-3 w-3' />
            </Button>
          )}

          {/* Hover overlay effect */}
          <div className='pointer-events-none absolute inset-0 bg-black/10 opacity-0 transition-opacity group-hover:opacity-100' />
        </div>
      ))}
    </div>
  )
}
