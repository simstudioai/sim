import { useCallback, useState } from 'react'
import { createLogger } from '@sim/logger'
import { sleep } from '@sim/utils/helpers'
import { useQueryClient } from '@tanstack/react-query'
import {
  DirectUploadError,
  MULTIPART_MAX_RETRIES,
  MULTIPART_RETRY_BACKOFF,
  MULTIPART_RETRY_DELAY_MS,
  normalizePresignedData,
  type PresignedUploadInfo,
  runUploadStrategy,
  runWithConcurrency,
  type UploadProgressEvent,
  WHOLE_FILE_PARALLEL_UPLOADS,
} from '@/lib/uploads/client/direct-upload'
import { getFileContentType, isAbortError, isNetworkError } from '@/lib/uploads/utils/file-utils'
import { knowledgeKeys } from '@/hooks/queries/kb/knowledge'

const logger = createLogger('KnowledgeUpload')

const KB_BATCH_PRESIGNED_ENDPOINT = '/api/files/presigned/batch?type=knowledge-base'
const KB_API_UPLOAD_ENDPOINT = '/api/files/upload'

const BATCH_REQUEST_SIZE = 50

export interface UploadedFile {
  filename: string
  fileUrl: string
  fileSize: number
  mimeType: string
  tag1?: string
  tag2?: string
  tag3?: string
  tag4?: string
  tag5?: string
  tag6?: string
  tag7?: string
}

export interface FileUploadStatus {
  fileName: string
  fileSize: number
  status: 'pending' | 'uploading' | 'completed' | 'failed'
  progress?: number
  error?: string
}

export interface UploadProgress {
  stage: 'idle' | 'uploading' | 'processing' | 'completing'
  filesCompleted: number
  totalFiles: number
  currentFile?: string
  currentFileProgress?: number
  fileStatuses?: FileUploadStatus[]
}

export interface UploadError {
  message: string
  timestamp: number
  code?: string
  details?: unknown
}

export interface ProcessingOptions {
  recipe?: string
}

export interface UseKnowledgeUploadOptions {
  onError?: (error: UploadError) => void
  workspaceId?: string
}

class KnowledgeUploadError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: unknown
  ) {
    super(message)
    this.name = 'KnowledgeUploadError'
  }
}

