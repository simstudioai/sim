import { randomBytes } from 'crypto'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { PDFDocument } from 'pdf-lib'
import { getBYOKKey } from '@/lib/api-key/byok'
import {
  type Chunk,
  ChunkLimitExceededError,
  JsonYamlChunker,
  RecursiveChunker,
  RegexChunker,
  SentenceChunker,
  StructuredDataChunker,
  TextChunker,
  TokenChunker,
} from '@/lib/chunkers'
import type { ChunkingStrategy, StrategyOptions } from '@/lib/chunkers/types'
import { env } from '@/lib/core/config/env'
import { OCR_CAPABILITY, requireCapability } from '@/lib/core/config/env-capabilities'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  isPayloadSizeLimitError,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { parseBuffer } from '@/lib/file-parsers'
import { decodeDataUriWithinLimit } from '@/lib/file-parsers/data-uri'
import type { FileParseMetadata, FileParseResult } from '@/lib/file-parsers/types'
import {
  MAX_DOCUMENT_CHUNKS,
  PermanentDocumentProcessingError,
} from '@/lib/knowledge/documents/document-processing-error'
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

const DEFAULT_OCR_CHUNK_CONCURRENCY = 2
const MAX_OCR_PDF_PAGES = 10_000
const MAX_OCR_PDF_CHUNKS = 10
const MAX_OCR_SPLIT_BYTES = 2 * MAX_FILE_SIZE
const MAX_OCR_RESPONSE_BYTES = 32 * 1024 * 1024
const MAX_OCR_OUTPUT_TEXT_BYTES = 20 * 1024 * 1024

/**
 * Two concurrent OCR chunks keep the source, split-buffer, response, and
 * extracted-text ceilings inside one worker's aggregate memory budget.
 */
const MAX_CONCURRENT_CHUNKS = DEFAULT_OCR_CHUNK_CONCURRENCY

type OCRResult = {
  success: boolean
  error?: string
  output?: {
    content?: string
    metadata?: {
      pageCount?: number
      usageInfo?: { pagesProcessed?: number }
    }
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
  let pdf: Awaited<ReturnType<typeof import('unpdf')['getDocumentProxy']>> | undefined
  try {
    const { getDocumentProxy } = await import('unpdf')
    const uint8Array = new Uint8Array(buffer)
    pdf = await getDocumentProxy(uint8Array)
    return pdf.numPages
  } catch (error) {
    logger.warn('Failed to get PDF page count:', error)
    return 0
  } finally {
    await pdf?.destroy().catch(() => {})
  }
}

interface PdfChunk {
  buffer: Buffer
  startPage: number
  endPage: number
}

async function buildPdfChunk(
  sourcePdf: PDFDocument,
  startPage: number,
  endPage: number
): Promise<PdfChunk> {
  const outputPdf = await PDFDocument.create()
  const pageIndices = Array.from(
    { length: endPage - startPage + 1 },
    (_, index) => startPage + index
  )
  const copiedPages = await outputPdf.copyPages(sourcePdf, pageIndices)
  for (const page of copiedPages) outputPdf.addPage(page)

  return {
    buffer: Buffer.from(await outputPdf.save()),
    startPage,
    endPage,
  }
}

type AzureOCRResponse = {
  pages?: OCRPage[]
  usage_info?: {
    pages_processed?: number
  }
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
  const baseOptions = {
    chunkSize,
    chunkOverlap,
    minCharactersPerChunk,
    maxChunks: MAX_DOCUMENT_CHUNKS,
  }

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
      throw new PermanentDocumentProcessingError(
        'no_extractable_text',
        unreadableDocumentMessage(filename)
      )
    }

    let chunks: Chunk[]
    const metadata: FileParseMetadata = parseResult.metadata ?? {}

    try {
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
            maxChunks: MAX_DOCUMENT_CHUNKS,
          })
        } else if (StructuredDataChunker.isStructuredData(content, mimeType)) {
          logger.info('Using structured data chunker for spreadsheet/CSV content')
          const rowCount = metadata.totalRows ?? metadata.rowCount
          chunks = await StructuredDataChunker.chunkStructuredData(content, {
            chunkSize,
            headers: metadata.headers,
            totalRows: typeof rowCount === 'number' ? rowCount : undefined,
            sheetName: metadata.sheetNames?.[0],
            maxChunks: MAX_DOCUMENT_CHUNKS,
          })
        } else {
          const chunker = new TextChunker({
            chunkSize,
            chunkOverlap,
            minCharactersPerChunk,
            maxChunks: MAX_DOCUMENT_CHUNKS,
          })
          chunks = await chunker.chunk(content)
        }
      }
    } catch (error) {
      if (error instanceof ChunkLimitExceededError) {
        throw new PermanentDocumentProcessingError(
          'document_complexity_limit',
          `This document would produce more than ${error.maxChunks.toLocaleString()} index chunks. Split it into smaller files or increase its knowledge-base chunk size, then retry.`,
          error
        )
      }
      throw error
    }

    if (chunks.length === 0) {
      throw new PermanentDocumentProcessingError(
        'no_extractable_text',
        `The chunking strategy produced no indexable text for ${filename}. Adjust the chunking settings or replace the document content, then retry.`
      )
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
    return decodeDataUriWithinLimit(fileUrl, MAX_FILE_SIZE).buffer
  }
  if (/^https?:\/\//i.test(fileUrl) || isInternalFileUrl(fileUrl)) {
    return downloadFileWithTimeout(fileUrl, userId)
  }
  throw new Error(
    'Unsupported fileUrl scheme: only data: URIs, http(s):// URLs, and internal /api/files/serve/ paths are allowed'
  )
}

