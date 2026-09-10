export interface FileParseMetadata {
  characterCount?: number
  pageCount?: number
  /** True when a parser limit stopped extraction before the input was exhausted. */
  truncated?: boolean
  /**
   * True when no real extraction happened and `content` is best-effort scraped
   * bytes or a placeholder message rather than the document's text.
   *
   * Set by extractors that can only return best-effort output, such as a
   * spreadsheet whose cells are all blank. Legacy `.doc` and `.ppt` inputs used
   * to fall through to a byte scrape reported this way; they now raise typed
   * errors instead. An automated caller must not index degraded content, and
   * every automated consumer checks this flag and skips the file.
   */
  degraded?: boolean
  extractionMethod?: string
  warning?: string
  messages?: unknown[]
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

export interface FileParseOptions {
  signal?: AbortSignal
  /** Complete PDF extraction rejects safety limits instead of returning preview text. */
  pdfTextMode?: 'preview' | 'complete'
}

export interface FileParser {
  parseFile(filePath: string, options?: FileParseOptions): Promise<FileParseResult>
  parseBuffer?(buffer: Buffer, options?: FileParseOptions): Promise<FileParseResult>
}

export type SupportedFileType =
  | 'pdf'
  | 'csv'
  | 'doc'
  | 'docx'
  | 'docm'
  | 'dotx'
  | 'txt'
  | 'md'
  | 'xlsx'
  | 'xls'
  | 'xlsm'
  | 'xlsb'
  | 'xltx'
  | 'html'
  | 'htm'
  | 'pptx'
  | 'pptm'
  | 'potx'
  | 'odt'
  | 'ods'
  | 'odp'
