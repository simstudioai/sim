// Document sorting options
export type DocumentSortField =
  | 'filename'
  | 'fileSize'
  | 'tokenCount'
  | 'chunkCount'
  | 'uploadedAt'
  | 'processingStatus'
  | 'enabled'
export type SortOrder = 'asc' | 'desc'

interface DocumentSortOptions {
  sortBy?: DocumentSortField
  sortOrder?: SortOrder
}

interface HeaderInfo {
  /** Header text */
  text: string
  /** Header level (1-6) */
  level: number
  /** Anchor link */
  anchor: string
  /** Position in document */
  position: number
}
