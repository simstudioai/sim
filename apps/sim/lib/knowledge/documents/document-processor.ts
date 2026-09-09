import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
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
  recordProviderCooldown,
  waitForProviderAdmission,
} from '@/lib/core/rate-limiter/provider-admission'
import { ProviderCapacityDeferredError } from '@/lib/core/rate-limiter/provider-capacity-error'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  isPayloadSizeLimitError,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import {
  addModelInputProvenanceToRequest,
  createModelInputProvenanceRequestMetadata,
} from '@/lib/execution/model-input-provenance'
import { parseBuffer } from '@/lib/file-parsers'
import { decodeDataUriWithinLimit } from '@/lib/file-parsers/data-uri'
import { FileParserError, isFileParserError } from '@/lib/file-parsers/errors'
import { openPdfDocument } from '@/lib/file-parsers/pdfjs-server'
import type { FileParseMetadata, FileParseResult } from '@/lib/file-parsers/types'
import { getMistralOcrPagesPerRequest } from '@/lib/internal/mistral/capacity'
import { MistralOperationError } from '@/lib/internal/mistral/errors'
import { mistralParseInputSchema } from '@/lib/internal/mistral/input'
import { executeMistralParse } from '@/lib/internal/mistral/operations'
import {
  MAX_DOCUMENT_CHUNKS,
  OcrRequestRejectedError,
  PermanentDocumentProcessingError,
} from '@/lib/knowledge/documents/document-processing-error'
import {
  createOcrCheckpoints,
  type OcrCheckpointContext,
} from '@/lib/knowledge/documents/ocr-checkpoints'
import {
  getAzureMistralOcrRequestPolicy,
  MISTRAL_OCR_REQUEST_POLICY,
  OCR_IMAGE_MIME_TYPES,
  type OcrRequestPolicy,
} from '@/lib/knowledge/documents/ocr-request-policy'
import { assertOcrSourceSupported } from '@/lib/knowledge/documents/ocr-source-validation'
import {
  resolveParserExtension,
  resolveStoredArtifactExtension,
} from '@/lib/knowledge/documents/parser-extension'
import {
  buildLargestFittingPdfChunk,
  type PdfOcrChunk,
} from '@/lib/knowledge/documents/pdf-ocr-chunking'
import { assessPdfTextLayer } from '@/lib/knowledge/documents/pdf-text-layer'
import { getProviderCapacityDeferral } from '@/lib/knowledge/documents/processing-provider-deferral'
import { resolveRetryDelayMs, retryWithExponentialBackoff } from '@/lib/knowledge/documents/utils'
import {
  assertKnowledgeOpaqueModelInputSafe,
  getKnowledgeOpaqueModelInputRegistry,
} from '@/lib/knowledge/model-input-provenance'
import { getFileExtension, isInternalFileUrl } from '@/lib/uploads/utils/file-utils'
import {
  type DownloadFileFromUrlOptions,
  downloadFileFromUrl,
} from '@/lib/uploads/utils/file-utils.server'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'
import { mistralParserTool } from '@/tools/mistral/parser'
import type { MistralParserInput } from '@/tools/mistral/types'

const logger = createLogger('DocumentProcessor')

const TIMEOUTS = {
  FILE_DOWNLOAD: 600000,
  MISTRAL_OCR_API: 120000,
} as const

const MAX_OCR_PDF_PAGES = 10_000
const MAX_OCR_SPLIT_BYTES = 2 * MAX_FILE_SIZE
const MAX_OCR_RESPONSE_BYTES = 32 * 1024 * 1024
const MAX_OCR_OUTPUT_TEXT_BYTES = 20 * 1024 * 1024

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

