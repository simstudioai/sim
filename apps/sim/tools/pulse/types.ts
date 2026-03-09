import type { RawFileInput } from '@/lib/uploads/utils/file-utils'
import type { UserFile } from '@/executor/types'
import type { ToolResponse } from '@/tools/types'

/**
 * Input parameters for the Pulse parser tool
 */
export interface PulseParserInput {
  /** URL to a document to be processed */
  filePath?: string

  file?: RawFileInput

  /** File upload data (from file-upload component) */
  fileUpload?: RawFileInput

  /** Pulse API key for authentication */
  apiKey: string

  /** Page range to process (1-indexed, e.g., "1-2,5") */
  pages?: string

  /** Whether to extract figures from the document */
  extractFigure?: boolean

  /** Whether to generate figure descriptions/captions */
  figureDescription?: boolean

  /** Whether to include HTML in the response */
  returnHtml?: boolean

  /** Chunking strategies (comma-separated: semantic, header, page, recursive) */
  chunking?: string

  /** Maximum characters per chunk when chunking is enabled */
  chunkSize?: number
}

export interface PulseParserV2Input {
  /** File to be processed */
  file: UserFile

  /** Pulse API key for authentication */
  apiKey: string

  /** Page range to process (1-indexed, e.g., "1-2,5") */
  pages?: string

  /** Whether to extract figures from the document */
  extractFigure?: boolean

  /** Whether to generate figure descriptions/captions */
  figureDescription?: boolean

  /** Whether to include HTML in the response */
  returnHtml?: boolean

  /** Chunking strategies (comma-separated: semantic, header, page, recursive) */
  chunking?: string

  /** Maximum characters per chunk when chunking is enabled */
  chunkSize?: number
}

/**
 * Plan info returned by the Pulse API
 */
export interface PulsePlanInfo {
  /** Number of pages used */
  pages_used: number

  /** Plan tier */
  tier: string

  /** Optional note */
  note?: string
}

/**
 * Native output structure from the Pulse API
 */
export interface PulseParserOutputData {
  /** Extracted content in markdown format */
  markdown: string

  /** Number of pages in the document */
  page_count: number

  /** Unique job identifier */
  job_id: string

  /** Plan usage information */
  'plan-info': PulsePlanInfo

  /** Bounding box layout information */
  bounding_boxes?: Record<string, unknown>

  /** URL for extraction results (for large documents) */
  extraction_url?: string

  /** HTML content if requested */
  html?: string

  /** Structured output if schema was provided */
  structured_output?: Record<string, unknown>

  /** Chunked content if chunking was enabled */
  chunks?: unknown[]

  /** Extracted figures if figure extraction was enabled */
  figures?: unknown[]
}

/**
 * Complete response from the Pulse parser tool
 */
export interface PulseParserOutput extends ToolResponse {
  /** The native Pulse API output */
  output: PulseParserOutputData
}
