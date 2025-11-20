'use client'

import { useRef, useState } from 'react'
import { Image, Loader2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'

const logger = createLogger('ImageSelector')

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp']

interface ImageSelectorProps {
  value?: string | null
  onChange: (imageUrl: string | null) => void
  disabled?: boolean
  label?: string
  placeholder?: string
  className?: string
}

export function ImageSelector({
  value,
  onChange,
  disabled = false,
  label = 'Logo Image',
  placeholder = 'Upload an image for your chat logo',
  className,
}: ImageSelectorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const validateFile = (file: File): string | null => {
    if (file.size > MAX_FILE_SIZE) {
      return `File "${file.name}" is too large. Maximum size is 5MB.`
    }
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      return `File "${file.name}" is not a supported image format. Please use PNG, JPEG, GIF, or WebP.`
    }
    return null
  }

  const handleFileUpload = async (file: File) => {
    const error = validateFile(file)
    if (error) {
      setUploadError(error)
      return
    }

    setIsUploading(true)
    setUploadError(null)

    try {
      // First, try to get a pre-signed URL for direct upload with chat type
      const presignedResponse = await fetch('/api/files/presigned?type=chat', {
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

      if (presignedResponse.ok) {
        // Use direct upload with presigned URL
        const presignedData = await presignedResponse.json()

        // Log the presigned URL response for debugging
        logger.info('Presigned URL response:', presignedData)

        // Upload directly to storage provider
        const uploadHeaders: Record<string, string> = {
          'Content-Type': file.type,
        }

        // Add any additional headers from the presigned response (for Azure Blob)
        if (presignedData.uploadHeaders) {
          Object.assign(uploadHeaders, presignedData.uploadHeaders)
        }

        const uploadResponse = await fetch(presignedData.uploadUrl, {
          method: 'PUT',
          body: file,
          headers: uploadHeaders,
        })

        logger.info(`Upload response status: ${uploadResponse.status}`)
        logger.info(
          'Upload response headers:',
          Object.fromEntries(uploadResponse.headers.entries())
        )

        if (!uploadResponse.ok) {
          const responseText = await uploadResponse.text()
          logger.error(`Direct upload failed: ${uploadResponse.status} - ${responseText}`)
          throw new Error(`Direct upload failed: ${uploadResponse.status} - ${responseText}`)
        }

        // Use the file info returned from the presigned URL endpoint
        const publicUrl = presignedData.fileInfo.path
        onChange(publicUrl)
        logger.info(`Image uploaded successfully via direct upload: ${publicUrl}`)
      } else {
        // Fallback to traditional upload through API route
        const formData = new FormData()
        formData.append('file', file)
        formData.append('context', 'chat')

        const response = await fetch('/api/files/upload', {
          method: 'POST',
          body: formData,
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: response.statusText }))
          throw new Error(errorData.error || `Failed to upload file: ${response.status}`)
        }

        const data = await response.json()
        const publicUrl = data.path
        onChange(publicUrl)
        logger.info(`Image uploaded successfully via server upload: ${publicUrl}`)
      }
    } catch (error) {
      logger.error('Error uploading image:', error)
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to upload image. Please try again.'
      setUploadError(errorMessage)
    } finally {
      setIsUploading(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      handleFileUpload(file)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!disabled) {
      setIsDragging(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    if (disabled) return

    const file = e.dataTransfer.files?.[0]
    if (file) {
      handleFileUpload(file)
    }
  }

  const handleRemove = () => {
    onChange(null)
    setUploadError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleClick = () => {
    if (!disabled && fileInputRef.current) {
      fileInputRef.current.click()
    }
  }

  return (
    <div className={cn('space-y-2', className)}>
      <Label className='font-medium text-sm'>{label}</Label>

      {value ? (
        // Show uploaded image
        <div className='space-y-2'>
          <div className='relative inline-block'>
            <img
              src={value}
              alt='Uploaded logo'
              className='h-20 w-20 rounded-lg border object-cover'
            />
            <Button
              type='button'
              variant='destructive'
              size='icon'
              className='-right-2 -top-2 absolute h-6 w-6 rounded-full'
              onClick={handleRemove}
              disabled={disabled || isUploading}
            >
              <X className='h-3 w-3' />
            </Button>
          </div>
          <Button
            type='button'
            variant='outline'
            onClick={handleClick}
            disabled={disabled || isUploading}
            className='text-sm'
          >
            {isUploading ? (
              <>
                <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                Uploading...
              </>
            ) : (
              <>
                <Upload className='mr-2 h-4 w-4' />
                Replace Image
              </>
            )}
          </Button>
        </div>
      ) : (
        // Show upload area
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={handleClick}
          className={cn(
            'relative flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 text-center transition-colors',
            isDragging
              ? 'border-primary bg-primary/5'
              : 'border-muted-foreground/25 hover:border-muted-foreground/40 hover:bg-muted/10',
            disabled && 'cursor-not-allowed opacity-50'
          )}
        >
          <input
            ref={fileInputRef}
            type='file'
            accept={ACCEPTED_IMAGE_TYPES.join(',')}
            onChange={handleFileChange}
            className='hidden'
            disabled={disabled}
          />

          {isUploading ? (
            <div className='space-y-2'>
              <Loader2 className='mx-auto h-8 w-8 animate-spin text-muted-foreground' />
              <p className='text-muted-foreground text-sm'>Uploading image...</p>
            </div>
          ) : (
            <div className='space-y-2'>
              <Image className='mx-auto h-8 w-8 text-muted-foreground' />
              <div>
                <p className='font-medium text-sm'>
                  {isDragging ? 'Drop image here!' : placeholder}
                </p>
                <p className='text-muted-foreground text-xs'>PNG, JPEG, GIF, or WebP (max 5MB)</p>
              </div>
            </div>
          )}
        </div>
      )}

      {uploadError && <p className='text-destructive text-sm'>{uploadError}</p>}
    </div>
  )
}
