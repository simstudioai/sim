import type { RawFileInput } from '@/lib/uploads/utils/file-utils'
import type { UserFile } from '@/executor/types'
import type { ToolResponse } from '@/tools/types'

/**
 * Input parameters for the Extend parser tool
 */
export interface ExtendParserInput {
  /** URL to a document to be processed */
  filePath?: string

  file?: RawFileInput

  /** File upload data (from file-upload component) */
  fileUpload?: RawFileInput

  /** Extend API key for authentication */
  apiKey: string

  /** Target output format */
  outputFormat?: 'markdown' | 'spatial'

  /** Chunking strategy */
  chunking?: 'page' | 'document' | 'section'

  /** Parsing engine */
  engine?: 'parse_performance' | 'parse_light'
}

export interface ExtendParserV2Input {
  /** File to be processed */
  file: UserFile

  /** Extend API key for authentication */
  apiKey: string

  /** Target output format */
  outputFormat?: 'markdown' | 'spatial'

  /** Chunking strategy */
  chunking?: 'page' | 'document' | 'section'

  /** Parsing engine */
  engine?: 'parse_performance' | 'parse_light'
}

/**
 * Chunk from parsed document
 */
export interface ExtendParseChunk {
  content: string
  page?: number
  metadata?: Record<string, unknown>
}

/**
 * Block-level element from parsed document
 */
export interface ExtendParseBlock {
  type: string
  content: string
  bbox?: {
    left: number
    top: number
    width: number
    height: number
    page: number
  }
  metadata?: Record<string, unknown>
}

/**
 * Native Extend API response structure for parsing
 */
export interface ExtendParserOutputData {
  id: string
  status: string
  chunks: ExtendParseChunk[]
  blocks: ExtendParseBlock[]
  pageCount: number | null
  creditsUsed: number | null
}

/**
 * Complete response from the Extend parser tool
 */
export interface ExtendParserOutput extends ToolResponse {
  output: ExtendParserOutputData
}
