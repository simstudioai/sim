import type { RawFileInput } from '@/lib/uploads/utils/file-utils'
import type { UserFile } from '@/executor/types'
import type { ToolResponse } from '@/tools/types'

/**
 * Input parameters for the Reducto parser tool
 */
export interface ReductoParserInput {
  /** URL to a document to be processed */
  filePath?: string

  file?: RawFileInput

  /** File upload data (from file-upload component) */
  fileUpload?: RawFileInput

  /** Reducto API key for authentication */
  apiKey: string

  /** Specific pages to process (1-indexed) */
  pages?: number[]

  /** Table output format (html or md) */
  tableOutputFormat?: 'html' | 'md'
}

export interface ReductoParserV2Input {
  /** File to be processed */
  file: UserFile

  /** Reducto API key for authentication */
  apiKey: string

  /** Specific pages to process (1-indexed) */
  pages?: number[]

  /** Table output format (html or md) */
  tableOutputFormat?: 'html' | 'md'
}

/**
 * Bounding box for spatial location data
 */
export interface ReductoBoundingBox {
  left: number
  top: number
  width: number
  height: number
  page: number
}

/**
 * Granular confidence scores
 */
export interface ReductoGranularConfidence {
  ocr: string | null
  layout: string | null
  order: string | null
}

/**
 * Block type classification
 */
export type ReductoBlockType =
  | 'Header'
  | 'Footer'
  | 'Title'
  | 'SectionHeader'
  | 'Text'
  | 'ListItem'
  | 'Table'
  | 'Figure'
  | 'Caption'
  | 'Equation'
  | 'Code'
  | 'PageNumber'
  | 'Watermark'
  | 'Handwriting'
  | 'Other'

/**
 * Parse block - structured content element
 */
export interface ReductoParseBlock {
  type: ReductoBlockType
  bbox: ReductoBoundingBox
  content: string
  image_url: string | null
  chart_data: string[] | null
  confidence: string | null
  granular_confidence: ReductoGranularConfidence | null
  extra: Record<string, unknown> | null
}

/**
 * Parse chunk - document segment
 */
export interface ReductoParseChunk {
  content: string
  embed: string
  enriched: string | null
  blocks: ReductoParseBlock[]
  enrichment_success: boolean
}

/**
 * OCR word data
 */
export interface ReductoOcrWord {
  text: string
  bbox: ReductoBoundingBox
  confidence: number
}

/**
 * OCR line data
 */
export interface ReductoOcrLine {
  text: string
  bbox: ReductoBoundingBox
  words: ReductoOcrWord[]
}

/**
 * OCR result data
 */
export interface ReductoOcrResult {
  lines: ReductoOcrLine[]
  words: ReductoOcrWord[]
}

/**
 * Full result - when response fits in payload
 */
export interface ReductoFullResult {
  type: 'full'
  chunks: ReductoParseChunk[]
  ocr: ReductoOcrResult | null
  custom: unknown
}

/**
 * URL result - when response exceeds size limits
 */
export interface ReductoUrlResult {
  type: 'url'
  url: string
}

/**
 * Usage information returned by Reducto API
 */
export interface ReductoUsage {
  num_pages: number
  credits: number | null
}

/**
 * Native Reducto API response structure
 */
export interface ReductoParserOutputData {
  job_id: string
  duration: number
  usage: ReductoUsage
  result: ReductoFullResult | ReductoUrlResult
  pdf_url: string | null
  studio_link: string | null
}

/**
 * Complete response from the Reducto parser tool
 */
export interface ReductoParserOutput extends ToolResponse {
  output: ReductoParserOutputData
}
