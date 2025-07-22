'use client'

import { useRef, useState } from 'react'
import { Paperclip, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { createLogger } from '@/lib/logs/console-logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('ChatFileUpload')

interface UploadedFile {
  path: string
  key: string
  name: string
  size: number
  type: string
}

interface ChatFileUploadProps {
  onFilesChange: (files: UploadedFile[]) => void
  disabled?: boolean
  maxFiles?: number
  maxSize?: number // in MB
}

export function ChatFileUpload({
  onFilesChange,
  disabled = false,
  maxFiles = 5,
  maxSize = 50,
}: ChatFileUploadProps) {
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([])
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { activeWorkflowId } = useWorkflowRegistry()

  const handleFileSelect = () => {
    if (disabled || isUploading) return
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    // Check file count limit
    if (uploadedFiles.length + files.length > maxFiles) {
      logger.error(`Cannot upload more than ${maxFiles} files`)
      return
    }

    setIsUploading(true)

    try {
      const newFiles: UploadedFile[] = []
      const maxSizeBytes = maxSize * 1024 * 1024

      for (const file of Array.from(files)) {
        // Validate file size
        if (file.size > maxSizeBytes) {
          logger.error(`File ${file.name} exceeds ${maxSize}MB limit`)
          continue
        }

        // Generate execution context for this upload
        // For chat uploads, we create a temporary execution context that will be used during workflow execution
        const executionId = `chat-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`

        // Get workspace ID from URL params
        const pathParts = window.location.pathname.split('/')
        const workspaceId = pathParts[2] // Get actual workspace UUID from URL
        const workflowId = activeWorkflowId || pathParts[4] // Get from activeWorkflowId or URL

        try {
          // Get presigned URL for workflow-execution upload
          const params = new URLSearchParams({
            type: 'workflow-execution',
            workspaceId,
            workflowId,
            executionId,
          })

          const presignedResponse = await fetch(`/api/files/presigned?${params}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              fileName: file.name,
              contentType: file.type,
              fileSize: file.size,
            }),
          })

          if (!presignedResponse.ok) {
            throw new Error(`Failed to get presigned URL: ${presignedResponse.statusText}`)
          }

          const presignedData = await presignedResponse.json()

          // Upload file using presigned URL
          const uploadHeaders: Record<string, string> = {
            'Content-Type': file.type,
          }

          // Add provider-specific headers
          if (presignedData.uploadHeaders) {
            Object.assign(uploadHeaders, presignedData.uploadHeaders)
          }

          const uploadResponse = await fetch(presignedData.presignedUrl, {
            method: 'PUT',
            headers: uploadHeaders,
            body: file,
          })

          if (!uploadResponse.ok) {
            throw new Error(`Upload failed: ${uploadResponse.statusText}`)
          }

          // Add to uploaded files
          newFiles.push(presignedData.fileInfo)
          logger.info(`Successfully uploaded ${file.name}`)
        } catch (error) {
          logger.error(`Failed to upload ${file.name}:`, error)
        }
      }

      // Update state with new files
      const updatedFiles = [...uploadedFiles, ...newFiles]
      setUploadedFiles(updatedFiles)
      onFilesChange(updatedFiles)
    } catch (error) {
      logger.error('Error during file upload:', error)
    } finally {
      setIsUploading(false)
      // Clear the input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const removeFile = (index: number) => {
    const updatedFiles = uploadedFiles.filter((_, i) => i !== index)
    setUploadedFiles(updatedFiles)
    onFilesChange(updatedFiles)
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Number.parseFloat((bytes / k ** i).toFixed(1)) + ' ' + sizes[i]
  }

  return (
    <div className='space-y-2'>
      {/* File Upload Button */}
      <div className='flex items-center gap-2'>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={handleFileSelect}
          disabled={disabled || isUploading || uploadedFiles.length >= maxFiles}
          className='h-8 px-2'
        >
          <Paperclip className='h-4 w-4' />
          {isUploading ? 'Uploading...' : 'Attach Files'}
        </Button>

        {uploadedFiles.length > 0 && (
          <span className='text-xs text-muted-foreground'>
            {uploadedFiles.length}/{maxFiles} files
          </span>
        )}
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type='file'
        multiple
        className='hidden'
        onChange={handleFileChange}
        accept='*/*'
      />

      {/* Uploaded files list */}
      {uploadedFiles.length > 0 && (
        <div className='space-y-1'>
          {uploadedFiles.map((file, index) => (
            <div
              key={index}
              className='flex items-center justify-between rounded-md bg-muted/50 px-2 py-1 text-xs'
            >
              <div className='flex items-center gap-2 min-w-0'>
                <span className='truncate font-medium'>{file.name}</span>
                <span className='text-muted-foreground'>{formatFileSize(file.size)}</span>
              </div>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onClick={() => removeFile(index)}
                className='h-6 w-6 p-0 hover:bg-destructive/10'
              >
                <X className='h-3 w-3' />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
