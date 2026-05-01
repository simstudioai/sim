import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'

const logger = createLogger('WorkspaceLogoUpload')
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/webp']

interface UseWorkspaceLogoUploadProps {
  workspaceId?: string
  currentLogoUrl?: string | null
  onUpload?: (url: string | null) => void
  onError?: (error: string) => void
}

/**
 * Hook for handling workspace logo upload functionality.
 * Manages file validation, preview generation, and server upload.
 */
export function useWorkspaceLogoUpload({
  workspaceId,
  currentLogoUrl,
  onUpload,
  onError,
}: UseWorkspaceLogoUploadProps = {}) {
  const previewRef = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const onUploadRef = useRef(onUpload)
  const onErrorRef = useRef(onError)
  const currentLogoUrlRef = useRef(currentLogoUrl)
  const workspaceIdRef = useRef(workspaceId)
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentLogoUrl || null)
  const [isUploading, setIsUploading] = useState(false)

  useEffect(() => {
    onUploadRef.current = onUpload
    onErrorRef.current = onError
    currentLogoUrlRef.current = currentLogoUrl
  }, [onUpload, onError, currentLogoUrl])

  useEffect(() => {
    workspaceIdRef.current = workspaceId
  }, [workspaceId])

  useEffect(() => {
    if (previewRef.current && previewRef.current !== currentLogoUrl) {
      URL.revokeObjectURL(previewRef.current)
      previewRef.current = null
    }
    setPreviewUrl(currentLogoUrl || null)
  }, [currentLogoUrl])

  const validateFile = useCallback((file: File): string | null => {
    if (file.size > MAX_FILE_SIZE) {
      return `File "${file.name}" is too large. Maximum size is 5MB.`
    }
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      return `File "${file.name}" is not a supported image format. Please use PNG, JPEG, SVG, or WebP.`
    }
    return null
  }, [])

  const uploadFileToServer = useCallback(async (file: File): Promise<string> => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('context', 'workspace-logos')
    if (workspaceIdRef.current) {
      formData.append('workspaceId', workspaceIdRef.current)
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
    logger.info(`Workspace logo uploaded successfully: ${publicUrl}`)
    return publicUrl
  }, [])

  const processFile = useCallback(
    async (file: File) => {
      const validationError = validateFile(file)
      if (validationError) {
        onErrorRef.current?.(validationError)
        return
      }

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
          error instanceof Error ? error.message : 'Failed to upload workspace logo'
        onErrorRef.current?.(errorMessage)
        URL.revokeObjectURL(newPreviewUrl)
        previewRef.current = null
        setPreviewUrl(currentLogoUrlRef.current || null)
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
      if (event.target) event.target.value = ''
    },
    [processFile]
  )

  const setTargetWorkspaceId = useCallback((id: string) => {
    workspaceIdRef.current = id
  }, [])

  const handleRemove = useCallback(() => {
    if (previewRef.current) {
      URL.revokeObjectURL(previewRef.current)
      previewRef.current = null
    }
    setPreviewUrl(null)
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
    fileInputRef,
    handleFileChange,
    handleRemove,
    setTargetWorkspaceId,
    isUploading,
  }
}
