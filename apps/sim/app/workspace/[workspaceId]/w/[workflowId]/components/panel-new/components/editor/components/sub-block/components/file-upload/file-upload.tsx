'use client'

import { useRef, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui'
import { Button } from '@/components/ui/button'
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
  // State management - handle both single file and array of files
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlockId)
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([])
  const [uploadProgress, setUploadProgress] = useState(0)
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFileRecord[]>([])
  const [loadingWorkspaceFiles, setLoadingWorkspaceFiles] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [addMoreOpen, setAddMoreOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  // For file deletion status
  const [deletingFiles, setDeletingFiles] = useState<Record<string, boolean>>({})

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Stores
  const { activeWorkflowId } = useWorkflowRegistry()
  const params = useParams()
  const workspaceId = params?.workspaceId as string

  // Use preview value when in preview mode, otherwise use store value
  const value = isPreview ? previewValue : storeValue

  // Load workspace files function
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

  // Filter out already selected files
  const availableWorkspaceFiles = workspaceFiles.filter((workspaceFile) => {
    const existingFiles = Array.isArray(value) ? value : value ? [value] : []
    // Check if this workspace file is already added (match by name or key)
    return !existingFiles.some(
      (existing) =>
        existing.name === workspaceFile.name ||
        existing.path?.includes(workspaceFile.key) ||
        existing.key === workspaceFile.key
    )
  })

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
      setUploadError(null) // Clear previous errors

      // Simulate upload progress
      progressInterval = setInterval(() => {
        setUploadProgress((prev) => {
          const newProgress = prev + Math.random() * 10
          return newProgress > 90 ? 90 : newProgress
        })
      }, 200)

      const uploadedFiles: UploadedFile[] = []
      const uploadErrors: string[] = []

      // Upload each file via server (workspace files need DB records)
      for (const file of validFiles) {
        try {
          // Create FormData for upload
          const formData = new FormData()
          formData.append('file', file)
          formData.append('context', 'workspace')

          // Add workspace ID for workspace-scoped storage
          if (workspaceId) {
            formData.append('workspaceId', workspaceId)
          }

          // Upload the file via server
          const response = await fetch('/api/files/upload', {
            method: 'POST',
            body: formData,
          })

          const data = await response.json()

          // Handle error response
          if (!response.ok) {
            const errorMessage = data.error || `Failed to upload file: ${response.status}`
            uploadErrors.push(`${file.name}: ${errorMessage}`)

            // Set error message with conditional auto-dismiss
            setUploadError(errorMessage)

            // Only auto-dismiss duplicate errors, keep other errors (like storage limits) visible
            if (data.isDuplicate || response.status === 409) {
              setTimeout(() => setUploadError(null), 5000)
            }
            continue
          }

          // Check if response has error even with 200 status
          if (data.success === false) {
            const errorMessage = data.error || 'Upload failed'
            uploadErrors.push(`${file.name}: ${errorMessage}`)

            // Set error message with conditional auto-dismiss
            setUploadError(errorMessage)

            // Only auto-dismiss duplicate errors, keep other errors (like storage limits) visible
            if (data.isDuplicate) {
              setTimeout(() => setUploadError(null), 5000)
            }
            continue
          }

          // Process successful upload - handle both workspace and regular uploads
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

      // Clear progress interval
      if (progressInterval) {
        clearInterval(progressInterval)
        progressInterval = null
      }

      setUploadProgress(100)

      // Send consolidated notification about uploaded files
      if (uploadedFiles.length > 0) {
        setUploadError(null) // Clear error on successful upload

        // Refresh workspace files list to keep dropdown up to date
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
        // Create a map to identify duplicates by url
        const uniqueFiles = new Map()

        // Add existing files to the map
        existingFiles.forEach((file) => {
          uniqueFiles.set(file.url || file.path, file) // Use url, fallback to path for backward compatibility
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
   * Handle selecting an existing workspace file
   */
  const handleSelectWorkspaceFile = (fileId: string) => {
    const selectedFile = workspaceFiles.find((f) => f.id === fileId)
    if (!selectedFile) return

    // Convert workspace file record to uploaded file format
    // Path will be converted to presigned URL during execution if needed
    const uploadedFile: UploadedFile = {
      name: selectedFile.name,
      path: selectedFile.path,
      size: selectedFile.size,
      type: selectedFile.type,
    }

    if (multiple) {
      // For multiple files: Append to existing
      const existingFiles = Array.isArray(value) ? value : value ? [value] : []
      const uniqueFiles = new Map()

      existingFiles.forEach((file) => {
        uniqueFiles.set(file.url || file.path, file)
      })

      uniqueFiles.set(uploadedFile.path, uploadedFile)
      const newFiles = Array.from(uniqueFiles.values())

      setStoreValue(newFiles)
    } else {
      // For single file: Replace
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

    // Mark this file as being deleted
    setDeletingFiles((prev) => ({ ...prev, [file.path || '']: true }))

    try {
      // Check if this is a workspace file (decoded path contains workspaceId pattern)
      const decodedPath = file.path ? decodeURIComponent(file.path) : ''
      const isWorkspaceFile =
        workspaceId &&
        (decodedPath.includes(`/${workspaceId}/`) || decodedPath.includes(`${workspaceId}/`))

      if (!isWorkspaceFile) {
        // Only delete from storage if it's NOT a workspace file
        // Workspace files are permanent and managed through Settings
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

      // Update the UI state (remove from selection)
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
        error instanceof Error ? error.message : 'Failed to remove file',
        activeWorkflowId
      )
    } finally {
      // Remove file from the deleting state
      setDeletingFiles((prev) => {
        const updated = { ...prev }
        delete updated[file.path || '']
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

    // Mark all files as deleting
    const deletingStatus: Record<string, boolean> = {}
    filesToDelete.forEach((file) => {
      deletingStatus[file.path || ''] = true
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
        logger.error(`Failed to delete file ${file.name}:`, error)
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
    const fileKey = file.path || ''
    const isDeleting = deletingFiles[fileKey]

    return (
      <div
        key={fileKey}
        className='flex items-center justify-between rounded border border-border bg-background px-3 py-2'
      >
        <div className='flex-1 truncate pr-2'>
          <div className='truncate font-normal text-sm' title={file.name}>
            {truncateMiddle(file.name)}
          </div>
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

      {/* Error message */}
      {uploadError && <div className='mb-2 text-red-600 text-sm'>{uploadError}</div>}

      <div>
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
            <Popover
              open={addMoreOpen}
              onOpenChange={(open) => {
                setAddMoreOpen(open)
                if (open) void loadWorkspaceFiles()
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  variant='outline'
                  role='combobox'
                  aria-expanded={addMoreOpen}
                  className='relative w-full justify-between'
                  disabled={disabled || loadingWorkspaceFiles}
                >
                  <span className='truncate font-normal'>+ Add More</span>
                  <ChevronDown className='absolute right-3 h-4 w-4 shrink-0 opacity-50' />
                </Button>
              </PopoverTrigger>
              <PopoverContent className='w-[320px] p-0' align='start'>
                <Command>
                  <CommandInput
                    placeholder='Search files...'
                    className='text-foreground placeholder:text-muted-foreground'
                  />
                  <CommandList onWheel={(e) => e.stopPropagation()}>
                    <CommandGroup>
                      <CommandItem
                        value='upload_new'
                        onSelect={() => {
                          setAddMoreOpen(false)
                          handleOpenFileDialog({
                            preventDefault: () => {},
                            stopPropagation: () => {},
                          } as React.MouseEvent)
                        }}
                      >
                        Upload New File
                      </CommandItem>
                    </CommandGroup>
                    <CommandEmpty>
                      {availableWorkspaceFiles.length === 0
                        ? 'No files available.'
                        : 'No files found.'}
                    </CommandEmpty>
                    {availableWorkspaceFiles.length > 0 && (
                      <CommandGroup heading='Workspace Files'>
                        {availableWorkspaceFiles.map((file) => (
                          <CommandItem
                            key={file.id}
                            value={file.name}
                            onSelect={() => {
                              handleSelectWorkspaceFile(file.id)
                              setAddMoreOpen(false)
                            }}
                          >
                            <span className='truncate' title={file.name}>
                              {truncateMiddle(file.name)}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    )}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        )}
      </div>

      {/* Show dropdown selector if no files and not uploading */}
      {!hasFiles && !isUploading && (
        <div className='flex items-center'>
          <Popover
            open={pickerOpen}
            onOpenChange={(open) => {
              setPickerOpen(open)
              if (open) void loadWorkspaceFiles()
            }}
          >
            <PopoverTrigger asChild>
              <Button
                variant='outline'
                role='combobox'
                aria-expanded={pickerOpen}
                className='relative w-full justify-between'
                disabled={disabled || loadingWorkspaceFiles}
              >
                <span className='truncate font-normal'>
                  {loadingWorkspaceFiles ? 'Loading files...' : 'Select or upload file'}
                </span>
                <ChevronDown className='absolute right-3 h-4 w-4 shrink-0 opacity-50' />
              </Button>
            </PopoverTrigger>
            <PopoverContent className='w-[320px] p-0' align='start'>
              <Command>
                <CommandInput
                  placeholder='Search files...'
                  className='text-foreground placeholder:text-muted-foreground'
                />
                <CommandList onWheel={(e) => e.stopPropagation()}>
                  <CommandGroup>
                    <CommandItem
                      value='upload_new'
                      onSelect={() => {
                        setPickerOpen(false)
                        handleOpenFileDialog({
                          preventDefault: () => {},
                          stopPropagation: () => {},
                        } as React.MouseEvent)
                      }}
                    >
                      Upload New File
                    </CommandItem>
                  </CommandGroup>
                  <CommandEmpty>
                    {availableWorkspaceFiles.length === 0
                      ? 'No files available.'
                      : 'No files found.'}
                  </CommandEmpty>
                  {availableWorkspaceFiles.length > 0 && (
                    <CommandGroup heading='Workspace Files'>
                      {availableWorkspaceFiles.map((file) => (
                        <CommandItem
                          key={file.id}
                          value={file.name}
                          onSelect={() => {
                            handleSelectWorkspaceFile(file.id)
                            setPickerOpen(false)
                          }}
                        >
                          <span className='truncate' title={file.name}>
                            {truncateMiddle(file.name)}
                          </span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      )}
    </div>
  )
}
