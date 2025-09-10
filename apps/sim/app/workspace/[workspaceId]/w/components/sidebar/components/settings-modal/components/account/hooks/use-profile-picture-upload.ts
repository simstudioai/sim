import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('ProfilePictureUpload')
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg']

interface UseProfilePictureUploadProps {
  onUpload?: (url: string | null) => void
  onError?: (error: string) => void
  currentImage?: string | null
}

export function useProfilePictureUpload({
  onUpload,
  onError,
  currentImage,
}: UseProfilePictureUploadProps = {}) {
  const previewRef = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentImage || null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)

  useEffect(() => {
    if (currentImage !== previewUrl) {
      if (previewRef.current && previewRef.current !== currentImage) {
        URL.revokeObjectURL(previewRef.current)
        previewRef.current = null
      }
      setPreviewUrl(currentImage || null)
    }
  }, [currentImage, previewUrl])

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
      const presignedResponse = await fetch('/api/files/presigned?type=profile-pictures', {
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
        const presignedData = await presignedResponse.json()

        logger.info('Presigned URL response:', presignedData)

        const uploadHeaders: Record<string, string> = {
          'Content-Type': file.type,
        }

        if (presignedData.uploadHeaders) {
          Object.assign(uploadHeaders, presignedData.uploadHeaders)
        }

        const uploadResponse = await fetch(presignedData.uploadUrl, {
          method: 'PUT',
          body: file,
          headers: uploadHeaders,
        })

        logger.info(`Upload response status: ${uploadResponse.status}`)

        if (!uploadResponse.ok) {
          const responseText = await uploadResponse.text()
          logger.error(`Direct upload failed: ${uploadResponse.status} - ${responseText}`)
          throw new Error(`Direct upload failed: ${uploadResponse.status} - ${responseText}`)
        }

        const publicUrl = presignedData.fileInfo.path
        logger.info(`Profile picture uploaded successfully via direct upload: ${publicUrl}`)
        return publicUrl
      }

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
      logger.info(`Profile picture uploaded successfully via server upload: ${publicUrl}`)
      return publicUrl
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Failed to upload profile picture')
    }
  }, [])

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (file) {
        const validationError = validateFile(file)
        if (validationError) {
          onError?.(validationError)
          return
        }

        setFileName(file.name)

        const newPreviewUrl = URL.createObjectURL(file)

        if (previewRef.current) {
          URL.revokeObjectURL(previewRef.current)
        }

        setPreviewUrl(newPreviewUrl)
        previewRef.current = newPreviewUrl

        setIsUploading(true)
        try {
          const serverUrl = await uploadFileToServer(file)

          URL.revokeObjectURL(newPreviewUrl)
          previewRef.current = null
          setPreviewUrl(serverUrl)

          onUpload?.(serverUrl)
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Failed to upload profile picture'
          onError?.(errorMessage)

          URL.revokeObjectURL(newPreviewUrl)
          previewRef.current = null
          setPreviewUrl(currentImage || null)
        } finally {
          setIsUploading(false)
        }
      }
    },
    [onUpload, onError, uploadFileToServer, validateFile, currentImage]
  )

  const handleRemove = useCallback(() => {
    if (previewRef.current) {
      URL.revokeObjectURL(previewRef.current)
      previewRef.current = null
    }
    setPreviewUrl(null)
    setFileName(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    onUpload?.(null)
  }, [onUpload])

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
