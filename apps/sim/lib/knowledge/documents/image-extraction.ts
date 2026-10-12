import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import sharp from 'sharp'
import { z } from 'zod'
import { env } from '@/lib/core/config/env'
import { getCostMultiplier } from '@/lib/core/config/env-flags'
import { waitForProviderAdmission } from '@/lib/core/rate-limiter/provider-admission'
import { ProviderCapacityDeferredError } from '@/lib/core/rate-limiter/provider-capacity-error'
import { EmbeddingConfigurationError } from '@/lib/embeddings/configuration-error'
import { resolveProviderKey } from '@/lib/embeddings/keys'
import { PermanentDocumentProcessingError } from '@/lib/knowledge/documents/document-processing-error'
import {
  GeminiImageExtractionError,
  requestGeminiImageExtraction,
} from '@/lib/knowledge/documents/image-extraction-gemini'
import {
  IMAGE_EXTRACTION_REPRESENTATION_VERSION,
  SEMANTIC_IMAGE_MIME_TYPES,
  SEMANTIC_IMAGE_MIN_BYTES,
} from '@/lib/knowledge/documents/image-extraction-policy'
import type { OcrCheckpointContext } from '@/lib/knowledge/documents/ocr-checkpoints'
import { isRetryableError, retryWithExponentialBackoff } from '@/lib/knowledge/documents/utils'
import {
  createVisionCheckpoint,
  type VisionExtractionCheckpoint,
} from '@/lib/knowledge/documents/vision-checkpoints'
import { assertKnowledgeOpaqueModelInputSafe } from '@/lib/knowledge/model-input-provenance'
import { sniffImageContentType } from '@/lib/uploads/utils/validation'
import { getProviderModels, INLINE_ATTACHMENT_MAX_BYTES } from '@/providers/models'
import { calculateCost } from '@/providers/utils'

const logger = createLogger('KnowledgeImageExtraction')

export const DEFAULT_IMAGE_EXTRACTION_MODEL = 'gemini-3.8-flash'

/** Below this many pixels on either side an image is an icon or spacer, never content. */
const MIN_IMAGE_EDGE_PX = 64
/** Longest edge sent to the model; the stored original is never resized. */
const MAX_IMAGE_EDGE_PX = 2048
const MAX_INPUT_PIXELS = 268_402_689
/** Dense tables truncated at 4,096 output tokens and parsed as nothing. */
const MAX_OUTPUT_TOKENS = 32_768
/** Covers every attempt of one extraction, retry waits included. */
const EXTRACTION_TIMEOUT_MS = 120_000
/**
 * Gemini failures worth an immediate retry inside one extraction: transient server
 * errors, which Gemini does not bill. Throttling (429) and overload (503) defer the
 * pass through provider admission instead.
 */
const RETRYABLE_GEMINI_STATUSES = new Set([500, 502, 504])
/** Time left after the call for the checkpoint write, embedding and the index swap. */
const POST_EXTRACTION_RESERVE_MS = 75_000