class ProcessingError extends KnowledgeUploadError {
  constructor(message: string, details?: unknown) {
    super(message, 'PROCESSING_ERROR', details)
  }
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error'

interface BatchPresignedFile {
  fileName: string
  contentType: string
  fileSize: number
}

/**
 * Fetch presigned upload data for many files in one round trip.
 * Returns one PresignedUploadInfo per input file (in order).
 */
const fetchBatchPresignedData = async (files: File[]): Promise<PresignedUploadInfo[]> => {
  const batches: File[][] = []
  for (let start = 0; start < files.length; start += BATCH_REQUEST_SIZE) {
    batches.push(files.slice(start, start + BATCH_REQUEST_SIZE))
  }

  const batchResults = await Promise.all(
    batches.map(async (batch, batchIndex) => {
      const body: { files: BatchPresignedFile[] } = {
        files: batch.map((file) => ({
          fileName: file.name,
          contentType: getFileContentType(file),
          fileSize: file.size,
        })),
      }

      const response = await fetch(KB_BATCH_PRESIGNED_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        throw new Error(
          `Batch ${batchIndex + 1} presigned URL generation failed: ${response.statusText}`
        )
      }

      const { files: presignedItems } = (await response.json()) as { files: unknown[] }
      return batch.map((file, idx) => normalizePresignedData(presignedItems[idx], file.name))
    })
  )

  return batchResults.flat()
}

/**
 * Server-proxied fallback used when cloud storage isn't configured.
 */
const uploadFileThroughAPI = async (
  file: File,
  workspaceId: string | undefined
): Promise<{ filePath: string }> => {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('context', 'knowledge-base')
  if (workspaceId) formData.append('workspaceId', workspaceId)

  const response = await fetch(KB_API_UPLOAD_ENDPOINT, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    let errorData: { message?: string; error?: string } | null = null
    try {
      errorData = (await response.json()) as { message?: string; error?: string }
    } catch {}
    throw new KnowledgeUploadError(
      `Failed to upload ${file.name}: ${errorData?.message || errorData?.error || response.statusText}`,
      'API_UPLOAD_ERROR',
      errorData
    )
  }

  const result = (await response.json()) as {
    fileInfo?: { path?: string }
    path?: string
  }
  const filePath = result.fileInfo?.path ?? result.path
  if (!filePath) {
    throw new KnowledgeUploadError(
      `Invalid upload response for ${file.name}: missing file path`,
      'API_UPLOAD_ERROR',
      result
    )
  }

  return { filePath }
}

const toAbsoluteUrl = (path: string): string =>
  path.startsWith('http') ? path : `${window.location.origin}${path}`

export function useKnowledgeUpload(options: UseKnowledgeUploadOptions = {}) {
  const queryClient = useQueryClient()
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({
    stage: 'idle',
    filesCompleted: 0,
    totalFiles: 0,
  })
  const [uploadError, setUploadError] = useState<UploadError | null>(null)

  const buildUploadedFile = (file: File, fileUrl: string): UploadedFile => {
    const f = file as File & {
      tag1?: string
      tag2?: string
      tag3?: string
      tag4?: string
      tag5?: string
      tag6?: string
      tag7?: string
    }
    return {
      filename: file.name,
      fileUrl,
      fileSize: file.size,
      mimeType: getFileContentType(file),
      tag1: f.tag1,
      tag2: f.tag2,
      tag3: f.tag3,
      tag4: f.tag4,
      tag5: f.tag5,
      tag6: f.tag6,
      tag7: f.tag7,
    }
  }

  const updateFileStatus = (fileIndex: number, patch: Partial<FileUploadStatus>) => {
    setUploadProgress((prev) => ({
      ...prev,
      fileStatuses: prev.fileStatuses?.map((fs, idx) =>
        idx === fileIndex ? { ...fs, ...patch } : fs
      ),
    }))
  }

  const uploadOneFile = async (
    file: File,
    fileIndex: number,
    presigned: PresignedUploadInfo
  ): Promise<UploadedFile> => {
    if (!options.workspaceId) {
      throw new KnowledgeUploadError('workspaceId is required for upload', 'MISSING_WORKSPACE_ID')
    }

    const onProgress = (event: UploadProgressEvent) => {
      updateFileStatus(fileIndex, { progress: event.percent, status: 'uploading' })
    }

    let attempt = 0
    while (true) {
      try {
        const result = await runUploadStrategy({
          file,
          workspaceId: options.workspaceId,
          context: 'knowledge-base',
          presignedOverride: presigned,
          onProgress,
        })
        return buildUploadedFile(file, toAbsoluteUrl(result.path))
      } catch (error) {
        if (error instanceof DirectUploadError && error.code === 'FALLBACK_REQUIRED') {
          const { filePath } = await uploadFileThroughAPI(file, options.workspaceId)
          return buildUploadedFile(file, toAbsoluteUrl(filePath))
        }

        if (attempt >= MULTIPART_MAX_RETRIES || (!isNetworkError(error) && !isAbortError(error))) {
          throw error
        }

        const delay = MULTIPART_RETRY_DELAY_MS * MULTIPART_RETRY_BACKOFF ** attempt
        attempt++
        logger.warn(
          `Upload retry ${attempt}/${MULTIPART_MAX_RETRIES} for ${file.name} in ${Math.round(delay / 1000)}s`
        )
        updateFileStatus(fileIndex, { progress: 0, status: 'uploading' })
        await sleep(delay)
      }
    }
  }

  const uploadFilesInBatches = async (files: File[]): Promise<UploadedFile[]> => {
    const fileStatuses: FileUploadStatus[] = files.map((file) => ({
      fileName: file.name,
      fileSize: file.size,
      status: 'pending',
      progress: 0,
    }))

    setUploadProgress((prev) => ({ ...prev, fileStatuses }))

    logger.info(`Starting batch upload of ${files.length} files`)

    const presignedData = await fetchBatchPresignedData(files)

    const settled = await runWithConcurrency(
      files,
      WHOLE_FILE_PARALLEL_UPLOADS,
      async (file, index) => {
        updateFileStatus(index, { status: 'uploading' })
        try {
          const uploaded = await uploadOneFile(file, index, presignedData[index])
          setUploadProgress((prev) => ({
            ...prev,
            filesCompleted: prev.filesCompleted + 1,
          }))
          updateFileStatus(index, { status: 'completed', progress: 100 })
          return uploaded
        } catch (error) {
          updateFileStatus(index, { status: 'failed', error: getErrorMessage(error) })
          throw error
        }
      }
    )

    const succeeded: UploadedFile[] = []
    const failed: Array<{ file: File; error: Error }> = []
    settled.forEach((result, idx) => {
      if (result?.status === 'fulfilled') {
        succeeded.push(result.value)
      } else if (result?.status === 'rejected') {
        failed.push({
          file: files[idx],
          error: result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
        })
      }
    })

    if (failed.length > 0) {
      throw new KnowledgeUploadError(
        `Failed to upload ${failed.length} file(s)`,
        'PARTIAL_UPLOAD_FAILURE',
        { failedFiles: failed, uploadedFiles: succeeded }
      )
    }

    return succeeded
  }

  const uploadFiles = async (
    files: File[],
    knowledgeBaseId: string,
    processingOptions: ProcessingOptions = {}
  ): Promise<UploadedFile[]> => {
    if (files.length === 0) {
      throw new KnowledgeUploadError('No files provided for upload', 'NO_FILES')
    }
    if (!knowledgeBaseId?.trim()) {
      throw new KnowledgeUploadError('Knowledge base ID is required', 'INVALID_KB_ID')
    }

    try {
      setIsUploading(true)
      setUploadError(null)
      setUploadProgress({ stage: 'uploading', filesCompleted: 0, totalFiles: files.length })

      const uploadedFiles = await uploadFilesInBatches(files)

      setUploadProgress((prev) => ({ ...prev, stage: 'processing' }))

      const processResponse = await fetch(`/api/knowledge/${knowledgeBaseId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documents: uploadedFiles.map((f) => ({ ...f })),
          processingOptions: {
            recipe: processingOptions.recipe ?? 'default',
            lang: 'en',
          },
          bulk: true,
        }),
      })

      if (!processResponse.ok) {
        let errorData: { error?: string; message?: string } | null = null
        try {
          errorData = (await processResponse.json()) as { error?: string; message?: string }
        } catch {}
        logger.error('Document processing failed:', {
          status: processResponse.status,
          error: errorData,
        })
        throw new ProcessingError(
          `Failed to start document processing: ${errorData?.error || errorData?.message || 'Unknown error'}`,
          errorData
        )
      }

      const processResult = (await processResponse.json()) as {
        success?: boolean
        error?: string
        data?: { documentsCreated?: unknown }
      }

      if (!processResult.success) {
        throw new ProcessingError(
          `Document processing failed: ${processResult.error || 'Unknown error'}`,
          processResult
        )
      }

      if (!processResult.data?.documentsCreated) {
        throw new ProcessingError(
          'Invalid processing response: missing document data',
          processResult
        )
      }

      setUploadProgress((prev) => ({ ...prev, stage: 'completing' }))
      logger.info(`Successfully started processing ${uploadedFiles.length} documents`)

      await queryClient.invalidateQueries({ queryKey: knowledgeKeys.detail(knowledgeBaseId) })

      return uploadedFiles
    } catch (err) {
      logger.error('Error uploading documents:', err)

      const error: UploadError =
        err instanceof KnowledgeUploadError
          ? { message: err.message, code: err.code, details: err.details, timestamp: Date.now() }
          : err instanceof DirectUploadError
            ? { message: err.message, code: err.code, details: err.details, timestamp: Date.now() }
            : err instanceof Error
              ? { message: err.message, timestamp: Date.now() }
              : { message: 'Unknown error occurred during upload', timestamp: Date.now() }

      setUploadError(error)
      options.onError?.(error)
      throw err
    } finally {
      setIsUploading(false)
      setUploadProgress({ stage: 'idle', filesCompleted: 0, totalFiles: 0 })
    }
  }

  const clearError = useCallback(() => {
    setUploadError(null)
  }, [])

  return {
    isUploading,
    uploadProgress,
    uploadError,
    uploadFiles,
    clearError,
  }
}
