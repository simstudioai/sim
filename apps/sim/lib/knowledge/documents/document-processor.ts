import { randomBytes } from 'crypto'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { PDFDocument } from 'pdf-lib'
import { getBYOKKey } from '@/lib/api-key/byok'
import {
  type Chunk,
  JsonYamlChunker,
  RecursiveChunker,
  RegexChunker,
  SentenceChunker,
  StructuredDataChunker,
  TextChunker,
  TokenChunker,
} from '@/lib/chunkers'
import type { ChunkingStrategy, StrategyOptions } from '@/lib/chunkers/types'
import { env, envNumber } from '@/lib/core/config/env'
import { OCR_CAPABILITY, requireCapability } from '@/lib/core/config/env-capabilities'
import { parseBuffer } from '@/lib/file-parsers'
import type { FileParseMetadata } from '@/lib/file-parsers/types'
import { resolveParserExtension } from '@/lib/knowledge/documents/parser-extension'
import { retryWithExponentialBackoff } from '@/lib/knowledge/documents/utils'
import {
  assertKnowledgeOpaqueModelInputSafe,
  getKnowledgeOpaqueModelInputRegistry,
} from '@/lib/knowledge/model-input-provenance'
import { StorageService } from '@/lib/uploads'
import { buildStorageKeySegment } from '@/lib/uploads/core/storage-key'
import { isInternalFileUrl } from '@/lib/uploads/utils/file-utils'
import { downloadFileFromUrl } from '@/lib/uploads/utils/file-utils.server'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'
import { mistralParserTool } from '@/tools/mistral/parser'
import { prepareToolRequest } from '@/tools/request-transport'

const logger = createLogger('DocumentProcessor')

const TIMEOUTS = {
  FILE_DOWNLOAD: 600000,
  MISTRAL_OCR_API: 120000,
} as const

const MAX_CONCURRENT_CHUNKS = envNumber(env.KB_CONFIG_CHUNK_CONCURRENCY, 10)

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

const MISTRAL_MAX_PAGES = 1000

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

