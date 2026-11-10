'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useFeedbackExpiry } from '@sim/emcn/feedback/use-feedback-expiry'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { useQueryClient } from '@tanstack/react-query'
import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import { fileDeleteContract } from '@/lib/api/contracts/storage-transfer'
import { ROOT_FOLDER_PATH } from '@/lib/folders/paths'
import { readFolderPaths } from '@/lib/folders/selection'
import { getExtensionFromMimeType } from '@/lib/uploads/utils/file'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state/constants'
import { containsReference } from '@/lib/workflows/sanitization/references'
import { isFileInFolderScope } from '@/lib/workspace-files/folder-path-selection'
import { findSelectedWorkspaceFile } from '@/lib/workspace-files/selection'
import { invalidateWorkspaceFileReads } from '@/hooks/queries/utils/workspace-file-cache'
import {
  workspaceFileListParams,
  workspaceFilesKeys,
} from '@/hooks/queries/utils/workspace-file-keys'
import {
  distinctFiles,
  useCloudStorageConfigured,
  useUploadWorkspaceFile,
  useWorkspaceFileList,
  useWorkspaceFileSelectionCandidates,
} from '@/hooks/queries/workspace-files'
import { useSearchFilterValue } from '@/hooks/use-search-filter-value'
import {
  useActiveCanonicalSubBlockValue,
  useResourceFolders,
  useSubBlockValue,
  useWorkflowRegistry,
  useWorkflowScope,
  useWorkflowStore,
} from '@/platform/lib/data/workflow-editor'
import { workspaceFileOptionLabel } from '@/platform/lib/data/workflow-editor/uploads/file-labels'
import { compareText } from '@/platform/shared/time'
import { getProviderFileAttachment, getProviderFromModel } from '@/providers/models'

const logger = createLogger('PlatformFileUpload')

const PICKER_PAGE_SIZE = 100
const BYTES_PER_MEGABYTE = 1024 * 1024
/** How long a finished upload's progress stays on screen before the rows give way to the picker. */
const UPLOAD_SETTLE_MS = 500
const NOT_ACCEPTED_REASON = 'This file type is not accepted here'
const CLOUD_REQUIRED_REASON = 'Requires cloud storage (S3 or Blob)'

type WorkspaceFile = ReturnType<typeof distinctFiles>[number]

const EMPTY_PICKER_FILES: WorkspaceFile[] = []

/** A file a file-upload sub-block holds: uploaded in place or chosen from the workspace. */
interface UploadedFile {
  name: string
  path: string
  key?: string
  size: number
  type: string
  /**
   * Canonical workspace file id, present when the file was chosen from the workspace or uploaded
   * there. A name alone is ambiguous once the same one exists in two folders, so carrying the id is
   * what resolves a choice to exactly one row.
   */
  id?: string
  /**
   * Folder of a chosen workspace file, as the stored backslash-escaped display path (`a\/b` is one
   * folder named `a/b`). Decode it with the folder display-path parser, never by splitting on `/`.
   */
  folderPath?: string
}

/** What a file-upload sub-block stores: one file, several, or none. */
export type FileUploadValue = UploadedFile | UploadedFile[] | null

/** Older stored values may name the file's location `url` rather than `path`. */
type StoredFile = UploadedFile & { url?: string }

/** A file on its way up, shown in place of the picker until its upload settles. */
interface UploadingFile {
  id: string
  name: string
  size: number
}

/** A message beneath the control; a transient one clears itself after the shared dwell. */
interface FileUploadError {
  message: string
  transient: boolean
}

/** One workspace file the picker offers. */
interface FilePickerOption {
  value: string
  label: string
  disabled?: boolean
  disabledReason?: string
}

