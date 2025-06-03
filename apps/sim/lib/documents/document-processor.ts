import { RecursiveChunker } from 'chonkie/cloud'
import type { RecursiveChunk } from 'chonkie/types'
import { env } from '@/lib/env'
import { isSupportedFileType, parseBuffer, parseFile } from '@/lib/file-parsers'
import { createLogger } from '@/lib/logs/console-logger'
import { type CustomS3Config, getPresignedUrlWithConfig, uploadToS3 } from '@/lib/uploads/s3-client'
import { mistralParserTool } from '@/tools/mistral/parser'
import { retryWithExponentialBackoff } from './utils'

const logger = createLogger('DocumentProcessor')

const S3_KB_CONFIG: CustomS3Config = {
  bucket: env.S3_KB_BUCKET_NAME || '',
  region: env.AWS_REGION || '',
}

class APIError extends Error {
  public status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'APIError'
    this.status = status
  }
}

export interface ProcessedDocument {
  content: string
  chunks: RecursiveChunk[]
  metadata: {
    filename: string
    fileSize: number
    mimeType: string
    characterCount: number
    tokenCount: number
    chunkCount: number
    processingMethod: 'file-parser' | 'mistral-ocr'
    s3Url?: string
  }
}

export interface DocumentProcessingOptions {
  knowledgeBaseId: string
  chunkSize?: number
  minCharactersPerChunk?: number
  recipe?: string
  lang?: string
}

/**
 * Determines the appropriate processing method for a file based on its type
 */
function determineProcessingMethod(
  mimeType: string,
  filename: string
): 'file-parser' | 'mistral-ocr' {
  // Use Mistral OCR for PDFs since it provides better results
  if (mimeType === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')) {
    return 'mistral-ocr'
  }

  // Extract file extension for supported file type check
  const extension = filename.split('.').pop()?.toLowerCase()

  // Use file parser for supported non-PDF types
  if (extension && isSupportedFileType(extension)) {
    return 'file-parser'
  }

  // For unsupported types, try file parser first (it might handle text files)
  return 'file-parser'
}

/**
 * Parse a document using the appropriate method (file parser or Mistral OCR)
 */
