import { type Chunk, JsonYamlChunker, StructuredDataChunker, TextChunker } from '@/lib/chunkers'
import { env } from '@/lib/env'
import { parseBuffer, parseFile } from '@/lib/file-parsers'
import { retryWithExponentialBackoff } from '@/lib/knowledge/documents/utils'
import { createLogger } from '@/lib/logs/console/logger'
import { StorageService } from '@/lib/uploads'
import { downloadFileFromUrl } from '@/lib/uploads/utils/file-utils.server'
import { mistralParserTool } from '@/tools/mistral/parser'

const logger = createLogger('DocumentProcessor')

const TIMEOUTS = {
  FILE_DOWNLOAD: 180000,
  MISTRAL_OCR_API: 120000,
} as const

type OCRResult = {
  success: boolean
  error?: string
  output?: {
    content?: string
  }
}

type OCRPage = {
  markdown?: string
}

type OCRRequestBody = {
  model: string
  document: {
    type: string
    document_url: string
  }
  include_image_base64: boolean
}

type AzureOCRResponse = {
  pages?: OCRPage[]
  [key: string]: unknown
}

class APIError extends Error {
  public status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'APIError'
    this.status = status
  }
}

export async function processDocument(
  fileUrl: string,
  filename: string,
  mimeType: string,
  chunkSize = 1000,
  chunkOverlap = 200,
  minChunkSize = 1,
  userId?: string,
  workspaceId?: string | null
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
    const parseResult = await parseDocument(fileUrl, filename, mimeType, userId, workspaceId)
    const { content, processingMethod } = parseResult
    const cloudUrl = 'cloudUrl' in parseResult ? parseResult.cloudUrl : undefined

    let chunks: Chunk[]
    const metadata = 'metadata' in parseResult ? parseResult.metadata : {}

    const isJsonYaml =
      metadata.type === 'json' ||
      metadata.type === 'yaml' ||
      mimeType.includes('json') ||
      mimeType.includes('yaml')

    if (isJsonYaml && JsonYamlChunker.isStructuredData(content)) {
      logger.info('Using JSON/YAML chunker for structured data')
      chunks = await JsonYamlChunker.chunkJsonYaml(content, {
        chunkSize,
        minChunkSize,
      })
    } else if (StructuredDataChunker.isStructuredData(content, mimeType)) {
      logger.info('Using structured data chunker for spreadsheet/CSV content')
      chunks = await StructuredDataChunker.chunkStructuredData(content, {
        headers: metadata.headers,
        totalRows: metadata.totalRows || metadata.rowCount,
        sheetName: metadata.sheetNames?.[0],
      })
    } else {
      const chunker = new TextChunker({ chunkSize, overlap: chunkOverlap, minChunkSize })
      chunks = await chunker.chunk(content)
    }

    const characterCount = content.length
    const tokenCount = chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0)

    logger.info(`Document processed: ${chunks.length} chunks, ${tokenCount} tokens`)

    return {
      chunks,
      metadata: {
        filename,
        fileSize: characterCount,
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

async function parseDocument(
  fileUrl: string,
  filename: string,
  mimeType: string,
  userId?: string,
  workspaceId?: string | null
): Promise<{
  content: string
  processingMethod: 'file-parser' | 'mistral-ocr'
  cloudUrl?: string
  metadata?: any
}> {
  const isPDF = mimeType === 'application/pdf'
  const hasAzureMistralOCR =
    env.OCR_AZURE_API_KEY && env.OCR_AZURE_ENDPOINT && env.OCR_AZURE_MODEL_NAME
  const hasMistralOCR = env.MISTRAL_API_KEY

  if (isPDF && (hasAzureMistralOCR || hasMistralOCR)) {
    if (hasAzureMistralOCR) {
      logger.info(`Using Azure Mistral OCR: ${filename}`)
      return parseWithAzureMistralOCR(fileUrl, filename, mimeType, userId, workspaceId)
    }

    if (hasMistralOCR) {
      logger.info(`Using Mistral OCR: ${filename}`)
      return parseWithMistralOCR(fileUrl, filename, mimeType, userId, workspaceId)
    }
  }

  logger.info(`Using file parser: ${filename}`)
  return parseWithFileParser(fileUrl, filename, mimeType)
}

async function handleFileForOCR(
  fileUrl: string,
  filename: string,
  mimeType: string,
  userId?: string,
  workspaceId?: string | null
) {
  const isExternalHttps = fileUrl.startsWith('https://') && !fileUrl.includes('/api/files/serve/')

  if (isExternalHttps) {
    return { httpsUrl: fileUrl }
  }

  logger.info(`Uploading "${filename}" to cloud storage for OCR`)

  const buffer = await downloadFileWithTimeout(fileUrl)

  try {
    const metadata: Record<string, string> = {
      originalName: filename,
      uploadedAt: new Date().toISOString(),
      purpose: 'knowledge-base',
      ...(userId && { userId }),
      ...(workspaceId && { workspaceId }),
    }

    const timestamp = Date.now()
    const uniqueId = Math.random().toString(36).substring(2, 9)
    const safeFileName = filename.replace(/[^a-zA-Z0-9.-]/g, '_')
    const customKey = `kb/${timestamp}-${uniqueId}-${safeFileName}`

    const cloudResult = await StorageService.uploadFile({
      file: buffer,
      fileName: filename,
      contentType: mimeType,
      context: 'knowledge-base',
      customKey,
      metadata,
    })

    const httpsUrl = await StorageService.generatePresignedDownloadUrl(
      cloudResult.key,
      'knowledge-base',
      900 // 15 minutes
    )

    logger.info(`Successfully uploaded for OCR: ${cloudResult.key}`)
    return { httpsUrl, cloudUrl: httpsUrl }
  } catch (uploadError) {
    const message = uploadError instanceof Error ? uploadError.message : 'Unknown error'
    throw new Error(`Cloud upload failed: ${message}. Cloud upload is required for OCR.`)
  }
}

async function downloadFileWithTimeout(fileUrl: string): Promise<Buffer> {
  return downloadFileFromUrl(fileUrl, TIMEOUTS.FILE_DOWNLOAD)
}

async function downloadFileForBase64(fileUrl: string): Promise<Buffer> {
  if (fileUrl.startsWith('data:')) {
    const [, base64Data] = fileUrl.split(',')
    if (!base64Data) {
      throw new Error('Invalid data URI format')
    }
    return Buffer.from(base64Data, 'base64')
  }
  if (fileUrl.startsWith('http')) {
    return downloadFileWithTimeout(fileUrl)
  }
  const fs = await import('fs/promises')
  return fs.readFile(fileUrl)
}

function processOCRContent(result: OCRResult, filename: string): string {
  if (!result.success) {
    throw new Error(`OCR processing failed: ${result.error || 'Unknown error'}`)
  }

  const content = result.output?.content || ''
  if (!content.trim()) {
    throw new Error('OCR returned empty content')
  }

  logger.info(`OCR completed: ${filename}`)
  return content
}

function validateOCRConfig(
  apiKey?: string,
  endpoint?: string,
  modelName?: string,
  service = 'OCR'
) {
  if (!apiKey) throw new Error(`${service} API key required`)
  if (!endpoint) throw new Error(`${service} endpoint required`)
  if (!modelName) throw new Error(`${service} model name required`)
}

function extractPageContent(pages: OCRPage[]): string {
  if (!pages?.length) return ''

  return pages
    .map((page) => page?.markdown || '')
    .filter(Boolean)
    .join('\n\n')
}

async function makeOCRRequest(
  endpoint: string,
  headers: Record<string, string>,
  body: OCRRequestBody
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUTS.MISTRAL_OCR_API)

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const errorText = await response.text()
      throw new APIError(
        `OCR failed: ${response.status} ${response.statusText} - ${errorText}`,
        response.status
      )
    }

    return response
  } catch (error) {
    clearTimeout(timeoutId)
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('OCR API request timed out')
    }
    throw error
  }
}

