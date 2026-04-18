'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { generateId } from '@/lib/core/utils/uuid'
import { resolveFileType } from '@/lib/uploads/utils/file-utils'

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
  workspaceId?: string
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
  const { userId, workspaceId, disabled, isLoading } = props

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
   * Uploads files in parallel so a slow file does not block faster ones queued
   * behind it. All placeholders insert in a single state update for a stable row.
   */
  const processFiles = useCallback(
    async (fileList: FileList) => {
      if (!userId) {
        logger.error('User ID not available for file upload')
        return
      }

      const files = Array.from(fileList)
      if (files.length === 0) return

      const placeholders: AttachedFile[] = files.map((file) => ({
        id: generateId(),
        name: file.name,
        size: file.size,
        type: resolveFileType(file),
        path: '',
        uploading: true,
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined,
      }))

      setAttachedFiles((prev) => [...prev, ...placeholders])

      await Promise.all(
        files.map(async (file, i) => {
          const placeholder = placeholders[i]
          try {
            const formData = new FormData()
            formData.append('file', file)
            formData.append('context', 'mothership')
            if (workspaceId) {
              formData.append('workspaceId', workspaceId)
            }

            const uploadResponse = await fetch('/api/files/upload', {
              method: 'POST',
              body: formData,
            })

            if (!uploadResponse.ok) {
              const errorData = await uploadResponse.json().catch(() => ({
                error: `Upload failed: ${uploadResponse.status}`,
              }))
              throw new Error(errorData.error || `Failed to upload file: ${uploadResponse.status}`)
            }

            const uploadData = await uploadResponse.json()

            logger.info(
              `File uploaded successfully: ${uploadData.fileInfo?.path || uploadData.path}`
            )

            setAttachedFiles((prev) =>
              prev.map((f) =>
                f.id === placeholder.id
                  ? {
                      ...f,
                      path: uploadData.fileInfo?.path || uploadData.path || uploadData.url,
                      key: uploadData.fileInfo?.key || uploadData.key,
                      uploading: false,
                    }
                  : f
              )
            )
          } catch (error) {
            logger.error(`File upload failed: ${error}`)
            if (placeholder.previewUrl) URL.revokeObjectURL(placeholder.previewUrl)
            setAttachedFiles((prev) => prev.filter((f) => f.id !== placeholder.id))
          }
        })
      )
    },
    [userId, workspaceId]
  )

  /**
   * Opens file picker dialog
   * Note: We allow file selection even when isLoading (streaming) so users can prepare images for the next message
   */
  const handleFileSelect = useCallback(() => {
    if (disabled) return
    fileInputRef.current?.click()
  }, [disabled])

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
   * Replaces the current attached files with a given set.
   * Cleans up preview URLs from the prior set before replacing.
   */
  const restoreAttachedFiles = useCallback((files: AttachedFile[]) => {
    setAttachedFiles((prev) => {
      prev.forEach((f) => {
        if (f.previewUrl) URL.revokeObjectURL(f.previewUrl)
      })
      return files
    })
  }, [])

  return {
    // State
    attachedFiles,
    isDragging,

    // Refs
    fileInputRef,

    // Operations
    formatFileSize,
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
    restoreAttachedFiles,
    processFiles,
  }
}