/** Options for {@link useFileUpload}, as the file-upload sub-block receives them. */
interface FileUploadOptions {
  blockId: string
  subBlockId: string
  /** Comma-separated MIME types, wildcards (`image/*`) or extensions (`.pdf`); `*` accepts all. */
  acceptedTypes: string
  multiple: boolean
  /** In megabytes. A model sub-block whose provider accepts larger attachments raises it. */
  maxSize: number
  /** Blocks new uploads unless S3 or Blob storage is configured. */
  requiresCloudStorage: boolean
  folderScope?: { fieldId: string; recursiveFieldId?: string }
  isPreview: boolean
  previewValue?: unknown
  disabled: boolean
  /** Controlled value: with `onValueChange`, reads and writes go here instead of the store. */
  value?: FileUploadValue
  onValueChange?: (value: FileUploadValue) => void
}

/** The file picker's state, shaped for a searchable select with server search and paging. */
export interface FilePickerState {
  options: FilePickerOption[]
  /** The selected workspace file in single mode, so the picker can mark it. */
  selectedFileId: string | null
  query: string
  onQueryChange: (query: string) => void
  onOpenChange: (open: boolean) => void
  hasMore: boolean
  loading: boolean
  error?: string
  loadMore: () => void
  retry: () => void
}

/** Everything the file-upload view renders and the actions it calls. */
interface FileUploadState {
  files: UploadedFile[]
  uploadingFiles: UploadingFile[]
  /** 0–100 across every file of the current upload. */
  uploadProgress: number
  uploadError: FileUploadError | null
  deletingPaths: ReadonlySet<string>
  showCloudStorageWarning: boolean
  showFolderScopeNotice: boolean
  /** New uploads are unavailable: preview, disabled, cloud storage or folder scope. */
  uploadBlocked: boolean
  picker: FilePickerState
  uploadFiles: (files: readonly File[]) => Promise<void>
  selectFile: (fileId: string) => void
  removeFile: (file: UploadedFile) => Promise<void>
}

function isStoredFile(entry: unknown): entry is StoredFile {
  return (
    typeof entry === 'object' && entry !== null && 'name' in entry && typeof entry.name === 'string'
  )
}

function toStoredFiles(value: unknown): StoredFile[] {
  if (Array.isArray(value)) return value.filter(isStoredFile)
  return isStoredFile(value) ? [value] : []
}

/** Where a stored file lives, which de-duplicates a multiple-file value. */
function fileLocation(file: StoredFile): string {
  return file.url || file.path
}

/**
 * Whether a MIME type matches the accepted list: exact types, `type/*` wildcards, `.ext`
 * extensions (by the type's known extension or its subtype), and `*` for everything.
 */
function isFileTypeAccepted(fileType: string | undefined, accepted: string): boolean {
  if (!accepted || accepted === '*') return true
  if (!fileType) return false
  const normalizedFileType = fileType.toLowerCase()
  return accepted
    .split(',')
    .map((type) => type.trim().toLowerCase())
    .some((acceptedType) => {
      if (acceptedType === normalizedFileType) return true
      if (acceptedType.endsWith('/*'))
        return normalizedFileType.startsWith(acceptedType.slice(0, -1))
      if (acceptedType.startsWith('.')) {
        const extension = acceptedType.slice(1)
        if (getExtensionFromMimeType(normalizedFileType) === extension) return true
        return normalizedFileType.endsWith(`/${extension}`)
      }
      return false
    })
}

function byFolderThenName(a: WorkspaceFile, b: WorkspaceFile): number {
  const folderOrder = compareText(a.folderPath ?? '', b.folderPath ?? '')
  return folderOrder !== 0 ? folderOrder : compareText(a.name, b.name)
}

/** The larger of the sub-block's own ceiling and what the block's chosen model accepts. */
function maxUploadBytes(maxSizeMb: number, model: unknown): number {
  const fallback = maxSizeMb * BYTES_PER_MEGABYTE
  if (typeof model !== 'string' || !model) return fallback
  try {
    return Math.max(fallback, getProviderFileAttachment(getProviderFromModel(model)).maxBytes)
  } catch {
    return fallback
  }
}

