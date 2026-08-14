export interface FileParseMetadata {
  characterCount?: number
  pageCount?: number
  /** True when a parser limit stopped extraction before the input was exhausted. */
  truncated?: boolean
  extractionMethod?: string
  warning?: string
  messages?: unknown[]
  html?: string
  type?: string
  headers?: string[]
  totalRows?: number
  rowCount?: number
  sheetNames?: string[]
  source?: string
  [key: string]: unknown
}

export interface FileParseResult {
  content: string
  metadata?: FileParseMetadata
}

export interface FileParser {
  parseFile(filePath: string): Promise<FileParseResult>
  parseBuffer?(buffer: Buffer): Promise<FileParseResult>
}

export type SupportedFileType =
  | 'pdf'
  | 'csv'
  | 'doc'
  | 'docx'
  | 'txt'
  | 'md'
  | 'xlsx'
  | 'xls'
  | 'html'
  | 'htm'
  | 'pptx'
  | 'ppt'
