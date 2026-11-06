import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { uploadInternalFileSession } from '@/lib/uploads/client/session-upload'

const logger = createLogger('ProfilePictureUpload')
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/webp']

interface UseProfilePictureUploadProps {
  onUpload?: (url: string | null) => void
  onError?: (error: string) => void
  currentImage?: string | null
  context?: 'profile-pictures' | 'workspace-logos'
  workspaceId?: string
  uploadWorkspaceLogo?: (file: File) => Promise<string>
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
  uploadWorkspaceLogo,
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
      if (context === 'workspace-logos') {
        if (!workspaceId) {
          throw new Error('A workspace in this organization is required to upload branding images.')
        }
        if (uploadWorkspaceLogo) return uploadWorkspaceLogo(file)
        const result = await uploadInternalFileSession({
          purpose: 'workspace_logo',
          workspaceId,
          file,
        })
        logger.info(`${context} uploaded successfully: ${result.path}`)
        return result.path
      }

      const result = await uploadInternalFileSession({
        purpose: 'profile_picture',
        file,
      })
      logger.info(`${context} uploaded successfully: ${result.path}`)
      return result.path
    },
    [context, workspaceId, uploadWorkspaceLogo]
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
        const errorMessage = getErrorMessage(error, 'Failed to upload profile picture')
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

  /**
   * Restore a saved preview after discarding a draft. Defaults to the current image.
   */
  const reset = useCallback((savedImage = currentImageRef.current) => {
    if (previewRef.current) {
      URL.revokeObjectURL(previewRef.current)
      previewRef.current = null
    }
    setPreviewUrl(savedImage || null)
    setFileName(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
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
    handleFile: processFile,
    handleThumbnailClick,
    handleFileChange,
    handleFileDrop,
    handleRemove,
    reset,
    isUploading,
  }
}
