import type { ToolResponse } from '@/tools/types'

/**
 * Input parameters for the Mistral OCR parser tool
 */
export interface MistralParserInput {
  /** URL to a PDF document to be processed */
  filePath: string

  /** File upload data (from file-upload component) */
  fileUpload?: any

  /** Mistral API key for authentication */
  apiKey: string

  /** Output format for the extracted content (default: 'markdown') */
  resultType?: 'markdown' | 'text' | 'json'

  /** Whether to include base64-encoded images in the response */
  includeImageBase64?: boolean

  /** Specific pages to process (zero-indexed) */
  pages?: number[]

  /** Maximum number of images to extract from the PDF */
  imageLimit?: number

  /** Minimum height and width (in pixels) for images to extract */
  imageMinSize?: number
}

/**
 * Usage information returned by the Mistral OCR API
 */
export interface MistralOcrUsageInfo {
  /** Number of pages processed in the document */
  pagesProcessed: number

  /** Size of the document in bytes */
  docSizeBytes: number
}

/**
 * Metadata about the processed document
 */
export interface MistralParserMetadata {
  /** Unique identifier for this OCR job */
  jobId: string

  /** File type of the document (typically 'pdf') */
  fileType: string

  /** Filename extracted from the document URL */
  fileName: string

  /** Source type (always 'url' for now) */
  source: 'url'

  /** Original URL to the document (only included for user-provided URLs) */
  sourceUrl?: string

  /** Total number of pages in the document */
  pageCount: number

  /** Usage statistics from the OCR processing */
  usageInfo?: MistralOcrUsageInfo

  /** The Mistral OCR model used for processing */
  model: string

  /** The output format that was requested */
  resultType?: 'markdown' | 'text' | 'json'

  /** ISO timestamp when the document was processed */
  processedAt: string
}

/**
 * Output data structure from the Mistral OCR parser
 */
export interface MistralParserOutputData {
  /** Extracted content in the requested format */
  content: string

  /** Metadata about the parsed document and processing */
  metadata: MistralParserMetadata
}

/**
 * Complete response from the Mistral OCR parser tool
 */
export interface MistralParserOutput extends ToolResponse {
  /** The output data containing content and metadata */
  output: MistralParserOutputData
}
