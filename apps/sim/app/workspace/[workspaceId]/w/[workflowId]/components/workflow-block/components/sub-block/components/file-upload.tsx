'use client'

import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { createLogger } from '@/lib/logs/console-logger'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { useSubBlockValue } from '../hooks/use-sub-block-value'

const logger = createLogger('FileUpload')

interface FileUploadProps {
  blockId: string
  subBlockId: string
  maxSize?: number // in MB
  acceptedTypes?: string // comma separated MIME types
  multiple?: boolean // whether to allow multiple file uploads
  isPreview?: boolean
  previewValue?: any | null
  disabled?: boolean
}

interface UploadedFile {
  name: string
  path: string
  size: number
  type: string
}

interface UploadingFile {
  id: string
  name: string
  size: number
}

export function FileUpload({
  blockId,
  subBlockId,
  maxSize = 10, // Default 10MB
  acceptedTypes = '*',
  multiple = false, // Default to single file for backward compatibility
  isPreview = false,
  previewValue,
  disabled = false,
}: FileUploadProps) {
  // State management - handle both single file and array of files
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlockId)
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([])
  const [uploadProgress, setUploadProgress] = useState(0)

  // For file deletion status
  const [deletingFiles, setDeletingFiles] = useState<Record<string, boolean>>({})

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Stores
  const { activeWorkflowId } = useWorkflowRegistry()

  // Use preview value when in preview mode, otherwise use store value
  const value = isPreview ? previewValue : storeValue

  /**
   * Opens file dialog
   * Prevents event propagation to avoid ReactFlow capturing the event
   */
  const handleOpenFileDialog = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (disabled) return

    if (fileInputRef.current) {
      fileInputRef.current.value = ''
      fileInputRef.current.click()
    }
  }

  /**
   * Formats file size for display in a human-readable format
   */
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  /**
   * Handles file upload when new file(s) are selected
   */
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isPreview || disabled) return

    e.stopPropagation()

    const files = e.target.files
    if (!files || files.length === 0) return

    // Get existing files and their total size
    const existingFiles = Array.isArray(value) ? value : value ? [value] : []
    const existingTotalSize = existingFiles.reduce((sum, file) => sum + file.size, 0)

    // Validate file sizes
    const maxSizeInBytes = maxSize * 1024 * 1024
    const validFiles: File[] = []
    let totalNewSize = 0

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      // Check if adding this file would exceed the total limit
      if (existingTotalSize + totalNewSize + file.size > maxSizeInBytes) {
        logger.error(
          `Adding ${file.name} would exceed the maximum size limit of ${maxSize}MB`,
          activeWorkflowId
        )
      } else {
        validFiles.push(file)
        totalNewSize += file.size
      }
    }

    if (validFiles.length === 0) return

    // Create placeholder uploading files - ensure unique IDs
    const uploading = validFiles.map((file) => ({
      id: `upload-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      name: file.name,
      size: file.size,
    }))

    setUploadingFiles(uploading)
    setUploadProgress(0)

    // Track progress simulation interval
    let progressInterval: NodeJS.Timeout | null = null

    try {
      // Simulate upload progress
      progressInterval = setInterval(() => {
        setUploadProgress((prev) => {
          const newProgress = prev + Math.random() * 10
          return newProgress > 90 ? 90 : newProgress
        })
      }, 200)

      const uploadedFiles: UploadedFile[] = []
      const uploadErrors: string[] = []

      // Try to get pre-signed URLs first for direct upload
      let useDirectUpload = false

      // Upload each file separately
      for (const file of validFiles) {
        try {
          // First, try to get a pre-signed URL for direct upload
          const presignedResponse = await fetch('/api/files/presigned', {
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

          const presignedData = await presignedResponse.json()

          if (presignedResponse.ok && presignedData.directUploadSupported) {
            // Use direct upload method
            useDirectUpload = true

            const uploadHeaders: Record<string, string> = {
              'Content-Type': file.type,
            }

            // Add Azure-specific headers if provided
            if (presignedData.uploadHeaders) {
              Object.assign(uploadHeaders, presignedData.uploadHeaders)
            }

            // Upload directly to cloud storage using the pre-signed URL
            const uploadResponse = await fetch(presignedData.presignedUrl, {
              method: 'PUT',
              headers: uploadHeaders, // Use the merged headers
              body: file,
            })

            if (!uploadResponse.ok) {
              throw new Error(
                `Direct upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`
              )
            }

            // Use the file info returned from the presigned URL endpoint
            uploadedFiles.push(presignedData.fileInfo)
          } else {
            // Fallback to traditional upload through API route
            useDirectUpload = false

            // Create FormData for upload
            const formData = new FormData()
            formData.append('file', file)

            // Upload the file via server
            const response = await fetch('/api/files/upload', {
              method: 'POST',
              body: formData,
            })

            // Handle error response
            if (!response.ok) {
              const errorData = await response.json().catch(() => ({ error: response.statusText }))
              const errorMessage = errorData.error || `Failed to upload file: ${response.status}`
              uploadErrors.push(`${file.name}: ${errorMessage}`)
              continue
            }

            // Process successful upload
            const data = await response.json()

            uploadedFiles.push({
              name: file.name,
              path: data.path,
              size: file.size,
              type: file.type,
            })
          }
        } catch (error) {
          console.error(`Error uploading ${file.name}:`, error)
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          uploadErrors.push(`${file.name}: ${errorMessage}`)
        }
      }

      // Clear progress interval
      if (progressInterval) {
        clearInterval(progressInterval)
        progressInterval = null
      }

      setUploadProgress(100)

      // Send consolidated notification about uploaded files
      if (uploadedFiles.length > 0) {
        const uploadMethod = useDirectUpload ? 'direct' : 'server'
        if (uploadedFiles.length === 1) {
          logger.info(
            `${uploadedFiles[0].name} was uploaded successfully (${uploadMethod} upload)`,
            activeWorkflowId
          )
        } else {
          logger.info(
            `Uploaded ${uploadedFiles.length} files successfully: ${uploadedFiles.map((f) => f.name).join(', ')} (${uploadMethod} upload)`,
            activeWorkflowId
          )
        }
      }

      // Send consolidated error notification if any
      if (uploadErrors.length > 0) {
        if (uploadErrors.length === 1) {
          logger.error(uploadErrors[0], activeWorkflowId)
        } else {
          logger.error(
            `Failed to upload ${uploadErrors.length} files: ${uploadErrors.join('; ')}`,
            activeWorkflowId
          )
        }
      }

      // Update the file value in state based on multiple setting
      if (multiple) {
        // For multiple files: Append to existing files if any
        const existingFiles = Array.isArray(value) ? value : value ? [value] : []
        // Create a map to identify duplicates by path
        const uniqueFiles = new Map()

        // Add existing files to the map
        existingFiles.forEach((file) => {
          uniqueFiles.set(file.path, file)
        })

        // Add new files to the map (will overwrite if same path)
        uploadedFiles.forEach((file) => {
          uniqueFiles.set(file.path, file)
        })

        // Convert map values back to array
        const newFiles = Array.from(uniqueFiles.values())

        setStoreValue(newFiles)
        useWorkflowStore.getState().triggerUpdate()
      } else {
        // For single file: Replace with last uploaded file
        setStoreValue(uploadedFiles[0] || null)
        useWorkflowStore.getState().triggerUpdate()
      }
    } catch (error) {
      logger.error(
        error instanceof Error ? error.message : 'Failed to upload file(s)',
        activeWorkflowId
      )
    } finally {
      // Clean up and reset upload state
      if (progressInterval) {
        clearInterval(progressInterval)
      }

      setTimeout(() => {
        setUploadingFiles([])
        setUploadProgress(0)
      }, 500)
    }
  }

  /**
   * Handles deletion of a single file
   */
  const handleRemoveFile = async (file: UploadedFile, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }

    // Mark this file as being deleted
    setDeletingFiles((prev) => ({ ...prev, [file.path]: true }))

    try {
      // Call API to delete the file from server
      const response = await fetch('/api/files/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ filePath: file.path }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }))
        const errorMessage = errorData.error || `Failed to delete file: ${response.status}`
        throw new Error(errorMessage)
      }

      // Update the UI state
      if (multiple) {
        // For multiple files: Remove the specific file
        const filesArray = Array.isArray(value) ? value : value ? [value] : []
        const updatedFiles = filesArray.filter((f) => f.path !== file.path)
        setStoreValue(updatedFiles.length > 0 ? updatedFiles : null)
      } else {
        // For single file: Clear the value
        setStoreValue(null)
      }

      useWorkflowStore.getState().triggerUpdate()
    } catch (error) {
      logger.error(
        error instanceof Error ? error.message : 'Failed to delete file from server',
        activeWorkflowId
      )
    } finally {
      // Remove file from the deleting state
      setDeletingFiles((prev) => {
        const updated = { ...prev }
        delete updated[file.path]
        return updated
      })
    }
  }

  /**
   * Handles deletion of all files (for multiple mode)
   */
  const handleRemoveAllFiles = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (!value) return

    const filesToDelete = Array.isArray(value) ? value : [value]
    const _fileCount = filesToDelete.length

    // Mark all files as deleting
    const deletingStatus: Record<string, boolean> = {}
    filesToDelete.forEach((file) => {
      deletingStatus[file.path] = true
    })
    setDeletingFiles(deletingStatus)

    // Clear input state immediately for better UX
    setStoreValue(null)
    useWorkflowStore.getState().triggerUpdate()

    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }

    // Track successful and failed deletions
    const deletionResults = {
      success: 0,
      failures: [] as string[],
    }

    // Delete each file
    for (const file of filesToDelete) {
      try {
        const response = await fetch('/api/files/delete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ filePath: file.path }),
        })

        if (response.ok) {
          deletionResults.success++
        } else {
          const errorData = await response.json().catch(() => ({ error: response.statusText }))
          const errorMessage = errorData.error || `Failed to delete file: ${response.status}`
          deletionResults.failures.push(`${file.name}: ${errorMessage}`)
        }
      } catch (error) {
        console.error(`Failed to delete file ${file.name}:`, error)
        deletionResults.failures.push(
          `${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      }
    }

    // Show error notification if any deletions failed
    if (deletionResults.failures.length > 0) {
      if (deletionResults.failures.length === 1) {
        logger.error(`Failed to delete file: ${deletionResults.failures[0]}`, activeWorkflowId)
      } else {
        logger.error(
          `Failed to delete ${deletionResults.failures.length} files: ${deletionResults.failures.join('; ')}`,
          activeWorkflowId
        )
      }
    }

    setDeletingFiles({})
  }

  // Helper to render a single file item
  const renderFileItem = (file: UploadedFile) => {
    const isDeleting = deletingFiles[file.path]

    return (
      <div
        key={file.path}
        className='flex items-center justify-between rounded border border-border bg-background px-3 py-2'
      >
        <div className='flex-1 truncate pr-2'>
          <div className='truncate font-normal text-sm'>{file.name}</div>
          <div className='text-muted-foreground text-xs'>{formatFileSize(file.size)}</div>
        </div>
        <Button
          type='button'
          variant='ghost'
          size='icon'
          className='h-8 w-8 shrink-0'
          onClick={(e) => handleRemoveFile(file, e)}
          disabled={isDeleting}
        >
          {isDeleting ? (
            <div className='h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent' />
          ) : (
            <X className='h-4 w-4' />
          )}
        </Button>
      </div>
    )
  }

  // Render a placeholder item for files being uploaded
  const renderUploadingItem = (file: UploadingFile) => {
    return (
      <div
        key={file.id}
        className='flex items-center justify-between rounded border border-border bg-background px-3 py-2'
      >
        <div className='flex-1 truncate pr-2'>
          <div className='truncate font-normal text-sm'>{file.name}</div>
          <div className='text-muted-foreground text-xs'>{formatFileSize(file.size)}</div>
        </div>
        <div className='flex h-8 w-8 shrink-0 items-center justify-center'>
          <div className='h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent' />
        </div>
      </div>
    )
  }

  // Get files array regardless of multiple setting
  const filesArray = Array.isArray(value) ? value : value ? [value] : []
  const hasFiles = filesArray.length > 0
  const isUploading = uploadingFiles.length > 0

  return (
    <div className='w-full' onClick={(e) => e.stopPropagation()}>
      <input
        type='file'
        ref={fileInputRef}
        onChange={handleFileChange}
        style={{ display: 'none' }}
        accept={acceptedTypes}
        multiple={multiple}
        data-testid='file-input-element'
      />

      <div className='bg-background'>
        {/* File list with consistent spacing */}
        {(hasFiles || isUploading) && (
          <div className='mb-2 space-y-2'>
            {/* Only show files that aren't currently uploading */}
            {filesArray.map((file) => {
              // Don't show files that have duplicates in the uploading list
              const isCurrentlyUploading = uploadingFiles.some(
                (uploadingFile) => uploadingFile.name === file.name
              )
              return !isCurrentlyUploading && renderFileItem(file)
            })}
            {isUploading && (
              <>
                {uploadingFiles.map(renderUploadingItem)}
                <div className='mt-1'>
                  <Progress value={uploadProgress} className='h-2 w-full' />
                  <div className='mt-1 text-center text-muted-foreground text-xs'>
                    {uploadProgress < 100 ? 'Uploading...' : 'Upload complete!'}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Action buttons */}
        {(hasFiles || isUploading) && (
          <div className='flex space-x-2'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              className='h-10 flex-1 font-normal text-sm'
              onClick={handleRemoveAllFiles}
              disabled={isUploading}
            >
              Remove All
            </Button>
            {multiple && !isUploading && (
              <Button
                type='button'
                variant='outline'
                size='sm'
                className='h-10 flex-1 font-normal text-sm'
                onClick={handleOpenFileDialog}
              >
                Add More
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Show upload button if no files and not uploading */}
      {!hasFiles && !isUploading && (
        <div className='flex items-center'>
          <Button
            type='button'
            variant='outline'
            className='h-10 w-full justify-center bg-background text-center font-normal text-sm'
            onClick={handleOpenFileDialog}
          >
            <div className='flex w-full items-center justify-center gap-2'>
              {/* <Upload className="h-4 w-4" /> */}
              <span>{multiple ? 'Upload Files' : 'Upload File'}</span>
              <span className='text-muted-foreground text-xs'>({maxSize}MB max)</span>
            </div>
          </Button>
        </div>
      )}
    </div>
  )
}