async function parseWithAzureMistralOCR(
  fileUrl: string,
  filename: string,
  mimeType: string,
  userId?: string,
  workspaceId?: string | null
) {
  validateOCRConfig(
    env.OCR_AZURE_API_KEY,
    env.OCR_AZURE_ENDPOINT,
    env.OCR_AZURE_MODEL_NAME,
    'Azure Mistral OCR'
  )

  const fileBuffer = await downloadFileForBase64(fileUrl)
  const base64Data = fileBuffer.toString('base64')
  const dataUri = `data:${mimeType};base64,${base64Data}`

  try {
    const response = await retryWithExponentialBackoff(
      () =>
        makeOCRRequest(
          env.OCR_AZURE_ENDPOINT!,
          {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${env.OCR_AZURE_API_KEY}`,
          },
          {
            model: env.OCR_AZURE_MODEL_NAME!,
            document: {
              type: 'document_url',
              document_url: dataUri,
            },
            include_image_base64: false,
          }
        ),
      { maxRetries: 3, initialDelayMs: 1000, maxDelayMs: 10000 }
    )

    const ocrResult = (await response.json()) as AzureOCRResponse
    const content = extractPageContent(ocrResult.pages || []) || JSON.stringify(ocrResult, null, 2)

    if (!content.trim()) {
      throw new Error('Azure Mistral OCR returned empty content')
    }

    logger.info(`Azure Mistral OCR completed: ${filename}`)
    return { content, processingMethod: 'mistral-ocr' as const, cloudUrl: undefined }
  } catch (error) {
    logger.error(`Azure Mistral OCR failed for ${filename}:`, {
      message: error instanceof Error ? error.message : String(error),
    })

    return env.MISTRAL_API_KEY
      ? parseWithMistralOCR(fileUrl, filename, mimeType, userId, workspaceId)
      : parseWithFileParser(fileUrl, filename, mimeType)
  }
}

async function parseWithMistralOCR(
  fileUrl: string,
  filename: string,
  mimeType: string,
  userId?: string,
  workspaceId?: string | null
) {
  if (!env.MISTRAL_API_KEY) {
    throw new Error('Mistral API key required')
  }

  if (!mistralParserTool.request?.body) {
    throw new Error('Mistral parser tool not configured')
  }

  const { httpsUrl, cloudUrl } = await handleFileForOCR(
    fileUrl,
    filename,
    mimeType,
    userId,
    workspaceId
  )
  const params = { filePath: httpsUrl, apiKey: env.MISTRAL_API_KEY, resultType: 'text' as const }

  try {
    const response = await retryWithExponentialBackoff(
      async () => {
        let url =
          typeof mistralParserTool.request!.url === 'function'
            ? mistralParserTool.request!.url(params)
            : mistralParserTool.request!.url

        const isInternalRoute = url.startsWith('/')

        if (isInternalRoute) {
          const { getBaseUrl } = await import('@/lib/urls/utils')
          url = `${getBaseUrl()}${url}`
        }

        let headers =
          typeof mistralParserTool.request!.headers === 'function'
            ? mistralParserTool.request!.headers(params)
            : mistralParserTool.request!.headers

        if (isInternalRoute) {
          const { generateInternalToken } = await import('@/lib/auth/internal')
          const internalToken = await generateInternalToken(userId)
          headers = {
            ...headers,
            Authorization: `Bearer ${internalToken}`,
          }
        }

        const requestBody = mistralParserTool.request!.body!(params) as OCRRequestBody
        return makeOCRRequest(url, headers as Record<string, string>, requestBody)
      },
      { maxRetries: 3, initialDelayMs: 1000, maxDelayMs: 10000 }
    )

    const result = (await mistralParserTool.transformResponse!(response, params)) as OCRResult
    const content = processOCRContent(result, filename)

    return { content, processingMethod: 'mistral-ocr' as const, cloudUrl }
  } catch (error) {
    logger.error(`Mistral OCR failed for ${filename}:`, {
      message: error instanceof Error ? error.message : String(error),
    })

    logger.info(`Falling back to file parser: ${filename}`)
    return parseWithFileParser(fileUrl, filename, mimeType)
  }
}

async function parseWithFileParser(fileUrl: string, filename: string, mimeType: string) {
  try {
    let content: string
    let metadata: any = {}

    if (fileUrl.startsWith('data:')) {
      content = await parseDataURI(fileUrl, filename, mimeType)
    } else if (fileUrl.startsWith('http')) {
      const result = await parseHttpFile(fileUrl, filename)
      content = result.content
      metadata = result.metadata || {}
    } else {
      const result = await parseFile(fileUrl)
      content = result.content
      metadata = result.metadata || {}
    }

    if (!content.trim()) {
      throw new Error('File parser returned empty content')
    }

    return { content, processingMethod: 'file-parser' as const, cloudUrl: undefined, metadata }
  } catch (error) {
    logger.error(`File parser failed for ${filename}:`, error)
    throw error
  }
}

async function parseDataURI(fileUrl: string, filename: string, mimeType: string): Promise<string> {
  const [header, base64Data] = fileUrl.split(',')
  if (!base64Data) {
    throw new Error('Invalid data URI format')
  }

  if (mimeType === 'text/plain') {
    return header.includes('base64')
      ? Buffer.from(base64Data, 'base64').toString('utf8')
      : decodeURIComponent(base64Data)
  }

  const extension = filename.split('.').pop()?.toLowerCase() || 'txt'
  const buffer = Buffer.from(base64Data, 'base64')
  const result = await parseBuffer(buffer, extension)
  return result.content
}

async function parseHttpFile(
  fileUrl: string,
  filename: string
): Promise<{ content: string; metadata?: any }> {
  const buffer = await downloadFileWithTimeout(fileUrl)

  const extension = filename.split('.').pop()?.toLowerCase()
  if (!extension) {
    throw new Error(`Could not determine file extension: ${filename}`)
  }

  const result = await parseBuffer(buffer, extension)
  return result
}
