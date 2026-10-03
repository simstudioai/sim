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
  /** Indexing callers require complete extraction; preview row limits must not discard content. */
  contentMode?: 'preview' | 'complete'
  /**
   * Complete text byte budget for CSV/XLSX (default 25 MiB) and PDF (default 20 MiB).
   * PDF applies this when pdfTextMode is 'complete' and never exceeds its safe default.
   * Exceeding it throws complexity_limit instead of returning a truncated prefix.
   * DOCX applies this only when docxTextMode is 'complete' (default 2 MiB); separate
   * conversion graph limits can reject structurally complex inputs before normalization.
   * Preview mode retains its own limits; other formats use their parser-specific budgets.
   */
  maxTextBytes?: number
  /** Preserve textual markup in a canonical .txt artifact instead of interpreting it as HTML or RTF. */
  textMode?: 'literal'
  /** Opt into bounded DOCX conversion without lossy or unchecked parser fallbacks. */
  docxTextMode?: 'complete'
  /** Complete PDF extraction rejects safety limits instead of returning preview text. */
  pdfTextMode?: 'preview' | 'complete'
  /** Lower page ceiling for complete PDF extraction; defaults to the parser's safe limit. */
  pdfMaxPages?: number
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
