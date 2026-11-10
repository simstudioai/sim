/** One document a search found or an answer cited; without a `url` it has no page to open. */
export interface SourceRowData {
  id: string
  url?: string
  title: string
  meta?: string
  snippet?: string
  /** The document no longer opens for this reader, as when it was deleted after it was cited. */
  unavailable?: boolean
}

/** A source row with a page to open. */
export type LinkedSourceRow = SourceRowData & { url: string }
