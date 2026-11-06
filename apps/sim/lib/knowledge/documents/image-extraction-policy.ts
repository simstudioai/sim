import { normalizeMimeType } from '@/lib/uploads/utils/mime'

/**
 * How a knowledge source's image documents are turned into text. `semantic` runs
 * one vision-model extraction per image; `ocr` is the shared OCR path. A source
 * that declares nothing keeps `ocr`, so declaring the policy is the only way an
 * image reaches the vision extractor.
 */
export type ImageExtractionPolicy = 'semantic' | 'ocr'

/** Raster formats the vision extractor reads (a GIF as its first frame); SVG, HEIC and AVIF are excluded. */
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
  const normalized = normalizeMimeType(mediaType)
  const canonical = normalized === 'image/jpg' ? 'image/jpeg' : normalized
  return SEMANTIC_IMAGE_MIME_TYPES.has(canonical) ? canonical : undefined
}

/** Whether a document goes to the vision extractor; an undeclared policy keeps OCR. */
export function isSemanticImage(
  policy: ImageExtractionPolicy | undefined,
  mimeType: string | undefined
): boolean {
  return policy === 'semantic' && SEMANTIC_IMAGE_MIME_TYPES.has(mimeType ?? '')
}

/**
 * A source's declaration that it reads images with the vision extractor, behind
 * one of its own settings. The setting's `semantic` value turns reading on; any
 * other value, or none, leaves images unindexed: the source stops listing them,
 * and turning the setting off removes every indexed document of a semantic image
 * type. A source adopting this must accept that its images have no OCR fallback,
 * and must append {@link IMAGE_EXTRACTION_REPRESENTATION_VERSION} to each image's
 * content hash so a new extraction contract re-reads its images.
 */
export interface ImageExtractionDeclaration {
  /** The `sourceConfig` field holding the setting. */
  settingId: string
}

/** Whether a source's current settings index its images. */
export function isImageExtractionEnabled(
  declaration: ImageExtractionDeclaration | undefined,
  sourceConfig: Record<string, unknown>
): boolean {
  return declaration !== undefined && sourceConfig[declaration.settingId] === 'semantic'
}
