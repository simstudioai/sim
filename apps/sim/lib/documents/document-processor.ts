import { type Chunk, TextChunker } from '@/lib/documents/chunker'
import { retryWithExponentialBackoff } from '@/lib/documents/utils'
import { env } from '@/lib/env'
import { parseBuffer, parseFile } from '@/lib/file-parsers'
import { createLogger } from '@/lib/logs/console-logger'
import { getPresignedUrlWithConfig, getStorageProvider, uploadFile } from '@/lib/uploads'
import { BLOB_KB_CONFIG, S3_KB_CONFIG } from '@/lib/uploads/setup'
import { mistralParserTool } from '@/tools/mistral/parser'

const logger = createLogger('DocumentProcessor')

// Timeout constants (in milliseconds)
const TIMEOUTS = {
  FILE_DOWNLOAD: 60000, // 60 seconds
  MISTRAL_OCR_API: 90000, // 90 seconds
} as const

type S3Config = {
  bucket: string
  region: string
}

type BlobConfig = {
  containerName: string
  accountName: string
  accountKey?: string
  connectionString?: string
}

function getKBConfig(): S3Config | BlobConfig {
  const provider = getStorageProvider()
  if (provider === 'blob') {
    return {
      containerName: BLOB_KB_CONFIG.containerName,
      accountName: BLOB_KB_CONFIG.accountName,
      accountKey: BLOB_KB_CONFIG.accountKey,
      connectionString: BLOB_KB_CONFIG.connectionString,
    }
  }
  return {
    bucket: S3_KB_CONFIG.bucket,
    region: S3_KB_CONFIG.region,
  }
}

class APIError extends Error {
  public status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'APIError'
    this.status = status
  }
}

/**
 * Process a document by parsing it and chunking the content
 */
export async function processDocument(
  fileUrl: string,
  filename: string,
  mimeType: string,
  chunkSize = 1000,
  chunkOverlap = 200
): Promise<{
  chunks: Chunk[]
  metadata: {
    filename: string
    fileSize: number
    mimeType: string
    chunkCount: number
    tokenCount: number
    characterCount: number
    processingMethod: 'file-parser' | 'mistral-ocr'
    cloudUrl?: string
  }
}> {
  logger.info(`Processing document: ${filename}`)

  try {
    // Parse the document
    const { content, processingMethod, cloudUrl } = await parseDocument(fileUrl, filename, mimeType)

    // Create chunker and process content
    const chunker = new TextChunker({
      chunkSize,
      overlap: chunkOverlap,
    })

    const chunks = await chunker.chunk(content)

    // Calculate metadata
    const characterCount = content.length
    const tokenCount = chunks.reduce((sum: number, chunk: Chunk) => sum + chunk.tokenCount, 0)

    logger.info(`Document processed successfully: ${chunks.length} chunks, ${tokenCount} tokens`)

    return {
      chunks,
      metadata: {
        filename,
        fileSize: content.length, // Using content length as file size approximation
        mimeType,
        chunkCount: chunks.length,
        tokenCount,
        characterCount,
        processingMethod,
        cloudUrl,
      },
    }
  } catch (error) {
    logger.error(`Error processing document ${filename}:`, error)
    throw error
  }
}

/**
 * Parse a document from a URL or file path
 */
async function parseDocument(
  fileUrl: string,
  filename: string,
  mimeType: string
): Promise<{
  content: string
  processingMethod: 'file-parser' | 'mistral-ocr'
  cloudUrl?: string
}> {
  // Check if we should use Mistral OCR for PDFs
  const shouldUseMistralOCR = mimeType === 'application/pdf' && env.MISTRAL_API_KEY

  if (shouldUseMistralOCR) {
    logger.info(`Using Mistral OCR for PDF: ${filename}`)
    return await parseWithMistralOCR(fileUrl, filename, mimeType)
  }

  // Use standard file parser
  logger.info(`Using file parser for: ${filename}`)
  return await parseWithFileParser(fileUrl, filename, mimeType)
}

/**
 * Parse document using Mistral OCR
 */