async function parseDocument(
  fileUrl: string,
  filename: string,
  mimeType: string
): Promise<{ content: string; processingMethod: 'file-parser' | 'mistral-ocr'; s3Url?: string }> {
  const processingMethod = determineProcessingMethod(mimeType, filename)

  logger.info(`Processing document "${filename}" using ${processingMethod}`)

  try {
    if (processingMethod === 'mistral-ocr') {
      // Use Mistral OCR for PDFs - but first ensure we have an HTTPS URL
      const mistralApiKey = env.MISTRAL_API_KEY
      if (!mistralApiKey) {
        throw new Error('MISTRAL_API_KEY not configured')
      }

      let httpsUrl = fileUrl
      let s3Url: string | undefined

      // If the URL is not HTTPS, we need to upload to S3 first
      if (!fileUrl.startsWith('https://')) {
        logger.info(`Uploading "${filename}" to S3 for Mistral OCR access`)

        // Download the file content
        const response = await fetch(fileUrl)
        if (!response.ok) {
          throw new Error(`Failed to download file for S3 upload: ${response.statusText}`)
        }

        const buffer = Buffer.from(await response.arrayBuffer())

        // Always upload to S3 for Mistral OCR, even in development
        if (!S3_KB_CONFIG.bucket || !S3_KB_CONFIG.region) {
          throw new Error(
            'S3 configuration missing: AWS_REGION and S3_KB_BUCKET_NAME environment variables are required for PDF processing with Mistral OCR'
          )
        }

        try {
          // Upload to S3
          const s3Result = await uploadToS3(buffer, filename, mimeType, S3_KB_CONFIG)
          // Generate presigned URL with 15 minutes expiration
          httpsUrl = await getPresignedUrlWithConfig(s3Result.key, S3_KB_CONFIG, 900)
          s3Url = httpsUrl
          logger.info(`Successfully uploaded to S3 for Mistral OCR: ${s3Result.key}`)
        } catch (uploadError) {
          logger.error('Failed to upload to S3 for Mistral OCR:', uploadError)
          throw new Error(
            `S3 upload failed: ${uploadError instanceof Error ? uploadError.message : 'Unknown error'}. S3 upload is required for PDF processing with Mistral OCR.`
          )
        }
      }

      if (!mistralParserTool.request?.body) {
        throw new Error('Mistral parser tool not properly configured')
      }

      const requestBody = mistralParserTool.request.body({
        filePath: httpsUrl,
        apiKey: mistralApiKey,
        resultType: 'text',
      })

      // Make the actual API call to Mistral with retry logic
      const response = await retryWithExponentialBackoff(
        async () => {
          logger.info(`Calling Mistral OCR API for "${filename}"`)

          const response = await fetch('https://api.mistral.ai/v1/ocr', {
            method: mistralParserTool.request.method,
            headers: mistralParserTool.request.headers({
              filePath: httpsUrl,
              apiKey: mistralApiKey,
              resultType: 'text',
            }),
            body: JSON.stringify(requestBody),
          })

          if (!response.ok) {
            const errorText = await response.text()
            const error = new APIError(
              `Mistral API error: ${response.status} ${response.statusText} - ${errorText}`,
              response.status
            )
            throw error
          }

          return response
        },
        {
          maxRetries: 5,
          initialDelayMs: 2000, // Start with 2 seconds for Mistral OCR
          maxDelayMs: 120000, // Max 2 minutes delay for OCR processing
          backoffMultiplier: 2,
        }
      )

      if (!mistralParserTool.transformResponse) {
        throw new Error('Mistral parser transform function not available')
      }

      const result = await mistralParserTool.transformResponse(response, {
        filePath: httpsUrl,
        apiKey: mistralApiKey,
        resultType: 'text',
      })

      if (!result.success) {
        throw new Error('Mistral OCR processing failed')
      }

      return {
        content: result.output.content,
        processingMethod: 'mistral-ocr',
        s3Url,
      }
    }

    // Use file parser for other supported types
    let content: string

    if (fileUrl.startsWith('http')) {
      // Download the file and parse buffer
      const response = await fetch(fileUrl)
      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.statusText}`)
      }

      const buffer = Buffer.from(await response.arrayBuffer())
      const extension = filename.split('.').pop()?.toLowerCase()

      if (!extension) {
        throw new Error('Could not determine file extension')
      }

      const parseResult = await parseBuffer(buffer, extension)
      content = parseResult.content
    } else {
      // Local file path
      const parseResult = await parseFile(fileUrl)
      content = parseResult.content
    }

    return {
      content,
      processingMethod: 'file-parser',
    }
  } catch (error) {
    logger.error(`Failed to parse document "${filename}":`, error)
    throw new Error(
      `Document parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * Chunk text content using RecursiveChunker
 */
async function chunkContent(
  content: string,
  options: DocumentProcessingOptions
): Promise<RecursiveChunk[]> {
  const apiKey = env.CHONKIE_API_KEY
  if (!apiKey) {
    throw new Error('CHONKIE_API_KEY not configured')
  }

  const chunker = new RecursiveChunker(apiKey, {
    chunkSize: options.chunkSize || 512,
    recipe: options.recipe || 'default',
    lang: options.lang || 'en',
    minCharactersPerChunk: options.minCharactersPerChunk || 24,
  })

  try {
    logger.info('Chunking content with RecursiveChunker', {
      contentLength: content.length,
      chunkSize: options.chunkSize || 512,
    })

    const chunks = await chunker.chunk({ text: content })

    logger.info(`Successfully created ${chunks.length} chunks`)
    return chunks as RecursiveChunk[]
  } catch (error) {
    logger.error('Chunking failed:', error)
    throw new Error(
      `Text chunking failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    )
  }
}

/**
 * Calculate token count estimation (rough approximation: 4 chars per token)
 */
function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Process a single document: parse content and create chunks
 */
export async function processDocument(
  fileUrl: string,
  filename: string,
  mimeType: string,
  fileSize: number,
  options: DocumentProcessingOptions
): Promise<ProcessedDocument> {
  const startTime = Date.now()
  logger.info(`Starting document processing for "${filename}"`)

  try {
    // Step 1: Parse the document
    const { content, processingMethod, s3Url } = await parseDocument(fileUrl, filename, mimeType)

    if (!content || content.trim().length === 0) {
      throw new Error('No content extracted from document')
    }

    // Step 2: Chunk the content
    const chunks = await chunkContent(content, options)

    if (chunks.length === 0) {
      throw new Error('No chunks created from content')
    }

    // Step 3: Calculate metadata
    const characterCount = content.length
    const tokenCount = estimateTokenCount(content)
    const chunkCount = chunks.length

    const processedDocument: ProcessedDocument = {
      content,
      chunks,
      metadata: {
        filename,
        fileSize,
        mimeType,
        characterCount,
        tokenCount,
        chunkCount,
        processingMethod,
        s3Url,
      },
    }

    const processingTime = Date.now() - startTime
    logger.info(`Document processing completed for "${filename}"`, {
      processingTime: `${processingTime}ms`,
      contentLength: characterCount,
      chunkCount,
      tokenCount,
      processingMethod,
    })

    return processedDocument
  } catch (error) {
    const processingTime = Date.now() - startTime
    logger.error(`Document processing failed for "${filename}" after ${processingTime}ms:`, error)
    throw error
  }
}

/**
 * Process multiple documents in parallel
 */
export async function processDocuments(
  documents: Array<{
    fileUrl: string
    filename: string
    mimeType: string
    fileSize: number
  }>,
  options: DocumentProcessingOptions
): Promise<ProcessedDocument[]> {
  const startTime = Date.now()
  logger.info(`Starting batch processing of ${documents.length} documents`)

  try {
    // Process all documents in parallel
    const processingPromises = documents.map((doc) =>
      processDocument(doc.fileUrl, doc.filename, doc.mimeType, doc.fileSize, options)
    )

    const results = await Promise.allSettled(processingPromises)

    // Separate successful and failed results
    const successfulResults: ProcessedDocument[] = []
    const errors: string[] = []

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successfulResults.push(result.value)
      } else {
        const filename = documents[index].filename
        const errorMessage =
          result.reason instanceof Error ? result.reason.message : 'Unknown error'
        errors.push(`${filename}: ${errorMessage}`)
        logger.error(`Failed to process document "${filename}":`, result.reason)
      }
    })

    const processingTime = Date.now() - startTime
    logger.info(`Batch processing completed in ${processingTime}ms`, {
      totalDocuments: documents.length,
      successful: successfulResults.length,
      failed: errors.length,
    })

    if (errors.length > 0) {
      logger.warn('Some documents failed to process:', errors)
    }

    if (successfulResults.length === 0) {
      throw new Error(`All documents failed to process. Errors: ${errors.join('; ')}`)
    }

    return successfulResults
  } catch (error) {
    const processingTime = Date.now() - startTime
    logger.error(`Batch processing failed after ${processingTime}ms:`, error)
    throw error
  }
}
