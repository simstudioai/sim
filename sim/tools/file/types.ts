import { ToolResponse } from '../types'

export interface FileParserInput {
  filePath: string | string[]
  fileType?: string
  fileUrl?: string
}

export interface FileParseResult {
  content: string
  fileType: string
  size: number
  name: string
  binary: boolean
  metadata?: Record<string, any>
}

export interface FileParserOutputData {
  files: FileParseResult[]
  combinedContent: string
  [key: string]: any
}

export interface FileParserOutput extends ToolResponse {
  output: FileParserOutputData
}
