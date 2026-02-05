import type { UserFile } from '@/executor/types'
import type { ToolResponse } from '@/tools/types'

export interface FileParserInput {
  filePath?: string | string[]
  file?: UserFile | UserFile[] | FileUploadInput | FileUploadInput[]
  fileType?: string
  workspaceId?: string
  workflowId?: string
  executionId?: string
}

export interface FileUploadInput {
  path: string
  name?: string
  size?: number
  type?: string
}

export interface FileParseResult {
  content: string
  fileType: string
  size: number
  name: string
  binary: boolean
  metadata?: Record<string, unknown>
  /** UserFile object for the raw file (stored in execution storage) */
  file?: UserFile
}

export interface FileParserOutputData {
  /** Array of parsed file results with content and optional UserFile */
  files: FileParseResult[]
  /** Combined text content from all files */
  combinedContent: string
  /** Array of UserFile objects for downstream use (attachments, uploads, etc.) */
  processedFiles?: UserFile[]
  [key: string]: unknown
}

export interface FileParserOutput extends ToolResponse {
  output: FileParserOutputData
}

export interface FileParserV3OutputData {
  /** Array of parsed files as UserFile objects */
  files: UserFile[]
  /** Combined text content from all files */
  combinedContent: string
}

export interface FileParserV3Output extends ToolResponse {
  output: FileParserV3OutputData
}

/** API response structure for single file parse */
export interface FileParseApiResponse {
  success: boolean
  output?: FileParseResult
  content?: string
  filePath?: string
  viewerUrl?: string | null
  error?: string
}

/** API response structure for multiple file parse */
export interface FileParseApiMultiResponse {
  success: boolean
  results: Array<{
    success: boolean
    output?: FileParseResult
    filePath?: string
    viewerUrl?: string | null
    error?: string
  }>
}
