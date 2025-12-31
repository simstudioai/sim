import { useCallback, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'
import { knowledgeKeys } from '@/hooks/queries/knowledge'

const logger = createLogger('KnowledgeUpload')

export interface UploadedFile {
  filename: string
  fileUrl: string
  fileSize: number
  mimeType: string
  // Document tags
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
  progress?: number // 0-100 percentage
  error?: string
}

export interface UploadProgress {
  stage: 'idle' | 'uploading' | 'processing' | 'completing'
  filesCompleted: number
  totalFiles: number
  currentFile?: string
  currentFileProgress?: number // 0-100 percentage for current file
  fileStatuses?: FileUploadStatus[] // Track each file's status
}

export interface UploadError {
  message: string
  timestamp: number
  code?: string
  details?: any
}

export interface ProcessingOptions {
  chunkSize?: number
  minCharactersPerChunk?: number
  chunkOverlap?: number
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
    public details?: any
  ) {
    super(message)
    this.name = 'KnowledgeUploadError'
  }
}

class PresignedUrlError extends KnowledgeUploadError {
  constructor(message: string, details?: any) {
    super(message, 'PRESIGNED_URL_ERROR', details)
  }
}

class DirectUploadError extends KnowledgeUploadError {
  constructor(message: string, details?: any) {
    super(message, 'DIRECT_UPLOAD_ERROR', details)
  }
}

class ProcessingError extends KnowledgeUploadError {
  constructor(message: string, details?: any) {
    super(message, 'PROCESSING_ERROR', details)
  }
}

/**
 * Configuration constants for file upload operations
 */
const UPLOAD_CONFIG = {
  MAX_PARALLEL_UPLOADS: 3,
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 2000,
  RETRY_BACKOFF: 2,
  CHUNK_SIZE: 8 * 1024 * 1024,
  DIRECT_UPLOAD_THRESHOLD: 4 * 1024 * 1024,
  LARGE_FILE_THRESHOLD: 50 * 1024 * 1024,
  BASE_TIMEOUT_MS: 2 * 60 * 1000,
  TIMEOUT_PER_MB_MS: 1500,
  MAX_TIMEOUT_MS: 10 * 60 * 1000,
  MULTIPART_PART_CONCURRENCY: 3,
  MULTIPART_MAX_RETRIES: 3,
  BATCH_REQUEST_SIZE: 50,
} as const

/**
 * Calculates the upload timeout based on file size
 */
const calculateUploadTimeoutMs = (fileSize: number) => {
  const sizeInMb = fileSize / (1024 * 1024)
  const dynamicBudget = UPLOAD_CONFIG.BASE_TIMEOUT_MS + sizeInMb * UPLOAD_CONFIG.TIMEOUT_PER_MB_MS
  return Math.min(dynamicBudget, UPLOAD_CONFIG.MAX_TIMEOUT_MS)
}

/**
 * Delays execution for the specified duration
 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Gets high resolution timestamp for performance measurements
 */
const getHighResTime = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now()

/**
 * Formats bytes to megabytes with 2 decimal places
 */
const formatMegabytes = (bytes: number) => Number((bytes / (1024 * 1024)).toFixed(2))

/**
 * Calculates throughput in Mbps
 */
const calculateThroughputMbps = (bytes: number, durationMs: number) => {
  if (!bytes || !durationMs) return 0
  return Number((((bytes * 8) / durationMs) * 0.001).toFixed(2))
}

/**
 * Formats duration from milliseconds to seconds
 */
const formatDurationSeconds = (durationMs: number) => Number((durationMs / 1000).toFixed(2))

/**
 * Gets the content type for a file, falling back to extension-based lookup if browser doesn't provide one
 */
const getFileContentType = (file: File): string => {
  if (file.type?.trim()) {
    return file.type
  }
  const extension = getFileExtension(file.name)
  return getMimeTypeFromExtension(extension)
}

/**
 * Runs async operations with concurrency limit
 */
const runWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<Array<PromiseSettledResult<R>>> => {
  const results: Array<PromiseSettledResult<R>> = Array(items.length)

  if (items.length === 0) {
    return results
  }

  const concurrency = Math.max(1, Math.min(limit, items.length))
  let nextIndex = 0

  const runners = Array.from({ length: concurrency }, async () => {
    while (true) {
      const currentIndex = nextIndex++
      if (currentIndex >= items.length) {
        break
      }

      try {
        const value = await worker(items[currentIndex], currentIndex)
        results[currentIndex] = { status: 'fulfilled', value }
      } catch (error) {
        results[currentIndex] = { status: 'rejected', reason: error }
      }
    }
  })

  await Promise.all(runners)
  return results
}

/**
 * Extracts the error name from an unknown error object
 */
const getErrorName = (error: unknown) =>
  typeof error === 'object' && error !== null && 'name' in error ? String((error as any).name) : ''

/**
 * Extracts a human-readable message from an unknown error
 */
const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error'

/**
 * Checks if an error is an abort error
 */
const isAbortError = (error: unknown) => getErrorName(error) === 'AbortError'

/**
 * Checks if an error is a network-related error
 */
const isNetworkError = (error: unknown) => {
  if (!(error instanceof Error)) {
    return false
  }

  const message = error.message.toLowerCase()
  return (
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('connection') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('ecconnreset')
  )
}

interface PresignedFileInfo {
  path: string
  key: string
  name: string
  size: number
  type: string
}

interface PresignedUploadInfo {
  fileName: string
  presignedUrl: string
  fileInfo: PresignedFileInfo
  uploadHeaders?: Record<string, string>
  directUploadSupported: boolean
  presignedUrls?: any
}

/**
 * Normalizes presigned URL response data into a consistent format
 */
const normalizePresignedData = (data: any, context: string): PresignedUploadInfo => {
  const presignedUrl = data?.presignedUrl || data?.uploadUrl
  const fileInfo = data?.fileInfo

  if (!presignedUrl || !fileInfo?.path) {
    throw new PresignedUrlError(`Invalid presigned response for ${context}`, data)
  }

  return {
    fileName: data.fileName || fileInfo.name || context,
    presignedUrl,
    fileInfo: {
      path: fileInfo.path,
      key: fileInfo.key,
      name: fileInfo.name || context,
      size: fileInfo.size || data.fileSize || 0,
      type: fileInfo.type || data.contentType || '',
    },
    uploadHeaders: data.uploadHeaders || undefined,
    directUploadSupported: data.directUploadSupported !== false,
    presignedUrls: data.presignedUrls,
  }
}

/**
 * Fetches presigned URL data for file upload
 */
const getPresignedData = async (
  file: File,
  timeoutMs: number,
  controller?: AbortController
): Promise<PresignedUploadInfo> => {
  const localController = controller ?? new AbortController()
  const timeoutId = setTimeout(() => localController.abort(), timeoutMs)
  const startTime = getHighResTime()

  try {
    const presignedResponse = await fetch('/api/files/presigned?type=knowledge-base', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileName: file.name,
        contentType: getFileContentType(file),
        fileSize: file.size,
      }),
      signal: localController.signal,
    })

    if (!presignedResponse.ok) {
      let errorDetails: any = null
      try {
        errorDetails = await presignedResponse.json()
      } catch {
        errorDetails = null
      }

      logger.error('Presigned URL request failed', {
        status: presignedResponse.status,
        fileSize: file.size,
      })

      throw new PresignedUrlError(
        `Failed to get presigned URL for ${file.name}: ${presignedResponse.status} ${presignedResponse.statusText}`,
        errorDetails
      )
    }

    const presignedData = await presignedResponse.json()
    const durationMs = getHighResTime() - startTime
    logger.info('Fetched presigned URL', {
      fileName: file.name,
      sizeMB: formatMegabytes(file.size),
      durationMs: formatDurationSeconds(durationMs),
    })
    return normalizePresignedData(presignedData, file.name)
  } finally {
    clearTimeout(timeoutId)
    if (!controller) {
      localController.abort()
    }
  }
}

/**
 * Hook for managing file uploads to knowledge bases
 */
