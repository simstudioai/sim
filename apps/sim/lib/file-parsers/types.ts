export interface FileParseMetadata {
  characterCount?: number
  pageCount?: number
  /** True when a parser limit stopped extraction before the input was exhausted. */
  truncated?: boolean
  /**
   * True when no real extraction happened and `content` is best-effort scraped
   * bytes or a placeholder message rather than the document's text.
   *
   * The legacy-format parsers (`doc`, `ppt`) deliberately never throw, so an
   * interactive upload still shows the user something. An automated caller must
   * not index that: it embeds ZIP internals or an English placeholder sentence as
   * if it were document content. Such callers check this flag and skip the file.
   */
  degraded?: boolean
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
  | 'ppt'
  | 'pptm'
  | 'potx'
  | 'odt'
  | 'ods'
  | 'odp'
