'use client'

import { useRef, useState } from 'react'
import { Info, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useNotificationStore } from '@/stores/notifications/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { useSubBlockValue } from '../hooks/use-sub-block-value'

interface FileUploadProps {
  blockId: string
  subBlockId: string
  maxSize?: number // in MB
  acceptedTypes?: string // comma separated MIME types
  multiple?: boolean // whether to allow multiple file uploads
}

interface UploadedFile {
  name: string
  path: string
  size: number
  type: string
}

export function FileUpload({
  blockId,
  subBlockId,
  maxSize = 10, // Default 10MB
  acceptedTypes = '*',
  multiple = false, // Default to single file for backward compatibility
}: FileUploadProps) {
  // State management - handle both single file and array of files
  const [value, setValue] = useSubBlockValue<UploadedFile | UploadedFile[] | null>(
    blockId,
    subBlockId,
    true
  )
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)

  // For file deletion status
  const [deletingFiles, setDeletingFiles] = useState<Record<string, boolean>>({})

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Stores
  const { addNotification } = useNotificationStore()
  const { activeWorkflowId } = useWorkflowRegistry()

  /**
   * Opens file dialog
   * Prevents event propagation to avoid ReactFlow capturing the event
   */
  const handleOpenFileDialog = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

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
        addNotification(
          'error',
          `Adding ${file.name} would exceed the maximum size limit of ${maxSize}MB`,
          activeWorkflowId
        )
      } else {
        validFiles.push(file)
        totalNewSize += file.size
      }
    }

    if (validFiles.length === 0) return

    setIsUploading(true)
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

      // Upload each file separately
      for (const file of validFiles) {
        // Create FormData for upload
        const formData = new FormData()
        formData.append('file', file)

        // Upload the file
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

      // Clear progress interval
      if (progressInterval) {
        clearInterval(progressInterval)
        progressInterval = null
      }

      setUploadProgress(100)

      // Send consolidated notification about uploaded files
      if (uploadedFiles.length > 0) {
        if (uploadedFiles.length === 1) {
          addNotification(
            'console',
            `${uploadedFiles[0].name} was uploaded successfully`,
            activeWorkflowId
          )
        } else {
          addNotification(
            'console',
            `Uploaded ${uploadedFiles.length} files successfully: ${uploadedFiles.map((f) => f.name).join(', ')}`,
            activeWorkflowId
          )
        }
      }

      // Send consolidated error notification if any
      if (uploadErrors.length > 0) {
        if (uploadErrors.length === 1) {
          addNotification('error', uploadErrors[0], activeWorkflowId)
        } else {
          addNotification(
            'error',
            `Failed to upload ${uploadErrors.length} files: ${uploadErrors.join('; ')}`,
            activeWorkflowId
          )
        }
      }

      // Update the file value in state based on multiple setting
      if (multiple) {
        // For multiple files: Append to existing files if any
        const existingFiles = Array.isArray(value) ? value : value ? [value] : []
        const newFiles = [...existingFiles, ...uploadedFiles]
        setValue(newFiles)

        // Make sure to update the subblock store value for the workflow execution
        useSubBlockStore.getState().setValue(blockId, subBlockId, newFiles)
        useWorkflowStore.getState().triggerUpdate()
      } else {
        // For single file: Replace with last uploaded file
        setValue(uploadedFiles[0] || null)

        // Make sure to update the subblock store value for the workflow execution
        useSubBlockStore.getState().setValue(blockId, subBlockId, uploadedFiles[0] || null)
        useWorkflowStore.getState().triggerUpdate()
      }
    } catch (error) {
      addNotification(
        'error',
        error instanceof Error ? error.message : 'Failed to upload file(s)',
        activeWorkflowId
      )
    } finally {
      // Clean up and reset upload state
      if (progressInterval) {
        clearInterval(progressInterval)
      }

      setTimeout(() => {
        setIsUploading(false)
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
        setValue(updatedFiles.length > 0 ? updatedFiles : null)

        // Make sure to update the subblock store value for the workflow execution
        useSubBlockStore
          .getState()
          .setValue(blockId, subBlockId, updatedFiles.length > 0 ? updatedFiles : null)
      } else {
        // For single file: Clear the value
        setValue(null)

        // Make sure to update the subblock store
        useSubBlockStore.getState().setValue(blockId, subBlockId, null)
      }

      addNotification('console', `${file.name} was deleted successfully`, activeWorkflowId)
      useWorkflowStore.getState().triggerUpdate()
    } catch (error) {
      addNotification(
        'error',
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
    const fileCount = filesToDelete.length

    // Mark all files as deleting
    const deletingStatus: Record<string, boolean> = {}
    filesToDelete.forEach((file) => {
      deletingStatus[file.path] = true
    })
    setDeletingFiles(deletingStatus)

    // Clear input state immediately for better UX
    setValue(null)
    useSubBlockStore.getState().setValue(blockId, subBlockId, null)
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

    // Show a single consolidated notification about the deletions
    if (deletionResults.success > 0) {
      if (fileCount === 1) {
        addNotification('console', `File was deleted successfully`, activeWorkflowId)
      } else {
        addNotification(
          'console',
          `${deletionResults.success} of ${fileCount} files were deleted successfully`,
          activeWorkflowId
        )
      }
    }

    // Show error notification if any deletions failed
    if (deletionResults.failures.length > 0) {
      if (deletionResults.failures.length === 1) {
        addNotification(
          'error',
          `Failed to delete file: ${deletionResults.failures[0]}`,
          activeWorkflowId
        )
      } else {
        addNotification(
          'error',
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
        className="flex items-center justify-between p-2 rounded border border-border bg-secondary/30 mb-2"
      >
        <div className="flex-1 truncate pr-2">
          <div className="font-medium text-sm truncate">{file.name}</div>
          <div className="text-xs text-muted-foreground">{formatFileSize(file.size)}</div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={(e) => handleRemoveFile(file, e)}
          disabled={isDeleting}
        >
          {isDeleting ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            <X className="h-4 w-4" />
          )}
        </Button>
      </div>
    )
  }

  // Get files array regardless of multiple setting
  const filesArray = Array.isArray(value) ? value : value ? [value] : []
  const hasFiles = filesArray.length > 0

  return (
    <div className="w-full" onClick={(e) => e.stopPropagation()}>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        style={{ display: 'none' }}
        accept={acceptedTypes}
        multiple={multiple}
        data-testid="file-input-element"
      />

      {isUploading ? (
        <div className="w-full p-4 border border-border rounded-md">
          <Progress value={uploadProgress} className="w-full h-2 mb-2" />
          <div className="text-xs text-center text-muted-foreground">
            {uploadProgress < 100 ? 'Uploading...' : 'Upload complete!'}
          </div>
        </div>
      ) : (
        <>
          {hasFiles && (
            <div className="mb-3">
              {/* File list */}
              <div className="space-y-1">{filesArray.map(renderFileItem)}</div>

              {/* Action buttons */}
              <div className="flex space-x-2 mt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={handleRemoveAllFiles}
                >
                  Remove All
                </Button>
                {multiple && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={handleOpenFileDialog}
                  >
                    Add More
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Show upload button if no files or if not in multiple mode */}
          {(!hasFiles || !multiple) && (
            <Button
              type="button"
              variant="outline"
              className="w-full justify-center text-center font-normal"
              onClick={handleOpenFileDialog}
            >
              <Upload className="mr-2 h-4 w-4" />
              {multiple ? 'Upload Files' : 'Upload File'}

              <Tooltip>
                <TooltipTrigger className="ml-1">
                  <Info className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Max file size: {maxSize}MB</p>
                  {multiple && <p>You can select multiple files at once</p>}
                </TooltipContent>
              </Tooltip>
            </Button>
          )}
        </>
      )}
    </div>
  )
}
