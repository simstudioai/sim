export interface SearchSourceRow {
  id: string
  url: string
  title: string
  meta?: string
  snippet?: string
}

interface SearchFilterOption {
  id: string
  label: string
}

/** One search's results and controls, the same on the Search route and in a chat panel tab. */
export interface SearchResultsData {
  status: 'idle' | 'searching' | 'updating' | 'error' | 'ready' | 'needs-range'
  rows: readonly SearchSourceRow[]
  /** The apps this search reached, which is what the source filter offers. */
  providers: readonly string[]
  retry: () => void
  empty: boolean
  /** No connected app can answer: the viewer needs to connect one, not change the query. */
  noApps?: { href: string }
  someAppsUnavailable: boolean
  partial: boolean
  filters?: {
    source: {
      value: string
      options: readonly SearchFilterOption[]
      onChange: (id: string) => void
    }
    updated: {
      value: string
      options: readonly SearchFilterOption[]
      onChange: (id: string) => void
    }
    range?: {
      from?: string
      to?: string
      onChange: (from: string, to: string) => void
    }
  }
  onCopyLink: (row: SearchSourceRow) => void
  onOpen: (row: SearchSourceRow) => void
  onSummarize?: (row: SearchSourceRow) => void
}
