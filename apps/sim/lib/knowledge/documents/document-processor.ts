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
import {
  resolveParserExtension,
  resolveStoredArtifactExtension,
} from '@/lib/knowledge/documents/parser-extension'
import { assessPdfTextLayer } from '@/lib/knowledge/documents/pdf-text-layer'
import { retryWithExponentialBackoff } from '@/lib/knowledge/documents/utils'
import {
  assertKnowledgeOpaqueModelInputSafe,
  getKnowledgeOpaqueModelInputRegistry,
} from '@/lib/knowledge/model-input-provenance'
import { StorageService } from '@/lib/uploads'
import { buildStorageKeySegment } from '@/lib/uploads/core/storage-key'
import { getFileExtension, isInternalFileUrl } from '@/lib/uploads/utils/file-utils'
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

/** Legacy binary formats and the modern container that replaces them. */
const LEGACY_FORMAT_REPLACEMENTS: Record<string, string> = {
  doc: 'DOCX',
  ppt: 'PPTX',
  xls: 'XLSX',
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

    /**
     * Guards every parser, not just the file parsers: OCR reads a scanned page
     * that has no recoverable text as empty, and chunking empty content yields a
     * document that reports success while holding nothing. Failing here keeps it
     * visible with a reason instead.
     */
    if (parseResult.metadata?.degraded || !content.trim()) {
      throw new Error(unreadableDocumentMessage(filename))
    }

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
      logger.info('Using BYOK key for Mistral OCR', { scope: byokResult.scope })
      return byokResult.apiKey
    }
  }
  return env.MISTRAL_API_KEY || null
}

/**
 * Reads a PDF's embedded text layer, returning it only when it is good enough to
 * index — otherwise `undefined`, leaving the caller to fall through to OCR.
 *
 * A failure to parse is not an error here: an encrypted or malformed PDF simply
 * has no usable layer, which is precisely a case for OCR. The document is fetched
 * again on that path, a second read from our own storage, which is a cheap price
 * for keeping the two extraction routes independent.
 */
async function readEmbeddedPdfText(
  fileUrl: string,
  filename: string,
  mimeType: string,
  userId?: string
): Promise<
  | {
      content: string
      processingMethod: 'file-parser'
      cloudUrl?: string
      metadata?: FileParseMetadata
    }
  | undefined
