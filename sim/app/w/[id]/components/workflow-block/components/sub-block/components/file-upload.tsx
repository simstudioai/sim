'use client'

import { useRef, useState } from 'react'
import { Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
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
}: FileUploadProps) {
  // State management
  const [value, setValue] = useSubBlockValue<UploadedFile | null>(blockId, subBlockId, true)
  const [isUploading, setIsUploading] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isDeleted, setIsDeleted] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Stores
  const { addNotification } = useNotificationStore()
  const { activeWorkflowId } = useWorkflowRegistry()

  /**
   * Opens file dialog and resets deletion state
   * Prevents event propagation to avoid ReactFlow capturing the event
   */
  const handleOpenFileDialog = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    setIsDeleted(false)

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
   * Handles file upload when a new file is selected
   */
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation()

    const file = e.target.files?.[0]
    if (!file) return

    setIsDeleted(false)

    // Validate file size
    const maxSizeInBytes = maxSize * 1024 * 1024
    if (file.size > maxSizeInBytes) {
      addNotification(
        'error',
        `File too large: Maximum file size is ${maxSize}MB`,
        activeWorkflowId
      )
      return
    }

    setIsUploading(true)
    setUploadProgress(0)

    // Create FormData for upload
    const formData = new FormData()
    formData.append('file', file)

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

      // Upload the file
      const response = await fetch('/api/files/upload', {
        method: 'POST',
        body: formData,
      })

      // Clear progress interval
      if (progressInterval) {
        clearInterval(progressInterval)
        progressInterval = null
      }

      // Handle error response
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }))
        const errorMessage = errorData.error || `Failed to upload file: ${response.status}`
        throw new Error(errorMessage)
      }

      // Process successful upload
      const data = await response.json()
      setUploadProgress(100)

      // Update the file value in state
      setValue({
        name: file.name,
        path: data.path,
        size: file.size,
        type: file.type,
      })

      addNotification('console', `${file.name} was uploaded successfully`, activeWorkflowId)
    } catch (error) {
      addNotification(
        'error',
        error instanceof Error ? error.message : 'Failed to upload file',
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
   * Handles file deletion when the remove button is clicked
   */
  const handleRemove = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    // Only attempt to delete if there's a file
    if (!value || !value.path) {
      // Ensure UI state is cleared even if there's no file
      setValue(null)
      setIsDeleted(true)
      useSubBlockStore.getState().setValue(blockId, subBlockId, null)
      useWorkflowStore.getState().triggerUpdate()

      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      return
    }

    // Save file info before clearing state
    const fileToDelete = {
      path: value.path,
      name: value.name,
    }

    setIsDeleting(true)

    try {
      // Update UI state immediately
      setValue(null)
      setIsDeleted(true)
      useSubBlockStore.getState().setValue(blockId, subBlockId, null)
      useWorkflowStore.getState().triggerUpdate()

      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }

      // Call API to delete the file from server
      const response = await fetch('/api/files/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ filePath: fileToDelete.path }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }))
        const errorMessage = errorData.error || `Failed to delete file: ${response.status}`
        throw new Error(errorMessage)
      }

      addNotification('console', `${fileToDelete.name} was deleted successfully`, activeWorkflowId)
    } catch (error) {
      // Keep UI in deleted state even if server deletion fails
      addNotification(
        'error',
        error instanceof Error ? error.message : 'Failed to delete file from server',
        activeWorkflowId
      )
    } finally {
      setIsDeleting(false)
    }
  }

  // Determine whether to show file or upload button
  const shouldShowFile = value && !isDeleting && !isDeleted

  return (
    <div className="w-full" onClick={(e) => e.stopPropagation()}>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        style={{ display: 'none' }}
        accept={acceptedTypes}
        data-testid="file-input-element"
      />

      {isDeleting ? (
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start text-left font-normal"
          disabled={true}
          data-testid="file-deleting-indicator"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <X className="mr-1 h-4 w-4 animate-pulse" />
          Deleting file...
        </Button>
      ) : !shouldShowFile ? (
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start text-left font-normal"
          onClick={handleOpenFileDialog}
          disabled={isUploading}
          data-testid="file-upload-button"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Upload className="mr-1 h-4 w-4" />
          {isUploading ? 'Uploading...' : 'Click to upload file'}
        </Button>
      ) : (
        <div className="border rounded-md px-3 py-3" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start justify-between">
            <div className="truncate max-w-[200px] text-sm" title={value.name}>
              {value.name}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={handleRemove}
                disabled={isDeleting}
                aria-label="Remove file"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">{formatFileSize(value.size)}</div>
        </div>
      )}

      {isUploading && (
        <div className="mt-2">
          <Progress
            value={uploadProgress}
            className="h-2"
            aria-label={`Upload progress: ${Math.round(uploadProgress)}%`}
          />
        </div>
      )}
    </div>
  )
}
