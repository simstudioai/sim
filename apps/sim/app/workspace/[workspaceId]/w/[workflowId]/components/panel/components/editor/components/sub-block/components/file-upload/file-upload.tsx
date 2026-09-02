'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Combobox, cn } from '@sim/emcn'
import { X } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { randomFloat } from '@sim/utils/random'
import { useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { Progress } from '@/components/ui/progress'
import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import { fileDeleteContract } from '@/lib/api/contracts/storage-transfer'
import { readFolderPaths } from '@/lib/folders/selection'
import { formatFileSize, getExtensionFromMimeType } from '@/lib/uploads/utils/file-utils'
import { containsReference } from '@/lib/workflows/sanitization/references'
import { parseWorkspaceFileFolderDisplayPath } from '@/lib/workspace-files/folder-display-path'
import { isFileInFolderScope } from '@/lib/workspace-files/folder-path-selection'
import { findSelectedWorkspaceFile } from '@/lib/workspace-files/selection'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { getWorkflowSearchLabelHighlight } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/workflow-search-highlight'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useActiveSearchTarget } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/providers/active-search-target-provider'
import {
  useCloudStorageConfigured,
  useUploadWorkspaceFile,
  useWorkspaceFiles,
  workspaceFilesKeys,
} from '@/hooks/queries/workspace-files'
import { getProviderAttachmentMaxBytes } from '@/providers/attachments'
import { getProviderFromModel } from '@/providers/utils'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('FileUpload')

interface FileUploadProps {
  blockId: string
  subBlockId: string
  maxSize?: number // in MB
  acceptedTypes?: string // comma separated MIME types
  multiple?: boolean // whether to allow multiple file uploads
  /**
   * When true, disable new uploads and show a notice if S3/Blob is not configured
   * (providers that need a public HTTPS URL Meta can fetch, e.g. Instagram).
   */
  requiresCloudStorage?: boolean
  isPreview?: boolean
  previewValue?: any | null
  disabled?: boolean
  /**
   * A sibling folder field that narrows what this picker offers, and the switch
   * saying whether that scope descends. See `SubBlockConfig.folderScope`.
   */
  folderScope?: { fieldId: string; manualFieldId?: string; recursiveFieldId?: string }
  /**
   * Controlled value. When `onValueChange` is provided the component reads from
   * this prop and writes through `onValueChange` instead of the subblock store,
   * letting it be embedded where the value lives outside a subblock (e.g. a
   * single field inside the input-format editor).
   */
  value?: UploadedFile | UploadedFile[] | null
  onValueChange?: (value: UploadedFile | UploadedFile[] | null) => void
}

/**
 * Label for a workspace file, prefixed with its folder so two files sharing a
 * name are distinguishable.
 *
 * The stored folder path escapes a slash inside a folder name, so it is decoded
 * into segments rather than split — otherwise a folder named `Q3/Q4` reads as
 * two levels.
 */
function workspaceFileOptionLabel(file: { name: string; folderPath?: string | null }): string {
  if (!file.folderPath) return file.name
  try {
    return `${parseWorkspaceFileFolderDisplayPath(file.folderPath).join(' / ')} / ${file.name}`
  } catch {
    return file.name
  }
}

function byFolderThenName(
  a: { name: string; folderPath?: string | null },
  b: { name: string; folderPath?: string | null }
): number {
  const folderOrder = (a.folderPath ?? '').localeCompare(b.folderPath ?? '')
  return folderOrder !== 0 ? folderOrder : a.name.localeCompare(b.name)
}

/** Uses the shared formatter while preserving exact values below one kilobyte. */
function workspaceFileSizeLabel(bytes: number): string {
  return formatFileSize(bytes, { includeBytes: true })
}

export interface UploadedFile {
  name: string
  path: string
  key?: string
  size: number
  type: string
  /**
   * Canonical workspace file id, present when the file was chosen from the
   * workspace rather than uploaded in place.
   *
   * Carrying it is what makes a chosen file resolvable to exactly one row. A
   * name alone is ambiguous the moment the same one exists in two folders, and
   * the reference resolver then falls back to the oldest match anywhere in the
   * workspace — so dropping the id here turned a precise choice into a guess.
   *
   * Optional, because an upload has no workspace id until it lands.
   */
  id?: string
  /**
   * Folder of a chosen workspace file, as the stored backslash-escaped display
   * path (`a\/b` is one folder named `a/b`). Decode it with
   * `parseWorkspaceFileFolderDisplayPath` — never by splitting on `/`.
   */
  folderPath?: string
}

interface SingleFileSelectorProps {
  file: UploadedFile
  options: Array<{ label: string; value: string; disabled?: boolean }>
  selectedValue: string
  inputValue: string
  onInputChange: (value: string) => void
  onClear: (e: React.MouseEvent) => void
  onOpenChange: (open: boolean) => void
  disabled: boolean
  isLoading: boolean
  formatFileSize: (bytes: number) => string
  truncateMiddle: (text: string, start?: number, end?: number) => string
  isDeleting: boolean
  workflowSearchHighlight?: ReturnType<typeof getWorkflowSearchLabelHighlight>
}

/**
 * Single file selector component that shows the selected file with both
 * a clear button (X) and a chevron to change the selection.
 * Follows the same pattern as SelectorCombobox for consistency.
 */
function SingleFileSelector({
  file,
  options,
  selectedValue,
  inputValue,
  onInputChange,
  onClear,
  onOpenChange,
  disabled,
  isLoading,
  formatFileSize,
  truncateMiddle,
  isDeleting,
  workflowSearchHighlight,
}: SingleFileSelectorProps) {
  const displayLabel = `${truncateMiddle(file.name, 20, 12)} (${workspaceFileSizeLabel(file.size)})`
  const [searchQuery, setSearchQuery] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  // When not editing, always show the file's display label. When editing, show the user's query.
  const comboboxValue = isEditing ? searchQuery : displayLabel

  return (
    <div className='relative w-full'>
      <Combobox
        options={options}
        value={comboboxValue}
        selectedValue={selectedValue}
        onChange={(newValue) => {
          // Check if user selected an option
          const matched = options.find((opt) => opt.value === newValue || opt.label === newValue)
          if (matched) {
            setIsEditing(false)
            setSearchQuery('')
            onInputChange(matched.value)
            return
          }
          // User is typing to search
          setIsEditing(true)
          setSearchQuery(newValue)
        }}
        onOpenChange={(open) => {
          if (!open) {
            setIsEditing(false)
            setSearchQuery('')
          }
          onOpenChange(open)
        }}
        placeholder={isLoading ? 'Loading files...' : 'Select or upload file'}
        disabled={disabled || isDeleting}
        editable={true}
        filterOptions={isEditing}
        isLoading={isLoading}
        inputProps={{
          className: 'pr-[60px]',
        }}
        overlayContent={
          workflowSearchHighlight ? (
            <span className='block truncate'>
              {formatDisplayText(comboboxValue, { workflowSearchHighlight })}
            </span>
          ) : undefined
        }
      />
      <Button
        type='button'
        variant='ghost'
        className='-translate-y-1/2 absolute top-1/2 right-[28px] z-10 size-6 p-0'
        onClick={onClear}
        disabled={isDeleting}
      >
        {isDeleting ? (
          <div className='size-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent' />
        ) : (
          <X className='size-4 opacity-50 hover-hover:opacity-100' />
        )}
      </Button>
    </div>
  )
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
  requiresCloudStorage = false,
  isPreview = false,
  previewValue,
  disabled = false,
  folderScope,
  value: controlledValue,
  onValueChange,
}: FileUploadProps) {
  const activeSearchTarget = useActiveSearchTarget()
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlockId)
  const isControlled = onValueChange !== undefined

  /**
   * Persists a new value. In controlled mode the caller owns persistence; in
   * store mode we write through the subblock store and notify collaborators.
   */
  const commitValue = useCallback(
    (next: UploadedFile | UploadedFile[] | null) => {
      if (isControlled) {
        onValueChange(next)
        return
      }
      setStoreValue(next)
      useWorkflowStore.getState().triggerUpdate()
    },
    [isControlled, onValueChange, setStoreValue]
  )
  const [modelValue] = useSubBlockValue(blockId, 'model')
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([])
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState('')

  const [deletingFiles, setDeletingFiles] = useState<Record<string, boolean>>({})

  const fileInputRef = useRef<HTMLInputElement>(null)

  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const params = useParams()
  const workspaceId = params?.workspaceId as string

  const {
    data: workspaceFiles = [],
    isLoading: loadingWorkspaceFiles,
    isPlaceholderData: workspaceFilesArePlaceholderData,
    refetch: refetchWorkspaceFiles,
  } = useWorkspaceFiles(isPreview ? '' : workspaceId)

  const { data: cloudConfigured, isLoading: loadingCloudStatus } = useCloudStorageConfigured(
    requiresCloudStorage && !isPreview
  )
  // Fail closed: block until the status check succeeds with true. Loading, errors, and
  // explicit false all leave cloudConfigured !== true (avoid Meta-unfetchable files).
  const cloudUploadBlocked = requiresCloudStorage && cloudConfigured !== true
  const showCloudStorageWarning =
    requiresCloudStorage && !loadingCloudStatus && cloudConfigured !== true

  const uploadFileMutation = useUploadWorkspaceFile()
  const queryClient = useQueryClient()

  const value = isControlled ? controlledValue : isPreview ? previewValue : storeValue
  const filesArray = useMemo<UploadedFile[]>(
    () => (Array.isArray(value) ? value : value ? [value] : []),
    [value]
  )

  const maxSizeInBytes = useMemo(() => {
    const fallback = maxSize * 1024 * 1024
    if (typeof modelValue !== 'string' || !modelValue) return fallback
    try {
      return Math.max(fallback, getProviderAttachmentMaxBytes(getProviderFromModel(modelValue)))
    } catch {
      return fallback
    }
  }, [modelValue, maxSize])
  const maxSizeLabel = `${Math.round(maxSizeInBytes / (1024 * 1024))}MB`

  /**
   * Checks if a file's MIME type matches the accepted types
   * Supports exact matches, wildcard patterns (e.g., 'image/*'), and '*' for all types
   */
  const isFileTypeAccepted = (fileType: string | undefined, accepted: string): boolean => {
    if (accepted === '*') return true
    if (!fileType) return false

    const acceptedList = accepted.split(',').map((t) => t.trim().toLowerCase())
    const normalizedFileType = fileType.toLowerCase()

    return acceptedList.some((acceptedType) => {
      if (acceptedType === normalizedFileType) return true

      if (acceptedType.endsWith('/*')) {
        const typePrefix = acceptedType.slice(0, -1) // 'image/' from 'image/*'
        return normalizedFileType.startsWith(typePrefix)
      }

      if (acceptedType.startsWith('.')) {
        const extension = acceptedType.slice(1).toLowerCase()
        const fileExtension = getExtensionFromMimeType(normalizedFileType)
        if (fileExtension === extension) return true
        return normalizedFileType.endsWith(`/${extension}`)
      }

      return false
    })
  }

  /*
   * A sibling folder field narrows what this picker offers. Choosing a folder
   * means the run only touches that folder, so listing files from anywhere else
   * would let a selection be built that the operation then ignores — the picker
   * has to describe the same set the run will read.
   *
   * Falling back to this control's own id keeps the hook call unconditional for
   * a picker with no folder scope; its own value is never a folder path, so the
   * scope reads as absent.
   */
  const [folderScopeValue] = useSubBlockValue<unknown>(blockId, folderScope?.fieldId ?? subBlockId)
  /*
   * Through `readFolderPaths` rather than a string check so current arrays and
   * legacy serialized arrays resolve to the same canonical scopes.
   */
  const [manualFolderScopeValue] = useSubBlockValue<unknown>(
    blockId,
    folderScope?.manualFieldId ?? folderScope?.fieldId ?? subBlockId
  )
  const folderScopePaths = useMemo(() => {
    if (!folderScope) return []
    const selectedPaths = readFolderPaths(folderScopeValue)
    return selectedPaths.length > 0 ? selectedPaths : readFolderPaths(manualFolderScopeValue)
  }, [folderScope, folderScopeValue, manualFolderScopeValue])

  const [folderScopeRecursive] = useSubBlockValue<unknown>(
    blockId,
    folderScope?.recursiveFieldId ?? subBlockId
  )
  /*
   * Absent means "descend", matching the switch's own default, so an unset or
   * not-yet-rendered value never narrows the options behind the user's back.
   */
  const folderScopeIncludesSubfolders =
    !folderScope?.recursiveFieldId ||
    folderScopeRecursive === undefined ||
    folderScopeRecursive === null ||
    folderScopeRecursive === '' ||
    folderScopeRecursive === true ||
    folderScopeRecursive === 'true'

  const hasConcreteFolderScope =
    folderScopePaths.length > 0 && folderScopePaths.every((path) => !containsReference(path))
  const scopedWorkspaceFiles = useMemo(
    () =>
      hasConcreteFolderScope
        ? workspaceFiles.filter((workspaceFile) =>
            folderScopePaths.some((folderScopePath) =>
              isFileInFolderScope(workspaceFile.folderPath, folderScopePath, {
                includeSubfolders: folderScopeIncludesSubfolders,
              })
            )
          )
        : workspaceFiles,
    [folderScopeIncludesSubfolders, folderScopePaths, hasConcreteFolderScope, workspaceFiles]
  )

  const selectedWorkspaceFileIds = useMemo(
    () =>
      new Set(
        filesArray.flatMap((file) => {
          const match = findSelectedWorkspaceFile(file, workspaceFiles)
          return match ? [match.id] : []
        })
      ),
    [filesArray, workspaceFiles]
  )

  useEffect(() => {
    if (
      !folderScope ||
      !hasConcreteFolderScope ||
      loadingWorkspaceFiles ||
      workspaceFilesArePlaceholderData ||
      isPreview
    ) {
      return
    }

    const scopedIds = new Set(scopedWorkspaceFiles.map((file) => file.id))
    const nextFiles = filesArray.filter((file) => {
      const workspaceFile = findSelectedWorkspaceFile(file, workspaceFiles)
      return !workspaceFile || scopedIds.has(workspaceFile.id)
    })
    if (nextFiles.length === filesArray.length) return

    commitValue(multiple ? (nextFiles.length > 0 ? nextFiles : null) : (nextFiles[0] ?? null))
  }, [
    commitValue,
    filesArray,
    folderScope,
    hasConcreteFolderScope,
    isPreview,
    loadingWorkspaceFiles,
    multiple,
    scopedWorkspaceFiles,
    workspaceFiles,
    workspaceFilesArePlaceholderData,
  ])

  const availableWorkspaceFiles = useMemo(
    () =>
      scopedWorkspaceFiles.filter(
        (workspaceFile) => !selectedWorkspaceFileIds.has(workspaceFile.id)
      ),
    [scopedWorkspaceFiles, selectedWorkspaceFileIds]
  )

  /**
   * Opens file dialog
   */
  const handleOpenFileDialog = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (disabled || cloudUploadBlocked) return

    if (fileInputRef.current) {
      fileInputRef.current.value = ''
      fileInputRef.current.click()
    }
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
    if (isPreview || disabled || cloudUploadBlocked) return

    e.stopPropagation()

    const files = e.target.files
    if (!files || files.length === 0) return

    const validFiles: File[] = []
    let sizeExceededFile: string | null = null

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (file.size > maxSizeInBytes) {
        const errorMessage = `${file.name} exceeds the maximum file size of ${maxSizeLabel}`
        logger.error(errorMessage, activeWorkflowId)
        if (!sizeExceededFile) {
          sizeExceededFile = errorMessage
        }
      } else {
        validFiles.push(file)
      }
    }

    if (validFiles.length === 0) {
      if (sizeExceededFile) {
        setUploadError(sizeExceededFile)
        setTimeout(() => setUploadError(null), 5000)
      }
      return
    }

    const uploading = validFiles.map((file) => ({
      id: `upload-${Date.now()}-${generateShortId(7)}`,
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
          const newProgress = prev + randomFloat() * 10
          return newProgress > 90 ? 90 : newProgress
        })
      }, 200)

      const uploadedFiles: UploadedFile[] = []
      const uploadErrors: string[] = []

      for (const file of validFiles) {
        try {
          const data = await uploadFileMutation.mutateAsync({
            workspaceId,
            file,
            skipToast: true,
            skipInvalidation: true,
          })

          uploadedFiles.push({
            name: data.file.name,
            path: data.file.url,
            key: data.file.key,
            size: data.file.size,
            type: data.file.type,
          })
        } catch (error) {
          logger.error(`Error uploading ${file.name}:`, error)
          const errorMessage = getErrorMessage(error, 'Unknown error')
          uploadErrors.push(`${file.name}: ${errorMessage}`)
          setUploadError(errorMessage)
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
          void refetchWorkspaceFiles()
          void queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.storageInfo() })
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

        commitValue(newFiles)
      } else {
        commitValue(uploadedFiles[0] || null)
      }
    } catch (error) {
      logger.error(getErrorMessage(error, 'Failed to upload file(s)'), activeWorkflowId)
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
    if (cloudUploadBlocked) return

    const selectedFile = workspaceFiles.find((f) => f.id === fileId)
    if (!selectedFile) return

    const uploadedFile: UploadedFile = {
      name: selectedFile.name,
      path: selectedFile.path,
      key: selectedFile.key,
      size: selectedFile.size,
      type: selectedFile.type,
      id: selectedFile.id,
      folderPath: selectedFile.folderPath ?? undefined,
    }

    if (multiple) {
      const existingFiles = Array.isArray(value) ? value : value ? [value] : []
      const uniqueFiles = new Map()

      existingFiles.forEach((file) => {
        uniqueFiles.set(file.url || file.path, file)
      })

      uniqueFiles.set(uploadedFile.path, uploadedFile)
      const newFiles = Array.from(uniqueFiles.values())

      commitValue(newFiles)
    } else {
      commitValue(uploadedFile)
    }

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
        try {
          await requestJson(fileDeleteContract, {
            body: { filePath: file.path },
          })
        } catch (err) {
          if (isApiClientError(err)) {
            throw new Error(err.message || `Failed to delete file: ${err.status}`)
          }
          throw err
        }
      }

      if (multiple) {
        const filesArray = Array.isArray(value) ? value : value ? [value] : []
        const updatedFiles = filesArray.filter((f) => f.path !== file.path)
        commitValue(updatedFiles.length > 0 ? updatedFiles : null)
      } else {
        commitValue(null)
      }
    } catch (error) {
      logger.error(getErrorMessage(error, 'Failed to remove file'), activeWorkflowId)
    } finally {
      setDeletingFiles((prev) => {
        const updated = { ...prev }
        delete updated[file.path || '']
        return updated
      })
    }
  }

  const renderFileItem = (file: UploadedFile, index: number) => {
    const fileKey = file.path || ''
    const isDeleting = deletingFiles[fileKey]
    const displayName = truncateMiddle(file.name)
    const workflowSearchHighlight = getWorkflowSearchLabelHighlight({
      activeSearchTarget,
      blockId,
      subBlockId,
      valuePath: [index, 'name'],
      label: displayName,
    })

    return (
      <div
        key={fileKey}
        className='relative rounded-sm border border-[var(--border-1)] bg-[var(--surface-5)] px-2 py-1.5 hover-hover:bg-[var(--surface-active)] dark:bg-[var(--surface-5)]'
      >
        <div className='truncate pr-6 text-sm' title={file.name}>
          <span className='text-[var(--text-primary)]'>
            {formatDisplayText(displayName, { workflowSearchHighlight })}
          </span>
          <span className='ml-2 text-[var(--text-muted)]'>
            ({workspaceFileSizeLabel(file.size)})
          </span>
        </div>
        <Button
          type='button'
          variant='ghost'
          className='-translate-y-1/2 absolute top-1/2 right-[4px] size-6 p-0'
          onClick={(e) => handleRemoveFile(file, e)}
          disabled={isDeleting}
        >
          {isDeleting ? (
            <div className='size-4 animate-spin rounded-full border-[1.5px] border-current border-t-transparent' />
          ) : (
            <X className='size-4 opacity-50' />
          )}
        </Button>
      </div>
    )
  }

  const renderUploadingItem = (file: UploadingFile) => {
    return (
      <div
        key={file.id}
        className='flex items-center justify-between rounded-sm border border-[var(--border-1)] bg-[var(--surface-5)] px-2 py-1.5 dark:bg-[var(--surface-5)]'
      >
        <div className='flex-1 truncate pr-2 text-sm'>
          <span className='text-[var(--text-primary)]'>{file.name}</span>
          <span className='ml-2 text-[var(--text-muted)]'>
            ({workspaceFileSizeLabel(file.size)})
          </span>
        </div>
        <div className='flex size-5 shrink-0 items-center justify-center'>
          <div className='size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent' />
        </div>
      </div>
    )
  }

  const hasFiles = filesArray.length > 0
  const isUploading = uploadingFiles.length > 0

  // Options for multiple file mode (filters out already selected files)
  const comboboxOptions = useMemo(
    () => [
      { label: 'Upload New File', value: '__upload_new__', disabled: cloudUploadBlocked },
      ...[...availableWorkspaceFiles].sort(byFolderThenName).map((file) => {
        const isAccepted =
          !acceptedTypes || acceptedTypes === '*' || isFileTypeAccepted(file.type, acceptedTypes)
        return {
          label: workspaceFileOptionLabel(file),
          value: file.id,
          // When cloud is required, local workspace files are also unpublishable.
          disabled: !isAccepted || cloudUploadBlocked,
        }
      }),
    ],
    [availableWorkspaceFiles, acceptedTypes, cloudUploadBlocked]
  )

  // Options for single file mode (includes all files, selected one will be highlighted)
  const singleFileOptions = useMemo(
    () => [
      { label: 'Upload New File', value: '__upload_new__', disabled: cloudUploadBlocked },
      ...[...scopedWorkspaceFiles].sort(byFolderThenName).map((file) => {
        const isAccepted =
          !acceptedTypes || acceptedTypes === '*' || isFileTypeAccepted(file.type, acceptedTypes)
        return {
          label: workspaceFileOptionLabel(file),
          value: file.id,
          disabled: !isAccepted || cloudUploadBlocked,
        }
      }),
    ],
    [scopedWorkspaceFiles, acceptedTypes, cloudUploadBlocked]
  )

  // Find the selected file's workspace ID for highlighting in single file mode
  const selectedFileId = useMemo(() => {
    if (!hasFiles || multiple) return ''
    const currentFile = filesArray[0]
    if (!currentFile) return ''
    const matchedWorkspaceFile = findSelectedWorkspaceFile(currentFile, workspaceFiles)
    return matchedWorkspaceFile?.id || ''
  }, [filesArray, workspaceFiles, hasFiles, multiple])

  const handleComboboxChange = (value: string) => {
    setInputValue(value)

    // Look in full workspaceFiles list (not filtered) to allow re-selecting same file in single mode
    const selectedFile = workspaceFiles.find((file) => file.id === value)
    const isAcceptedType =
      selectedFile &&
      (!acceptedTypes ||
        acceptedTypes === '*' ||
        isFileTypeAccepted(selectedFile.type, acceptedTypes))

    const isValidOption = value === '__upload_new__' || isAcceptedType

    if (!isValidOption) {
      return
    }

    setInputValue('')

    if (value === '__upload_new__') {
      if (cloudUploadBlocked) return
      handleOpenFileDialog({
        preventDefault: () => {},
        stopPropagation: () => {},
      } as React.MouseEvent)
    } else {
      handleSelectWorkspaceFile(value)
    }
  }

  return (
    <div role='presentation' className='w-full' onClick={(e) => e.stopPropagation()}>
      <input
        type='file'
        ref={fileInputRef}
        onChange={handleFileChange}
        style={{ display: 'none' }}
        accept={acceptedTypes}
        multiple={multiple}
        data-testid='file-input-element'
      />

      {showCloudStorageWarning && (
        <div className='mb-2 text-muted-foreground text-xs'>
          Cloud storage (S3 or Blob) is required for file uploads. Configure S3_BUCKET_NAME and
          AWS_REGION, or Azure Blob env vars.
        </div>
      )}

      {/* Error message */}
      {uploadError && <div className='mb-2 text-red-600 text-sm'>{uploadError}</div>}

      {/* File list with consistent spacing - only show for multiple mode or when uploading */}
      {((hasFiles && multiple) || isUploading) && (
        <div className={cn('space-y-2', multiple && 'mb-2')}>
          {/* Only show files that aren't currently uploading (for multiple mode only) */}
          {multiple &&
            filesArray.map((file, index) => {
              const isCurrentlyUploading = uploadingFiles.some(
                (uploadingFile) => uploadingFile.name === file.name
              )
              return !isCurrentlyUploading && renderFileItem(file, index)
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
        <Combobox
          options={comboboxOptions}
          value={inputValue}
          onChange={handleComboboxChange}
          onOpenChange={(open) => {
            if (open) void refetchWorkspaceFiles()
          }}
          placeholder={loadingWorkspaceFiles ? 'Loading files...' : '+ Add More'}
          disabled={disabled || loadingWorkspaceFiles}
          editable={true}
          filterOptions={true}
          isLoading={loadingWorkspaceFiles}
        />
      )}

      {/* Single file mode with file selected: show combobox-style UI with X and chevron */}
      {hasFiles && !multiple && !isUploading && (
        <SingleFileSelector
          file={filesArray[0]}
          options={singleFileOptions}
          selectedValue={selectedFileId}
          inputValue={inputValue}
          onInputChange={handleComboboxChange}
          onClear={(e) => handleRemoveFile(filesArray[0], e)}
          onOpenChange={(open) => {
            if (open) void refetchWorkspaceFiles()
          }}
          disabled={disabled}
          isLoading={loadingWorkspaceFiles}
          formatFileSize={formatFileSize}
          truncateMiddle={truncateMiddle}
          isDeleting={deletingFiles[filesArray[0]?.path || '']}
          workflowSearchHighlight={getWorkflowSearchLabelHighlight({
            activeSearchTarget,
            blockId,
            subBlockId,
            valuePath: [],
            label: `${truncateMiddle(filesArray[0].name, 20, 12)} (${workspaceFileSizeLabel(filesArray[0].size)})`,
          })}
        />
      )}

      {/* Show dropdown selector if no files and not uploading */}
      {!hasFiles && !isUploading && (
        <Combobox
          options={comboboxOptions}
          value={inputValue}
          onChange={handleComboboxChange}
          onOpenChange={(open) => {
            if (open) void refetchWorkspaceFiles()
          }}
          placeholder={loadingWorkspaceFiles ? 'Loading files...' : 'Select or upload file'}
          disabled={disabled || loadingWorkspaceFiles}
          editable={true}
          filterOptions={true}
          isLoading={loadingWorkspaceFiles}
        />
      )}
    </div>
  )
}
