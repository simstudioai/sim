export interface SearchResult {
  id: string
  type: 'page'
  url: string
  content: string
  breadcrumbs: string[]
}

export interface SearchChunk {
  id: string
  pageId: string
  sourceDocument: string
  sourceLink: string
  headerText: string
  headerLevel: number
  text: string
  contentHash: string
  documentTitle: string
}

export interface SearchIndex {
  version: 1
  catalogHash: string
  entries: Array<{
    chunk: Pick<SearchChunk, 'id' | 'pageId' | 'sourceLink' | 'headerText'>
    body: string
    heading: string
    title: string
  }>
}