const IMAGE_EXTRACTION_SYSTEM_PROMPT = `You extract the knowledge held in one image attachment from a Confluence page in a knowledge base, so that the text can be indexed for search. You identify what the image is and extract accordingly, in one response that follows the given JSON schema exactly.

Rules that apply to every kind:
- Transcribe faithfully. Never guess, infer, or "correct" a value you cannot actually read; write [unreadable] in its place and report it in quality.unreadable_regions.
- Numbers, dates, names, and codes are copied exactly as shown.
- Keep the original language of the text; do not translate. Set language accordingly.
- Do not add commentary, disclaimers, or advice. Caveats belong only in the quality object.

Per kind:
- table (a table, schedule, calendar, matrix, or list saved as an image): fill table.headers and table.rows with every cell, preserving merged or spanning cells by repeating the spanning value in each cell it covers and explaining the span in table.notes. Then write rendered_text as one line per row that states each value with its header, for example "Region: EMEA. Quarter: Q1 2026. Launch date: March 3. Owner: Field marketing." Include the caption and notes.
- scan (a scanned or photographed text document, form, or letter): transcribe the full text in reading order with headings preserved as lines; rendered_text is that transcription. If it also contains a table, fill the table object too.
- screenshot (application or web UI): visible_text is every label, field name, menu item, button, and message shown. description names the application if identifiable, the screen, any highlighted or circled control, arrows or annotations, and the action the screenshot demonstrates. rendered_text is visible_text followed by the description.
- diagram (chart, flowchart, org chart, map, floor plan, process diagram): visible_text is every label; description states the entities and their relationships, arrows and directions, axis units, legend meanings, and for maps and floor plans the landmarks and routes. If it is a chart with readable values, put the data in the table object. rendered_text is visible_text followed by the description.
- photo (a photograph of a place, object, or person): visible_text is any readable signage; description states what is shown and any annotation drawn on it. rendered_text is visible_text followed by the description.
- decorative (a logo, icon, symbol, avatar, spacer, banner with no informational content): description is one short phrase; visible_text is any brand or icon text; rendered_text is an empty string; table is empty.

Quality: confidence is your honest estimate that rendered_text is complete and correct. Add the matching issue codes when the image is low resolution, text is tiny, cells are merged ambiguously, the image is cropped, rotated, or handwritten, or parts are unreadable.`

const IMAGE_KINDS = ['table', 'scan', 'screenshot', 'diagram', 'photo', 'decorative'] as const
const QUALITY_ISSUES = [
  'low_resolution',
  'merged_cells_ambiguous',
  'partial_crop',
  'handwriting',
  'unreadable_regions',
  'small_text',
  'skewed_or_rotated',
  'other',
] as const

/**
 * The model's output contract. Indexing keeps only `kind` and `rendered_text`;
 * the other fields stay because asking for them is what makes the model read
 * tables cell by cell and report what it could not read.
 */
export const IMAGE_EXTRACTION_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    kind: {
      type: 'string',
      enum: [...IMAGE_KINDS],
      description:
        'What the image is: a table, schedule, or matrix; a scanned text document; a UI screenshot; a diagram, chart, map, or floor plan; a photo; or pure decoration (logo, icon, symbol, spacer).',
    },
    language: {
      type: 'string',
      description:
        "Primary language of any text in the image, as an ISO 639-1 code, or 'none' when there is no text, or 'mixed' with both codes joined by '+'.",
    },
    visible_text: {
      type: 'string',
      description:
        'Every piece of text visible in the image, transcribed in reading order. Empty string when there is none. Mark any run you cannot read as [unreadable].',
    },
    description: {
      type: 'string',
      description:
        'What the image shows and what it is for: highlighted controls, arrows, annotations, spatial relationships, the action a screenshot demonstrates. For decoration, one short phrase.',
    },
    table: {
      type: 'object',
      description:
        "The table's structure when kind is table, or when a screenshot or scan contains a table. Otherwise empty caption, empty arrays, empty notes.",
      properties: {
        caption: { type: 'string' },
        headers: { type: 'array', items: { type: 'string' } },
        rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
        notes: { type: 'string', description: 'Footnotes, units, merged-cell explanations.' },
      },
      required: ['caption', 'headers', 'rows', 'notes'],
    },
    rendered_text: {
      type: 'string',
      description:
        'The text that will be indexed for search. For a table: one sentence or line per row that preserves the relationships between header and cell values, plus the caption and notes. For a scan: the full text in reading order with headings. For a screenshot, diagram, or photo: the visible text followed by the description. For decoration: empty string.',
    },
    quality: {
      type: 'object',
      properties: {
        confidence: {
          type: 'number',
          description: '0 to 1, how confident you are that rendered_text is complete and correct.',
        },
        issues: { type: 'array', items: { type: 'string', enum: [...QUALITY_ISSUES] } },
        unreadable_regions: {
          type: 'string',
          description: 'Where the unreadable parts are, or empty.',
        },
      },
      required: ['confidence', 'issues', 'unreadable_regions'],
    },
  },
  required: [
    'kind',
    'language',
    'visible_text',
    'description',
    'table',
    'rendered_text',
    'quality',
  ],
}

