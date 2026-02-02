import { createLogger } from '@sim/logger'
import { PDFDocument } from 'pdf-lib'
import { getBYOKKey } from '@/lib/api-key/byok'
import { type Chunk, JsonYamlChunker, StructuredDataChunker, TextChunker } from '@/lib/chunkers'
import { env } from '@/lib/core/config/env'
import { parseBuffer, parseFile } from '@/lib/file-parsers'
import type { FileParseMetadata } from '@/lib/file-parsers/types'
import { retryWithExponentialBackoff } from '@/lib/knowledge/documents/utils'
import { StorageService } from '@/lib/uploads'
import { isInternalFileUrl } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromUrl } from '@/lib/uploads/utils/file-utils.server'
import { mistralParserTool } from '@/tools/mistral/parser'

const logger = createLogger('DocumentProcessor')

const TIMEOUTS = {
  FILE_DOWNLOAD: 180000,
  MISTRAL_OCR_API: 120000,
} as const

const MAX_CONCURRENT_CHUNKS = env.KB_CONFIG_CHUNK_CONCURRENCY

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

const MISTRAL_MAX_PAGES = 1000

/**
 * Get page count from a PDF buffer using unpdf
 */
async function getPdfPageCount(buffer: Buffer): Promise<number> {
  try {
    const { getDocumentProxy } = await import('unpdf')
    const uint8Array = new Uint8Array(buffer)
    const pdf = await getDocumentProxy(uint8Array)
    return pdf.numPages
  } catch (error) {
    logger.warn('Failed to get PDF page count:', error)
    return 0
  }
}

/**
 * Split a PDF buffer into multiple smaller PDFs
 * Returns an array of PDF buffers, each with at most maxPages pages
 */
