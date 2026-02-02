import type { RawFileInput } from '@/lib/uploads/utils/file-utils'
import type { UserFile } from '@/executor/types'
import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property definitions for Mistral OCR API responses.
 * Based on Mistral API documentation: https://docs.mistral.ai/api/endpoint/ocr
 */

/**
 * Output definition for OCR image bounding box objects
 */
export const MISTRAL_OCR_IMAGE_OUTPUT_PROPERTIES = {
  id: { type: 'string', description: 'Image identifier (e.g., img-0.jpeg)' },
  top_left_x: { type: 'number', description: 'Top-left X coordinate in pixels' },
  top_left_y: { type: 'number', description: 'Top-left Y coordinate in pixels' },
  bottom_right_x: { type: 'number', description: 'Bottom-right X coordinate in pixels' },
  bottom_right_y: { type: 'number', description: 'Bottom-right Y coordinate in pixels' },
  image_base64: {
    type: 'string',
    description: 'Base64-encoded image data (when include_image_base64=true)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete OCR image output definition
 */
export const MISTRAL_OCR_IMAGE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Extracted image with bounding box',
  properties: MISTRAL_OCR_IMAGE_OUTPUT_PROPERTIES,
}

/**
 * Output definition for page dimension objects
 */
export const MISTRAL_OCR_DIMENSIONS_OUTPUT_PROPERTIES = {
  dpi: { type: 'number', description: 'Dots per inch' },
  height: { type: 'number', description: 'Page height in pixels' },
  width: { type: 'number', description: 'Page width in pixels' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete page dimensions output definition
 */
export const MISTRAL_OCR_DIMENSIONS_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Page dimensions',
  properties: MISTRAL_OCR_DIMENSIONS_OUTPUT_PROPERTIES,
}

/**
 * Output definition for OCR page objects
 */
export const MISTRAL_OCR_PAGE_OUTPUT_PROPERTIES = {
  index: { type: 'number', description: 'Page index (zero-based)' },
  markdown: { type: 'string', description: 'Extracted markdown content' },
  images: {
    type: 'array',
    description: 'Images extracted from this page with bounding boxes',
    items: {
      type: 'object',
      properties: MISTRAL_OCR_IMAGE_OUTPUT_PROPERTIES,
    },
  },
  dimensions: MISTRAL_OCR_DIMENSIONS_OUTPUT,
  tables: {
    type: 'array',
    description: 'Extracted tables as HTML/markdown (when table_format is set)',
  },
  hyperlinks: {
    type: 'array',
    description: 'Array of URL strings detected in the page',
    items: { type: 'string', description: 'URL or mailto link' },
  },
  header: {
    type: 'string',
    description: 'Page header content (when extract_header=true)',
    optional: true,
  },
  footer: {
    type: 'string',
    description: 'Page footer content (when extract_footer=true)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete OCR page output definition
 */
export const MISTRAL_OCR_PAGE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'OCR processed page',
  properties: MISTRAL_OCR_PAGE_OUTPUT_PROPERTIES,
}

/**
 * Output definition for usage info objects
 */
export const MISTRAL_OCR_USAGE_OUTPUT_PROPERTIES = {
  pages_processed: { type: 'number', description: 'Total number of pages processed' },
  doc_size_bytes: { type: 'number', description: 'Document file size in bytes', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete usage info output definition
 */
export const MISTRAL_OCR_USAGE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Usage and processing statistics',
  properties: MISTRAL_OCR_USAGE_OUTPUT_PROPERTIES,
}

/**
 * Output definition for parser metadata objects
 */
export const MISTRAL_PARSER_METADATA_OUTPUT_PROPERTIES = {
  jobId: { type: 'string', description: 'Unique job identifier' },
  fileType: { type: 'string', description: 'File type (e.g., pdf)' },
  fileName: { type: 'string', description: 'Original file name' },
  source: { type: 'string', description: 'Source type (url or file)' },
  pageCount: { type: 'number', description: 'Number of pages processed' },
  model: { type: 'string', description: 'Mistral model used' },
  resultType: { type: 'string', description: 'Output format (markdown, text, json)' },
  processedAt: { type: 'string', description: 'Processing timestamp' },
  sourceUrl: { type: 'string', description: 'Source URL if applicable', optional: true },
  usageInfo: MISTRAL_OCR_USAGE_OUTPUT,
} as const satisfies Record<string, OutputProperty>

/**
 * Complete parser metadata output definition
 */
export const MISTRAL_PARSER_METADATA_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Processing metadata',
  properties: MISTRAL_PARSER_METADATA_OUTPUT_PROPERTIES,
}

export interface MistralParserInput {
  filePath?: string
  file?: RawFileInput
  fileUpload?: RawFileInput
  _internalFilePath?: string
  apiKey: string
  resultType?: 'markdown' | 'text' | 'json'
  includeImageBase64?: boolean
  pages?: number[]
  imageLimit?: number
  imageMinSize?: number
}

export interface MistralParserV2Input {
  file: UserFile
  apiKey: string
  resultType?: 'markdown' | 'text' | 'json'
  includeImageBase64?: boolean
  pages?: number[]
  imageLimit?: number
  imageMinSize?: number
}

export interface MistralOcrUsageInfo {
  pagesProcessed: number
  docSizeBytes: number | null
}

export interface MistralParserMetadata {
  jobId: string
  fileType: string
  fileName: string
  source: 'url' | 'file'
  sourceUrl?: string
  pageCount: number
  usageInfo?: MistralOcrUsageInfo
  model: string
  resultType?: 'markdown' | 'text' | 'json'
  processedAt: string
}

export interface MistralParserOutputData {
  content: string
  metadata: MistralParserMetadata
}

export interface MistralParserOutput extends ToolResponse {
  output: MistralParserOutputData
}

export interface MistralOcrImage {
  id: string
  top_left_x: number
  top_left_y: number
  bottom_right_x: number
  bottom_right_y: number
  image_base64?: string
}

export interface MistralOcrDimensions {
  dpi: number
  height: number
  width: number
}

export interface MistralOcrPage {
  index: number
  markdown: string
  images: MistralOcrImage[]
  dimensions: MistralOcrDimensions
  tables: unknown[]
  hyperlinks: unknown[]
  header: string | null
  footer: string | null
}

export interface MistralOcrUsageInfoRaw {
  pages_processed: number
  doc_size_bytes: number | null
}

export interface MistralParserV2Output extends ToolResponse {
  output: {
    pages: MistralOcrPage[]
    model: string
    usage_info: MistralOcrUsageInfoRaw
    document_annotation: string | null
  }
}
