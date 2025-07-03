import { useState } from 'react'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('KnowledgeUpload')

export interface UploadedFile {
  filename: string
  fileUrl: string
  fileSize: number
  mimeType: string
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
    mimeType: string
  ): UploadedFile => ({
    filename,
    fileUrl,
    fileSize,
    mimeType,
  })

  const uploadFiles = async (
    files: File[],
    knowledgeBaseId: string,
    processingOptions: ProcessingOptions = {}
  ): Promise<UploadedFile[]> => {
    if (files.length === 0) return []

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
          const presignedResponse = await fetch('/api/knowledge/presigned', {
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

          const presignedData = await presignedResponse.json()

          if (presignedResponse.ok && presignedData.directUploadSupported) {
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
              throw new Error(
                `Direct upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`
              )
            }

            // Convert relative path to full URL for schema validation
            const fullFileUrl = presignedData.fileInfo.path.startsWith('http')
              ? presignedData.fileInfo.path
              : `${window.location.origin}${presignedData.fileInfo.path}`

            uploadedFiles.push(createUploadedFile(file.name, fullFileUrl, file.size, file.type))
          } else {
            // Fallback to traditional upload through API route
            const formData = new FormData()
            formData.append('file', file)

            const uploadResponse = await fetch('/api/files/upload', {
              method: 'POST',
              body: formData,
            })

            if (!uploadResponse.ok) {
              const errorData = await uploadResponse.json()
              throw new Error(
                `Failed to upload ${file.name}: ${errorData.error || 'Unknown error'}`
              )
            }

            const uploadResult = await uploadResponse.json()

            // Validate upload result structure
            if (!uploadResult.path) {
              throw new Error(`Invalid upload response for ${file.name}: missing file path`)
            }

            uploadedFiles.push(
              createUploadedFile(
                file.name,
                uploadResult.path.startsWith('http')
                  ? uploadResult.path
                  : `${window.location.origin}${uploadResult.path}`,
                file.size,
                file.type
              )
            )
          }
        } catch (fileError) {
          logger.error(`Error uploading file ${file.name}:`, fileError)
          throw new Error(
            `Failed to upload ${file.name}: ${fileError instanceof Error ? fileError.message : 'Unknown error'}`
          )
        }
      }

      setUploadProgress((prev) => ({ ...prev, stage: 'processing' }))

      // Start async document processing
      const processResponse = await fetch(`/api/knowledge/${knowledgeBaseId}/documents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          documents: uploadedFiles,
          processingOptions: {
            chunkSize: processingOptions.chunkSize || 1024,
            minCharactersPerChunk: processingOptions.minCharactersPerChunk || 100,
            chunkOverlap: processingOptions.chunkOverlap || 200,
            recipe: processingOptions.recipe || 'default',
            lang: 'en',
          },
          bulk: true,
        }),
      })

      if (!processResponse.ok) {
        const errorData = await processResponse.json()
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
        throw new Error(
          `Failed to start document processing: ${errorData.error || errorData.message || 'Unknown error'}`
        )
      }

      const processResult = await processResponse.json()

      // Validate process result structure
      if (!processResult.success) {
        throw new Error(`Document processing failed: ${processResult.error || 'Unknown error'}`)
      }

      if (!processResult.data || !processResult.data.documentsCreated) {
        throw new Error('Invalid processing response: missing document data')
      }

      setUploadProgress((prev) => ({ ...prev, stage: 'completing' }))

      logger.info(`Successfully started processing ${uploadedFiles.length} documents`)

      // Call success callback
      options.onUploadComplete?.(uploadedFiles)

      return uploadedFiles
    } catch (err) {
      logger.error('Error uploading documents:', err)

      const errorMessage =
        err instanceof Error ? err.message : 'Unknown error occurred during upload'
      const error: UploadError = {
        message: errorMessage,
        timestamp: Date.now(),
      }

      setUploadError(error)
      options.onError?.(error)

      // Show user-friendly error message in console for debugging
      console.error('Document upload failed:', errorMessage)

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