/** Validates the output even though Gemini was given the schema; a truncated or blocked answer must not index. */
const extractionSchema = z.object({
  kind: z.enum(IMAGE_KINDS),
  language: z.string(),
  visible_text: z.string(),
  description: z.string(),
  table: z.object({
    caption: z.string(),
    headers: z.array(z.string()),
    rows: z.array(z.array(z.string())),
    notes: z.string(),
  }),
  rendered_text: z.string(),
  quality: z.object({
    confidence: z.number(),
    issues: z.array(z.string()),
    unreadable_regions: z.string(),
  }),
})

/** What indexing keeps from one image: whether it is decorative, and its searchable text. */
export type ImageExtractionResult = Omit<VisionExtractionCheckpoint, 'usage'> & {
  usage?: VisionExtractionCheckpoint['usage']
}

const DECORATIVE: ImageExtractionResult = { decorative: true, renderedText: '' }

/**
 * The model from `KB_IMAGE_EXTRACTION_MODEL`, or the default when it is unset or
 * not a Gemini model in the catalog (the extractor speaks Gemini's API only, and
 * only catalog models carry the pricing that bills each image).
 * Never throws: a bad value must not stop indexing.
 */
export function resolveImageExtractionModel(): string {
  const configured = env.KB_IMAGE_EXTRACTION_MODEL?.trim()
  if (!configured) return DEFAULT_IMAGE_EXTRACTION_MODEL
  const catalogModel = getProviderModels('google').find(
    (id) => id.toLowerCase() === configured.toLowerCase() && id.toLowerCase().startsWith('gemini-')
  )
  if (catalogModel) return catalogModel
  logger.warn(
    `KB_IMAGE_EXTRACTION_MODEL="${configured}" is not a supported Gemini model, falling back to ${DEFAULT_IMAGE_EXTRACTION_MODEL}`
  )
  return DEFAULT_IMAGE_EXTRACTION_MODEL
}

/** Workspace key first, then the deployment's Gemini keys, exactly as knowledge embeddings resolve. */
async function resolveGeminiKey(
  workspaceId: string | null | undefined
): Promise<{ apiKey: string; isBYOK: boolean }> {
  try {
    return await resolveProviderKey('gemini', workspaceId)
  } catch (error) {
    if (!(error instanceof EmbeddingConfigurationError)) throw error
    throw new PermanentDocumentProcessingError(
      'image_extraction_unavailable',
      'Image indexing needs a Gemini API key. Add one to the workspace, or set GEMINI_API_KEY on the deployment, then retry.'
    )
  }
}

/** Gemini 400 reasons caused by the deployment's key or region, never by the image. */
const GEMINI_CONFIGURATION_REASONS = ['API_KEY_INVALID', 'API_KEY_EXPIRED', 'FAILED_PRECONDITION']

/**
 * Maps a Gemini failure onto processing outcomes: throttling and overload defer
 * the pass, a rejected key, model or region fails the document as unavailable,
 * a rejected image fails it as invalid, anything else retries.
 */
function toProcessingError(error: GeminiImageExtractionError, model: string): Error {
  if (error.status === 429 || error.status === 503) {
    return new ProviderCapacityDeferredError('rate_limit', {
      providerId: 'google',
      retryAfterMs: error.retryAfterMs,
      cause: error,
    })
  }
  if (
    error.status === 401 ||
    error.status === 403 ||
    (error.status === 400 &&
      GEMINI_CONFIGURATION_REASONS.some((reason) => error.detail.includes(reason)))
  ) {
    return new PermanentDocumentProcessingError(
      'image_extraction_unavailable',
      `Gemini rejected the API key used for ${model}. Check the workspace or deployment Gemini key, then retry.`,
      error
    )
  }
  if (error.status === 404) {
    return new PermanentDocumentProcessingError(
      'image_extraction_unavailable',
      `Gemini does not serve the model ${model}. Set KB_IMAGE_EXTRACTION_MODEL to an available Gemini model, then retry.`,
      error
    )
  }
  if (error.status === 400) {
    return new PermanentDocumentProcessingError(
      'invalid_file',
      'Gemini could not read this image. Replace the attachment with a valid PNG, JPEG, WebP or GIF image, then retry.',
      error
    )
  }
  return error
}

