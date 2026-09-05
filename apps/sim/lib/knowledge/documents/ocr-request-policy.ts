export interface OcrRequestPolicy {
  readonly maxBytes: number
  readonly maxPages: number
  readonly maxChunks: number
  readonly concurrency: number
}

/** Raster formats accepted by the Mistral image OCR transport. */
export const OCR_IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
])

/** Mistral's hosted OCR request limits for uploaded documents. */
export const MISTRAL_OCR_REQUEST_POLICY = {
  maxBytes: 50_000_000,
  maxPages: 1000,
  maxChunks: 10,
  concurrency: 2,
} as const satisfies OcrRequestPolicy

/** Current Azure-hosted Mistral Document AI request limits. */
const AZURE_MISTRAL_CURRENT_REQUEST_POLICY = {
  maxBytes: 30_000_000,
  maxPages: 30,
  maxChunks: 10,
  concurrency: 1,
} as const satisfies OcrRequestPolicy

/** Historical Azure Mistral OCR deployments accepted the direct-provider envelope. */
const AZURE_MISTRAL_LEGACY_REQUEST_POLICY = {
  maxBytes: 50_000_000,
  maxPages: 1000,
  maxChunks: 10,
  concurrency: 1,
} as const satisfies OcrRequestPolicy

const AZURE_MISTRAL_LEGACY_MODEL_NAMES = new Set(['mistral-ocr', 'mistral-ocr-2503'])

/**
 * Resolves Azure's model-specific OCR envelope. Azure deployments can use a
 * custom deployment name, so only the repository's established legacy alias and
 * the historical model ID receive the older, larger envelope. Every other name
 * uses the stricter current contract and therefore cannot overrun a documented
 * current-model limit.
 */
export function getAzureMistralOcrRequestPolicy(modelName: string): OcrRequestPolicy {
  return AZURE_MISTRAL_LEGACY_MODEL_NAMES.has(modelName.trim().toLowerCase())
    ? AZURE_MISTRAL_LEGACY_REQUEST_POLICY
    : AZURE_MISTRAL_CURRENT_REQUEST_POLICY
}
