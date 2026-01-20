import type { ToolResponse } from '@/tools/types'

/**
 * Input parameters for the Mistral OCR parser tool
 */
export interface MistralParserInput {
  /** URL to a PDF document to be processed */
  filePath: string

  /** File upload data (from file-upload component) */
  fileUpload?: any

  /** Internal file path flag (for presigned URL conversion) */
  _internalFilePath?: string

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
  docSizeBytes: number | null
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

/**
 * Image bounding box and data from Mistral OCR API
 */
export interface MistralOcrImage {
  /** Image identifier */
  id: string
  /** Top-left X coordinate */
  top_left_x: number
  /** Top-left Y coordinate */
  top_left_y: number
  /** Bottom-right X coordinate */
  bottom_right_x: number
  /** Bottom-right Y coordinate */
  bottom_right_y: number
  /** Base64-encoded image data (if includeImageBase64 was true) */
  image_base64?: string
}

/**
 * Page dimensions from Mistral OCR API
 */
export interface MistralOcrDimensions {
  /** DPI of the page */
  dpi: number
  /** Page height in pixels */
  height: number
  /** Page width in pixels */
  width: number
}

/**
 * Page data from Mistral OCR API
 */
export interface MistralOcrPage {
  /** Page index (zero-based) */
  index: number
  /** Markdown content extracted from this page */
  markdown: string
  /** Images extracted from this page */
  images: MistralOcrImage[]
  /** Page dimensions */
  dimensions: MistralOcrDimensions
  /** Tables extracted from this page */
  tables: unknown[]
  /** Hyperlinks found on this page */
  hyperlinks: unknown[]
  /** Header content if detected */
  header: string | null
  /** Footer content if detected */
  footer: string | null
}

/**
 * Raw usage info from Mistral OCR API
 */
export interface MistralOcrUsageInfoRaw {
  /** Number of pages processed */
  pages_processed: number
  /** Document size in bytes */
  doc_size_bytes: number | null
}

/**
 * V2 Output - Returns raw Mistral API response structure
 */
export interface MistralParserV2Output extends ToolResponse {
  output: {
    /** Array of page objects with full OCR data */
    pages: MistralOcrPage[]
    /** Model used for OCR processing */
    model: string
    /** Usage statistics from the API */
    usage_info: MistralOcrUsageInfoRaw
    /** Structured annotation data as JSON string (when applicable) */
    document_annotation: string | null
  }
}
