import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('ImageUpload')
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg']

interface UseImageUploadProps {
  onUpload?: (url: string | null) => void
  onError?: (error: string) => void
  uploadToServer?: boolean
}

export function useImageUpload({
  onUpload,
  onError,
  uploadToServer = false,
}: UseImageUploadProps = {}) {
  const previewRef = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)

  const validateFile = useCallback((file: File): string | null => {
    if (file.size > MAX_FILE_SIZE) {
      return `File "${file.name}" is too large. Maximum size is 5MB.`
    }
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      return `File "${file.name}" is not a supported image format. Please use PNG or JPEG.`
    }
    return null
  }, [])

  const handleThumbnailClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const uploadFileToServer = useCallback(async (file: File): Promise<string> => {
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
        logger.info(`Image uploaded successfully via direct upload: ${publicUrl}`)
        return publicUrl
      }
      // Fallback to traditional upload through API route
      const formData = new FormData()
      formData.append('file', file)

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
      logger.info(`Image uploaded successfully via server upload: ${publicUrl}`)
      return publicUrl
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Failed to upload image')
    }
  }, [])

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (file) {
        // Validate file first
        const validationError = validateFile(file)
        if (validationError) {
          onError?.(validationError)
          return
        }

        setFileName(file.name)

        // Always create preview URL
        const previewUrl = URL.createObjectURL(file)
        setPreviewUrl(previewUrl)
        previewRef.current = previewUrl

        if (uploadToServer) {
          setIsUploading(true)
          try {
            const serverUrl = await uploadFileToServer(file)
            onUpload?.(serverUrl)
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to upload image'
            onError?.(errorMessage)
          } finally {
            setIsUploading(false)
          }
        } else {
          onUpload?.(previewUrl)
        }
      }
    },
    [onUpload, onError, uploadToServer, uploadFileToServer, validateFile]
  )

  const handleRemove = useCallback(() => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
    }
    setPreviewUrl(null)
    setFileName(null)
    previewRef.current = null
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    onUpload?.(null) // Notify parent that image was removed
  }, [previewUrl, onUpload])

  useEffect(() => {
    return () => {
      if (previewRef.current) {
        URL.revokeObjectURL(previewRef.current)
      }
    }
  }, [])

  return {
    previewUrl,
    fileName,
    fileInputRef,
    handleThumbnailClick,
    handleFileChange,
    handleRemove,
    isUploading,
  }
}