interface ImageDimensions {
  width: number
  height: number
}

async function readDimensions(source: Buffer): Promise<ImageDimensions> {
  const metadata = await sharp(source, { limitInputPixels: MAX_INPUT_PIXELS })
    .metadata()
    .catch(() => null)
  const width = metadata?.width ?? 0
  const height = metadata?.pageHeight ?? metadata?.height ?? 0
  if (!width || !height) {
    throw new PermanentDocumentProcessingError(
      'invalid_file',
      'This image could not be decoded. Replace the attachment with a valid PNG, JPEG, WebP or GIF image, then retry.'
    )
  }
  return { width, height }
}

/**
 * Sends the original when it is already small enough; otherwise the first frame,
 * downscaled to the longest-edge limit, as lossless PNG (or JPEG if PNG is still
 * over the inline cap). GIFs always go as one still frame.
 */
async function prepareModelImage(
  source: Buffer,
  mimeType: string,
  { width, height }: ImageDimensions
): Promise<{ bytes: Buffer; mimeType: string }> {
  const fits =
    Math.max(width, height) <= MAX_IMAGE_EDGE_PX && source.length <= INLINE_ATTACHMENT_MAX_BYTES
  if (fits && mimeType !== 'image/gif') return { bytes: source, mimeType }
  const resized = () =>
    sharp(source, { limitInputPixels: MAX_INPUT_PIXELS, pages: 1 }).rotate().resize({
      width: MAX_IMAGE_EDGE_PX,
      height: MAX_IMAGE_EDGE_PX,
      fit: 'inside',
      withoutEnlargement: true,
    })
  try {
    const png = await resized().png().toBuffer()
    if (png.length <= INLINE_ATTACHMENT_MAX_BYTES) return { bytes: png, mimeType: 'image/png' }
    return { bytes: await resized().jpeg({ quality: 85 }).toBuffer(), mimeType: 'image/jpeg' }
  } catch (error) {
    /** The header decoded but the pixel data did not, so every retry would fail the same way. */
    throw new PermanentDocumentProcessingError(
      'invalid_file',
      'This image could not be decoded. Replace the attachment with a valid PNG, JPEG, WebP or GIF image, then retry.',
      error
    )
  }
}

function parseExtraction(content: string): z.infer<typeof extractionSchema> {
  const trimmed = content.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  let parsed: unknown
  try {
    parsed = JSON.parse(fenced ? fenced[1] : trimmed)
  } catch (error) {
    /** Usually a response cut off mid-object; a retry gets a fresh one. */
    throw new Error('Image extraction returned malformed JSON', { cause: error })
  }
  const result = extractionSchema.safeParse(parsed)
  if (!result.success) {
    throw new PermanentDocumentProcessingError(
      'image_extraction_invalid',
      'The image extraction model returned an incomplete result. Retry, or choose another model with KB_IMAGE_EXTRACTION_MODEL.'
    )
  }
  return result.data
}

/**
 * Turns one image into searchable text with a single vision-model call. An icon
 * under the pixel floor, or anything the model classifies as decorative, comes
 * back as decorative with no text. The validated result is checkpointed before
 * it is returned, so a pass that dies before its index swap does not pay twice.
 */