async function applyStrategy(
  strategy: ChunkingStrategy,
  content: string,
  chunkSize: number,
  chunkOverlap: number,
  minCharactersPerChunk: number,
  strategyOptions?: StrategyOptions
): Promise<Chunk[]> {
  const baseOptions = { chunkSize, chunkOverlap, minCharactersPerChunk }

  switch (strategy) {
    case 'token': {
      const chunker = new TokenChunker(baseOptions)
      return chunker.chunk(content)
    }
    case 'sentence': {
      const chunker = new SentenceChunker(baseOptions)
      return chunker.chunk(content)
    }
    case 'recursive': {
      const chunker = new RecursiveChunker({
        ...baseOptions,
        separators: strategyOptions?.separators,
        recipe: strategyOptions?.recipe,
      })
      return chunker.chunk(content)
    }
    case 'regex': {
      if (!strategyOptions?.pattern) {
        logger.warn(
          'Regex strategy requested but no pattern provided, falling back to text chunker'
        )
        const chunker = new TextChunker(baseOptions)
        return chunker.chunk(content)
      }
      const chunker = new RegexChunker({
        ...baseOptions,
        pattern: strategyOptions.pattern,
        strictBoundaries: strategyOptions.strictBoundaries,
      })
      return chunker.chunk(content)
    }
    default: {
      const chunker = new TextChunker(baseOptions)
      return chunker.chunk(content)
    }
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
  workspaceId?: string | null,
  strategy?: ChunkingStrategy,
  strategyOptions?: StrategyOptions
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
  logger.info('Processing document', { mimeType })

  try {
    const parseResult = await parseDocument(fileUrl, filename, mimeType, userId, workspaceId)
    const { content, processingMethod } = parseResult
    const cloudUrl = 'cloudUrl' in parseResult ? parseResult.cloudUrl : undefined

    let chunks: Chunk[]
    const metadata: FileParseMetadata = parseResult.metadata ?? {}

    if (strategy && strategy !== 'auto') {
      logger.info(`Using explicit chunking strategy: ${strategy}`)
      chunks = await applyStrategy(
        strategy,
        content,
        chunkSize,
        chunkOverlap,
        minCharactersPerChunk,
        strategyOptions
      )
    } else {
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
    logger.error('Error processing document', {
      mimeType,
      errorType: toError(error).name,
    })
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
  const mistralApiKey = await getMistralApiKey(workspaceId)

  if (isPDF) {
    const ocrProvider = requireCapability(OCR_CAPABILITY, {
      OCR_PROVIDER: env.OCR_PROVIDER,
      OCR_AZURE_API_KEY: env.OCR_AZURE_API_KEY,
      OCR_AZURE_ENDPOINT: env.OCR_AZURE_ENDPOINT,
      OCR_AZURE_MODEL_NAME: env.OCR_AZURE_MODEL_NAME,
      MISTRAL_API_KEY: mistralApiKey,
    }).providerId

    if (ocrProvider === 'azure-mistral') {
      assertKnowledgeOpaqueModelInputSafe()
      logger.info('Using Azure Mistral OCR')
      return parseWithAzureMistralOCR(fileUrl, filename, mimeType, userId)
    }

    if (ocrProvider === 'mistral') {
      assertKnowledgeOpaqueModelInputSafe()
      logger.info('Using Mistral OCR')
      return parseWithMistralOCR(fileUrl, filename, mimeType, userId, workspaceId, mistralApiKey)
    }
  }

  logger.info('Using file parser')
  return parseWithFileParser(fileUrl, filename, mimeType, userId)
}

async function handleFileForOCR(
  fileUrl: string,
  filename: string,
  mimeType: string,
  userId?: string,
  workspaceId?: string | null
) {
  const isExternalHttps = /^https:\/\//i.test(fileUrl) && !isInternalFileUrl(fileUrl)

  if (isExternalHttps) {
    if (mimeType === 'application/pdf') {
      logger.info(`handleFileForOCR: Downloading external PDF to check page count`)
      try {
        const buffer = await downloadFileWithTimeout(fileUrl, userId)
        logger.info(`handleFileForOCR: Downloaded external PDF: ${buffer.length} bytes`)
        return { httpsUrl: fileUrl, buffer }
      } catch (error) {
        logger.warn(
          `handleFileForOCR: Failed to download external PDF for page count check, proceeding without batching`,
          {
            errorType: toError(error).name,
          }
        )
        return { httpsUrl: fileUrl, buffer: undefined }
      }
    }
    logger.info(`handleFileForOCR: Using external URL directly`)
    return { httpsUrl: fileUrl, buffer: undefined }
  }

  logger.info('Uploading document to cloud storage for OCR')

  const buffer = await downloadFileWithTimeout(fileUrl, userId)

  logger.info('Downloaded document for OCR', { bytes: buffer.length })

  try {
    const metadata: Record<string, string> = {
      originalName: filename,
      uploadedAt: new Date().toISOString(),
      purpose: 'knowledge-base',
      ...(userId && { userId }),
      ...(workspaceId && { workspaceId }),
    }

    const timestamp = Date.now()
    const uniqueId = randomBytes(8).toString('hex')
    const customKey = `kb/${buildStorageKeySegment(`${timestamp}-${uniqueId}-`, filename)}`

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
    const message = getErrorMessage(uploadError, 'Unknown error')
    throw new Error(`Cloud upload failed: ${message}. Cloud upload is required for OCR.`)
  }
}

/**
 * Downloads an ingestion source file, enforcing the {@link MAX_FILE_SIZE} document
 * limit. `maxBytes` aborts the streaming read once the cap is exceeded (and rejects
 * up front on an oversized `Content-Length`), so an attacker-controlled `fileUrl`
 * pointing at an unbounded body cannot exhaust the processing worker's memory.
 */
async function downloadFileWithTimeout(fileUrl: string, userId?: string): Promise<Buffer> {
  return downloadFileFromUrl(fileUrl, {
    timeoutMs: TIMEOUTS.FILE_DOWNLOAD,
    maxBytes: MAX_FILE_SIZE,
    userId,
  })
}

async function downloadFileForBase64(fileUrl: string, userId?: string): Promise<Buffer> {
  if (/^data:/i.test(fileUrl)) {
    const [, base64Data] = fileUrl.split(',')
    if (!base64Data) {
      throw new Error('Invalid data URI format')
    }
    return Buffer.from(base64Data, 'base64')
  }
  if (/^https?:\/\//i.test(fileUrl) || isInternalFileUrl(fileUrl)) {
    return downloadFileWithTimeout(fileUrl, userId)
  }
  throw new Error(
    'Unsupported fileUrl scheme: only data: URIs, http(s):// URLs, and internal /api/files/serve/ paths are allowed'
  )
}

function processOCRContent(result: OCRResult): string {
  if (!result.success) {
    throw new Error(`OCR processing failed: ${result.error || 'Unknown error'}`)
  }

  const content = result.output?.content || ''
  if (!content.trim()) {
    throw new Error('OCR returned empty content')
  }

  logger.info('OCR completed')
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
  headers: HeadersInit,
  body: string | Record<string, unknown>
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUTS.MISTRAL_OCR_API)

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
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
  userId?: string
) {
  validateOCRConfig(
    env.OCR_AZURE_API_KEY,
    env.OCR_AZURE_ENDPOINT,
    env.OCR_AZURE_MODEL_NAME,
    'Azure Mistral OCR'
  )

  const fileBuffer = await downloadFileForBase64(fileUrl, userId)

  if (mimeType === 'application/pdf') {
    const pageCount = await getPdfPageCount(fileBuffer)
    if (pageCount > MISTRAL_MAX_PAGES) {
      throw new Error(
        `PDF has ${pageCount} pages, exceeding the Azure OCR limit of ${MISTRAL_MAX_PAGES}`
      )
    }
    logger.info('Azure Mistral OCR: PDF page count resolved', { pageCount })
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

    logger.info('Azure Mistral OCR completed')
    return { content, processingMethod: 'mistral-ocr' as const, cloudUrl: undefined }
  } catch (error) {
    logger.error('Azure Mistral OCR failed', {
      errorType: toError(error).name,
    })
    throw error
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

  const { httpsUrl, cloudUrl, buffer } = await handleFileForOCR(
    fileUrl,
    filename,
    mimeType,
    userId,
    workspaceId
  )

  logger.info('Mistral OCR source prepared')

  let pageCount = 0
  if (mimeType === 'application/pdf' && buffer) {
    pageCount = await getPdfPageCount(buffer)
    logger.info('PDF page count resolved', { pageCount })
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
    const content = processOCRContent(result)

    return { content, processingMethod: 'mistral-ocr' as const, cloudUrl }
  } catch (error) {
    logger.error('Mistral OCR failed', {
      errorType: toError(error).name,
    })
    throw error
  }
}

async function executeMistralOCRRequest(
  params: { filePath: string; apiKey: string; resultType: 'text' },
  userId?: string
): Promise<Response> {
  return retryWithExponentialBackoff(
    async () => {
      const request = prepareToolRequest(
        mistralParserTool,
        params,
        getKnowledgeOpaqueModelInputRegistry()
      )
      let { url } = request

      if (request.isInternalRoute) {
        const { getInternalApiBaseUrl } = await import('@/lib/core/utils/urls')
        url = `${getInternalApiBaseUrl()}${url}`
      }

      const { headers } = request

      if (request.isInternalRoute) {
        const { generateInternalToken } = await import('@/lib/auth/internal')
        const internalToken = await generateInternalToken(userId)
        headers.set('Authorization', `Bearer ${internalToken}`)
      }

      if (!request.body) throw new Error('Mistral parser request body is unavailable')
      return makeOCRRequest(url, headers, request.body)
    },
    { maxRetries: 3, initialDelayMs: 1000, maxDelayMs: 10000 }
  )
}

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
    const timestamp = Date.now()
    const uniqueId = randomBytes(8).toString('hex')
    const chunkKey = `kb/${buildStorageKeySegment(
      `${timestamp}-${uniqueId}-chunk${chunkIndex + 1}-`,
      filename
    )}`

    // No metadata: these chunks are ephemeral OCR artifacts (deleted in the
    // finally below) that are fetched via a direct presigned URL, never through
    // verifyKBFileAccess. Omitting metadata avoids writing an orphan ownership
    // binding row per chunk.
    const uploadResult = await StorageService.uploadFile({
      file: chunk.buffer,
      fileName: `${filename}_chunk${chunkIndex + 1}`,
      contentType: 'application/pdf',
      context: 'knowledge-base',
      customKey: chunkKey,
    })

    uploadedKey = uploadResult.key

    const chunkUrl = await StorageService.generatePresignedDownloadUrl(
      uploadResult.key,
      'knowledge-base',
      900 // 15 minutes
    )

    logger.info(`Uploaded chunk ${chunkIndex + 1} for OCR`)

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
      errorType: toError(error).name,
    })
    return { index: chunkIndex, content: null }
  } finally {
    if (uploadedKey) {
      try {
        await StorageService.deleteFile({ key: uploadedKey, context: 'knowledge-base' })
        logger.info(`Cleaned up chunk ${chunkIndex + 1} from S3`)
      } catch (deleteError) {
        logger.warn(`Failed to clean up chunk ${chunkIndex + 1} from S3:`, {
          errorType: toError(deleteError).name,
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
  logger.info(`Splitting PDF into chunks`, { totalPages, maxPagesPerChunk: MISTRAL_MAX_PAGES })

  const pdfChunks = await splitPdfIntoChunks(pdfBuffer, MISTRAL_MAX_PAGES)
  logger.info(
    `Split into ${pdfChunks.length} chunks, processing with concurrency ${MAX_CONCURRENT_CHUNKS}`
  )

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

  const sortedResults = results
    .sort((a, b) => a.index - b.index)
    .filter((r) => r.content !== null)
    .map((r) => r.content as string)

  if (sortedResults.length === 0) {
    throw new Error(
      `OCR failed for all ${pdfChunks.length} chunks. ` +
        `Large PDFs require OCR - file parser fallback would produce poor results.`
    )
  }

  const combinedContent = sortedResults.join('\n\n')
  logger.info(`Successfully processed ${sortedResults.length}/${pdfChunks.length} chunks`)

  return {
    content: combinedContent,
    processingMethod: 'mistral-ocr',
    cloudUrl,
  }
}

async function parseWithFileParser(
  fileUrl: string,
  filename: string,
  mimeType: string,
  userId?: string
) {
  try {
    let content: string
    let metadata: FileParseMetadata = {}

    if (/^data:/i.test(fileUrl)) {
      content = await parseDataURI(fileUrl, filename, mimeType)
    } else if (/^https?:\/\//i.test(fileUrl) || isInternalFileUrl(fileUrl)) {
      // Internal URLs may arrive as an app-relative `/api/files/serve/...` path
      // (some ingestion callers store the relative path); downloadFileFromUrl
      // resolves it directly against storage without an absolute origin.
      const result = await parseHttpFile(fileUrl, filename, mimeType, userId)
      content = result.content
      metadata = result.metadata || {}
    } else {
      throw new Error(
        'Unsupported fileUrl scheme: only data: URIs, http(s):// URLs, and internal /api/files/serve/ paths are allowed'
      )
    }

    if (!content.trim()) {
      throw new Error('File parser returned empty content')
    }

    return { content, processingMethod: 'file-parser' as const, cloudUrl: undefined, metadata }
  } catch (error) {
    logger.error('File parser failed', { errorType: toError(error).name })
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

  const extension = resolveParserExtension(filename, mimeType, 'txt')
  const buffer = Buffer.from(base64Data, 'base64')
  const result = await parseBuffer(buffer, extension)
  return result.content
}

async function parseHttpFile(
  fileUrl: string,
  filename: string,
  mimeType?: string,
  userId?: string
): Promise<{ content: string; metadata?: FileParseMetadata }> {
  const buffer = await downloadFileWithTimeout(fileUrl, userId)

  const extension = resolveParserExtension(filename, mimeType)
  const result = await parseBuffer(buffer, extension)
  return result
}
