'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { getMothershipAttachmentPreviewUrl } from '@/lib/copilot/chat/attachment-preview'
import { assertMultiFileUploadAdmission } from '@/lib/uploads/client/admission'
import { runWithConcurrency, WHOLE_FILE_PARALLEL_UPLOADS } from '@/lib/uploads/client/concurrency'
import { uploadInternalFileSession } from '@/lib/uploads/client/session-upload'
import { MAX_WORKSPACE_FILE_SIZE } from '@/lib/uploads/shared/types'
import { resolveFileType } from '@/lib/uploads/utils/file-utils'

const logger = createLogger('useFileAttachments')

/**
 * Image formats no browser decodes in an `<img>`. A blob URL of these bytes renders
 * broken, so their preview has to come from the serve route, which substitutes a
 * JPEG derivative once the file is uploaded.
 *
 * Matched as prefixes so the `-sequence` variants Safari reports for Live Photos and
 * burst captures are covered too. The server decides for real by sniffing the
 * container — see `isHevcHeifContainer` in `@/lib/uploads/server/heic`; keep the two
 * in step when adding a format.
 */
const SERVER_RENDERED_IMAGE_PREFIXES = ['image/heic', 'image/heif'] as const

/** Whether the browser can decode these bytes itself, making a blob URL worth creating. */
function rendersFromBlobUrl(mediaType: string): boolean {
  if (SERVER_RENDERED_IMAGE_PREFIXES.some((prefix) => mediaType.startsWith(prefix))) return false
  return mediaType.startsWith('image/') || mediaType.startsWith('video/')
}

/**
 * Revokes a preview URL only when it is one we minted. A preview can also be a serve
 * URL, which owns no object-URL handle.
 */
function revokePreviewUrl(previewUrl?: string): void {
  if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl)
}

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
  const [dragCounter, setDragCounter] = useState(0)
  const isDragging = dragCounter > 0
  const fileInputRef = useRef<HTMLInputElement>(null)
  const attachedFilesRef = useRef<AttachedFile[]>([])
  const uploadControllersRef = useRef(new Map<string, AbortController>())

  const updateAttachedFiles = useCallback((update: (files: AttachedFile[]) => AttachedFile[]) => {
    const next = update(attachedFilesRef.current)
    attachedFilesRef.current = next
    setAttachedFiles(next)
  }, [])

  /**
   * Cleanup preview URLs on unmount
   */
  useEffect(() => {
    return () => {
      for (const controller of uploadControllersRef.current.values()) controller.abort()
      uploadControllersRef.current.clear()
      attachedFilesRef.current.forEach((f) => revokePreviewUrl(f.previewUrl))
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
      if (!workspaceId) {
        logger.error('workspaceId required for mothership uploads')
        return
      }

      if (fileList.length === 0) return
      try {
        assertMultiFileUploadAdmission(fileList, {
          existingFiles: attachedFilesRef.current,
          maxFileBytes: MAX_WORKSPACE_FILE_SIZE,
        })
      } catch (error) {
        toast.error("Couldn't add files", { description: toError(error).message })
        return
      }

      const files = Array.from(fileList)

      const placeholders: AttachedFile[] = files.map((file) => {
        /** Resolved once: browsers report `application/octet-stream` (or nothing) for
         *  plenty of files, and both the chip and the preview decision key off it. */
        const type = resolveFileType(file)
        return {
          id: generateId(),
          name: file.name,
          size: file.size,
          type,
          path: '',
          uploading: true,
          previewUrl: rendersFromBlobUrl(type) ? URL.createObjectURL(file) : undefined,
        }
      })
      const controllers = placeholders.map(() => new AbortController())
      placeholders.forEach((placeholder, index) => {
        uploadControllersRef.current.set(placeholder.id, controllers[index])
      })

      updateAttachedFiles((current) => [...current, ...placeholders])

      await runWithConcurrency(files, WHOLE_FILE_PARALLEL_UPLOADS, async (file, i) => {
        const placeholder = placeholders[i]
        const controller = controllers[i]
        try {
          const result = await uploadInternalFileSession({
            purpose: 'mothership_attachment',
            file,
            workspaceId,
            signal: controller.signal,
          })

          logger.info(`File uploaded successfully: ${result.path}`)

          updateAttachedFiles((current) =>
            current.map((f) =>
              f.id === placeholder.id
                ? {
                    ...f,
                    path: result.path,
                    key: result.key,
                    uploading: false,
                    previewUrl:
                      f.previewUrl ??
                      getMothershipAttachmentPreviewUrl({
                        key: result.key,
                        media_type: f.type,
                      }),
                  }
                : f
            )
          )
        } catch (error) {
          if (!controller.signal.aborted) {
            logger.error(`File upload failed: ${error}`)
            toast.error(`Couldn't upload "${file.name}"`, {
              description: toError(error).message,
            })
          }
          revokePreviewUrl(placeholder.previewUrl)
          updateAttachedFiles((current) => current.filter((file) => file.id !== placeholder.id))
        } finally {
          uploadControllersRef.current.delete(placeholder.id)
        }
      })
    },
    [userId, workspaceId, updateAttachedFiles]
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
      uploadControllersRef.current.get(fileId)?.abort()
      uploadControllersRef.current.delete(fileId)
      const file = attachedFilesRef.current.find((f) => f.id === fileId)
      revokePreviewUrl(file?.previewUrl)
      updateAttachedFiles((current) => current.filter((file) => file.id !== fileId))
    },
    [updateAttachedFiles]
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
    setDragCounter((prev) => prev + 1)
  }, [])

  /**
   * Handles drag leave event
   */
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragCounter((prev) => Math.max(0, prev - 1))
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
    for (const controller of uploadControllersRef.current.values()) controller.abort()
    uploadControllersRef.current.clear()
    attachedFilesRef.current.forEach((f) => revokePreviewUrl(f.previewUrl))
    updateAttachedFiles(() => [])
  }, [updateAttachedFiles])

  /**
   * Replaces the current attached files with a given set, revoking the prior set's
   * preview URLs first. Revoked outside the updater, which must stay pure — React
   * double-invokes updaters in StrictMode and may replay them.
   */
  const restoreAttachedFiles = useCallback(
    (files: AttachedFile[]) => {
      for (const controller of uploadControllersRef.current.values()) controller.abort()
      uploadControllersRef.current.clear()
      attachedFilesRef.current.forEach((f) => revokePreviewUrl(f.previewUrl))
      updateAttachedFiles(() => files)
    },
    [updateAttachedFiles]
  )

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
