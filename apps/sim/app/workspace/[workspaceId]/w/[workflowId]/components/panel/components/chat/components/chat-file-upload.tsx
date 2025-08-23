'use client'

import { useRef, useState } from 'react'
import { File, FileText, Image, Paperclip, X } from 'lucide-react'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('ChatFileUpload')

interface ChatFile {
  id: string
  name: string
  size: number
  type: string
  file: File
}

interface ChatFileUploadProps {
  files: ChatFile[]
  onFilesChange: (files: ChatFile[]) => void
  maxFiles?: number
  maxSize?: number // in MB
  acceptedTypes?: string[]
  disabled?: boolean
  onError?: (errors: string[]) => void
}

export function ChatFileUpload({
  files,
  onFilesChange,
  maxFiles = 5,
  maxSize = 10,
  acceptedTypes = ['*'],
  disabled = false,
  onError,
}: ChatFileUploadProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = (selectedFiles: FileList | null) => {
    if (!selectedFiles || disabled) return

    const newFiles: ChatFile[] = []
    const errors: string[] = []

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i]

      // Check file count limit
      if (files.length + newFiles.length >= maxFiles) {
        errors.push(`Maximum ${maxFiles} files allowed`)
        break
      }

      // Check file size
      if (file.size > maxSize * 1024 * 1024) {
        errors.push(`${file.name} is too large (max ${maxSize}MB)`)
        continue
      }

      // Check file type if specified
      if (acceptedTypes.length > 0 && !acceptedTypes.includes('*')) {
        const isAccepted = acceptedTypes.some((type) => {
          if (type.endsWith('/*')) {
            return file.type.startsWith(type.slice(0, -1))
          }
          return file.type === type
        })

        if (!isAccepted) {
          errors.push(`${file.name} type not supported`)
          continue
        }
      }

      // Check for duplicates
      const isDuplicate = files.some(
        (existingFile) => existingFile.name === file.name && existingFile.size === file.size
      )

      if (isDuplicate) {
        errors.push(`${file.name} already added`)
        continue
      }

      newFiles.push({
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        type: file.type,
        file,
      })
    }

    if (errors.length > 0) {
      logger.warn('File upload errors:', errors)
      onError?.(errors)
    }

    if (newFiles.length > 0) {
      onFilesChange([...files, ...newFiles])
    }
  }

  const handleRemoveFile = (fileId: string) => {
    onFilesChange(files.filter((f) => f.id !== fileId))
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!disabled) {
      setIsDragOver(true)
      e.dataTransfer.dropEffect = 'copy'
    }
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!disabled) {
      setIsDragOver(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
    if (!disabled) {
      handleFileSelect(e.dataTransfer.files)
    }
  }

  const getFileIcon = (type: string) => {
    if (type.startsWith('image/')) return <Image className='h-4 w-4' />
    if (type.includes('text') || type.includes('json')) return <FileText className='h-4 w-4' />
    return <File className='h-4 w-4' />
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i]}`
  }

  return (
    <div className='space-y-2'>
      {/* File Upload Button */}
      <div className='flex items-center gap-2'>
        <button
          type='button'
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || files.length >= maxFiles}
          className='flex items-center gap-1 rounded-md px-2 py-1 text-gray-600 text-sm transition-colors hover:bg-gray-100 hover:text-gray-800 disabled:cursor-not-allowed disabled:opacity-50'
          title={files.length >= maxFiles ? `Maximum ${maxFiles} files` : 'Attach files'}
        >
          <Paperclip className='h-4 w-4' />
          <span className='hidden sm:inline'>Attach</span>
        </button>

        <input
          ref={fileInputRef}
          type='file'
          multiple
          onChange={(e) => {
            handleFileSelect(e.target.files)
            if (fileInputRef.current) {
              fileInputRef.current.value = ''
            }
          }}
          className='hidden'
          accept={acceptedTypes.join(',')}
          disabled={disabled}
        />

        {files.length > 0 && (
          <span className='text-gray-500 text-xs'>
            {files.length}/{maxFiles} files
          </span>
        )}
      </div>

      {/* File List */}
      {files.length > 0 && (
        <div className='space-y-1'>
          {files.map((file) => (
            <div
              key={file.id}
              className='flex items-center gap-2 rounded-md bg-gray-50 px-2 py-1 text-sm dark:bg-gray-800'
            >
              {getFileIcon(file.type)}
              <span className='flex-1 truncate dark:text-white' title={file.name}>
                {file.name}
              </span>
              <span className='text-gray-500 text-xs dark:text-gray-400'>
                {formatFileSize(file.size)}
              </span>
              <button
                type='button'
                onClick={() => handleRemoveFile(file.id)}
                className='p-0.5 text-gray-400 transition-colors hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400'
                title='Remove file'
              >
                <X className='h-3 w-3' />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Drag and Drop Area (when dragging) */}
      {isDragOver && (
        <div
          className='fixed inset-0 z-50 flex items-center justify-center border-2 border-blue-500 border-dashed bg-blue-500/10'
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <div className='rounded-lg bg-white p-4 shadow-lg'>
            <p className='font-medium text-blue-600'>Drop files here to attach</p>
          </div>
        </div>
      )}
    </div>
  )
}