/** Absent means "descend", matching the switch's own default, so an unset value never narrows. */
function scopeIncludesSubfolders(recursiveFieldId: string | undefined, value: unknown): boolean {
  return (
    !recursiveFieldId ||
    value === undefined ||
    value === null ||
    value === '' ||
    value === true ||
    value === 'true'
  )
}

/**
 * The file-upload sub-block's behavior, ported from the legacy editor: uploads into workspace
 * storage (into the scoped folder when one is chosen), picks existing workspace files a page at a
 * time with server search, honors accepted types, the size ceiling, the cloud-storage requirement
 * and a sibling folder scope, and removes files (deleting an in-place upload from storage).
 */
export function useFileUpload({
  blockId,
  subBlockId,
  acceptedTypes,
  multiple,
  maxSize,
  requiresCloudStorage,
  folderScope,
  isPreview,
  previewValue,
  disabled,
  value: controlledValue,
  onValueChange,
}: FileUploadOptions): FileUploadState {
  const [storeValue, setStoreValue] = useSubBlockValue<FileUploadValue>(blockId, subBlockId)
  const [modelValue] = useSubBlockValue<unknown>(blockId, 'model')
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const { workspaceId } = useWorkflowScope()
  const queryClient = useQueryClient()
  const uploadFileMutation = useUploadWorkspaceFile()
  const isControlled = onValueChange !== undefined

  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([])
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadError, setUploadError] = useState<FileUploadError | null>(null)
  const [deletingPaths, setDeletingPaths] = useState<ReadonlySet<string>>(() => new Set())
  const [query, setQuery] = useState('')

  useFeedbackExpiry(uploadError?.transient ? uploadError : null, () => setUploadError(null))

  /** In controlled mode the caller persists; otherwise the store does, and collaborators hear it. */
  const commitValue = useCallback(
    (next: FileUploadValue) => {
      if (onValueChange) {
        onValueChange(next)
        return
      }
      setStoreValue(next)
      useWorkflowStore.getState().triggerUpdate()
    },
    [onValueChange, setStoreValue]
  )

  const value: unknown = isControlled ? controlledValue : isPreview ? previewValue : storeValue
  const files = useMemo(() => toStoredFiles(value), [value])

  const { data: cloudConfigured, isLoading: loadingCloudStatus } = useCloudStorageConfigured(
    requiresCloudStorage && !isPreview
  )
  // Fails closed: loading, an error and an explicit false all block, so no file Meta cannot fetch.
  const cloudUploadBlocked = requiresCloudStorage && cloudConfigured !== true
  const showCloudStorageWarning =
    requiresCloudStorage && !loadingCloudStatus && cloudConfigured !== true

  const maxSizeInBytes = maxUploadBytes(maxSize, modelValue)
  const maxSizeLabel = `${Math.round(maxSizeInBytes / BYTES_PER_MEGABYTE)}MB`

  /*
   * A sibling folder field narrows what this picker offers, so the picker describes the same set
   * the run reads. Falling back to this control's own id keeps the hook call unconditional; its own
   * value is never a folder path, so the scope reads as absent.
   */
  const folderScopeValue = useActiveCanonicalSubBlockValue<unknown>(
    blockId,
    folderScope?.fieldId ?? subBlockId
  )
  const folderScopePaths = useMemo(
    () => (folderScope ? readFolderPaths(folderScopeValue) : []),
    [folderScope, folderScopeValue]
  )
  const [folderScopeRecursive] = useSubBlockValue<unknown>(
    blockId,
    folderScope?.recursiveFieldId ?? subBlockId
  )
  const includeSubfolders = scopeIncludesSubfolders(
    folderScope?.recursiveFieldId,
    folderScopeRecursive
  )
  const hasConcreteFolderScope =
    folderScopePaths.length > 0 && folderScopePaths.every((path) => !containsReference(path))
  const {
    byPath: folderByPath,
    isLoading: loadingFolderScope,
    isPlaceholderData: folderScopeIsPlaceholderData,
    error: folderScopeError,
  } = useResourceFolders(folderScope && !isPreview ? workspaceId : undefined, 'file')

  /** `null` uploads to the root, `undefined` means no single folder can take the upload. */
  const uploadTargetFolderId = useMemo<string | null | undefined>(() => {
    if (!folderScope || folderScopePaths.length === 0) return null
    if (!hasConcreteFolderScope || folderScopePaths.length !== 1) return undefined
    if (folderScopePaths[0] === ROOT_FOLDER_PATH) return null
    if (loadingFolderScope || folderScopeIsPlaceholderData || folderScopeError) return undefined
    return folderByPath.get(folderScopePaths[0])?.id
  }, [
    folderByPath,
    folderScope,
    folderScopeError,
    folderScopeIsPlaceholderData,
    folderScopePaths,
    hasConcreteFolderScope,
    loadingFolderScope,
  ])
  const folderScopeUploadBlocked = uploadTargetFolderId === undefined

  /*
   * A page at a time: with a typed query, the files whose names match it; without one, the most
   * recently updated. A single concrete folder scope is applied by the server (descending when the
   * scope does); any other scope is applied to the page here, which keeps it correct but sparser.
   */
  const pickerQuery = useSearchFilterValue(query, SEARCH_DEBOUNCE_MS).trim()
  const scopeFolderId =
    hasConcreteFolderScope && folderScopePaths.length === 1
      ? folderScopePaths[0] === ROOT_FOLDER_PATH
        ? null
        : folderByPath.get(folderScopePaths[0])?.id
      : undefined
  const pickerList = useWorkspaceFileList(
    isPreview ? '' : workspaceId,
    workspaceFileListParams({
      folderId: scopeFolderId,
      recursive: includeSubfolders,
      q: pickerQuery,
      sortBy: pickerQuery ? 'name' : 'updatedAt',
      sortOrder: pickerQuery ? 'asc' : 'desc',
      limit: PICKER_PAGE_SIZE,
    })
  )
  const pickerFiles = pickerList.data?.files ?? EMPTY_PICKER_FILES

  const isInFolderScope = useCallback(
    (folderPath: string | null | undefined) =>
      folderScopePaths.some((scopePath) =>
        isFileInFolderScope(folderPath, scopePath, { includeSubfolders })
      ),
    [includeSubfolders, folderScopePaths]
  )
  const scopedWorkspaceFiles = useMemo(
    () =>
      hasConcreteFolderScope
        ? pickerFiles.filter((workspaceFile) => isInFolderScope(workspaceFile.folderPath))
        : pickerFiles,
    [hasConcreteFolderScope, isInFolderScope, pickerFiles]
  )

  /** The selected files, resolved on their own: they need not be on the page the picker shows. */
  const selections = useWorkspaceFileSelectionCandidates(isPreview ? '' : workspaceId, files)
  const workspaceFiles = useMemo(
    () => distinctFiles([selections.candidates, pickerFiles]),
    [selections.candidates, pickerFiles]
  )
  const selectedWorkspaceFileIds = useMemo(
    () =>
      new Set(
        files.flatMap((file) => {
          const match = findSelectedWorkspaceFile(file, workspaceFiles)
          return match ? [match.id] : []
        })
      ),
    [files, workspaceFiles]
  )

  /*
   * Narrowing the folder scope drops selected files it no longer covers, so the value never names
   * a file the run would skip.
   */
  useEffect(() => {
    if (!folderScope || !hasConcreteFolderScope || selections.isPending || isPreview) return
    const nextFiles = files.filter((file) => {
      const workspaceFile = findSelectedWorkspaceFile(file, selections.candidates)
      return !workspaceFile || isInFolderScope(workspaceFile.folderPath)
    })
    if (nextFiles.length === files.length) return
    commitValue(multiple ? (nextFiles.length > 0 ? nextFiles : null) : (nextFiles[0] ?? null))
  }, [
    commitValue,
    files,
    folderScope,
    hasConcreteFolderScope,
    isInFolderScope,
    isPreview,
    multiple,
    selections.candidates,
    selections.isPending,
  ])

  const isAccepted = useCallback(
    (file: WorkspaceFile) => isFileTypeAccepted(file.type, acceptedTypes),
    [acceptedTypes]
  )

  /** Multiple mode offers only what is not yet chosen; single mode keeps the current file listed. */
  const options = useMemo<FilePickerOption[]>(() => {
    const source = multiple
      ? scopedWorkspaceFiles.filter((file) => !selectedWorkspaceFileIds.has(file.id))
      : scopedWorkspaceFiles
    const typed = query.trim().toLowerCase()
    return [...source]
      .sort(byFolderThenName)
      .map((file) => {
        const accepted = isAccepted(file)
        return {
          value: file.id,
          label: workspaceFileOptionLabel(file),
          // When cloud storage is required, files already in local workspace storage cannot publish.
          disabled: !accepted || cloudUploadBlocked,
          disabledReason: !accepted
            ? NOT_ACCEPTED_REASON
            : cloudUploadBlocked
              ? CLOUD_REQUIRED_REASON
              : undefined,
        }
      })
      .filter((option) => !typed || option.label.toLowerCase().includes(typed))
  }, [
    cloudUploadBlocked,
    isAccepted,
    multiple,
    query,
    scopedWorkspaceFiles,
    selectedWorkspaceFileIds,
  ])

  const selectedFileId = useMemo(() => {
    if (multiple || files.length === 0) return null
    return findSelectedWorkspaceFile(files[0], workspaceFiles)?.id ?? null
  }, [files, multiple, workspaceFiles])

  const uploadBlocked = isPreview || disabled || cloudUploadBlocked || folderScopeUploadBlocked

  async function uploadFiles(selected: readonly File[]) {
    if (uploadBlocked || selected.length === 0) return

    const validFiles: File[] = []
    let sizeExceeded: string | null = null
    for (const file of selected) {
      if (file.size > maxSizeInBytes) {
        logger.error('File exceeds the maximum upload size', {
          fileName: file.name,
          maxSizeLabel,
          workflowId: activeWorkflowId,
        })
        sizeExceeded ??= `${file.name} exceeds the maximum file size of ${maxSizeLabel}`
      } else {
        validFiles.push(file)
      }
    }
    if (validFiles.length === 0) {
      if (sizeExceeded) setUploadError({ message: sizeExceeded, transient: true })
      return
    }

    setUploadingFiles(
      validFiles.map((file) => ({
        id: `upload-${generateShortId(7)}`,
        name: file.name,
        size: file.size,
      }))
    )
    setUploadProgress(0)
    setUploadError(null)

    const totalBytes = validFiles.reduce((sum, file) => sum + file.size, 0)
    const progressOf = (settledBytes: number, settledCount: number) =>
      totalBytes > 0
        ? Math.min(100, (settledBytes / totalBytes) * 100)
        : (settledCount / validFiles.length) * 100

    try {
      const uploadedFiles: UploadedFile[] = []
      let settledBytes = 0
      for (const [index, file] of validFiles.entries()) {
        try {
          const data = await uploadFileMutation.mutateAsync({
            workspaceId,
            file,
            folderId: uploadTargetFolderId,
            skipToast: true,
            skipInvalidation: true,
            onProgress: (event) =>
              setUploadProgress(progressOf(settledBytes + event.loaded, index)),
          })
          uploadedFiles.push({
            name: data.file.name,
            path: data.file.url,
            key: data.file.key,
            id: data.file.id,
            size: data.file.size,
            type: data.file.type,
          })
        } catch (error) {
          logger.error('Failed to upload file', { fileName: file.name, error })
          setUploadError({ message: getErrorMessage(error, 'Unknown error'), transient: false })
        }
        settledBytes += file.size
        setUploadProgress(progressOf(settledBytes, index + 1))
      }
      setUploadProgress(100)

      if (uploadedFiles.length === 0) return
      setUploadError(null)
      if (workspaceId) {
        void invalidateWorkspaceFileReads(queryClient, workspaceId)
        void queryClient.invalidateQueries({ queryKey: workspaceFilesKeys.storageInfo() })
      }
      logger.info('Uploaded files', {
        count: uploadedFiles.length,
        workflowId: activeWorkflowId,
      })

      if (multiple) {
        const unique = new Map<string, StoredFile>()
        for (const file of files) unique.set(fileLocation(file), file)
        for (const file of uploadedFiles) unique.set(file.path, file)
        commitValue([...unique.values()])
      } else {
        commitValue(uploadedFiles[0])
      }
    } catch (error) {
      logger.error('Failed to upload files', { error, workflowId: activeWorkflowId })
    } finally {
      setTimeout(() => {
        setUploadingFiles([])
        setUploadProgress(0)
      }, UPLOAD_SETTLE_MS)
    }
  }

  function selectFile(fileId: string) {
    if (cloudUploadBlocked || disabled || isPreview) return
    const selected = workspaceFiles.find((file) => file.id === fileId)
    if (!selected || !isAccepted(selected)) return

    const chosen: UploadedFile = {
      name: selected.name,
      path: selected.path,
      key: selected.key,
      size: selected.size,
      type: selected.type,
      id: selected.id,
      folderPath: selected.folderPath ?? undefined,
    }
    if (multiple) {
      const unique = new Map<string, StoredFile>()
      for (const file of files) unique.set(fileLocation(file), file)
      unique.set(chosen.path, chosen)
      commitValue([...unique.values()])
    } else {
      commitValue(chosen)
    }
    setQuery('')
    logger.info('Selected workspace file', { fileId, workflowId: activeWorkflowId })
  }

  async function removeFile(file: UploadedFile) {
    if (isPreview || disabled) return
    const location = file.path || ''
    setDeletingPaths((current) => new Set(current).add(location))
    try {
      const decodedPath = file.path ? decodeURIComponent(file.path) : ''
      const isWorkspaceFile =
        workspaceId &&
        (decodedPath.includes(`/${workspaceId}/`) || decodedPath.includes(`${workspaceId}/`))
      // A workspace file outlives the block; only an in-place upload is removed from storage.
      if (!isWorkspaceFile) {
        try {
          await requestJson(fileDeleteContract, { body: { filePath: file.path } })
        } catch (error) {
          if (isApiClientError(error)) {
            throw new Error(error.message || `Failed to delete file: ${error.status}`)
          }
          throw error
        }
      }
      if (multiple) {
        const remaining = files.filter((entry) => entry.path !== file.path)
        commitValue(remaining.length > 0 ? remaining : null)
      } else {
        commitValue(null)
      }
    } catch (error) {
      logger.error('Failed to remove file', {
        error: getErrorMessage(error, 'Failed to remove file'),
        workflowId: activeWorkflowId,
      })
    } finally {
      setDeletingPaths((current) => {
        const next = new Set(current)
        next.delete(location)
        return next
      })
    }
  }

  return {
    files,
    uploadingFiles,
    uploadProgress,
    uploadError,
    deletingPaths,
    showCloudStorageWarning,
    showFolderScopeNotice: folderScopeUploadBlocked && !loadingFolderScope,
    uploadBlocked,
    picker: {
      options,
      selectedFileId,
      query,
      onQueryChange: setQuery,
      onOpenChange: (open) => {
        if (!open) setQuery('')
        else if (pickerList.isStale) void pickerList.refetch()
      },
      hasMore: Boolean(pickerList.hasNextPage),
      loading: pickerList.isLoading || pickerList.isFetchingNextPage,
      error: pickerList.error
        ? getErrorMessage(pickerList.error, 'Could not load files')
        : undefined,
      loadMore: pickerList.loadMore,
      retry: () => void pickerList.refetch(),
    },
    uploadFiles,
    selectFile,
    removeFile,
  }
}