async function parseWithMistralOCR(
  fileUrl: string,
  filename: string,
  mimeType: string
): Promise<{
  content: string
  processingMethod: 'file-parser' | 'mistral-ocr'
  cloudUrl?: string
}> {
  const mistralApiKey = env.MISTRAL_API_KEY
  if (!mistralApiKey) {
    throw new Error('Mistral API key is required for OCR processing')
  }

  let httpsUrl = fileUrl
  let cloudUrl: string | undefined

  // If the URL is not HTTPS, we need to upload to cloud storage first
  if (!fileUrl.startsWith('https://')) {
    logger.info(`Uploading "${filename}" to cloud storage for Mistral OCR access`)

    // Download the file content with timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUTS.FILE_DOWNLOAD)

    try {
      const response = await fetch(fileUrl, { signal: controller.signal })
      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`Failed to download file for cloud upload: ${response.statusText}`)
      }

      const buffer = Buffer.from(await response.arrayBuffer())

      // Always upload to cloud storage for Mistral OCR, even in development
      const kbConfig = getKBConfig()
      const provider = getStorageProvider()

      if (provider === 'blob') {
        const blobConfig = kbConfig as BlobConfig
        if (
          !blobConfig.containerName ||
          (!blobConfig.connectionString && (!blobConfig.accountName || !blobConfig.accountKey))
        ) {
          throw new Error(
            'Azure Blob configuration missing for PDF processing with Mistral OCR. Set AZURE_CONNECTION_STRING or both AZURE_ACCOUNT_NAME + AZURE_ACCOUNT_KEY, and AZURE_KB_CONTAINER_NAME.'
          )
        }
      } else {
        const s3Config = kbConfig as S3Config
        if (!s3Config.bucket || !s3Config.region) {
          throw new Error(
            'S3 configuration missing for PDF processing with Mistral OCR. Set AWS_REGION and S3_KB_BUCKET_NAME environment variables.'
          )
        }
      }

      try {
        // Upload to cloud storage
        const cloudResult = await uploadFile(buffer, filename, mimeType, kbConfig as any)
        // Generate presigned URL with 15 minutes expiration
        httpsUrl = await getPresignedUrlWithConfig(cloudResult.key, kbConfig as any, 900)
        cloudUrl = httpsUrl
        logger.info(`Successfully uploaded to cloud storage for Mistral OCR: ${cloudResult.key}`)
      } catch (uploadError) {
        logger.error('Failed to upload to cloud storage for Mistral OCR:', uploadError)
        throw new Error(
          `Cloud upload failed: ${uploadError instanceof Error ? uploadError.message : 'Unknown error'}. Cloud upload is required for PDF processing with Mistral OCR.`
        )
      }
    } catch (error) {
      clearTimeout(timeoutId)
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('File download timed out for Mistral OCR processing')
      }
      throw error
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

  try {
    const response = await retryWithExponentialBackoff(
      async () => {
        const url =
          typeof mistralParserTool.request!.url === 'function'
            ? mistralParserTool.request!.url({
                filePath: httpsUrl,
                apiKey: mistralApiKey,
                resultType: 'text',
              })
            : mistralParserTool.request!.url

        const headers =
          typeof mistralParserTool.request!.headers === 'function'
            ? mistralParserTool.request!.headers({
                filePath: httpsUrl,
                apiKey: mistralApiKey,
                resultType: 'text',
              })
            : mistralParserTool.request!.headers

        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUTS.MISTRAL_OCR_API)

        try {
          const res = await fetch(url, {
            method: mistralParserTool.request!.method,
            headers,
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          })

          clearTimeout(timeoutId)

          if (!res.ok) {
            const errorText = await res.text()
            throw new APIError(
              `Mistral OCR failed: ${res.status} ${res.statusText} - ${errorText}`,
              res.status
            )
          }

          return res
        } catch (error) {
          clearTimeout(timeoutId)
          if (error instanceof Error && error.name === 'AbortError') {
            throw new Error('Mistral OCR API request timed out')
          }
          throw error
        }
      },
      {
        maxRetries: 3,
        initialDelayMs: 1000,
        maxDelayMs: 10000,
      }
    )

    const result = await mistralParserTool.transformResponse!(response, {
      filePath: httpsUrl,
      apiKey: mistralApiKey,
      resultType: 'text',
    })

    if (!result.success) {
      throw new Error(`Mistral OCR processing failed: ${result.error || 'Unknown error'}`)
    }

    const content = result.output?.content || ''
    if (!content.trim()) {
      throw new Error('Mistral OCR returned empty content')
    }

    logger.info(`Mistral OCR completed successfully for ${filename}`)
    return {
      content,
      processingMethod: 'mistral-ocr',
      cloudUrl,
    }
  } catch (error) {
    logger.error(`Mistral OCR failed for ${filename}:`, {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      name: error instanceof Error ? error.name : 'Unknown',
    })

    // Fall back to file parser
    logger.info(`Falling back to file parser for ${filename}`)
    return await parseWithFileParser(fileUrl, filename, mimeType)
  }
}

/**
 * Parse document using standard file parser
 */
async function parseWithFileParser(
  fileUrl: string,
  filename: string,
  mimeType: string
): Promise<{
  content: string
  processingMethod: 'file-parser' | 'mistral-ocr'
  cloudUrl?: string
}> {
  try {
    let content: string

    if (fileUrl.startsWith('data:')) {
      logger.info(`Processing data URI for: ${filename}`)

      try {
        const [header, base64Data] = fileUrl.split(',')
        if (!base64Data) {
          throw new Error('Invalid data URI format')
        }

        if (header.includes('base64')) {
          const buffer = Buffer.from(base64Data, 'base64')
          content = buffer.toString('utf8')
        } else {
          content = decodeURIComponent(base64Data)
        }

        if (mimeType === 'text/plain') {
          logger.info(`Data URI processed successfully for text content: ${filename}`)
        } else {
          const extension = filename.split('.').pop()?.toLowerCase() || 'txt'
          const buffer = Buffer.from(base64Data, 'base64')
          const result = await parseBuffer(buffer, extension)
          content = result.content
        }
      } catch (error) {
        throw new Error(
          `Failed to process data URI: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      }
    } else if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), TIMEOUTS.FILE_DOWNLOAD)

      try {
        const response = await fetch(fileUrl, { signal: controller.signal })
        clearTimeout(timeoutId)

        if (!response.ok) {
          throw new Error(`Failed to download file: ${response.status} ${response.statusText}`)
        }

        const buffer = Buffer.from(await response.arrayBuffer())

        const extension = filename.split('.').pop()?.toLowerCase() || ''
        if (!extension) {
          throw new Error(`Could not determine file extension from filename: ${filename}`)
        }

        const result = await parseBuffer(buffer, extension)
        content = result.content
      } catch (error) {
        clearTimeout(timeoutId)
        if (error instanceof Error && error.name === 'AbortError') {
          throw new Error('File download timed out')
        }
        throw error
      }
    } else {
      // Parse local file
      const result = await parseFile(fileUrl)
      content = result.content
    }

    if (!content.trim()) {
      throw new Error('File parser returned empty content')
    }

    return {
      content,
      processingMethod: 'file-parser',
    }
  } catch (error) {
    logger.error(`File parser failed for ${filename}:`, error)
    throw error
  }
}
