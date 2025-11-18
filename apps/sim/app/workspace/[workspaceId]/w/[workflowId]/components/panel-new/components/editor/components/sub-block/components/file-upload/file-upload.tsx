'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button, Combobox } from '@/components/emcn/components'
import { Progress } from '@/components/ui/progress'
import { createLogger } from '@/lib/logs/console/logger'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { useSubBlockValue } from '../../hooks/use-sub-block-value'

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
  key?: string
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
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlockId)
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([])
  const [uploadProgress, setUploadProgress] = useState(0)
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFileRecord[]>([])
  const [loadingWorkspaceFiles, setLoadingWorkspaceFiles] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState('')

  const [deletingFiles, setDeletingFiles] = useState<Record<string, boolean>>({})

  const fileInputRef = useRef<HTMLInputElement>(null)

  const { activeWorkflowId } = useWorkflowRegistry()
  const params = useParams()
  const workspaceId = params?.workspaceId as string

  const value = isPreview ? previewValue : storeValue

  const loadWorkspaceFiles = async () => {
    if (!workspaceId || isPreview) return

    try {
      setLoadingWorkspaceFiles(true)
      const response = await fetch(`/api/workspaces/${workspaceId}/files`)
      const data = await response.json()

      if (data.success) {
        setWorkspaceFiles(data.files || [])
      }
    } catch (error) {
      logger.error('Error loading workspace files:', error)
    } finally {
      setLoadingWorkspaceFiles(false)
    }
  }

  const availableWorkspaceFiles = workspaceFiles.filter((workspaceFile) => {
    const existingFiles = Array.isArray(value) ? value : value ? [value] : []
    return !existingFiles.some(
      (existing) =>
        existing.name === workspaceFile.name ||
        existing.path?.includes(workspaceFile.key) ||
        existing.key === workspaceFile.key
    )
  })

  useEffect(() => {
    void loadWorkspaceFiles()
  }, [workspaceId])

  /**
   * Opens file dialog
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
   * Truncate long file names keeping both start and end segments.
   */
  const truncateMiddle = (text: string, start = 28, end = 18) => {
    if (!text) return ''
    if (text.length <= start + end + 3) return text
    return `${text.slice(0, start)}...${text.slice(-end)}`
  }

  /**
   * Handles file upload when new file(s) are selected
   */
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isPreview || disabled) return

    e.stopPropagation()

    const files = e.target.files
    if (!files || files.length === 0) return

    const existingFiles = Array.isArray(value) ? value : value ? [value] : []
    const existingTotalSize = existingFiles.reduce((sum, file) => sum + file.size, 0)

    const maxSizeInBytes = maxSize * 1024 * 1024
    const validFiles: File[] = []
    let totalNewSize = 0

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
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

    const uploading = validFiles.map((file) => ({
      id: `upload-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      name: file.name,
      size: file.size,
    }))

    setUploadingFiles(uploading)
    setUploadProgress(0)

    let progressInterval: NodeJS.Timeout | null = null

    try {
      setUploadError(null)

      progressInterval = setInterval(() => {
        setUploadProgress((prev) => {
          const newProgress = prev + Math.random() * 10
          return newProgress > 90 ? 90 : newProgress
        })
      }, 200)

      const uploadedFiles: UploadedFile[] = []
      const uploadErrors: string[] = []

      for (const file of validFiles) {
        try {
          const formData = new FormData()
          formData.append('file', file)
          formData.append('context', 'workspace')

          if (workspaceId) {
            formData.append('workspaceId', workspaceId)
          }

          const response = await fetch('/api/files/upload', {
            method: 'POST',
            body: formData,
          })

          const data = await response.json()

          if (!response.ok) {
            const errorMessage = data.error || `Failed to upload file: ${response.status}`
            uploadErrors.push(`${file.name}: ${errorMessage}`)

            setUploadError(errorMessage)

            if (data.isDuplicate || response.status === 409) {
              setTimeout(() => setUploadError(null), 5000)
            }
            continue
          }

          if (data.success === false) {
            const errorMessage = data.error || 'Upload failed'
            uploadErrors.push(`${file.name}: ${errorMessage}`)

            setUploadError(errorMessage)

            if (data.isDuplicate) {
              setTimeout(() => setUploadError(null), 5000)
            }
            continue
          }

          uploadedFiles.push({
            name: file.name,
            path: data.file?.url || data.url, // Workspace: data.file.url, Non-workspace: data.url
            key: data.file?.key || data.key, // Storage key for proper file access
            size: file.size,
            type: file.type,
          })
        } catch (error) {
          logger.error(`Error uploading ${file.name}:`, error)
          const errorMessage = error instanceof Error ? error.message : 'Unknown error'
          uploadErrors.push(`${file.name}: ${errorMessage}`)
        }
      }

      if (progressInterval) {
        clearInterval(progressInterval)
        progressInterval = null
      }

      setUploadProgress(100)

      if (uploadedFiles.length > 0) {
        setUploadError(null)

        if (workspaceId) {
          void loadWorkspaceFiles()
        }

        if (uploadedFiles.length === 1) {
          logger.info(`${uploadedFiles[0].name} was uploaded successfully`, activeWorkflowId)
        } else {
          logger.info(
            `Uploaded ${uploadedFiles.length} files successfully: ${uploadedFiles.map((f) => f.name).join(', ')}`,
            activeWorkflowId
          )
        }
      }

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

      if (multiple) {
        const existingFiles = Array.isArray(value) ? value : value ? [value] : []
        const uniqueFiles = new Map()

        existingFiles.forEach((file) => {
          uniqueFiles.set(file.url || file.path, file)
        })

        uploadedFiles.forEach((file) => {
          uniqueFiles.set(file.path, file)
        })

        const newFiles = Array.from(uniqueFiles.values())

        setStoreValue(newFiles)
        useWorkflowStore.getState().triggerUpdate()
      } else {
        setStoreValue(uploadedFiles[0] || null)
        useWorkflowStore.getState().triggerUpdate()
      }
    } catch (error) {
      logger.error(
        error instanceof Error ? error.message : 'Failed to upload file(s)',
        activeWorkflowId
      )
    } finally {
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
   * Handle selecting an existing workspace file
   */
  const handleSelectWorkspaceFile = (fileId: string) => {
    const selectedFile = workspaceFiles.find((f) => f.id === fileId)
    if (!selectedFile) return

    const uploadedFile: UploadedFile = {
      name: selectedFile.name,
      path: selectedFile.path,
      size: selectedFile.size,
      type: selectedFile.type,
    }

    if (multiple) {
      const existingFiles = Array.isArray(value) ? value : value ? [value] : []
      const uniqueFiles = new Map()

      existingFiles.forEach((file) => {
        uniqueFiles.set(file.url || file.path, file)
      })

      uniqueFiles.set(uploadedFile.path, uploadedFile)
      const newFiles = Array.from(uniqueFiles.values())

      setStoreValue(newFiles)
    } else {
      setStoreValue(uploadedFile)
    }

    useWorkflowStore.getState().triggerUpdate()
    logger.info(`Selected workspace file: ${selectedFile.name}`, activeWorkflowId)
  }

  /**
   * Handles deletion of a single file
   */
  const handleRemoveFile = async (file: UploadedFile, e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }

    setDeletingFiles((prev) => ({ ...prev, [file.path || '']: true }))

    try {
      const decodedPath = file.path ? decodeURIComponent(file.path) : ''
      const isWorkspaceFile =
        workspaceId &&
        (decodedPath.includes(`/${workspaceId}/`) || decodedPath.includes(`${workspaceId}/`))

      if (!isWorkspaceFile) {
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
      }

      if (multiple) {
        const filesArray = Array.isArray(value) ? value : value ? [value] : []
        const updatedFiles = filesArray.filter((f) => f.path !== file.path)
        setStoreValue(updatedFiles.length > 0 ? updatedFiles : null)
      } else {
        setStoreValue(null)
      }

      useWorkflowStore.getState().triggerUpdate()
    } catch (error) {
      logger.error(
        error instanceof Error ? error.message : 'Failed to remove file',
        activeWorkflowId
      )
    } finally {
      setDeletingFiles((prev) => {
        const updated = { ...prev }
        delete updated[file.path || '']
        return updated
      })
    }
  }

  const renderFileItem = (file: UploadedFile) => {
    const fileKey = file.path || ''
    const isDeleting = deletingFiles[fileKey]

    return (
      <div
        key={fileKey}
        className='flex items-center justify-between rounded-[4px] border border-[var(--surface-11)] bg-[var(--surface-6)] px-[8px] py-[6px] hover:border-[var(--surface-14)] hover:bg-[var(--surface-9)] dark:bg-[var(--surface-9)] dark:hover:bg-[var(--surface-11)]'
      >
        <div className='flex-1 truncate pr-2 text-sm' title={file.name}>
          <span className='text-[var(--text-primary)]'>{truncateMiddle(file.name)}</span>
          <span className='ml-2 text-[var(--text-muted)]'>({formatFileSize(file.size)})</span>
        </div>
        <Button
          type='button'
          variant='ghost'
          className='h-6 w-6 shrink-0 p-0'
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

  const renderUploadingItem = (file: UploadingFile) => {
    return (
      <div
        key={file.id}
        className='flex items-center justify-between rounded-[4px] border border-[var(--surface-11)] bg-[var(--surface-6)] px-[8px] py-[6px] dark:bg-[var(--surface-9)]'
      >
        <div className='flex-1 truncate pr-2 text-sm'>
          <span className='text-[var(--text-primary)]'>{file.name}</span>
          <span className='ml-2 text-[var(--text-muted)]'>({formatFileSize(file.size)})</span>
        </div>
        <div className='flex h-8 w-8 shrink-0 items-center justify-center'>
          <div className='h-4 w-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent' />
        </div>
      </div>
    )
  }

  const filesArray = Array.isArray(value) ? value : value ? [value] : []
  const hasFiles = filesArray.length > 0
  const isUploading = uploadingFiles.length > 0

  const comboboxOptions = useMemo(
    () => [
      { label: 'Upload New File', value: '__upload_new__' },
      ...availableWorkspaceFiles.map((file) => ({
        label: file.name,
        value: file.id,
      })),
    ],
    [availableWorkspaceFiles]
  )

  const handleComboboxChange = (value: string) => {
    setInputValue(value)

    const isValidOption =
      value === '__upload_new__' || availableWorkspaceFiles.some((file) => file.id === value)

    if (!isValidOption) {
      return
    }

    setInputValue('')

    if (value === '__upload_new__') {
      handleOpenFileDialog({
        preventDefault: () => {},
        stopPropagation: () => {},
      } as React.MouseEvent)
    } else {
      handleSelectWorkspaceFile(value)
    }
  }

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

      {/* Error message */}
      {uploadError && <div className='mb-2 text-red-600 text-sm'>{uploadError}</div>}

      <div>
        {/* File list with consistent spacing */}
        {(hasFiles || isUploading) && (
          <div className='mb-2 space-y-2'>
            {/* Only show files that aren't currently uploading */}
            {filesArray.map((file) => {
              const isCurrentlyUploading = uploadingFiles.some(
                (uploadingFile) => uploadingFile.name === file.name
              )
              return !isCurrentlyUploading && renderFileItem(file)
            })}
            {isUploading && (
              <>
                {uploadingFiles.map(renderUploadingItem)}
                <div className='mt-1'>
                  <Progress
                    value={uploadProgress}
                    className='h-2 w-full'
                    indicatorClassName='bg-foreground'
                  />
                  <div className='mt-1 text-center text-muted-foreground text-xs'>
                    {uploadProgress < 100 ? 'Uploading...' : 'Upload complete!'}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Add More dropdown for multiple files */}
        {hasFiles && multiple && !isUploading && (
          <div>
            <Combobox
              options={comboboxOptions}
              value={inputValue}
              onChange={handleComboboxChange}
              onOpenChange={(open) => {
                if (open) void loadWorkspaceFiles()
              }}
              placeholder={loadingWorkspaceFiles ? 'Loading files...' : '+ Add More'}
              disabled={disabled || loadingWorkspaceFiles}
              editable={true}
              filterOptions={true}
              isLoading={loadingWorkspaceFiles}
            />
          </div>
        )}
      </div>

      {/* Show dropdown selector if no files and not uploading */}
      {!hasFiles && !isUploading && (
        <div className='flex items-center'>
          <Combobox
            options={comboboxOptions}
            value={inputValue}
            onChange={handleComboboxChange}
            onOpenChange={(open) => {
              if (open) void loadWorkspaceFiles()
            }}
            placeholder={loadingWorkspaceFiles ? 'Loading files...' : 'Select or upload file'}
            disabled={disabled || loadingWorkspaceFiles}
            editable={true}
            filterOptions={true}
            isLoading={loadingWorkspaceFiles}
          />
        </div>
      )}
    </div>
  )
}
