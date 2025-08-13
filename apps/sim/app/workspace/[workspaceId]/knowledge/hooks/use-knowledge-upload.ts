import { useState } from 'react'
import { createLogger } from '@/lib/logs/console/logger'

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
  onUploadComplete?: (uploadedFiles: UploadedFile[]) => void
  onError?: (error: UploadError) => void
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

// Upload configuration constants
// Vercel has a 4.5MB body size limit for API routes
const UPLOAD_CONFIG = {
  BATCH_SIZE: 5, // Upload 5 files in parallel
  MAX_RETRIES: 3, // Retry failed uploads up to 3 times
  RETRY_DELAY: 1000, // Initial retry delay in ms
  CHUNK_SIZE: 5 * 1024 * 1024,
  VERCEL_MAX_BODY_SIZE: 4.5 * 1024 * 1024, // Vercel's 4.5MB limit
  DIRECT_UPLOAD_THRESHOLD: 4 * 1024 * 1024, // Files > 4MB must use presigned URLs
  LARGE_FILE_THRESHOLD: 50 * 1024 * 1024, // Files > 50MB need multipart upload
  UPLOAD_TIMEOUT: 60000, // 60 second timeout per upload
} as const

export function useKnowledgeUpload(options: UseKnowledgeUploadOptions = {}) {
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({
    stage: 'idle',
    filesCompleted: 0,
    totalFiles: 0,
  })
  const [uploadError, setUploadError] = useState<UploadError | null>(null)

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
    // Include tags from original file if available
    tag1: (originalFile as any)?.tag1,
    tag2: (originalFile as any)?.tag2,
    tag3: (originalFile as any)?.tag3,
    tag4: (originalFile as any)?.tag4,
    tag5: (originalFile as any)?.tag5,
    tag6: (originalFile as any)?.tag6,
    tag7: (originalFile as any)?.tag7,
  })

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
    fileIndex?: number
  ): Promise<UploadedFile> => {
    try {
      // Create abort controller for timeout
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), UPLOAD_CONFIG.UPLOAD_TIMEOUT)

      try {
        // Get presigned URL
        const presignedResponse = await fetch('/api/files/presigned?type=knowledge-base', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fileName: file.name,
            contentType: file.type,
            fileSize: file.size,
          }),
          signal: controller.signal,
        })

        clearTimeout(timeoutId)

        if (!presignedResponse.ok) {
          let errorDetails: any = null
          try {
            errorDetails = await presignedResponse.json()
          } catch {
            // Ignore JSON parsing errors
          }

          logger.error('Presigned URL request failed', {
            status: presignedResponse.status,
            fileSize: file.size,
            retryCount,
          })

          throw new PresignedUrlError(
            `Failed to get presigned URL for ${file.name}: ${presignedResponse.status} ${presignedResponse.statusText}`,
            errorDetails
          )
        }

        const presignedData = await presignedResponse.json()

        if (presignedData.directUploadSupported) {
          // Use presigned URLs for all uploads when cloud storage is available
          // Check if file needs multipart upload for large files
          if (file.size > UPLOAD_CONFIG.LARGE_FILE_THRESHOLD) {
            return await uploadFileInChunks(file, presignedData, fileIndex)
          }
          return await uploadFileDirectly(file, presignedData, fileIndex)
        }
        // Fallback to traditional upload through API route
        // This is only used when cloud storage is not configured
        // Must check file size due to Vercel's 4.5MB limit
        if (file.size > UPLOAD_CONFIG.DIRECT_UPLOAD_THRESHOLD) {
          throw new DirectUploadError(
            `File ${file.name} is too large (${(file.size / 1024 / 1024).toFixed(2)}MB) for upload. Cloud storage must be configured for files over 4MB.`,
            { fileSize: file.size, limit: UPLOAD_CONFIG.DIRECT_UPLOAD_THRESHOLD }
          )
        }
        logger.warn(`Using API upload fallback for ${file.name} - cloud storage not configured`)
        return await uploadFileThroughAPI(file)
      } finally {
        clearTimeout(timeoutId)
      }
    } catch (error) {
      const isTimeout = error instanceof Error && error.name === 'AbortError'
      const isNetwork =
        error instanceof Error &&
        (error.message.includes('fetch') ||
          error.message.includes('network') ||
          error.message.includes('Failed to fetch'))

      // Retry logic
      if (retryCount < UPLOAD_CONFIG.MAX_RETRIES) {
        const delay = UPLOAD_CONFIG.RETRY_DELAY * 2 ** retryCount // Exponential backoff
        // Only log essential info for debugging
        if (isTimeout || isNetwork) {
          logger.warn(`Upload failed (${isTimeout ? 'timeout' : 'network'}), retrying...`, {
            attempt: retryCount + 1,
            fileSize: file.size,
          })
        }

        // Reset progress to 0 before retry to indicate restart
        if (fileIndex !== undefined) {
          setUploadProgress((prev) => ({
            ...prev,
            fileStatuses: prev.fileStatuses?.map((fs, idx) =>
              idx === fileIndex ? { ...fs, progress: 0, status: 'uploading' as const } : fs
            ),
          }))
        }

        await new Promise((resolve) => setTimeout(resolve, delay))
        return uploadSingleFileWithRetry(file, retryCount + 1, fileIndex)
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
    presignedData: any,
    fileIndex?: number
  ): Promise<UploadedFile> => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      let isCompleted = false // Track if this upload has completed to prevent duplicate state updates

      const timeoutId = setTimeout(() => {
        if (!isCompleted) {
          isCompleted = true
          xhr.abort()
          reject(new Error('Upload timeout'))
        }
      }, UPLOAD_CONFIG.UPLOAD_TIMEOUT)

      // Track upload progress
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable && fileIndex !== undefined && !isCompleted) {
          const percentComplete = Math.round((event.loaded / event.total) * 100)
          setUploadProgress((prev) => {
            // Only update if this file is still uploading
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
          if (xhr.status >= 200 && xhr.status < 300) {
            const fullFileUrl = presignedData.fileInfo.path.startsWith('http')
              ? presignedData.fileInfo.path
              : `${window.location.origin}${presignedData.fileInfo.path}`
            resolve(createUploadedFile(file.name, fullFileUrl, file.size, file.type, file))
          } else {
            logger.error('S3 PUT request failed', {
              status: xhr.status,
              fileSize: file.size,
            })
            reject(
              new DirectUploadError(
                `Direct upload failed for ${file.name}: ${xhr.status} ${xhr.statusText}`,
                { uploadResponse: xhr.statusText }
              )
            )
          }
        }
      })

      xhr.addEventListener('error', () => {
        if (!isCompleted) {
          isCompleted = true
          clearTimeout(timeoutId)
          reject(new DirectUploadError(`Network error uploading ${file.name}`, {}))
        }
      })

      xhr.addEventListener('abort', () => {
        if (!isCompleted) {
          isCompleted = true
          clearTimeout(timeoutId)
          reject(new DirectUploadError(`Upload aborted for ${file.name}`, {}))
        }
      })

      // Start the upload
      xhr.open('PUT', presignedData.presignedUrl)

      // Set headers
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
    presignedData: any,
    fileIndex?: number
  ): Promise<UploadedFile> => {
    logger.info(
      `Uploading large file ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB) using multipart upload`
    )

    try {
      // Step 1: Initiate multipart upload
      const initiateResponse = await fetch('/api/files/multipart?action=initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type,
          fileSize: file.size,
        }),
      })

      if (!initiateResponse.ok) {
        throw new Error(`Failed to initiate multipart upload: ${initiateResponse.statusText}`)
      }

      const { uploadId, key } = await initiateResponse.json()
      logger.info(`Initiated multipart upload with ID: ${uploadId}`)

      // Step 2: Calculate parts
      const chunkSize = UPLOAD_CONFIG.CHUNK_SIZE
      const numParts = Math.ceil(file.size / chunkSize)
      const partNumbers = Array.from({ length: numParts }, (_, i) => i + 1)

      // Step 3: Get presigned URLs for all parts
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
        // Abort the multipart upload if we can't get URLs
        await fetch('/api/files/multipart?action=abort', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uploadId, key }),
        })
        throw new Error(`Failed to get part URLs: ${partUrlsResponse.statusText}`)
      }

      const { presignedUrls } = await partUrlsResponse.json()

      // Step 4: Upload parts in parallel (batch them to avoid overwhelming the browser)
      const uploadedParts: Array<{ ETag: string; PartNumber: number }> = []
      const PARALLEL_UPLOADS = 3 // Upload 3 parts at a time

      for (let i = 0; i < presignedUrls.length; i += PARALLEL_UPLOADS) {
        const batch = presignedUrls.slice(i, i + PARALLEL_UPLOADS)

        const batchPromises = batch.map(async ({ partNumber, url }: any) => {
          const start = (partNumber - 1) * chunkSize
          const end = Math.min(start + chunkSize, file.size)
          const chunk = file.slice(start, end)

          const uploadResponse = await fetch(url, {
            method: 'PUT',
            body: chunk,
            headers: {
              'Content-Type': file.type,
            },
          })

          if (!uploadResponse.ok) {
            throw new Error(`Failed to upload part ${partNumber}: ${uploadResponse.statusText}`)
          }

          // Get ETag from response headers
          const etag = uploadResponse.headers.get('ETag') || ''
          logger.info(`Uploaded part ${partNumber}/${numParts}`)

          return { ETag: etag.replace(/"/g, ''), PartNumber: partNumber }
        })

        const batchResults = await Promise.all(batchPromises)
        uploadedParts.push(...batchResults)
      }

      // Step 5: Complete multipart upload
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

      const fullFileUrl = path.startsWith('http') ? path : `${window.location.origin}${path}`

      return createUploadedFile(file.name, fullFileUrl, file.size, file.type, file)
    } catch (error) {
      logger.error(`Multipart upload failed for ${file.name}:`, error)
      // Fall back to direct upload if multipart fails
      logger.info('Falling back to direct upload')
      return uploadFileDirectly(file, presignedData)
    }
  }

  /**
   * Fallback upload through API
   */
  const uploadFileThroughAPI = async (file: File): Promise<UploadedFile> => {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), UPLOAD_CONFIG.UPLOAD_TIMEOUT)

    try {
      const formData = new FormData()
      formData.append('file', file)

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
          // Ignore JSON parsing errors
        }

        throw new DirectUploadError(
          `Failed to upload ${file.name}: ${errorData?.error || 'Unknown error'}`,
          errorData
        )
      }

      const uploadResult = await uploadResponse.json()

      // Validate upload result structure
      if (!uploadResult.path) {
        throw new DirectUploadError(
          `Invalid upload response for ${file.name}: missing file path`,
          uploadResult
        )
      }

      return createUploadedFile(
        file.name,
        uploadResult.path.startsWith('http')
          ? uploadResult.path
          : `${window.location.origin}${uploadResult.path}`,
        file.size,
        file.type,
        file
      )
    } finally {
      clearTimeout(timeoutId)
    }
  }

  /**
   * Upload files with a constant pool of concurrent uploads
   */
  const uploadFilesInBatches = async (files: File[]): Promise<UploadedFile[]> => {
    const uploadedFiles: UploadedFile[] = []
    const failedFiles: Array<{ file: File; error: Error }> = []

    // Initialize file statuses
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

    // Create a queue of files to upload
    const fileQueue = files.map((file, index) => ({ file, index }))
    const activeUploads = new Map<number, Promise<any>>()

    logger.info(
      `Starting upload of ${files.length} files with concurrency ${UPLOAD_CONFIG.BATCH_SIZE}`
    )

    // Function to start an upload for a file
    const startUpload = async (file: File, fileIndex: number) => {
      // Mark file as uploading (only if not already processing)
      setUploadProgress((prev) => {
        const currentStatus = prev.fileStatuses?.[fileIndex]?.status
        // Don't re-upload files that are already completed or currently uploading
        if (currentStatus === 'completed' || currentStatus === 'uploading') {
          return prev
        }
        return {
          ...prev,
          fileStatuses: prev.fileStatuses?.map((fs, idx) =>
            idx === fileIndex ? { ...fs, status: 'uploading' as const, progress: 0 } : fs
          ),
        }
      })

      try {
        const result = await uploadSingleFileWithRetry(file, 0, fileIndex)

        // Mark file as completed (with atomic update)
        setUploadProgress((prev) => {
          // Only mark as completed if still uploading (prevent race conditions)
          if (prev.fileStatuses?.[fileIndex]?.status === 'uploading') {
            return {
              ...prev,
              filesCompleted: prev.filesCompleted + 1,
              fileStatuses: prev.fileStatuses?.map((fs, idx) =>
                idx === fileIndex ? { ...fs, status: 'completed' as const, progress: 100 } : fs
              ),
            }
          }
          return prev
        })

        uploadedFiles.push(result)
        return { success: true, file, result }
      } catch (error) {
        // Mark file as failed (with atomic update)
        setUploadProgress((prev) => {
          // Only mark as failed if still uploading
          if (prev.fileStatuses?.[fileIndex]?.status === 'uploading') {
            return {
              ...prev,
              fileStatuses: prev.fileStatuses?.map((fs, idx) =>
                idx === fileIndex
                  ? {
                      ...fs,
                      status: 'failed' as const,
                      error: error instanceof Error ? error.message : 'Upload failed',
                    }
                  : fs
              ),
            }
          }
          return prev
        })

        failedFiles.push({
          file,
          error: error instanceof Error ? error : new Error(String(error)),
        })

        return {
          success: false,
          file,
          error: error instanceof Error ? error : new Error(String(error)),
        }
      }
    }

    // Process files with constant concurrency pool
    while (fileQueue.length > 0 || activeUploads.size > 0) {
      // Start new uploads up to the batch size limit
      while (fileQueue.length > 0 && activeUploads.size < UPLOAD_CONFIG.BATCH_SIZE) {
        const { file, index } = fileQueue.shift()!
        const uploadPromise = startUpload(file, index).finally(() => {
          activeUploads.delete(index)
        })
        activeUploads.set(index, uploadPromise)
      }

      // Wait for at least one upload to complete if we're at capacity or done with queue
      if (activeUploads.size > 0) {
        await Promise.race(Array.from(activeUploads.values()))
      }
    }

    // Report failed files
    if (failedFiles.length > 0) {
      logger.error(`Failed to upload ${failedFiles.length} files:`, failedFiles)
      const errorMessage = `Failed to upload ${failedFiles.length} file(s): ${failedFiles.map((f) => f.file.name).join(', ')}`
      throw new KnowledgeUploadError(errorMessage, 'PARTIAL_UPLOAD_FAILURE', {
        failedFiles,
        uploadedFiles,
      })
    }

    return uploadedFiles
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

      // Upload files in batches with retry logic
      const uploadedFiles = await uploadFilesInBatches(files)

      setUploadProgress((prev) => ({ ...prev, stage: 'processing' }))

      // Start async document processing
      const processPayload = {
        documents: uploadedFiles.map((file) => ({
          ...file,
          // Tags are already included in the file object from createUploadedFile
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
          // Ignore JSON parsing errors
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

      // Validate process result structure
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

      // Call success callback
      options.onUploadComplete?.(uploadedFiles)

      return uploadedFiles
    } catch (err) {
      logger.error('Error uploading documents:', err)

      const error = createErrorFromException(err, 'Unknown error occurred during upload')
      setUploadError(error)
      options.onError?.(error)

      // Show user-friendly error message in console for debugging
      console.error('Document upload failed:', error.message)

      throw err
    } finally {
      setIsUploading(false)
      setUploadProgress({ stage: 'idle', filesCompleted: 0, totalFiles: 0 })
    }
  }

  const clearError = () => {
    setUploadError(null)
  }

  return {
    isUploading,
    uploadProgress,
    uploadError,
    uploadFiles,
    clearError,
  }
}
