import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import type { StorageContext } from '@/lib/uploads/shared/types'

const logger = createLogger('ProfilePictureUpload')
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/webp']

interface UseProfilePictureUploadProps {
  onUpload?: (url: string | null) => void
  onError?: (error: string) => void
  currentImage?: string | null
  context?: StorageContext
  workspaceId?: string
}

/**
 * Hook for handling profile picture upload functionality.
 * Manages file validation, preview generation, and server upload.
 */
export function useProfilePictureUpload({
  onUpload,
  onError,
  currentImage,
  context = 'profile-pictures',
  workspaceId,
}: UseProfilePictureUploadProps = {}) {
  const previewRef = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const onUploadRef = useRef(onUpload)
  const onErrorRef = useRef(onError)
  const currentImageRef = useRef(currentImage)
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentImage || null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)

  useEffect(() => {
    onUploadRef.current = onUpload
    onErrorRef.current = onError
    currentImageRef.current = currentImage
  }, [onUpload, onError, currentImage])

  useEffect(() => {
    if (previewRef.current && previewRef.current !== currentImage) {
      URL.revokeObjectURL(previewRef.current)
      previewRef.current = null
    }
    setPreviewUrl(currentImage || null)
  }, [currentImage])

  const validateFile = useCallback((file: File): string | null => {
    if (file.size > MAX_FILE_SIZE) {
      return `File "${file.name}" is too large. Maximum size is 5MB.`
    }
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      return `File "${file.name}" is not a supported image format. Please use PNG, JPEG, SVG, or WebP.`
    }
    return null
  }, [])

  const handleThumbnailClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const uploadFileToServer = useCallback(
    async (file: File): Promise<string> => {
      try {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('context', context)
        if (workspaceId) {
          formData.append('workspaceId', workspaceId)
        }

        // boundary-raw-fetch: multipart/form-data upload (FileUpload boundary), incompatible with requestJson which JSON-stringifies bodies
        const response = await fetch('/api/files/upload', {
          method: 'POST',
          body: formData,
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ message: response.statusText }))
          throw new Error(
            errorData.message || errorData.error || `Failed to upload file: ${response.status}`
          )
        }

        const data = await response.json()
        const publicUrl = data.fileInfo?.path || data.path || data.url
        logger.info(`Profile picture uploaded successfully via server upload: ${publicUrl}`)
        return publicUrl
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : 'Failed to upload profile picture')
      }
    },
    [context, workspaceId]
  )

  const processFile = useCallback(
    async (file: File) => {
      const validationError = validateFile(file)
      if (validationError) {
        onErrorRef.current?.(validationError)
        return
      }

      setFileName(file.name)

      const newPreviewUrl = URL.createObjectURL(file)
      if (previewRef.current) URL.revokeObjectURL(previewRef.current)
      setPreviewUrl(newPreviewUrl)
      previewRef.current = newPreviewUrl

      setIsUploading(true)
      try {
        const serverUrl = await uploadFileToServer(file)
        URL.revokeObjectURL(newPreviewUrl)
        previewRef.current = null
        setPreviewUrl(serverUrl)
        onUploadRef.current?.(serverUrl)
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Failed to upload profile picture'
        onErrorRef.current?.(errorMessage)
        URL.revokeObjectURL(newPreviewUrl)
        previewRef.current = null
        setPreviewUrl(currentImageRef.current || null)
      } finally {
        setIsUploading(false)
      }
    },
    [uploadFileToServer, validateFile]
  )

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (file) processFile(file)
    },
    [processFile]
  )

  const handleFileDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer.files[0]
      if (file) processFile(file)
    },
    [processFile]
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
    onUploadRef.current?.(null)
  }, [])

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
    handleFileDrop,
    handleRemove,
    isUploading,
  }
}
