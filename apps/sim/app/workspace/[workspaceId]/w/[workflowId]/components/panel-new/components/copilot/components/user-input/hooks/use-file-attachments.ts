'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('useFileAttachments')

/**
 * File size units for formatting
 */
const FILE_SIZE_UNITS = ['Bytes', 'KB', 'MB', 'GB'] as const

/**
 * Kilobyte multiplier
 */
const KILOBYTE = 1024

/**
 * Attached file structure
 */
export interface AttachedFile {
  id: string
  name: string
  size: number
  type: string
  path: string
  key?: string
  uploading: boolean
  previewUrl?: string
}

/**
 * Message file attachment structure (for API)
 */
export interface MessageFileAttachment {
  id: string
  key: string
  filename: string
  media_type: string
  size: number
}

interface UseFileAttachmentsProps {
  userId?: string
  disabled?: boolean
  isLoading?: boolean
}

/**
 * Custom hook to manage file attachments including upload, drag/drop, and preview
 * Handles S3 presigned URL uploads and preview URL generation
 *
 * @param props - File attachment configuration
 * @returns File attachment state and operations
 */
export function useFileAttachments(props: UseFileAttachmentsProps) {
  const { userId, disabled, isLoading } = props

  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [dragCounter, setDragCounter] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  /**
   * Cleanup preview URLs on unmount
   */
  useEffect(() => {
    return () => {
      attachedFiles.forEach((f) => {
        if (f.previewUrl) {
          URL.revokeObjectURL(f.previewUrl)
        }
      })
    }
  }, [])

  /**
   * Formats file size in bytes to human-readable format
   * @param bytes - File size in bytes
   * @returns Formatted string (e.g., "2.5 MB")
   */
  const formatFileSize = useCallback((bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const i = Math.floor(Math.log(bytes) / Math.log(KILOBYTE))
    return `${Math.round((bytes / KILOBYTE ** i) * 100) / 100} ${FILE_SIZE_UNITS[i]}`
  }, [])

  /**
   * Checks if a file is an image based on media type
   * @param type - MIME type of the file
   * @returns True if file is an image
   */
  const isImageFile = useCallback((type: string) => {
    return type.startsWith('image/')
  }, [])

  /**
   * Determines file icon type based on media type
   * Returns a string identifier for icon type
   * @param mediaType - MIME type of the file
   * @returns Icon type identifier
   */
  const getFileIconType = useCallback((mediaType: string): 'image' | 'pdf' | 'text' | 'default' => {
    if (mediaType.startsWith('image/')) return 'image'
    if (mediaType.includes('pdf')) return 'pdf'
    if (mediaType.includes('text') || mediaType.includes('json') || mediaType.includes('xml')) {
      return 'text'
    }
    return 'default'
  }, [])

  /**
   * Processes and uploads files to S3
   * @param fileList - Files to process
   */
  const processFiles = useCallback(
    async (fileList: FileList) => {
      if (!userId) {
        logger.error('User ID not available for file upload')
        return
      }

      for (const file of Array.from(fileList)) {
        if (!file.type.startsWith('image/')) {
          logger.warn(`File ${file.name} is not an image. Only image files are allowed.`)
          continue
        }

        let previewUrl: string | undefined
        if (file.type.startsWith('image/')) {
          previewUrl = URL.createObjectURL(file)
        }

        const tempFile: AttachedFile = {
          id: crypto.randomUUID(),
          name: file.name,
          size: file.size,
          type: file.type,
          path: '',
          uploading: true,
          previewUrl,
        }

        setAttachedFiles((prev) => [...prev, tempFile])

        try {
          const presignedResponse = await fetch('/api/files/presigned?type=copilot', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              fileName: file.name,
              contentType: file.type,
              fileSize: file.size,
              userId,
            }),
          })

          if (!presignedResponse.ok) {
            throw new Error('Failed to get presigned URL')
          }

          const presignedData = await presignedResponse.json()

          logger.info(`Uploading file: ${presignedData.presignedUrl}`)
          const uploadHeaders = presignedData.uploadHeaders || {}
          const uploadResponse = await fetch(presignedData.presignedUrl, {
            method: 'PUT',
            headers: {
              'Content-Type': file.type,
              ...uploadHeaders,
            },
            body: file,
          })

          logger.info(`Upload response status: ${uploadResponse.status}`)

          if (!uploadResponse.ok) {
            const errorText = await uploadResponse.text()
            logger.error(`Upload failed: ${errorText}`)
            throw new Error(`Failed to upload file: ${uploadResponse.status} ${errorText}`)
          }

          setAttachedFiles((prev) =>
            prev.map((f) =>
              f.id === tempFile.id
                ? {
                    ...f,
                    path: presignedData.fileInfo.path,
                    key: presignedData.fileInfo.key,
                    uploading: false,
                  }
                : f
            )
          )
        } catch (error) {
          logger.error(`File upload failed: ${error}`)
          setAttachedFiles((prev) => prev.filter((f) => f.id !== tempFile.id))
        }
      }
    },
    [userId]
  )

  /**
   * Opens file picker dialog
   */
  const handleFileSelect = useCallback(() => {
    if (disabled || isLoading) return
    fileInputRef.current?.click()
  }, [disabled, isLoading])

  /**
   * Handles file input change event
   * @param e - Change event
   */
  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files || files.length === 0) return

      await processFiles(files)

      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    },
    [processFiles]
  )

  /**
   * Removes a file from attachments
   * @param fileId - ID of the file to remove
   */
  const removeFile = useCallback(
    (fileId: string) => {
      const file = attachedFiles.find((f) => f.id === fileId)
      if (file?.previewUrl) {
        URL.revokeObjectURL(file.previewUrl)
      }
      setAttachedFiles((prev) => prev.filter((f) => f.id !== fileId))
    },
    [attachedFiles]
  )

  /**
   * Opens file in new tab (for preview)
   * @param file - File to open
   */
  const handleFileClick = useCallback((file: AttachedFile) => {
    if (file.key) {
      window.open(file.path, '_blank')
    } else if (file.previewUrl) {
      window.open(file.previewUrl, '_blank')
    }
  }, [])

  /**
   * Handles drag enter event
   */
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragCounter((prev) => {
      const newCount = prev + 1
      if (newCount === 1) {
        setIsDragging(true)
      }
      return newCount
    })
  }, [])

  /**
   * Handles drag leave event
   */
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragCounter((prev) => {
      const newCount = prev - 1
      if (newCount === 0) {
        setIsDragging(false)
      }
      return newCount
    })
  }, [])

  /**
   * Handles drag over event
   */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  /**
   * Handles file drop event
   */
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      setDragCounter(0)

      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        await processFiles(e.dataTransfer.files)
      }
    },
    [processFiles]
  )

  /**
   * Clears all attached files and cleanup preview URLs
   */
  const clearAttachedFiles = useCallback(() => {
    attachedFiles.forEach((f) => {
      if (f.previewUrl) {
        URL.revokeObjectURL(f.previewUrl)
      }
    })
    setAttachedFiles([])
  }, [attachedFiles])

  /**
   * Gets message file attachments in API format
   * Only includes successfully uploaded files
   */
  const getMessageFileAttachments = useCallback((): MessageFileAttachment[] => {
    const failed = attachedFiles.filter((f) => !f.uploading && !f.key)
    if (failed.length > 0) {
      logger.error(`Some files failed to upload: ${failed.map((f) => f.name).join(', ')}`)
    }

    return attachedFiles
      .filter((f) => !f.uploading && f.key)
      .map((f) => ({
        id: f.id,
        key: f.key!,
        filename: f.name,
        media_type: f.type,
        size: f.size,
      }))
  }, [attachedFiles])

  return {
    // State
    attachedFiles,
    isDragging,

    // Refs
    fileInputRef,

    // Operations
    formatFileSize,
    isImageFile,
    getFileIconType,
    handleFileSelect,
    handleFileChange,
    removeFile,
    handleFileClick,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    clearAttachedFiles,
    getMessageFileAttachments,
  }
}