export function useKnowledgeUpload(options: UseKnowledgeUploadOptions = {}) {
  const queryClient = useQueryClient()
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({
    stage: 'idle',
    filesCompleted: 0,
    totalFiles: 0,
  })
  const [uploadError, setUploadError] = useState<UploadError | null>(null)

  /**
   * Creates an UploadedFile object from file metadata
   */
  const createUploadedFile = (
    filename: string,
    fileUrl: string,
    fileSize: number,
    mimeType: string,
    originalFile?: File
  ): UploadedFile => ({
    filename,
    fileUrl,
    fileSize,
    mimeType,
    tag1: (originalFile as any)?.tag1,
    tag2: (originalFile as any)?.tag2,
    tag3: (originalFile as any)?.tag3,
    tag4: (originalFile as any)?.tag4,
    tag5: (originalFile as any)?.tag5,
    tag6: (originalFile as any)?.tag6,
    tag7: (originalFile as any)?.tag7,
  })

  /**
   * Creates an UploadError from an exception
   */
  const createErrorFromException = (error: unknown, defaultMessage: string): UploadError => {
    if (error instanceof KnowledgeUploadError) {
      return {
        message: error.message,
        code: error.code,
        details: error.details,
        timestamp: Date.now(),
      }
    }

    if (error instanceof Error) {
      return {
        message: error.message,
        timestamp: Date.now(),
      }
    }

    return {
      message: defaultMessage,
      timestamp: Date.now(),
    }
  }

  /**
   * Upload a single file with retry logic
   */
  const uploadSingleFileWithRetry = async (
    file: File,
    retryCount = 0,
    fileIndex?: number,
    presignedOverride?: PresignedUploadInfo
  ): Promise<UploadedFile> => {
    const timeoutMs = calculateUploadTimeoutMs(file.size)
    let presignedData: PresignedUploadInfo | undefined
    const attempt = retryCount + 1
    logger.info('Upload attempt started', {
      fileName: file.name,
      attempt,
      sizeMB: formatMegabytes(file.size),
      timeoutMs: formatDurationSeconds(timeoutMs),
    })

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

      try {
        if (file.size > UPLOAD_CONFIG.LARGE_FILE_THRESHOLD) {
          presignedData = presignedOverride ?? (await getPresignedData(file, timeoutMs, controller))
          return await uploadFileInChunks(file, presignedData, timeoutMs, fileIndex)
        }

        if (presignedOverride?.directUploadSupported && presignedOverride.presignedUrl) {
          return await uploadFileDirectly(file, presignedOverride, timeoutMs, controller, fileIndex)
        }

        return await uploadFileThroughAPI(file, timeoutMs)
      } finally {
        clearTimeout(timeoutId)
      }
    } catch (error) {
      const isTimeout = isAbortError(error)
      const isNetwork = isNetworkError(error)

      if (retryCount < UPLOAD_CONFIG.MAX_RETRIES) {
        const delay = UPLOAD_CONFIG.RETRY_DELAY_MS * UPLOAD_CONFIG.RETRY_BACKOFF ** retryCount
        if (isTimeout || isNetwork) {
          logger.warn(
            `Upload failed (${isTimeout ? 'timeout' : 'network'}), retrying in ${delay / 1000}s...`,
            {
              attempt: retryCount + 1,
              fileSize: file.size,
              delay: delay,
            }
          )
        }

        if (fileIndex !== undefined) {
          setUploadProgress((prev) => ({
            ...prev,
            fileStatuses: prev.fileStatuses?.map((fs, idx) =>
              idx === fileIndex ? { ...fs, progress: 0, status: 'uploading' as const } : fs
            ),
          }))
        }

        await sleep(delay)
        const shouldReusePresigned = (isTimeout || isNetwork) && presignedData
        return uploadSingleFileWithRetry(
          file,
          retryCount + 1,
          fileIndex,
          shouldReusePresigned ? presignedData : undefined
        )
      }

      logger.error('Upload failed after retries', {
        fileSize: file.size,
        errorType: isTimeout ? 'timeout' : isNetwork ? 'network' : 'unknown',
        attempts: UPLOAD_CONFIG.MAX_RETRIES + 1,
      })
      throw error
    }
  }

  /**
   * Upload file directly with timeout and progress tracking
   */
  const uploadFileDirectly = async (
    file: File,
    presignedData: PresignedUploadInfo,
    timeoutMs: number,
    outerController: AbortController,
    fileIndex?: number
  ): Promise<UploadedFile> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      let isCompleted = false
      const startTime = getHighResTime()

      const timeoutId = setTimeout(() => {
        if (!isCompleted) {
          isCompleted = true
          xhr.abort()
          reject(new Error('Upload timeout'))
        }
      }, timeoutMs)

      const abortHandler = () => {
        if (!isCompleted) {
          isCompleted = true
          clearTimeout(timeoutId)
          xhr.abort()
          reject(new DirectUploadError(`Upload aborted for ${file.name}`, {}))
        }
      }

      outerController.signal.addEventListener('abort', abortHandler)

      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable && fileIndex !== undefined && !isCompleted) {
          const percentComplete = Math.round((event.loaded / event.total) * 100)
          setUploadProgress((prev) => {
            if (prev.fileStatuses?.[fileIndex]?.status === 'uploading') {
              return {
                ...prev,
                fileStatuses: prev.fileStatuses?.map((fs, idx) =>
                  idx === fileIndex ? { ...fs, progress: percentComplete } : fs
                ),
              }
            }
            return prev
          })
        }
      })

      xhr.addEventListener('load', () => {
        if (!isCompleted) {
          isCompleted = true
          clearTimeout(timeoutId)
          outerController.signal.removeEventListener('abort', abortHandler)
          const durationMs = getHighResTime() - startTime
          if (xhr.status >= 200 && xhr.status < 300) {
            const fullFileUrl = presignedData.fileInfo.path.startsWith('http')
              ? presignedData.fileInfo.path
              : `${window.location.origin}${presignedData.fileInfo.path}`
            logger.info('Direct upload completed', {
              fileName: file.name,
              sizeMB: formatMegabytes(file.size),
              durationMs: formatDurationSeconds(durationMs),
              throughputMbps: calculateThroughputMbps(file.size, durationMs),
              status: xhr.status,
            })
            resolve(
              createUploadedFile(file.name, fullFileUrl, file.size, getFileContentType(file), file)
            )
          } else {
            logger.error('S3 PUT request failed', {
              status: xhr.status,
              fileSize: file.size,
            })
            reject(
              new DirectUploadError(
                `Direct upload failed for ${file.name}: ${xhr.status} ${xhr.statusText}`,
                {
                  uploadResponse: xhr.statusText,
                }
              )
            )
          }
        }
      })

      xhr.addEventListener('error', () => {
        if (!isCompleted) {
          isCompleted = true
          clearTimeout(timeoutId)
          outerController.signal.removeEventListener('abort', abortHandler)
          const durationMs = getHighResTime() - startTime
          logger.error('Direct upload network error', {
            fileName: file.name,
            sizeMB: formatMegabytes(file.size),
            durationMs: formatDurationSeconds(durationMs),
          })
          reject(new DirectUploadError(`Network error uploading ${file.name}`, {}))
        }
      })

      xhr.addEventListener('abort', abortHandler)

      xhr.open('PUT', presignedData.presignedUrl)

      xhr.setRequestHeader('Content-Type', file.type)
      if (presignedData.uploadHeaders) {
        Object.entries(presignedData.uploadHeaders).forEach(([key, value]) => {
          xhr.setRequestHeader(key, value as string)
        })
      }

      xhr.send(file)
    })
  }

  /**
   * Upload large file in chunks (multipart upload)
   */
  const uploadFileInChunks = async (
    file: File,
    presignedData: PresignedUploadInfo,
    timeoutMs: number,
    fileIndex?: number
  ): Promise<UploadedFile> => {
    logger.info(
      `Uploading large file ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB) using multipart upload`
    )
    const startTime = getHighResTime()

    try {
      const initiateResponse = await fetch('/api/files/multipart?action=initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          contentType: getFileContentType(file),
          fileSize: file.size,
        }),
      })

      if (!initiateResponse.ok) {
        throw new Error(`Failed to initiate multipart upload: ${initiateResponse.statusText}`)
      }

      const { uploadId, key } = await initiateResponse.json()
      logger.info(`Initiated multipart upload with ID: ${uploadId}`)

      const chunkSize = UPLOAD_CONFIG.CHUNK_SIZE
      const numParts = Math.ceil(file.size / chunkSize)
      const partNumbers = Array.from({ length: numParts }, (_, i) => i + 1)

      const partUrlsResponse = await fetch('/api/files/multipart?action=get-part-urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId,
          key,
          partNumbers,
        }),
      })

      if (!partUrlsResponse.ok) {
        await fetch('/api/files/multipart?action=abort', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uploadId, key }),
        })
        throw new Error(`Failed to get part URLs: ${partUrlsResponse.statusText}`)
      }

      const { presignedUrls } = await partUrlsResponse.json()

      const uploadedParts: Array<{ ETag: string; PartNumber: number }> = []

      const controller = new AbortController()
      const multipartTimeoutId = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const uploadPart = async ({ partNumber, url }: any) => {
          const start = (partNumber - 1) * chunkSize
          const end = Math.min(start + chunkSize, file.size)
          const chunk = file.slice(start, end)

          for (let attempt = 0; attempt <= UPLOAD_CONFIG.MULTIPART_MAX_RETRIES; attempt++) {
            try {
              const partResponse = await fetch(url, {
                method: 'PUT',
                body: chunk,
                signal: controller.signal,
                headers: {
                  'Content-Type': file.type,
                },
              })

              if (!partResponse.ok) {
                throw new Error(`Failed to upload part ${partNumber}: ${partResponse.statusText}`)
              }

              const etag = partResponse.headers.get('ETag') || ''
              logger.info(`Uploaded part ${partNumber}/${numParts}`)

              if (fileIndex !== undefined) {
                const partProgress = Math.min(100, Math.round((partNumber / numParts) * 100))
                setUploadProgress((prev) => ({
                  ...prev,
                  fileStatuses: prev.fileStatuses?.map((fs, idx) =>
                    idx === fileIndex ? { ...fs, progress: partProgress } : fs
                  ),
                }))
              }

              return { ETag: etag.replace(/"/g, ''), PartNumber: partNumber }
            } catch (partError) {
              if (attempt >= UPLOAD_CONFIG.MULTIPART_MAX_RETRIES) {
                throw partError
              }

              const delay = UPLOAD_CONFIG.RETRY_DELAY_MS * UPLOAD_CONFIG.RETRY_BACKOFF ** attempt
              logger.warn(
                `Part ${partNumber} failed (attempt ${attempt + 1}), retrying in ${Math.round(delay / 1000)}s`
              )
              await sleep(delay)
            }
          }

          throw new Error(`Retries exhausted for part ${partNumber}`)
        }

        const partResults = await runWithConcurrency(
          presignedUrls,
          UPLOAD_CONFIG.MULTIPART_PART_CONCURRENCY,
          uploadPart
        )

        partResults.forEach((result) => {
          if (result?.status === 'fulfilled') {
            uploadedParts.push(result.value)
          } else if (result?.status === 'rejected') {
            throw result.reason
          }
        })
      } finally {
        clearTimeout(multipartTimeoutId)
      }

      const completeResponse = await fetch('/api/files/multipart?action=complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadId,
          key,
          parts: uploadedParts,
        }),
      })

      if (!completeResponse.ok) {
        throw new Error(`Failed to complete multipart upload: ${completeResponse.statusText}`)
      }

      const { path } = await completeResponse.json()
      logger.info(`Completed multipart upload for ${file.name}`)

      const durationMs = getHighResTime() - startTime
      logger.info('Multipart upload metrics', {
        fileName: file.name,
        sizeMB: formatMegabytes(file.size),
        parts: uploadedParts.length,
        durationMs: formatDurationSeconds(durationMs),
        throughputMbps: calculateThroughputMbps(file.size, durationMs),
      })

      const fullFileUrl = path.startsWith('http') ? path : `${window.location.origin}${path}`

      return createUploadedFile(file.name, fullFileUrl, file.size, getFileContentType(file), file)
    } catch (error) {
      logger.error(`Multipart upload failed for ${file.name}:`, error)
      const durationMs = getHighResTime() - startTime
      logger.warn('Falling back to direct upload after multipart failure', {
        fileName: file.name,
        sizeMB: formatMegabytes(file.size),
        durationMs: formatDurationSeconds(durationMs),
      })
      return uploadFileDirectly(file, presignedData, timeoutMs, new AbortController(), fileIndex)
    }
  }

  /**
   * Fallback upload through API
   */
  const uploadFileThroughAPI = async (file: File, timeoutMs: number): Promise<UploadedFile> => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('context', 'knowledge-base')

      if (options.workspaceId) {
        formData.append('workspaceId', options.workspaceId)
      }

      const uploadResponse = await fetch('/api/files/upload', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      })

      if (!uploadResponse.ok) {
        let errorData: any = null
        try {
          errorData = await uploadResponse.json()
        } catch {
          errorData = null
        }

        throw new DirectUploadError(
          `Failed to upload ${file.name}: ${errorData?.error || 'Unknown error'}`,
          errorData
        )
      }

      const uploadResult = await uploadResponse.json()

      const filePath = uploadResult.fileInfo?.path || uploadResult.path

      if (!filePath) {
        throw new DirectUploadError(
          `Invalid upload response for ${file.name}: missing file path`,
          uploadResult
        )
      }

      return createUploadedFile(
        file.name,
        filePath.startsWith('http') ? filePath : `${window.location.origin}${filePath}`,
        file.size,
        getFileContentType(file),
        file
      )
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Uploads files in batches using presigned URLs
   */
  const uploadFilesInBatches = async (files: File[]): Promise<UploadedFile[]> => {
    const results: UploadedFile[] = []
    const failedFiles: Array<{ file: File; error: Error }> = []

    const fileStatuses: FileUploadStatus[] = files.map((file) => ({
      fileName: file.name,
      fileSize: file.size,
      status: 'pending' as const,
      progress: 0,
    }))

    setUploadProgress((prev) => ({
      ...prev,
      fileStatuses,
    }))

    logger.info(`Starting batch upload of ${files.length} files`)

    try {
      const batches = []

      for (
        let batchStart = 0;
        batchStart < files.length;
        batchStart += UPLOAD_CONFIG.BATCH_REQUEST_SIZE
      ) {
        const batchFiles = files.slice(batchStart, batchStart + UPLOAD_CONFIG.BATCH_REQUEST_SIZE)
        const batchIndexOffset = batchStart
        batches.push({ batchFiles, batchIndexOffset })
      }

      logger.info(`Starting parallel processing of ${batches.length} batches`)

      const presignedPromises = batches.map(async ({ batchFiles }, batchIndex) => {
        logger.info(
          `Getting presigned URLs for batch ${batchIndex + 1}/${batches.length} (${batchFiles.length} files)`
        )

        const batchRequest = {
          files: batchFiles.map((file) => ({
            fileName: file.name,
            contentType: getFileContentType(file),
            fileSize: file.size,
          })),
        }

        const batchResponse = await fetch('/api/files/presigned/batch?type=knowledge-base', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(batchRequest),
        })

        if (!batchResponse.ok) {
          throw new Error(
            `Batch ${batchIndex + 1} presigned URL generation failed: ${batchResponse.statusText}`
          )
        }

        const { files: presignedData } = await batchResponse.json()
        return { batchFiles, presignedData, batchIndex }
      })

      const allPresignedData = await Promise.all(presignedPromises)
      logger.info(`Got all presigned URLs, starting uploads`)

      const allUploads = allPresignedData.flatMap(({ batchFiles, presignedData, batchIndex }) => {
        const batchIndexOffset = batchIndex * UPLOAD_CONFIG.BATCH_REQUEST_SIZE

        return batchFiles.map((file, batchFileIndex) => {
          const fileIndex = batchIndexOffset + batchFileIndex
          const presigned = presignedData[batchFileIndex]

          return { file, presigned, fileIndex }
        })
      })

      const uploadResults = await runWithConcurrency(
        allUploads,
        UPLOAD_CONFIG.MAX_PARALLEL_UPLOADS,
        async ({ file, presigned, fileIndex }) => {
          if (!presigned) {
            throw new Error(`No presigned data for file ${file.name}`)
          }

          setUploadProgress((prev) => ({
            ...prev,
            fileStatuses: prev.fileStatuses?.map((fs, idx) =>
              idx === fileIndex ? { ...fs, status: 'uploading' as const } : fs
            ),
          }))

          try {
            const result = await uploadSingleFileWithRetry(file, 0, fileIndex, presigned)

            setUploadProgress((prev) => ({
              ...prev,
              filesCompleted: prev.filesCompleted + 1,
              fileStatuses: prev.fileStatuses?.map((fs, idx) =>
                idx === fileIndex ? { ...fs, status: 'completed' as const, progress: 100 } : fs
              ),
            }))

            return result
          } catch (error) {
            setUploadProgress((prev) => ({
              ...prev,
              fileStatuses: prev.fileStatuses?.map((fs, idx) =>
                idx === fileIndex
                  ? {
                      ...fs,
                      status: 'failed' as const,
                      error: getErrorMessage(error),
                    }
                  : fs
              ),
            }))
            throw error
          }
        }
      )

      uploadResults.forEach((result, idx) => {
        if (result?.status === 'fulfilled') {
          results.push(result.value)
        } else if (result?.status === 'rejected') {
          failedFiles.push({
            file: allUploads[idx].file,
            error:
              result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
          })
        }
      })

      if (failedFiles.length > 0) {
        logger.error(`Failed to upload ${failedFiles.length} files`)
        throw new KnowledgeUploadError(
          `Failed to upload ${failedFiles.length} file(s)`,
          'PARTIAL_UPLOAD_FAILURE',
          {
            failedFiles,
            uploadedFiles: results,
          }
        )
      }

      return results
    } catch (error) {
      logger.error('Batch upload failed:', error)
      throw error
    }
  }

  /**
   * Main upload function that handles file uploads and document processing
   */
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

      const processPayload = {
        documents: uploadedFiles.map((file) => ({
          ...file,
        })),
        processingOptions: {
          chunkSize: processingOptions.chunkSize || 1024,
          minCharactersPerChunk: processingOptions.minCharactersPerChunk || 1,
          chunkOverlap: processingOptions.chunkOverlap || 200,
          recipe: processingOptions.recipe || 'default',
          lang: 'en',
        },
        bulk: true,
      }

      const processResponse = await fetch(`/api/knowledge/${knowledgeBaseId}/documents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(processPayload),
      })

      if (!processResponse.ok) {
        let errorData: any = null
        try {
          errorData = await processResponse.json()
        } catch {
          errorData = null
        }

        logger.error('Document processing failed:', {
          status: processResponse.status,
          error: errorData,
          uploadedFiles: uploadedFiles.map((f) => ({
            filename: f.filename,
            fileUrl: f.fileUrl,
            fileSize: f.fileSize,
            mimeType: f.mimeType,
          })),
        })

        throw new ProcessingError(
          `Failed to start document processing: ${errorData?.error || errorData?.message || 'Unknown error'}`,
          errorData
        )
      }

      const processResult = await processResponse.json()

      if (!processResult.success) {
        throw new ProcessingError(
          `Document processing failed: ${processResult.error || 'Unknown error'}`,
          processResult
        )
      }

      if (!processResult.data || !processResult.data.documentsCreated) {
        throw new ProcessingError(
          'Invalid processing response: missing document data',
          processResult
        )
      }

      setUploadProgress((prev) => ({ ...prev, stage: 'completing' }))

      logger.info(`Successfully started processing ${uploadedFiles.length} documents`)

      await queryClient.invalidateQueries({
        queryKey: knowledgeKeys.detail(knowledgeBaseId),
      })

      return uploadedFiles
    } catch (err) {
      logger.error('Error uploading documents:', err)

      const error = createErrorFromException(err, 'Unknown error occurred during upload')
      setUploadError(error)
      options.onError?.(error)

      logger.error('Document upload failed:', error.message)

      throw err
    } finally {
      setIsUploading(false)
      setUploadProgress({ stage: 'idle', filesCompleted: 0, totalFiles: 0 })
    }
  }

  /**
   * Clears the current upload error
   */
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