async function getPdfPageCount(buffer: Buffer): Promise<number> {
  let pdf: Awaited<ReturnType<typeof openPdfDocument>> | undefined
  try {
    const uint8Array = new Uint8Array(buffer)
    pdf = await openPdfDocument(uint8Array)
    return pdf.numPages
  } catch (error) {
    logger.warn('Primary PDF page-count parser failed', {
      errorType: toError(error).name,
    })
    try {
      return (await PDFDocument.load(buffer)).getPageCount()
    } catch (fallbackError) {
      logger.warn('Fallback PDF page-count parser failed', {
        errorType: toError(fallbackError).name,
      })
      return 0
    }
  } finally {
    await pdf?.destroy().catch(() => {})
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

  constructor(
    message: string,
    status: number,
    readonly retryAfterMs?: number
  ) {
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

/**
 * Who a source-file read runs as: the actor for authorization and OCR
 * attribution, plus how a knowledge-base file identifies its reader.
 */
export type SourceFileAccess = Pick<
  DownloadFileFromUrlOptions,
  'userId' | 'knowledgeAccess' | 'signal'
> & {
  ocrCheckpoint?: OcrCheckpointContext
  /** Canonical worker deadline; OCR yields before another request can overrun this pass. */
  processingDeadlineAt?: number
}

export async function processDocument(
  fileUrl: string,
  filename: string,
  mimeType: string,
  chunkSize = 1024,
  chunkOverlap = 200,
  minCharactersPerChunk = 100,
  access: SourceFileAccess = {},
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
    access.signal?.throwIfAborted()
    const parseResult = await parseDocument(fileUrl, filename, mimeType, access, workspaceId)
    access.signal?.throwIfAborted()
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

        const jsonYamlChunks = isJsonYaml
          ? await JsonYamlChunker.chunkStructured(content, {
              chunkSize,
              minCharactersPerChunk,
              maxChunks: MAX_DOCUMENT_CHUNKS,
            })
          : null

        if (jsonYamlChunks !== null) {
          logger.info('Using JSON/YAML chunker for structured data')
          chunks = jsonYamlChunks
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

    access.signal?.throwIfAborted()
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
 * A malformed PDF can fall through to OCR. Password protection and extraction safety
 * limits remain typed failures: sending that same document to a paid provider
 * would repeat the work without establishing that its native text was unusable.
 */
async function readEmbeddedPdfText(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  access: SourceFileAccess
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
    const parsed = await parseBuffer(buffer, 'pdf', {
      signal: access.signal,
      pdfTextMode: 'complete',
    })
    if (parsed.metadata?.truncated) {
      throw new FileParserError(
        'complexity_limit',
        'PDF text extraction stopped at a safety limit. Split or simplify the PDF and retry.'
      )
    }

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
    access.signal?.throwIfAborted()
    if (
      (error instanceof Error && error.name === 'PasswordException') ||
      (isFileParserError(error) && error.code === 'encrypted_file')
    ) {
      throw new PermanentDocumentProcessingError(
        'encrypted_file',
        'This PDF is password-protected. Remove the password protection and retry.'
      )
    }
    if (isFileParserError(error) && error.code === 'complexity_limit') {
      throw new PermanentDocumentProcessingError('document_complexity_limit', error.message, error)
    }
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
  access: SourceFileAccess,
  workspaceId?: string | null
): Promise<{
  content: string
  processingMethod: 'file-parser' | 'mistral-ocr'
  cloudUrl?: string
  metadata?: FileParseMetadata
}> {
  const isPDF = mimeType === 'application/pdf'
  const isImage = OCR_IMAGE_MIME_TYPES.has(mimeType)
  const mistralApiKey = await getMistralApiKey(workspaceId)
  access.signal?.throwIfAborted()

  if (isPDF || isImage) {
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
      const buffer = await downloadFileForBase64(fileUrl, access)
      access.signal?.throwIfAborted()
      assertOcrSourceSupported(buffer, mimeType)
      const embedded = isPDF
        ? await readEmbeddedPdfText(buffer, filename, mimeType, access)
        : undefined
      if (embedded) return embedded

      assertKnowledgeOpaqueModelInputSafe()

      if (ocrProvider === 'azure-mistral') {
        logger.info('Using Azure Mistral OCR')
        return parseWithAzureMistralOCR(buffer, filename, mimeType, access)
      }

      logger.info('Using Mistral OCR')
      return parseWithMistralOCR(buffer, filename, mimeType, access, mistralApiKey)
    }
    if (isImage) throw new Error('Configure Mistral or Azure OCR to index image files')
  }

  logger.info('Using file parser')
  return parseWithFileParser(fileUrl, filename, mimeType, access)
}

/**
 * Downloads an ingestion source file, enforcing the {@link MAX_FILE_SIZE} document
 * limit. `maxBytes` aborts the streaming read once the cap is exceeded (and rejects
 * up front on an oversized `Content-Length`), so an attacker-controlled `fileUrl`
 * pointing at an unbounded body cannot exhaust the processing worker's memory.
 */
async function downloadFileWithTimeout(fileUrl: string, access: SourceFileAccess): Promise<Buffer> {
  return downloadFileFromUrl(fileUrl, {
    timeoutMs: TIMEOUTS.FILE_DOWNLOAD,
    maxBytes: MAX_FILE_SIZE,
    ...access,
  })
}

async function downloadFileForBase64(fileUrl: string, access: SourceFileAccess): Promise<Buffer> {
  access.signal?.throwIfAborted()
  if (/^data:/i.test(fileUrl)) {
    return decodeDataUriWithinLimit(fileUrl, MAX_FILE_SIZE).buffer
  }
  if (/^https?:\/\//i.test(fileUrl) || isInternalFileUrl(fileUrl)) {
    return downloadFileWithTimeout(fileUrl, access)
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
  body: string | Record<string, unknown>,
  signal?: AbortSignal,
  deadlineAt = Date.now() + TIMEOUTS.MISTRAL_OCR_API
): Promise<Response> {
  signal?.throwIfAborted()
  await waitForProviderAdmission({
    providerId: 'azure-mistral',
    credentialFingerprint: sha256Hex(env.OCR_AZURE_API_KEY!),
    operation: 'ocr',
    signal,
    maxWaitMs: Math.max(0, deadlineAt - Date.now()),
  })
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUTS.MISTRAL_OCR_API)
  const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
      signal: requestSignal,
    })

    const responseBodyLimit = response.ok ? MAX_OCR_RESPONSE_BYTES : DEFAULT_MAX_ERROR_BODY_BYTES
    let responseText: string
    try {
      responseText = await readResponseTextWithLimit(response, {
        maxBytes: responseBodyLimit,
        label: response.ok ? 'OCR success response' : 'OCR error response',
        signal: requestSignal,
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
      if ([400, 415, 422].includes(response.status)) {
        throw new OcrRequestRejectedError(response.status)
      }
      if (response.status === 413) {
        throw new PermanentDocumentProcessingError(
          'document_complexity_limit',
          'The OCR provider rejected this document because the request was too large. Split or optimize the document and retry.'
        )
      }
      if (response.status === 429) {
        await recordProviderCooldown(
          {
            providerId: 'azure-mistral',
            credentialFingerprint: sha256Hex(env.OCR_AZURE_API_KEY!),
            operation: 'ocr',
          },
          resolveRetryDelayMs(response.headers) ?? 1000
        )
      }
      throw new APIError(
        `OCR failed: ${response.status}`,
        response.status,
        resolveRetryDelayMs(response.headers)
      )
    }

    return new Response(responseText, {
      status: response.status,
      headers: response.headers,
    })
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('OCR API request timed out')
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

async function parseWithAzureMistralOCR(
  fileBuffer: Buffer,
  filename: string,
  mimeType: string,
  access: SourceFileAccess
) {
  validateOCRConfig(
    env.OCR_AZURE_API_KEY,
    env.OCR_AZURE_ENDPOINT,
    env.OCR_AZURE_MODEL_NAME,
    'Azure Mistral OCR'
  )

  const requestPolicy = getAzureMistralOcrRequestPolicy(env.OCR_AZURE_MODEL_NAME!)
  if (mimeType !== 'application/pdf' && fileBuffer.length > requestPolicy.maxBytes) {
    throw new PermanentDocumentProcessingError(
      'document_complexity_limit',
      'This image exceeds the OCR request size limit. Resize the image and retry.'
    )
  }

  try {
    /**
     * A PDF is chunked to the provider's page cap rather than refused for
     * exceeding it, matching the other OCR provider. Refusing meant a long
     * document could not be ingested at all, and the cap applies to a single
     * request, not to the document.
     */
    const content =
      mimeType === 'application/pdf'
        ? await ocrPdfInChunks(
            fileBuffer,
            'azure-mistral',
            filename,
            requestPolicy,
            (chunk) => {
              const pageCount = chunk.endPage - chunk.startPage + 1
              return recognizeWithAzureOCR(
                chunk.buffer,
                mimeType,
                pageCount > 0 ? pageCount : undefined,
                access.signal
              )
            },
            access.signal,
            access.ocrCheckpoint
              ? {
                  context: access.ocrCheckpoint,
                  providerIdentity: `azure-mistral:${env.OCR_AZURE_ENDPOINT}:${env.OCR_AZURE_MODEL_NAME}`,
                  deadlineAt: access.processingDeadlineAt,
                }
              : undefined
          )
        : await recognizeWithAzureOCR(fileBuffer, mimeType, undefined, access.signal)

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
  expectedPages?: number,
  signal?: AbortSignal
): Promise<string> {
  const dataUri = `data:${mimeType};base64,${buffer.toString('base64')}`

  const response = await retryWithExponentialBackoff(
    (operationSignal, deadlineAt) =>
      makeOCRRequest(
        env.OCR_AZURE_ENDPOINT!,
        {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.OCR_AZURE_API_KEY}`,
        },
        {
          model: env.OCR_AZURE_MODEL_NAME!,
          document: mimeType.startsWith('image/')
            ? { type: 'image_url', image_url: dataUri }
            : { type: 'document_url', document_url: dataUri },
          include_image_base64: false,
        },
        operationSignal,
        deadlineAt
      ),
    { maxRetries: 3, initialDelayMs: 1000, maxDelayMs: 10000, retryBudgetMs: 120000, signal }
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
  buffer: Buffer,
  filename: string,
  mimeType: string,
  access: SourceFileAccess,
  mistralApiKey?: string | null
) {
  const apiKey = mistralApiKey || env.MISTRAL_API_KEY
  if (!apiKey) throw new Error('Mistral API key required')
  access.signal?.throwIfAborted()
  if (mimeType !== 'application/pdf') {
    const content = await recognizeWithMistralOCR(
      { buffer, filename, mimeType, expectedPages: 1 },
      apiKey,
      access
    )
    return { content, processingMethod: 'mistral-ocr' as const }
  }
  return processMistralOCRInBatches(filename, apiKey, buffer, access)
}

async function executeMistralOCRRequest(
  params: MistralParserInput,
  access: SourceFileAccess,
  expectedPages?: number
): Promise<Response> {
  try {
    return await retryWithExponentialBackoff(
      async (operationSignal, deadlineAt) => {
        operationSignal?.throwIfAborted()
        const input = mistralParseInputSchema.parse(mistralParserTool.operation.input(params))
        const headers = new Headers()
        const modelInput = mistralParserTool.operation.modelInput
        const inputPaths =
          modelInput?.mode === 'private-provenance' ? modelInput.inputPaths(params) : []
        const metadata = createModelInputProvenanceRequestMetadata(
          getKnowledgeOpaqueModelInputRegistry(),
          inputPaths
        )
        const operationInput = mistralParseInputSchema.parse(
          addModelInputProvenanceToRequest(input, headers, metadata)
        )
        try {
          const result = await executeMistralParse(operationInput, {
            headers,
            maxResponseBytes: MAX_OCR_RESPONSE_BYTES,
            deadlineAt,
            expectedPages,
            requestId: generateId(),
            signal: operationSignal,
            trustedCaller: 'knowledge-ingestion',
            userId: access.userId,
          })
          return Response.json(result)
        } catch (error) {
          operationSignal?.throwIfAborted()
          if (error instanceof MistralOperationError) {
            if (error.source === 'provider' && [400, 415, 422].includes(error.status)) {
              throw new OcrRequestRejectedError(error.status)
            }
            if (error.status === 413) {
              throw new PermanentDocumentProcessingError(
                'document_complexity_limit',
                'The OCR provider rejected this document because the request was too large. Split or optimize the document and retry.'
              )
            }
            throw new APIError(`OCR failed: ${error.status}`, error.status, error.retryAfterMs)
          }
          throw error
        }
      },
      {
        maxRetries: 3,
        initialDelayMs: 1000,
        maxDelayMs: 10000,
        retryBudgetMs: 120000,
        signal: access.signal,
      }
    )
  } catch (error) {
    access.signal?.throwIfAborted()
    if (toError(error).name === 'TimeoutError') {
      throw new ProviderCapacityDeferredError('provider_timeout', {
        providerId: 'mistral',
        retryAfterMs: 60_000,
        cause: error,
      })
    }
    throw error
  }
}

async function recognizeWithMistralOCR(
  file: { buffer: Buffer; filename: string; mimeType: string; expectedPages?: number },
  apiKey: string,
  access: SourceFileAccess
): Promise<string> {
  access.signal?.throwIfAborted()
  if (file.buffer.length > MISTRAL_OCR_REQUEST_POLICY.maxBytes) {
    throw new PermanentDocumentProcessingError(
      'document_complexity_limit',
      'This file exceeds the OCR request size limit. Split or resize the file and retry.'
    )
  }

  try {
    const params: MistralParserInput = {
      file: {
        key: `ocr/${generateId()}`,
        name: file.filename,
        type: file.mimeType,
        size: file.buffer.length,
        base64: file.buffer.toString('base64'),
      },
      apiKey,
      resultType: 'text',
    }

    const response = await executeMistralOCRRequest(params, access, file.expectedPages)
    const result = (await mistralParserTool.transformResponse!(response, params)) as OCRResult

    if (!result.success) {
      throw new Error(`OCR processing failed: ${result.error || 'Unknown error'}`)
    }

    const pageCount = result.output?.metadata?.pageCount
    const pagesProcessed = result.output?.metadata?.usageInfo?.pagesProcessed
    if (pageCount === 0) throw new Error('OCR provider returned no page results')
    if (
      file.expectedPages === undefined &&
      (!Number.isFinite(pageCount) ||
        !Number.isFinite(pagesProcessed) ||
        pageCount !== pagesProcessed)
    ) {
      throw new Error('OCR provider did not report a complete page count for this PDF')
    }
    if (
      file.expectedPages !== undefined &&
      (pageCount !== file.expectedPages ||
        (Number.isFinite(pagesProcessed) && pagesProcessed !== file.expectedPages))
    ) {
      throw new Error(
        `OCR provider returned an incomplete page result: expected ${file.expectedPages}, received ${pageCount}`
      )
    }

    const content = result.output?.content ?? ''
    assertOcrOutputTextWithinLimit(content)
    return content
  } catch (error) {
    logger.error('Mistral OCR failed', {
      errorType: toError(error).name,
    })
    throw error
  }
}

/**
 * Runs a PDF through OCR a chunk at a time and stitches the pages back together.
 *
 * A provider that caps how many pages or bytes one request may carry needs the
 * document split according to its own policy. The splitting, concurrency,
 * ordering, and partial-failure rule live here once rather than being restated
 * per provider, where they had already drifted into one provider chunking and
 * the other refusing anything over the cap.
 *
 * A document is indexed whole or not at all: if any chunk fails, the document
 * fails, because a partial result reports success while page ranges are missing
 * and nothing downstream can tell.
 */
async function ocrPdfInChunks(
  pdfBuffer: Buffer,
  provider: string,
  filename: string,
  policy: OcrRequestPolicy,
  recognize: (chunk: PdfOcrChunk, chunkIndex: number) => Promise<string | null>,
  signal?: AbortSignal,
  checkpointOptions?: {
    context: OcrCheckpointContext
    providerIdentity: string
    deadlineAt?: number
  }
): Promise<string> {
  signal?.throwIfAborted()
  const detectedPageCount = await getPdfPageCount(pdfBuffer)

  /**
   * An encrypted or malformed PDF may be acceptable to the provider even when
   * pdf-lib cannot load it. It can still be sent whole when its measured bytes
   * and known page count fit the request policy. Once a known limit is exceeded,
   * however, sending it unsplit would knowingly violate the provider contract.
   */
  let sourcePdf: PDFDocument | null = null
  let totalPages = detectedPageCount
  try {
    sourcePdf = await PDFDocument.load(pdfBuffer)
    totalPages = sourcePdf.getPageCount()
  } catch (error) {
    logger.info('PDF could not be loaded for OCR splitting', {
      provider,
      error: toError(error).message,
    })
  }

  if (totalPages > MAX_OCR_PDF_PAGES) {
    throw new PermanentDocumentProcessingError(
      'document_complexity_limit',
      `This PDF has ${totalPages.toLocaleString()} pages, exceeding the safe OCR limit of ${MAX_OCR_PDF_PAGES.toLocaleString()}. Split it into smaller files and retry.`
    )
  }

  const minimumChunkCount = totalPages > 0 ? Math.ceil(totalPages / policy.maxPages) : 1
  if (minimumChunkCount > policy.maxChunks) {
    throw new PermanentDocumentProcessingError(
      'document_complexity_limit',
      `This PDF requires at least ${minimumChunkCount.toLocaleString()} OCR requests, exceeding the safe limit of ${policy.maxChunks.toLocaleString()}. Split it into smaller files and retry.`
    )
  }

  const requiresSplitting = pdfBuffer.length > policy.maxBytes || totalPages > policy.maxPages
  if (requiresSplitting && (!sourcePdf || totalPages === 0)) {
    throw new PermanentDocumentProcessingError(
      'document_complexity_limit',
      `This PDF exceeds the OCR provider's per-request limit and could not be split safely. Split or optimize the PDF and retry.`
    )
  }

  logger.info('OCR PDF request policy resolved', {
    provider,
    bytes: pdfBuffer.length,
    totalPages,
    requiresSplitting,
    maxBytesPerRequest: policy.maxBytes,
    maxPagesPerRequest: policy.maxPages,
    maxChunks: policy.maxChunks,
    concurrency: policy.concurrency,
  })

  const checkpoints = checkpointOptions
    ? createOcrCheckpoints({ ...checkpointOptions, source: pdfBuffer, policy })
    : undefined

  type ChunkOutcome =
    | { index: number; kind: 'content'; content: string; cached: boolean }
    | { index: number; kind: 'empty'; cached: boolean }
    | { index: number; kind: 'failure'; error: unknown }

  const outcomes: ChunkOutcome[] = []
  let cumulativeSplitBytes = 0
  let cumulativeOutputBytes = 0
  let nextPage = 0
  let nextChunkIndex = 0
  let wholeDocumentPending = !requiresSplitting

  while (wholeDocumentPending || nextPage < totalPages) {
    signal?.throwIfAborted()
    const batch: Array<{ chunk: PdfOcrChunk; index: number }> = []

    if (wholeDocumentPending) {
      batch.push({
        chunk: {
          buffer: pdfBuffer,
          startPage: 0,
          endPage: totalPages > 0 ? totalPages - 1 : -1,
        },
        index: nextChunkIndex++,
      })
      wholeDocumentPending = false
      nextPage = totalPages
    } else {
      for (let slot = 0; slot < policy.concurrency && nextPage < totalPages; slot++) {
        if (nextChunkIndex >= policy.maxChunks) {
          throw new PermanentDocumentProcessingError(
            'document_complexity_limit',
            `Byte-aware OCR splitting requires more than the safe limit of ${policy.maxChunks.toLocaleString()} requests. Split or optimize the PDF and retry.`
          )
        }

        const chunk = await buildLargestFittingPdfChunk(sourcePdf!, nextPage, totalPages, policy)
        signal?.throwIfAborted()
        cumulativeSplitBytes += chunk.buffer.length
        if (cumulativeSplitBytes > MAX_OCR_SPLIT_BYTES) {
          throw new PermanentDocumentProcessingError(
            'document_complexity_limit',
            `Splitting this PDF for OCR exceeded the safe cumulative limit of ${MAX_OCR_SPLIT_BYTES.toLocaleString()} bytes. Split it into smaller files and retry.`
          )
        }

        batch.push({ chunk, index: nextChunkIndex++ })
        nextPage = chunk.endPage + 1
      }
    }

    const batchResults = await Promise.all(
      batch.map(async ({ chunk, index }): Promise<ChunkOutcome> => {
        try {
          signal?.throwIfAborted()
          const cached = await checkpoints?.load(
            chunk,
            MAX_OCR_OUTPUT_TEXT_BYTES - cumulativeOutputBytes,
            signal
          )
          const wasCached = cached !== undefined && cached !== null
          /** Leave time for the request, checkpoint write and the rest of the indexing pass. */
          if (
            !wasCached &&
            checkpointOptions?.deadlineAt !== undefined &&
            Date.now() + TIMEOUTS.MISTRAL_OCR_API + 75_000 >= checkpointOptions.deadlineAt
          ) {
            throw new ProviderCapacityDeferredError('processing_budget', {
              providerId: provider,
              retryAfterMs: 1000,
            })
          }
          const content = wasCached ? cached : await recognize(chunk, index)
          return content && content.trim().length > 0
            ? { index, kind: 'content', content, cached: wasCached }
            : { index, kind: 'empty', cached: wasCached }
        } catch (error) {
          signal?.throwIfAborted()
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
    for (const outcome of batchResults) {
      if (outcome.kind === 'failure' || outcome.cached) continue
      const range = batch.find((entry) => entry.index === outcome.index)!.chunk
      await checkpoints?.save(
        range,
        outcome.kind === 'content' ? outcome.content : '',
        MAX_OCR_OUTPUT_TEXT_BYTES,
        signal
      )
    }
    outcomes.push(...batchResults)
    if (batchResults.some((outcome) => outcome.kind === 'failure')) break
  }

  const chunkCount = outcomes.length

  const failures = outcomes.filter(
    (outcome): outcome is Extract<ChunkOutcome, { kind: 'failure' }> => outcome.kind === 'failure'
  )
  if (failures.length > 0) {
    const permanentFailure = failures.find(
      (failure) =>
        failure.error instanceof PermanentDocumentProcessingError ||
        failure.error instanceof OcrRequestRejectedError
    )?.error
    if (permanentFailure) throw permanentFailure
    const abortedFailure = failures.find(
      (failure) => failure.error instanceof Error && failure.error.name === 'AbortError'
    )?.error
    if (abortedFailure) throw abortedFailure
    const capacityFailure = getProviderCapacityDeferral(
      new AggregateError(failures.map((failure) => failure.error))
    )
    if (capacityFailure) throw capacityFailure
    if (chunkCount === 1) throw failures[0].error

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
  access: SourceFileAccess
): Promise<{
  content: string
  processingMethod: 'mistral-ocr'
}> {
  const content = await ocrPdfInChunks(
    pdfBuffer,
    'mistral',
    filename,
    {
      ...MISTRAL_OCR_REQUEST_POLICY,
      maxPages: getMistralOcrPagesPerRequest(),
      maxChunks: 512,
      concurrency: 1,
    },
    (chunk) =>
      recognizeWithMistralOCR(
        {
          buffer: chunk.buffer,
          filename,
          mimeType: 'application/pdf',
          expectedPages:
            chunk.endPage >= chunk.startPage ? chunk.endPage - chunk.startPage + 1 : undefined,
        },
        apiKey,
        access
      ),
    access.signal,
    access.ocrCheckpoint
      ? {
          context: access.ocrCheckpoint,
          providerIdentity: 'mistral:mistral-ocr-latest',
          deadlineAt: access.processingDeadlineAt,
        }
      : undefined
  )

  return { content, processingMethod: 'mistral-ocr' }
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
  access: SourceFileAccess
) {
  try {
    let content: string
    let metadata: FileParseMetadata = {}

    if (/^data:/i.test(fileUrl)) {
      const result = await parseDataURI(fileUrl, filename, mimeType, access)
      content = result.content
      metadata = result.metadata || {}
    } else if (/^https?:\/\//i.test(fileUrl) || isInternalFileUrl(fileUrl)) {
      // Internal URLs may arrive as an app-relative `/api/files/serve/...` path
      // (some ingestion callers store the relative path); downloadFileFromUrl
      // resolves it directly against storage without an absolute origin.
      const result = await parseHttpFile(fileUrl, filename, mimeType, access)
      content = result.content
      metadata = result.metadata || {}
    } else {
      throw new Error(
        'Unsupported fileUrl scheme: only data: URIs, http(s):// URLs, and internal /api/files/serve/ paths are allowed'
      )
    }

    access.signal?.throwIfAborted()
    return { content, processingMethod: 'file-parser' as const, cloudUrl: undefined, metadata }
  } catch (error) {
    logger.error('File parser failed', { errorType: toError(error).name })
    throw error
  }
}

async function parseDataURI(
  fileUrl: string,
  filename: string,
  mimeType: string,
  access: SourceFileAccess
): Promise<FileParseResult> {
  const { buffer } = decodeDataUriWithinLimit(fileUrl, MAX_FILE_SIZE)
  const extension = resolveParserExtension(filename, mimeType, 'txt')
  logger.info('Parsing bounded data URI', { bytes: buffer.length, extension })
  return parseBuffer(buffer, extension, {
    signal: access.signal,
    pdfTextMode: extension === 'pdf' ? 'complete' : undefined,
  })
}

async function parseHttpFile(
  fileUrl: string,
  filename: string,
  mimeType: string | undefined,
  access: SourceFileAccess
): Promise<{ content: string; metadata?: FileParseMetadata }> {
  const buffer = await downloadFileWithTimeout(fileUrl, access)
  access.signal?.throwIfAborted()

  /** Prefer what we actually downloaded over what the document is *called*. */
  const extension =
    resolveStoredArtifactExtension(fileUrl) ?? resolveParserExtension(filename, mimeType)
  const result = await parseBuffer(buffer, extension, {
    signal: access.signal,
    pdfTextMode: extension === 'pdf' ? 'complete' : undefined,
  })
  return result
}
