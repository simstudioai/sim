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

export interface UploadProgress {
  stage: 'idle' | 'uploading' | 'processing' | 'completing'
  filesCompleted: number
  totalFiles: number
  currentFile?: string
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

      const uploadedFiles: UploadedFile[] = []

      // Upload all files using presigned URLs
      for (const [index, file] of files.entries()) {
        setUploadProgress((prev) => ({
          ...prev,
          currentFile: file.name,
          filesCompleted: index,
        }))

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
          })

          if (!presignedResponse.ok) {
            let errorDetails: any = null
            try {
              errorDetails = await presignedResponse.json()
            } catch {
              // Ignore JSON parsing errors
            }

            throw new PresignedUrlError(
              `Failed to get presigned URL for ${file.name}: ${presignedResponse.status} ${presignedResponse.statusText}`,
              errorDetails
            )
          }

          const presignedData = await presignedResponse.json()

          if (presignedData.directUploadSupported) {
            // Use presigned URL for direct upload
            const uploadHeaders: Record<string, string> = {
              'Content-Type': file.type,
            }

            // Add Azure-specific headers if provided
            if (presignedData.uploadHeaders) {
              Object.assign(uploadHeaders, presignedData.uploadHeaders)
            }

            const uploadResponse = await fetch(presignedData.presignedUrl, {
              method: 'PUT',
              headers: uploadHeaders,
              body: file,
            })

            if (!uploadResponse.ok) {
              throw new DirectUploadError(
                `Direct upload failed for ${file.name}: ${uploadResponse.status} ${uploadResponse.statusText}`,
                { uploadResponse: uploadResponse.statusText }
              )
            }

            // Convert relative path to full URL for schema validation
            const fullFileUrl = presignedData.fileInfo.path.startsWith('http')
              ? presignedData.fileInfo.path
              : `${window.location.origin}${presignedData.fileInfo.path}`

            uploadedFiles.push(
              createUploadedFile(file.name, fullFileUrl, file.size, file.type, file)
            )
          } else {
            // Fallback to traditional upload through API route
            const formData = new FormData()
            formData.append('file', file)

            const uploadResponse = await fetch('/api/files/upload', {
              method: 'POST',
              body: formData,
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

            uploadedFiles.push(
              createUploadedFile(
                file.name,
                uploadResult.path.startsWith('http')
                  ? uploadResult.path
                  : `${window.location.origin}${uploadResult.path}`,
                file.size,
                file.type,
                file
              )
            )
          }
        } catch (fileError) {
          logger.error(`Error uploading file ${file.name}:`, fileError)
          throw fileError // Re-throw to be caught by outer try-catch
        }
      }

      setUploadProgress((prev) => ({ ...prev, stage: 'processing' }))

      // Start async document processing
      const processPayload = {
        documents: uploadedFiles.map((file) => ({
          ...file,
          // Extract tags from file if they exist (added by upload modal)
          tag1: (file as any).tag1,
          tag2: (file as any).tag2,
          tag3: (file as any).tag3,
          tag4: (file as any).tag4,
          tag5: (file as any).tag5,
          tag6: (file as any).tag6,
          tag7: (file as any).tag7,
        })),
        processingOptions: {
          chunkSize: processingOptions.chunkSize || 1024,
          minCharactersPerChunk: processingOptions.minCharactersPerChunk || 100,
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
