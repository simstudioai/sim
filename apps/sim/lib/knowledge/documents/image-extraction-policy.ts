/**
 * How a knowledge source's image documents are turned into text. `semantic` runs
 * one vision-model extraction per image; `ocr` is the original OCR path. A source
 * that declares nothing keeps `ocr`, so declaring the policy is the only way an
 * image reaches the vision extractor.
 */
export type ImageExtractionPolicy = 'semantic' | 'ocr'

/** Raster formats every vision provider accepts inline; SVG, HEIC and AVIF are excluded. */
export const SEMANTIC_IMAGE_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

/**
 * Smallest image file a source should list for semantic extraction. Icons and
 * spacers fall below it; the processor's pixel floor catches the rest.
 */
export const SEMANTIC_IMAGE_MIN_BYTES = 2 * 1024

/**
 * Identifies the extraction prompt, schema and model contract. Sources append it
 * to an image's content hash, so changing it re-extracts images and nothing else.
 */
export const IMAGE_EXTRACTION_REPRESENTATION_VERSION = 'image-extract-v1'

/** Normalizes a source-reported media type (`image/JPG; charset=...`) to a semantic image type. */
export function semanticImageMimeType(mediaType: string | undefined): string | undefined {
  const normalized = mediaType?.split(';')[0]?.trim().toLowerCase()
  if (!normalized) return undefined
  const canonical = normalized === 'image/jpg' ? 'image/jpeg' : normalized
  return SEMANTIC_IMAGE_MIME_TYPES.has(canonical) ? canonical : undefined
}

export function isSemanticImage(policy: ImageExtractionPolicy, mimeType: string): boolean {
  return policy === 'semantic' && SEMANTIC_IMAGE_MIME_TYPES.has(mimeType)
}
