import type {
  LinkedSourceRow,
  SourceRowData,
} from '@/app/(product)/_components/source-row/source-row'

interface SearchFilterOption {
  id: string
  label: string
}

/** One search's results and controls, the same on the Search route and in a chat panel tab. */
export interface SearchResultsData {
  status: 'idle' | 'searching' | 'updating' | 'error' | 'ready' | 'needs-range'
  rows: readonly SourceRowData[]
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
  onOpen: (row: LinkedSourceRow) => void
  onSummarize?: (row: SourceRowData) => void
}
