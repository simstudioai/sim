import { useCallback, useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { useQueryClient } from '@tanstack/react-query'
import type { V2KnowledgeDocumentSummary } from '@/lib/api/contracts/v2/knowledge'
import {
  assertMultiFileUploadAdmission,
  MultiFileUploadAdmissionError,
} from '@/lib/uploads/client/admission'
import { runWithConcurrency, WHOLE_FILE_PARALLEL_UPLOADS } from '@/lib/uploads/client/concurrency'
import { uploadKnowledgeDocumentSession } from '@/lib/uploads/client/session-upload'
import type { UploadProgressEvent } from '@/lib/uploads/client/types'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'

const logger = createLogger('KnowledgeUpload')

interface KnowledgeDocumentUploadFile extends File {
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

export function useKnowledgeUpload(options: UseKnowledgeUploadOptions = {}) {
  const queryClient = useQueryClient()
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({
    stage: 'idle',
    filesCompleted: 0,
    totalFiles: 0,
  })
  const [uploadError, setUploadError] = useState<UploadError | null>(null)
  const isUploading = uploadProgress.stage !== 'idle'

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
    knowledgeBaseId: string,
    processingOptions: ProcessingOptions
  ): Promise<V2KnowledgeDocumentSummary> => {
    if (!options.workspaceId) {
      throw new KnowledgeUploadError('workspaceId is required for upload', 'MISSING_WORKSPACE_ID')
    }
    const onProgress = (event: UploadProgressEvent) => {
      updateFileStatus(fileIndex, { progress: event.percent, status: 'uploading' })
    }
    const taggedFile = file as KnowledgeDocumentUploadFile
    return uploadKnowledgeDocumentSession({
      workspaceId: options.workspaceId,
      knowledgeBaseId,
      file,
      onProgress,
      tag1: taggedFile.tag1,
      tag2: taggedFile.tag2,
      tag3: taggedFile.tag3,
      tag4: taggedFile.tag4,
      tag5: taggedFile.tag5,
      tag6: taggedFile.tag6,
      tag7: taggedFile.tag7,
      processingOptions: {
        recipe: processingOptions.recipe ?? 'default',
        lang: 'en',
      },
    })
  }

  /** Reconciles both caches an upload moves: the base's documents and the list's `docCount`. */
  const invalidateKnowledgeCaches = async (knowledgeBaseId: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: knowledgeKeys.detail(knowledgeBaseId) }),
      queryClient.invalidateQueries({ queryKey: knowledgeKeys.lists() }),
    ])
  }

  const uploadFilesInBatches = async (
    files: File[],
    knowledgeBaseId: string,
    processingOptions: ProcessingOptions
  ): Promise<V2KnowledgeDocumentSummary[]> => {
    if (!options.workspaceId) {
      throw new KnowledgeUploadError('workspaceId is required for upload', 'MISSING_WORKSPACE_ID')
    }

    const fileStatuses: FileUploadStatus[] = files.map((file) => ({
      fileName: file.name,
      fileSize: file.size,
      status: 'pending',
      progress: 0,
    }))

    setUploadProgress((prev) => ({ ...prev, fileStatuses }))

    logger.info(`Starting signed session upload of ${files.length} files`)

    const settled = await runWithConcurrency(
      files,
      WHOLE_FILE_PARALLEL_UPLOADS,
      async (file, index) => {
        updateFileStatus(index, { status: 'uploading' })
        try {
          const uploaded = await uploadOneFile(file, index, knowledgeBaseId, processingOptions)
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

    const succeeded: V2KnowledgeDocumentSummary[] = []
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
        { failedFiles: failed, uploadedDocuments: succeeded }
      )
    }

    return succeeded
  }

  const uploadFiles = async (
    files: File[],
    knowledgeBaseId: string,
    processingOptions: ProcessingOptions = {}
  ): Promise<V2KnowledgeDocumentSummary[]> => {
    if (files.length === 0) {
      throw new KnowledgeUploadError('No files provided for upload', 'NO_FILES')
    }
    if (!knowledgeBaseId?.trim()) {
      throw new KnowledgeUploadError('Knowledge base ID is required', 'INVALID_KB_ID')
    }

    try {
      assertMultiFileUploadAdmission(files)
      setUploadError(null)
      setUploadProgress({ stage: 'uploading', filesCompleted: 0, totalFiles: files.length })

      const uploadedDocuments = await uploadFilesInBatches(
        files,
        knowledgeBaseId,
        processingOptions
      )

      setUploadProgress((prev) => ({ ...prev, stage: 'processing' }))
      logger.info(`Successfully started processing ${uploadedDocuments.length} documents`)

      await invalidateKnowledgeCaches(knowledgeBaseId)

      return uploadedDocuments
    } catch (err) {
      logger.error('Error uploading documents:', err)

      /**
       * A partial batch failure still created every document that did upload, so the caches
       * must reconcile on this path too — otherwise the list is missing rows that exist until
       * its staleTime expires. Admission failures create nothing and need no refetch.
       */
      if (err instanceof KnowledgeUploadError && err.code === 'PARTIAL_UPLOAD_FAILURE') {
        void invalidateKnowledgeCaches(knowledgeBaseId)
      }

      const error: UploadError =
        err instanceof KnowledgeUploadError
          ? { message: err.message, code: err.code, details: err.details, timestamp: Date.now() }
          : err instanceof MultiFileUploadAdmissionError
            ? { message: err.message, code: err.code, timestamp: Date.now() }
            : err instanceof Error
              ? { message: err.message, timestamp: Date.now() }
              : { message: 'Unknown error occurred during upload', timestamp: Date.now() }

      setUploadError(error)
      options.onError?.(error)
      throw err
    } finally {
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
