'use client'

import { useRef, useState } from 'react'
import { Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useNotificationStore } from '@/stores/notifications/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
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
  const [value, setValue] = useSubBlockValue<UploadedFile | null>(blockId, subBlockId, true)
  const [isUploading, setIsUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { addNotification } = useNotificationStore()
  const { activeWorkflowId } = useWorkflowRegistry()

  // Function to open file dialog - this stops propagation explicitly to prevent ReactFlow from capturing the event
  const openFileDialog = (e: React.MouseEvent) => {
    // Prevent any parent events from being triggered (critical for ReactFlow)
    e.preventDefault()
    e.stopPropagation()

    // Clear any previous file selection and then trigger the file dialog
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
      fileInputRef.current.click()
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation() // Stop event propagation

    const file = e.target.files?.[0]
    if (!file) return

    // Check file size
    if (file.size > maxSize * 1024 * 1024) {
      addNotification(
        'error',
        `File too large: Maximum file size is ${maxSize}MB`,
        activeWorkflowId
      )
      return
    }

    setIsUploading(true)
    setProgress(0)

    // Create FormData
    const formData = new FormData()
    formData.append('file', file)

    try {
      // Simulate progress
      const progressInterval = setInterval(() => {
        setProgress((prev) => {
          const newProgress = prev + Math.random() * 10
          return newProgress > 90 ? 90 : newProgress
        })
      }, 200)

      // Upload the file
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      clearInterval(progressInterval)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: response.statusText }))
        const errorMessage = errorData.error || `Failed to upload file: ${response.status}`
        throw new Error(errorMessage)
      }

      const data = await response.json()
      setProgress(100)

      // Update the value with file metadata
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
      setTimeout(() => {
        setIsUploading(false)
        setProgress(0)
      }, 500)
    }
  }

  const handleRemove = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setValue(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // Format file size for display
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

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

      {!value ? (
        <Button
          type="button"
          variant="outline"
          className="w-full justify-start text-left font-normal"
          onClick={openFileDialog}
          disabled={isUploading}
          data-testid="file-upload-button"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Upload className="mr-1 h-4 w-4" />
          {isUploading ? 'Uploading...' : 'Click to upload file'}
        </Button>
      ) : (
        <div className="border rounded-md p-2" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between">
            <div className="truncate max-w-[200px]" title={value.name}>
              {value.name}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={handleRemove}
                aria-label="Remove file"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="text-xs text-muted-foreground mt-1">{formatFileSize(value.size)}</div>
        </div>
      )}

      {isUploading && (
        <div className="mt-2">
          <Progress
            value={progress}
            className="h-2"
            aria-label={`Upload progress: ${Math.round(progress)}%`}
          />
        </div>
      )}
    </div>
  )
}