export async function extractImageText(input: {
  source: Buffer
  filename: string
  workspaceId?: string | null
  checkpoint?: OcrCheckpointContext
  deadlineAt?: number
  signal?: AbortSignal
}): Promise<ImageExtractionResult> {
  const { source, filename, workspaceId, signal } = input
  signal?.throwIfAborted()
  const mimeType = sniffImageContentType(source)
  if (!mimeType || !SEMANTIC_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new PermanentDocumentProcessingError(
      'invalid_file',
      `${filename} is not a PNG, JPEG, WebP or GIF image. Replace the attachment, then retry.`
    )
  }
  /** Listing drops these by reported size; this catches a source that reported none. */
  if (source.length < SEMANTIC_IMAGE_MIN_BYTES) return DECORATIVE
  const dimensions = await readDimensions(source)
  if (dimensions.width < MIN_IMAGE_EDGE_PX || dimensions.height < MIN_IMAGE_EDGE_PX) {
    return DECORATIVE
  }

  const model = resolveImageExtractionModel()
  const checkpoint = input.checkpoint
    ? createVisionCheckpoint({
        context: input.checkpoint,
        source,
        model,
        contractVersion: IMAGE_EXTRACTION_REPRESENTATION_VERSION,
      })
    : undefined
  const cached = await checkpoint?.load(signal)
  if (cached) return cached

  const deadlineAt = input.deadlineAt ?? Number.POSITIVE_INFINITY
  /** Time left for the admission wait once the call and the post-call work are reserved. */
  const spareMs = () => deadlineAt - Date.now() - EXTRACTION_TIMEOUT_MS - POST_EXTRACTION_RESERVE_MS
  const deferForBudget = () =>
    new ProviderCapacityDeferredError('processing_budget', {
      providerId: 'google',
      retryAfterMs: 1000,
    })
  if (spareMs() <= 0) throw deferForBudget()
  assertKnowledgeOpaqueModelInputSafe()
  const key = await resolveGeminiKey(workspaceId)
  const image = await prepareModelImage(source, mimeType, dimensions)
  await waitForProviderAdmission({
    providerId: 'google',
    credentialFingerprint: sha256Hex(key.apiKey),
    operation: 'ocr',
    signal,
    maxWaitMs: Math.max(0, Math.min(EXTRACTION_TIMEOUT_MS, spareMs())),
  })
  if (spareMs() <= 0) throw deferForBudget()

  let response: Awaited<ReturnType<typeof requestGeminiImageExtraction>>
  try {
    response = await retryWithExponentialBackoff(
      (attemptSignal) =>
        requestGeminiImageExtraction({
          model,
          apiKey: key.apiKey,
          systemPrompt: IMAGE_EXTRACTION_SYSTEM_PROMPT,
          userText: `Attachment title: ${filename}\nMedia type: ${image.mimeType}\n\nExtract this image according to the schema.`,
          image,
          responseJsonSchema: IMAGE_EXTRACTION_RESPONSE_SCHEMA,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          signal: attemptSignal,
        }),
      {
        maxRetries: 3,
        initialDelayMs: 1000,
        maxDelayMs: 10_000,
        retryBudgetMs: EXTRACTION_TIMEOUT_MS,
        retryCondition: (error) =>
          error instanceof GeminiImageExtractionError
            ? RETRYABLE_GEMINI_STATUSES.has(error.status)
            : isRetryableError(error),
        signal,
      }
    )
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new ProviderCapacityDeferredError('provider_timeout', {
        providerId: 'google',
        cause: error,
      })
    }
    throw error instanceof GeminiImageExtractionError ? toProcessingError(error, model) : error
  }

  if (response.finishReason === 'MAX_TOKENS') {
    /** Deterministic for this image and model, so a retry would pay for the same cut-off. */
    throw new PermanentDocumentProcessingError(
      'image_extraction_invalid',
      'The image holds more text than one extraction can return. Split it into smaller images, then retry.'
    )
  }
  if (!response.text.trim()) {
    throw new PermanentDocumentProcessingError(
      'image_extraction_invalid',
      `Gemini returned no extraction for this image (${response.finishReason ?? 'no reason given'}).`
    )
  }
  const extraction = parseExtraction(response.text)
  const decorative = extraction.kind === 'decorative'
  const costMultiplier = getCostMultiplier()
  const cost = key.isBYOK
    ? 0
    : calculateCost(
        model,
        response.inputTokens,
        response.outputTokens,
        false,
        costMultiplier,
        costMultiplier
      ).total
  const result: VisionExtractionCheckpoint = {
    decorative,
    renderedText: decorative ? '' : extraction.rendered_text.trim(),
    usage: {
      model,
      cost,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
    },
  }
  try {
    await checkpoint?.save(result, signal)
  } catch (error) {
    signal?.throwIfAborted()
    logger.warn('Could not checkpoint an image extraction; a retry will extract it again', {
      error,
    })
  }
  return result
}
