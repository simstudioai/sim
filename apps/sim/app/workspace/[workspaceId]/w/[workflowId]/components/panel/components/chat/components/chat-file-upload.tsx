'use client'

import { useRef, useState } from 'react'
import { Paperclip, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('ChatFileUpload')

interface FileWithPreview {
  file: File
  preview?: string
}

interface ChatFileUploadProps {
  onFilesChange: (files: FileWithPreview[]) => void
  files: FileWithPreview[]
  disabled?: boolean
  maxFiles?: number
  maxSizeInMB?: number
}

export function ChatFileUpload({
  onFilesChange,
  files,
  disabled = false,
  maxFiles = 5,
  maxSizeInMB = 10,
}: ChatFileUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)

  const handleFileSelect = (selectedFiles: FileList | null) => {
    if (!selectedFiles || selectedFiles.length === 0) return

    const newFiles: FileWithPreview[] = []
    const maxSizeInBytes = maxSizeInMB * 1024 * 1024

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i]

      // Check file size
      if (file.size > maxSizeInBytes) {
        logger.error(
          `File ${file.name} is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Maximum size is ${maxSizeInMB}MB.`
        )
        continue
      }

      // Check total file count
      if (files.length + newFiles.length >= maxFiles) {
        logger.error(`Maximum ${maxFiles} files allowed`)
        break
      }

      // Create preview for images
      let preview: string | undefined
      if (file.type.startsWith('image/')) {
        preview = URL.createObjectURL(file)
      }

      newFiles.push({ file, preview })
    }

    if (newFiles.length > 0) {
      onFilesChange([...files, ...newFiles])
    }
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileSelect(e.target.files)
    // Reset input value to allow selecting the same file again
    e.target.value = ''
  }

  const handleRemoveFile = (index: number) => {
    const newFiles = [...files]
    const removedFile = newFiles.splice(index, 1)[0]

    // Revoke object URL to prevent memory leaks
    if (removedFile.preview) {
      URL.revokeObjectURL(removedFile.preview)
    }

    onFilesChange(newFiles)
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    if (disabled) return

    const droppedFiles = e.dataTransfer.files
    handleFileSelect(droppedFiles)
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`
  }

  return (
    <div className='space-y-2'>
      {/* File Upload Button */}
      <div className='flex items-center gap-2'>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || files.length >= maxFiles}
          className='h-8 w-8 p-0 text-muted-foreground hover:text-foreground'
        >
          <Paperclip className='h-4 w-4' />
        </Button>

        <input
          ref={fileInputRef}
          type='file'
          multiple
          onChange={handleFileInputChange}
          className='hidden'
          accept='*/*'
        />

        {files.length > 0 && (
          <span className='text-muted-foreground text-xs'>
            {files.length}/{maxFiles} files
          </span>
        )}
      </div>

      {/* File List */}
      {files.length > 0 && (
        <div className='space-y-1'>
          {files.map((fileWithPreview, index) => (
            <div key={index} className='flex items-center gap-2 rounded-md bg-muted/50 p-2 text-sm'>
              {/* File Preview/Icon */}
              {fileWithPreview.preview ? (
                <img
                  src={fileWithPreview.preview}
                  alt={fileWithPreview.file.name}
                  className='h-8 w-8 rounded object-cover'
                />
              ) : (
                <div className='flex h-8 w-8 items-center justify-center rounded bg-muted'>
                  <Paperclip className='h-4 w-4 text-muted-foreground' />
                </div>
              )}

              {/* File Info */}
              <div className='min-w-0 flex-1'>
                <div className='truncate font-medium'>{fileWithPreview.file.name}</div>
                <div className='text-muted-foreground text-xs'>
                  {formatFileSize(fileWithPreview.file.size)}
                </div>
              </div>

              {/* Remove Button */}
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onClick={() => handleRemoveFile(index)}
                className='h-6 w-6 p-0 text-muted-foreground hover:text-destructive'
              >
                <X className='h-3 w-3' />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Drag and Drop Overlay */}
      {dragActive && (
        <div
          className='fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm'
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <div className='rounded-lg border-2 border-primary border-dashed bg-background p-8 text-center'>
            <Paperclip className='mx-auto h-12 w-12 text-primary' />
            <p className='mt-2 font-medium text-lg'>Drop files here</p>
            <p className='text-muted-foreground text-sm'>
              Maximum {maxFiles} files, {maxSizeInMB}MB each
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
