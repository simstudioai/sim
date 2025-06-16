import { type Chunk, TextChunker } from '@/lib/documents/chunker'
import { env } from '@/lib/env'
import { parseBuffer, parseFile } from '@/lib/file-parsers'
import { createLogger } from '@/lib/logs/console-logger'
import { getPresignedUrlWithConfig, getStorageProvider, uploadFile } from '@/lib/uploads'
import { BLOB_KB_CONFIG, S3_KB_CONFIG } from '@/lib/uploads/setup'
import { mistralParserTool } from '@/tools/mistral/parser'
import { retryWithExponentialBackoff } from './utils'

const logger = createLogger('DocumentProcessor')

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

    // Download the file content
    const response = await fetch(fileUrl)
    if (!response.ok) {
      throw new Error(`Failed to download file for cloud upload: ${response.statusText}`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())

    // Always upload to cloud storage for Mistral OCR, even in development
    const kbConfig = getKBConfig()
    const provider = getStorageProvider()

    if (provider === 'blob') {
      const blobConfig = kbConfig as BlobConfig
      if (!blobConfig.containerName || !blobConfig.accountName) {
        throw new Error(
          'Azure Blob configuration missing: AZURE_ACCOUNT_NAME and AZURE_KB_CONTAINER_NAME environment variables are required for PDF processing with Mistral OCR'
        )
      }
    } else {
      const s3Config = kbConfig as S3Config
      if (!s3Config.bucket || !s3Config.region) {
        throw new Error(
          'S3 configuration missing: AWS_REGION and S3_KB_BUCKET_NAME environment variables are required for PDF processing with Mistral OCR'
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
        // Get the URL from the tool
        const url =
          typeof mistralParserTool.request!.url === 'function'
            ? mistralParserTool.request!.url({
                filePath: httpsUrl,
                apiKey: mistralApiKey,
                resultType: 'text',
              })
            : mistralParserTool.request!.url

        // Get headers from the tool
        const headers =
          typeof mistralParserTool.request!.headers === 'function'
            ? mistralParserTool.request!.headers({
                filePath: httpsUrl,
                apiKey: mistralApiKey,
                resultType: 'text',
              })
            : mistralParserTool.request!.headers

        const res = await fetch(url, {
          method: mistralParserTool.request!.method,
          headers,
          body: JSON.stringify(requestBody),
        })

        if (!res.ok) {
          const errorText = await res.text()
          throw new APIError(
            `Mistral OCR failed: ${res.status} ${res.statusText} - ${errorText}`,
            res.status
          )
        }

        return res
      },
      {
        maxRetries: 3,
        initialDelayMs: 1000,
        maxDelayMs: 10000,
      }
    )

    // Use the tool's transformResponse function to process the response
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
    // Log the full error details for debugging
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

    if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
      // Download and parse remote file
      const response = await fetch(fileUrl)
      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.status} ${response.statusText}`)
      }

      const buffer = Buffer.from(await response.arrayBuffer())

      // Extract file extension from filename
      const extension = filename.split('.').pop()?.toLowerCase() || ''
      if (!extension) {
        throw new Error(`Could not determine file extension from filename: ${filename}`)
      }

      const result = await parseBuffer(buffer, extension)
      content = result.content
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
