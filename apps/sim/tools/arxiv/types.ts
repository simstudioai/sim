// Common types for ArXiv tools
import type { ToolResponse } from '@/tools/types'

// Common parameters for all ArXiv tools
export interface ArxivBaseParams {}

// Search tool types
export interface ArxivSearchParams extends ArxivBaseParams {
  query: string
  searchField?: 'all' | 'ti' | 'au' | 'abs' | 'co' | 'jr' | 'cat' | 'rn'
  maxResults?: number
  sortBy?: 'relevance' | 'lastUpdatedDate' | 'submittedDate'
  sortOrder?: 'ascending' | 'descending'
}

export interface ArxivPaper {
  id: string
  title: string
  summary: string
  authors: string[]
  published: string
  updated: string
  link: string
  pdfLink: string
  categories: string[]
  primaryCategory: string
  comment?: string
  journalRef?: string
  doi?: string
}

export interface ArxivSearchResponse extends ToolResponse {
  output: {
    papers: ArxivPaper[]
    totalResults: number
    query: string
  }
}

// Get Paper Details tool types
export interface ArxivGetPaperParams extends ArxivBaseParams {
  paperId: string
}

export interface ArxivGetPaperResponse extends ToolResponse {
  output: {
    paper: ArxivPaper
  }
}

// Get Author Papers tool types
export interface ArxivGetAuthorPapersParams extends ArxivBaseParams {
  authorName: string
  maxResults?: number
}

export interface ArxivGetAuthorPapersResponse extends ToolResponse {
  output: {
    authorPapers: ArxivPaper[]
    totalResults: number
    authorName: string
  }
}

export type ArxivResponse =
  | ArxivSearchResponse
  | ArxivGetPaperResponse
  | ArxivGetAuthorPapersResponse