function assertOcrOutputTextWithinLimit(content: string): void {
  const outputBytes = Buffer.byteLength(content, 'utf8')
  if (outputBytes <= MAX_OCR_OUTPUT_TEXT_BYTES) return

  throw new PermanentDocumentProcessingError(
    'document_complexity_limit',
    `OCR extracted ${outputBytes.toLocaleString()} bytes of text, exceeding the safe limit of ${MAX_OCR_OUTPUT_TEXT_BYTES.toLocaleString()} bytes. Split the document into smaller files and retry.`
  )
}

function processOCRContent(result: OCRResult, filename: string, expectedPages?: number): string {
  if (!result.success) {
    throw new Error(`OCR processing failed: ${result.error || 'Unknown error'}`)
  }

  const content = result.output?.content || ''
  const pageCount = result.output?.metadata?.pageCount
  const pagesProcessed = result.output?.metadata?.usageInfo?.pagesProcessed
  if (pageCount === 0) {
    throw new Error('OCR provider returned no page results')
  }
  if (
    expectedPages !== undefined &&
    (pageCount !== expectedPages ||
      (Number.isFinite(pagesProcessed) && pagesProcessed !== expectedPages))
  ) {
    throw new Error(
      `OCR provider returned an incomplete page result: expected ${expectedPages}, received ${pageCount ?? 0}`
    )
  }
  if (
    expectedPages === undefined &&
    (!Number.isFinite(pageCount) ||
      !Number.isFinite(pagesProcessed) ||
      pageCount !== pagesProcessed)
  ) {
    throw new Error('OCR provider did not report a complete page count for this PDF')
  }
  if (!content.trim()) {
    throw new PermanentDocumentProcessingError(
      'no_extractable_text',
      unreadableDocumentMessage(filename)
    )
  }

  assertOcrOutputTextWithinLimit(content)

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

    const responseBodyLimit = response.ok ? MAX_OCR_RESPONSE_BYTES : DEFAULT_MAX_ERROR_BODY_BYTES
    let responseText: string
    try {
      responseText = await readResponseTextWithLimit(response, {
        maxBytes: responseBodyLimit,
        label: response.ok ? 'OCR success response' : 'OCR error response',
        signal: controller.signal,
      })
    } catch (error) {
      if (response.ok && isPayloadSizeLimitError(error)) {
        throw new Error(
          `OCR provider response exceeded the safe envelope limit of ${MAX_OCR_RESPONSE_BYTES} bytes`,
          { cause: error }
        )
      }
      if (!response.ok && isPayloadSizeLimitError(error)) {
        responseText = ''
      } else {
        throw error
      }
    }

    if (!response.ok) {
      throw new APIError(`OCR failed: ${response.status}`, response.status)
    }

    return new Response(responseText, {
      status: response.status,
      headers: response.headers,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('OCR API request timed out')
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
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
        ? await ocrPdfInChunks(fileBuffer, 'azure-mistral', filename, (chunk) => {
            const pageCount = chunk.endPage - chunk.startPage + 1
            return recognizeWithAzureOCR(
              chunk.buffer,
              mimeType,
              pageCount > 0 ? pageCount : undefined
            )
          })
        : await recognizeWithAzureOCR(fileBuffer, mimeType)

    if (!content.trim()) {
      throw new PermanentDocumentProcessingError(
        'no_extractable_text',
        unreadableDocumentMessage(filename)
      )
    }

    assertOcrOutputTextWithinLimit(content)

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
async function recognizeWithAzureOCR(
  buffer: Buffer,
  mimeType: string,
  expectedPages?: number
): Promise<string> {
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

  const returnedPages = ocrResult.pages?.length ?? 0
  const processedPages = ocrResult.usage_info?.pages_processed
  if (expectedPages !== undefined) {
    if (
      returnedPages !== expectedPages ||
      (processedPages !== undefined && processedPages !== expectedPages)
    ) {
      throw new Error(
        `OCR provider returned an incomplete page result: expected ${expectedPages}, received ${returnedPages}`
      )
    }
  } else if (
    returnedPages === 0 ||
    !Number.isFinite(processedPages) ||
    processedPages !== returnedPages
  ) {
    throw new Error('OCR provider did not report a complete page count for this PDF')
  }

  /**
   * A response carrying no pages is no content. Returning the raw payload instead
   * would be indexed as though it were the document: stitched into a chunked run
   * as recovered text, and in a single-document run it would satisfy the
   * empty-content check that exists to catch exactly this.
   */
  const content = extractPageContent(ocrResult.pages || [])
  assertOcrOutputTextWithinLimit(content)
  return content
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
    const content = processOCRContent(result, filename, pageCount > 0 ? pageCount : undefined)

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
): Promise<string> {
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

    if (!result.success) {
      throw new Error(`OCR processing failed: ${result.error || 'Unknown error'}`)
    }

    const pageCount = result.output?.metadata?.pageCount
    const pagesProcessed = result.output?.metadata?.usageInfo?.pagesProcessed
    if (
      chunkPageCount > 0 &&
      (pageCount !== chunkPageCount ||
        (Number.isFinite(pagesProcessed) && pagesProcessed !== chunkPageCount))
    ) {
      throw new Error(
        `OCR provider returned an incomplete page result: expected ${chunkPageCount}, received ${pageCount}`
      )
    }

    const content = result.output?.content ?? ''
    assertOcrOutputTextWithinLimit(content)
    logger.info(`Chunk ${chunkIndex + 1}/${totalChunks} completed successfully`)
    return content
  } catch (error) {
    logger.error(`Chunk ${chunkIndex + 1}/${totalChunks} failed:`, {
      errorType: toError(error).name,
    })
    throw error
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
  filename: string,
  recognize: (
    chunk: { buffer: Buffer; startPage: number; endPage: number },
    chunkIndex: number,
    totalChunks: number
  ) => Promise<string | null>
): Promise<string> {
  const detectedPageCount = await getPdfPageCount(pdfBuffer)

  /**
   * Splitting has to load the document, which an encrypted or malformed PDF will
   * refuse. That must not decide whether the file reaches OCR at all: those are
   * exactly the documents with no readable text layer, so OCR is their only route,
   * and the provider may well accept bytes that a local parser would not. When the
   * split fails the document is sent whole and the page cap is left to the
   * provider — the behaviour before it was chunked.
   */
  let sourcePdf: PDFDocument | null = null
  let totalPages = detectedPageCount
  try {
    sourcePdf = await PDFDocument.load(pdfBuffer)
    totalPages = sourcePdf.getPageCount()
  } catch (error) {
    logger.info('PDF could not be split for OCR, sending it whole', {
      provider,
      error: toError(error).message,
    })
  }

  const requiresSplitting = sourcePdf !== null && totalPages > MISTRAL_MAX_PAGES
  const chunkCount = requiresSplitting ? Math.ceil(totalPages / MISTRAL_MAX_PAGES) : 1
  if (totalPages > MAX_OCR_PDF_PAGES || chunkCount > MAX_OCR_PDF_CHUNKS) {
    throw new PermanentDocumentProcessingError(
      'document_complexity_limit',
      `This PDF has ${totalPages.toLocaleString()} pages, exceeding the safe OCR limit of ${MAX_OCR_PDF_PAGES.toLocaleString()}. Split it into smaller files and retry.`
    )
  }

  logger.info('Splitting PDF for OCR', {
    provider,
    totalPages,
    chunks: chunkCount,
    maxPagesPerChunk: MISTRAL_MAX_PAGES,
    concurrency: MAX_CONCURRENT_CHUNKS,
  })

  type ChunkOutcome =
    | { index: number; kind: 'content'; content: string }
    | { index: number; kind: 'empty' }
    | { index: number; kind: 'failure'; error: unknown }

  const outcomes: ChunkOutcome[] = []
  let cumulativeSplitBytes = 0
  let cumulativeOutputBytes = 0

  for (let i = 0; i < chunkCount; i += MAX_CONCURRENT_CHUNKS) {
    const batchEnd = Math.min(i + MAX_CONCURRENT_CHUNKS, chunkCount)
    const batch: PdfChunk[] = []
    for (let index = i; index < batchEnd; index++) {
      let chunk: PdfChunk
      if (requiresSplitting && sourcePdf) {
        const startPage = index * MISTRAL_MAX_PAGES
        const endPage = Math.min(startPage + MISTRAL_MAX_PAGES - 1, totalPages - 1)
        chunk = await buildPdfChunk(sourcePdf, startPage, endPage)
        cumulativeSplitBytes += chunk.buffer.length
        if (cumulativeSplitBytes > MAX_OCR_SPLIT_BYTES) {
          throw new PermanentDocumentProcessingError(
            'document_complexity_limit',
            `Splitting this PDF for OCR exceeded the safe cumulative limit of ${MAX_OCR_SPLIT_BYTES.toLocaleString()} bytes. Split it into smaller files and retry.`
          )
        }
      } else {
        chunk = {
          buffer: pdfBuffer,
          startPage: 0,
          endPage: totalPages > 0 ? totalPages - 1 : -1,
        }
      }
      batch.push(chunk)
    }

    const batchResults = await Promise.all(
      batch.map(async (chunk, batchIndex): Promise<ChunkOutcome> => {
        const index = i + batchIndex
        try {
          const content = await recognize(chunk, index, chunkCount)
          return content && content.trim().length > 0
            ? { index, kind: 'content', content }
            : { index, kind: 'empty' }
        } catch (error) {
          logger.warn('OCR chunk failed', {
            provider,
            chunk: index + 1,
            error: toError(error).message,
          })
          return { index, kind: 'failure', error }
        }
      })
    )
    for (const outcome of batchResults) {
      if (outcome.kind !== 'content') continue
      cumulativeOutputBytes += Buffer.byteLength(outcome.content, 'utf8')
      if (cumulativeOutputBytes > MAX_OCR_OUTPUT_TEXT_BYTES) {
        throw new PermanentDocumentProcessingError(
          'document_complexity_limit',
          `OCR extracted more than the safe limit of ${MAX_OCR_OUTPUT_TEXT_BYTES.toLocaleString()} bytes of text. Split the document into smaller files and retry.`
        )
      }
    }
    outcomes.push(...batchResults)
  }

  const failures = outcomes.filter(
    (outcome): outcome is Extract<ChunkOutcome, { kind: 'failure' }> => outcome.kind === 'failure'
  )
  if (failures.length > 0) {
    const permanentFailure = failures.find(
      (failure) => failure.error instanceof PermanentDocumentProcessingError
    )?.error
    if (permanentFailure) throw permanentFailure

    throw new Error(
      `OCR completed ${outcomes.length - failures.length} of ${chunkCount} chunks; indexing the document would omit the rest`,
      { cause: new AggregateError(failures.map((failure) => failure.error)) }
    )
  }

  const recovered = outcomes
    .sort((a, b) => a.index - b.index)
    .flatMap((outcome) => (outcome.kind === 'content' ? [outcome.content] : []))

  /**
   * Provider-specific checks already proved that every requested page was
   * represented. If every complete range is nevertheless blank, the document
   * has no text to index; a mixture of blank and nonblank pages remains valid.
   */
  if (recovered.length === 0) {
    throw new PermanentDocumentProcessingError(
      'no_extractable_text',
      unreadableDocumentMessage(filename)
    )
  }

  const content = recovered.join('\n\n')
  assertOcrOutputTextWithinLimit(content)
  return content
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
  const content = await ocrPdfInChunks(pdfBuffer, 'mistral', filename, (chunk, index, total) =>
    processChunk(chunk, index, total, filename, apiKey, userId)
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
      const result = await parseDataURI(fileUrl, filename, mimeType)
      content = result.content
      metadata = result.metadata || {}
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

async function parseDataURI(
  fileUrl: string,
  filename: string,
  mimeType: string
): Promise<FileParseResult> {
  const { buffer, mediaType } = decodeDataUriWithinLimit(fileUrl, MAX_FILE_SIZE)
  const extension = resolveParserExtension(filename, mimeType, 'txt')
  logger.info('Parsing bounded data URI', { bytes: buffer.length, mediaType, extension })
  return parseBuffer(buffer, extension)
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