> {
  try {
    const buffer = await downloadFileWithTimeout(fileUrl, userId)
    const parsed = await parseBuffer(buffer, 'pdf')

    /**
     * The page count comes from the same parse as the text, rather than a second
     * independent read of the file. Counting separately lets the two disagree: a
     * count that failed would report no pages, the density check would fall back to
     * treating the document as a single page, and a long scan carrying only a header
     * would look dense enough to skip OCR and be indexed as that header.
     */
    const pageCount = parsed.metadata?.pageCount ?? 0
    const verdict = assessPdfTextLayer(parsed.content, pageCount, parsed.metadata?.truncated)
    if (!verdict.usable) {
      logger.info('PDF text layer not usable, routing to OCR', {
        filename,
        pageCount,
        reason: verdict.reason,
      })
      return undefined
    }

    logger.info('Using embedded PDF text layer', { filename, pageCount })
    return {
      content: parsed.content,
      processingMethod: 'file-parser',
      cloudUrl: undefined,
      metadata: parsed.metadata,
    }
  } catch (error) {
    logger.info('Could not read PDF text layer, routing to OCR', {
      filename,
      mimeType,
      error: toError(error).message,
    })
    return undefined
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

    if (ocrProvider === 'azure-mistral' || ocrProvider === 'mistral') {
      /**
       * Most PDFs carry a usable text layer, and reading it costs nothing. OCR is
       * a per-document call to an external service, so it is reserved for the
       * documents that actually need it — which also means everything else stops
       * depending on that service being reachable.
       */
      const embedded = await readEmbeddedPdfText(fileUrl, filename, mimeType, userId)
      if (embedded) return embedded

      assertKnowledgeOpaqueModelInputSafe()

      if (ocrProvider === 'azure-mistral') {
        logger.info('Using Azure Mistral OCR')
        return parseWithAzureMistralOCR(fileUrl, filename, mimeType, userId)
      }

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

  try {
    /**
     * A PDF is chunked to the provider's page cap rather than refused for
     * exceeding it, matching the other OCR provider. Refusing meant a long
     * document could not be ingested at all, and the cap applies to a single
     * request, not to the document.
     */
    const content =
      mimeType === 'application/pdf'
        ? await ocrPdfInChunks(fileBuffer, 'azure-mistral', (chunk) =>
            recognizeWithAzureOCR(chunk.buffer, mimeType)
          )
        : await recognizeWithAzureOCR(fileBuffer, mimeType)

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

/** Sends one document to Azure Mistral OCR inline, as a base64 data URI. */
async function recognizeWithAzureOCR(buffer: Buffer, mimeType: string): Promise<string> {
  const dataUri = `data:${mimeType};base64,${buffer.toString('base64')}`

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

  /**
   * A response carrying no pages is no content. Returning the raw payload instead
   * would be indexed as though it were the document: stitched into a chunked run
   * as recovered text, and in a single-document run it would satisfy the
   * empty-content check that exists to catch exactly this.
   */
  return extractPageContent(ocrResult.pages || [])
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

/**
 * Runs a PDF through OCR a chunk at a time and stitches the pages back together.
 *
 * A provider that caps how many pages one request may carry needs the document
 * split, and both providers cap at the same limit — so the splitting, the
 * concurrency, the ordering and the partial-failure rule live here once rather
 * than being restated per provider, where they had already drifted into one
 * provider chunking and the other refusing anything over the cap.
 *
 * A document is indexed whole or not at all: if any chunk fails, the document
 * fails, because a partial result reports success while page ranges are missing
 * and nothing downstream can tell.
 */
async function ocrPdfInChunks(
  pdfBuffer: Buffer,
  provider: string,
  recognize: (
    chunk: { buffer: Buffer; startPage: number; endPage: number },
    chunkIndex: number,
    totalChunks: number
  ) => Promise<string | null>
): Promise<string> {
  const totalPages = await getPdfPageCount(pdfBuffer)

  /**
   * Splitting has to load the document, which an encrypted or malformed PDF will
   * refuse. That must not decide whether the file reaches OCR at all: those are
   * exactly the documents with no readable text layer, so OCR is their only route,
   * and the provider may well accept bytes that a local parser would not. When the
   * split fails the document is sent whole and the page cap is left to the
   * provider — the behaviour before it was chunked.
   */
  let pdfChunks: { buffer: Buffer; startPage: number; endPage: number }[]
  try {
    pdfChunks = await splitPdfIntoChunks(pdfBuffer, MISTRAL_MAX_PAGES)
  } catch (error) {
    logger.info('PDF could not be split for OCR, sending it whole', {
      provider,
      error: toError(error).message,
    })
    pdfChunks = [{ buffer: pdfBuffer, startPage: 0, endPage: Math.max(0, totalPages - 1) }]
  }

  logger.info('Splitting PDF for OCR', {
    provider,
    totalPages,
    chunks: pdfChunks.length,
    maxPagesPerChunk: MISTRAL_MAX_PAGES,
    concurrency: MAX_CONCURRENT_CHUNKS,
  })

  const results: { index: number; content: string | null }[] = []

  for (let i = 0; i < pdfChunks.length; i += MAX_CONCURRENT_CHUNKS) {
    const batch = pdfChunks.slice(i, i + MAX_CONCURRENT_CHUNKS)
    const batchResults = await Promise.all(
      batch.map((chunk, batchIndex) => {
        const index = i + batchIndex
        return recognize(chunk, index, pdfChunks.length).then(
          (content) => ({ index, content }),
          (error) => {
            logger.warn('OCR chunk failed', {
              provider,
              chunk: index + 1,
              error: toError(error).message,
            })
            return { index, content: null }
          }
        )
      })
    )
    results.push(...batchResults)
  }

  const recovered = results
    .sort((a, b) => a.index - b.index)
    .map((r) => r.content)
    .filter((content): content is string => content !== null && content.trim().length > 0)

  /**
   * Each chunk has already exhausted its own retries, so a missing one is a real
   * failure rather than a blip. Failing the document leaves it visible with a
   * reason and eligible for the stuck-document sweep, which can retry it and
   * produce a complete result — whereas indexing what came back would be
   * indistinguishable from a document that never had those pages.
   */
  if (recovered.length < pdfChunks.length) {
    throw new Error(
      `OCR recovered ${recovered.length} of ${pdfChunks.length} chunks; ` +
        'indexing the document would omit the rest'
    )
  }

  return recovered.join('\n\n')
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
  const content = await ocrPdfInChunks(pdfBuffer, 'mistral', (chunk, index, total) =>
    processChunk(chunk, index, total, filename, apiKey, userId).then((r) => r.content)
  )

  return { content, processingMethod: 'mistral-ocr', cloudUrl }
}

/**
 * Why a document could not be read, phrased for whoever has to act on it.
 *
 * The `doc` and `ppt` parsers never throw: on a legacy OLE binary or a deck with
 * no text they return a placeholder sentence or scraped archive bytes, which an
 * interactive upload can show a user but an automated sync must never embed. They
 * report that as `degraded`, and it is treated here exactly like empty output.
 * Legacy formats get the concrete remedy, since re-saving genuinely fixes them —
 * the modern container is one the bundled parsers read.
 */
function unreadableDocumentMessage(filename: string): string {
  const modernFormat = LEGACY_FORMAT_REPLACEMENTS[getFileExtension(filename)]
  return modernFormat
    ? `No text could be extracted from this file. Re-save it as ${modernFormat} to index it.`
    : 'No text could be extracted from this file — it may be scanned, image-only, or password-protected.'
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

  /** Prefer what we actually downloaded over what the document is *called*. */
  const extension =
    resolveStoredArtifactExtension(fileUrl) ?? resolveParserExtension(filename, mimeType)
  const result = await parseBuffer(buffer, extension)
  return result
}