async function splitPdfIntoChunks(
  pdfBuffer: Buffer,
  maxPages: number
): Promise<{ buffer: Buffer; startPage: number; endPage: number }[]> {
  const sourcePdf = await PDFDocument.load(pdfBuffer)
  const totalPages = sourcePdf.getPageCount()

  if (totalPages <= maxPages) {
    return [{ buffer: pdfBuffer, startPage: 0, endPage: totalPages - 1 }]
  }

  const chunks: { buffer: Buffer; startPage: number; endPage: number }[] = []

  for (let startPage = 0; startPage < totalPages; startPage += maxPages) {
    const endPage = Math.min(startPage + maxPages - 1, totalPages - 1)
    const pageCount = endPage - startPage + 1

    const newPdf = await PDFDocument.create()
    const pageIndices = Array.from({ length: pageCount }, (_, i) => startPage + i)
    const copiedPages = await newPdf.copyPages(sourcePdf, pageIndices)

    copiedPages.forEach((page) => newPdf.addPage(page))

    const pdfBytes = await newPdf.save()
    chunks.push({
      buffer: Buffer.from(pdfBytes),
      startPage,
      endPage,
    })
  }

  return chunks
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
  chunkSize = 1024,
  chunkOverlap = 200,
  minCharactersPerChunk = 100,
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
    const metadata: FileParseMetadata = parseResult.metadata ?? {}

    const isJsonYaml =
      metadata.type === 'json' ||
      metadata.type === 'yaml' ||
      mimeType.includes('json') ||
      mimeType.includes('yaml')

    if (isJsonYaml && JsonYamlChunker.isStructuredData(content)) {
      logger.info('Using JSON/YAML chunker for structured data')
      chunks = await JsonYamlChunker.chunkJsonYaml(content, {
        chunkSize,
        minCharactersPerChunk,
      })
    } else if (StructuredDataChunker.isStructuredData(content, mimeType)) {
      logger.info('Using structured data chunker for spreadsheet/CSV content')
      const rowCount = metadata.totalRows ?? metadata.rowCount
      chunks = await StructuredDataChunker.chunkStructuredData(content, {
        chunkSize,
        headers: metadata.headers,
        totalRows: typeof rowCount === 'number' ? rowCount : undefined,
        sheetName: metadata.sheetNames?.[0],
      })
    } else {
      const chunker = new TextChunker({ chunkSize, chunkOverlap, minCharactersPerChunk })
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

async function getMistralApiKey(workspaceId?: string | null): Promise<string | null> {
  if (workspaceId) {
    const byokResult = await getBYOKKey(workspaceId, 'mistral')
    if (byokResult) {
      logger.info('Using workspace BYOK key for Mistral OCR')
      return byokResult.apiKey
    }
  }
  return env.MISTRAL_API_KEY || null
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
  metadata?: FileParseMetadata
}> {
  const isPDF = mimeType === 'application/pdf'
  const hasAzureMistralOCR =
    env.OCR_AZURE_API_KEY && env.OCR_AZURE_ENDPOINT && env.OCR_AZURE_MODEL_NAME

  const mistralApiKey = await getMistralApiKey(workspaceId)
  const hasMistralOCR = !!mistralApiKey

  if (isPDF && (hasAzureMistralOCR || hasMistralOCR)) {
    if (hasAzureMistralOCR) {
      logger.info(`Using Azure Mistral OCR: ${filename}`)
      return parseWithAzureMistralOCR(fileUrl, filename, mimeType)
    }

    if (hasMistralOCR) {
      logger.info(`Using Mistral OCR: ${filename}`)
      return parseWithMistralOCR(fileUrl, filename, mimeType, userId, workspaceId, mistralApiKey)
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
  const isExternalHttps = fileUrl.startsWith('https://') && !isInternalFileUrl(fileUrl)

  if (isExternalHttps) {
    if (mimeType === 'application/pdf') {
      logger.info(`handleFileForOCR: Downloading external PDF to check page count`)
      try {
        const buffer = await downloadFileWithTimeout(fileUrl)
        logger.info(`handleFileForOCR: Downloaded external PDF: ${buffer.length} bytes`)
        return { httpsUrl: fileUrl, buffer }
      } catch (error) {
        logger.warn(
          `handleFileForOCR: Failed to download external PDF for page count check, proceeding without batching`,
          {
            error: error instanceof Error ? error.message : String(error),
          }
        )
        return { httpsUrl: fileUrl, buffer: undefined }
      }
    }
    logger.info(`handleFileForOCR: Using external URL directly`)
    return { httpsUrl: fileUrl, buffer: undefined }
  }

  logger.info(`Uploading "${filename}" to cloud storage for OCR`)

  const buffer = await downloadFileWithTimeout(fileUrl)

  logger.info(`Downloaded ${filename}: ${buffer.length} bytes`)

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

    return { httpsUrl, cloudUrl: httpsUrl, buffer }
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

async function parseWithAzureMistralOCR(fileUrl: string, filename: string, mimeType: string) {
  validateOCRConfig(
    env.OCR_AZURE_API_KEY,
    env.OCR_AZURE_ENDPOINT,
    env.OCR_AZURE_MODEL_NAME,
    'Azure Mistral OCR'
  )

  const fileBuffer = await downloadFileForBase64(fileUrl)

  if (mimeType === 'application/pdf') {
    const pageCount = await getPdfPageCount(fileBuffer)
    if (pageCount > MISTRAL_MAX_PAGES) {
      logger.info(
        `PDF has ${pageCount} pages, exceeds Azure OCR limit of ${MISTRAL_MAX_PAGES}. ` +
          `Falling back to file parser.`
      )
      return parseWithFileParser(fileUrl, filename, mimeType)
    }
    logger.info(`Azure Mistral OCR: PDF page count for ${filename}: ${pageCount}`)
  }

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

    logger.info(`Falling back to file parser: ${filename}`)
    return parseWithFileParser(fileUrl, filename, mimeType)
  }
}

async function parseWithMistralOCR(
  fileUrl: string,
  filename: string,
  mimeType: string,
  userId?: string,
  workspaceId?: string | null,
  mistralApiKey?: string | null
) {
  const apiKey = mistralApiKey || env.MISTRAL_API_KEY
  if (!apiKey) {
    throw new Error('Mistral API key required')
  }

  if (!mistralParserTool.request?.body) {
    throw new Error('Mistral parser tool not configured')
  }

  const { httpsUrl, cloudUrl, buffer } = await handleFileForOCR(
    fileUrl,
    filename,
    mimeType,
    userId,
    workspaceId
  )

  logger.info(`Mistral OCR: Using presigned URL for ${filename}: ${httpsUrl}`)

  let pageCount = 0
  if (mimeType === 'application/pdf' && buffer) {
    pageCount = await getPdfPageCount(buffer)
    logger.info(`PDF page count for ${filename}: ${pageCount}`)
  }

  const needsBatching = pageCount > MISTRAL_MAX_PAGES

  if (needsBatching && buffer) {
    logger.info(
      `PDF has ${pageCount} pages, exceeds limit of ${MISTRAL_MAX_PAGES}. Splitting and processing in chunks.`
    )
    return processMistralOCRInBatches(filename, apiKey, buffer, userId, cloudUrl)
  }

  const params = { filePath: httpsUrl, apiKey, resultType: 'text' as const }

  try {
    const response = await executeMistralOCRRequest(params, userId)
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

async function executeMistralOCRRequest(
  params: { filePath: string; apiKey: string; resultType: 'text' },
  userId?: string
): Promise<Response> {
  return retryWithExponentialBackoff(
    async () => {
      let url =
        typeof mistralParserTool.request!.url === 'function'
          ? mistralParserTool.request!.url(params)
          : mistralParserTool.request!.url

      const isInternalRoute = url.startsWith('/')

      if (isInternalRoute) {
        const { getBaseUrl } = await import('@/lib/core/utils/urls')
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
}

/**
 * Process a single PDF chunk: upload to S3, OCR, cleanup
 */
async function processChunk(
  chunk: { buffer: Buffer; startPage: number; endPage: number },
  chunkIndex: number,
  totalChunks: number,
  filename: string,
  apiKey: string,
  userId?: string
): Promise<{ index: number; content: string | null }> {
  const chunkPageCount = chunk.endPage - chunk.startPage + 1

  logger.info(
    `Processing chunk ${chunkIndex + 1}/${totalChunks} (pages ${chunk.startPage + 1}-${chunk.endPage + 1}, ${chunkPageCount} pages)`
  )

  let uploadedKey: string | null = null

  try {
    // Upload the chunk to S3
    const timestamp = Date.now()
    const uniqueId = Math.random().toString(36).substring(2, 9)
    const safeFileName = filename.replace(/[^a-zA-Z0-9.-]/g, '_')
    const chunkKey = `kb/${timestamp}-${uniqueId}-chunk${chunkIndex + 1}-${safeFileName}`

    const metadata: Record<string, string> = {
      originalName: `${filename}_chunk${chunkIndex + 1}`,
      uploadedAt: new Date().toISOString(),
      purpose: 'knowledge-base',
      ...(userId && { userId }),
    }

    const uploadResult = await StorageService.uploadFile({
      file: chunk.buffer,
      fileName: `${filename}_chunk${chunkIndex + 1}`,
      contentType: 'application/pdf',
      context: 'knowledge-base',
      customKey: chunkKey,
      metadata,
    })

    uploadedKey = uploadResult.key

    const chunkUrl = await StorageService.generatePresignedDownloadUrl(
      uploadResult.key,
      'knowledge-base',
      900 // 15 minutes
    )

    logger.info(`Uploaded chunk ${chunkIndex + 1} to S3: ${chunkKey}`)

    // Process the chunk with Mistral OCR
    const params = {
      filePath: chunkUrl,
      apiKey,
      resultType: 'text' as const,
    }

    const response = await executeMistralOCRRequest(params, userId)
    const result = (await mistralParserTool.transformResponse!(response, params)) as OCRResult

    if (result.success && result.output?.content) {
      logger.info(`Chunk ${chunkIndex + 1}/${totalChunks} completed successfully`)
      return { index: chunkIndex, content: result.output.content }
    }
    logger.warn(`Chunk ${chunkIndex + 1}/${totalChunks} returned no content`)
    return { index: chunkIndex, content: null }
  } catch (error) {
    logger.error(`Chunk ${chunkIndex + 1}/${totalChunks} failed:`, {
      message: error instanceof Error ? error.message : String(error),
    })
    return { index: chunkIndex, content: null }
  } finally {
    // Clean up the chunk file from S3 after processing
    if (uploadedKey) {
      try {
        await StorageService.deleteFile({ key: uploadedKey, context: 'knowledge-base' })
        logger.info(`Cleaned up chunk ${chunkIndex + 1} from S3`)
      } catch (deleteError) {
        logger.warn(`Failed to clean up chunk ${chunkIndex + 1} from S3:`, {
          message: deleteError instanceof Error ? deleteError.message : String(deleteError),
        })
      }
    }
  }
}

async function processMistralOCRInBatches(
  filename: string,
  apiKey: string,
  pdfBuffer: Buffer,
  userId?: string,
  cloudUrl?: string
): Promise<{
  content: string
  processingMethod: 'mistral-ocr'
  cloudUrl?: string
}> {
  const totalPages = await getPdfPageCount(pdfBuffer)
  logger.info(
    `Splitting ${filename} (${totalPages} pages) into chunks of ${MISTRAL_MAX_PAGES} pages`
  )

  const pdfChunks = await splitPdfIntoChunks(pdfBuffer, MISTRAL_MAX_PAGES)
  logger.info(
    `Split into ${pdfChunks.length} chunks, processing with concurrency ${MAX_CONCURRENT_CHUNKS}`
  )

  // Process chunks concurrently with limited concurrency
  const results: { index: number; content: string | null }[] = []

  for (let i = 0; i < pdfChunks.length; i += MAX_CONCURRENT_CHUNKS) {
    const batch = pdfChunks.slice(i, i + MAX_CONCURRENT_CHUNKS)
    const batchPromises = batch.map((chunk, batchIndex) =>
      processChunk(chunk, i + batchIndex, pdfChunks.length, filename, apiKey, userId)
    )

    const batchResults = await Promise.all(batchPromises)
    for (const result of batchResults) {
      results.push(result)
    }

    logger.info(
      `Completed batch ${Math.floor(i / MAX_CONCURRENT_CHUNKS) + 1}/${Math.ceil(pdfChunks.length / MAX_CONCURRENT_CHUNKS)}`
    )
  }

  // Sort by index to maintain page order and filter out nulls
  const sortedResults = results
    .sort((a, b) => a.index - b.index)
    .filter((r) => r.content !== null)
    .map((r) => r.content as string)

  if (sortedResults.length === 0) {
    // Don't fall back to file parser for large PDFs - it produces poor results
    // Better to fail clearly than return low-quality extraction
    throw new Error(
      `OCR failed for all ${pdfChunks.length} chunks of ${filename}. ` +
        `Large PDFs require OCR - file parser fallback would produce poor results.`
    )
  }

  const combinedContent = sortedResults.join('\n\n')
  logger.info(
    `Successfully processed ${sortedResults.length}/${pdfChunks.length} chunks for ${filename}`
  )

  return {
    content: combinedContent,
    processingMethod: 'mistral-ocr',
    cloudUrl,
  }
}

async function parseWithFileParser(fileUrl: string, filename: string, mimeType: string) {
  try {
    let content: string
    let metadata: FileParseMetadata = {}

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
): Promise<{ content: string; metadata?: FileParseMetadata }> {
  const buffer = await downloadFileWithTimeout(fileUrl)

  const extension = filename.split('.').pop()?.toLowerCase()
  if (!extension) {
    throw new Error(`Could not determine file extension: ${filename}`)
  }

  const result = await parseBuffer(buffer, extension)
  return result
}
