import type { ToolResponse } from '@/tools/types'

/**
 * Volume information structure shared between search and details responses
 */
export interface VolumeInfo {
  id: string
  title: string
  subtitle: string | null
  authors: string[]
  publisher: string | null
  publishedDate: string | null
  description: string | null
  pageCount: number | null
  categories: string[]
  averageRating: number | null
  ratingsCount: number | null
  language: string | null
  previewLink: string | null
  infoLink: string | null
  thumbnailUrl: string | null
  isbn10: string | null
  isbn13: string | null
}

/**
 * Parameters for searching volumes
 */
export interface GoogleBooksVolumeSearchParams {
  apiKey: string
  query: string
  filter?: 'partial' | 'full' | 'free-ebooks' | 'paid-ebooks' | 'ebooks'
  printType?: 'all' | 'books' | 'magazines'
  orderBy?: 'relevance' | 'newest'
  startIndex?: number
  maxResults?: number
  langRestrict?: string
}

/**
 * Response from volume search
 */
export interface GoogleBooksVolumeSearchResponse extends ToolResponse {
  output: {
    totalItems: number
    volumes: VolumeInfo[]
  }
}

/**
 * Parameters for getting volume details
 */
export interface GoogleBooksVolumeDetailsParams {
  apiKey: string
  volumeId: string
  projection?: 'full' | 'lite'
}

/**
 * Response from volume details
 */
export interface GoogleBooksVolumeDetailsResponse extends ToolResponse {
  output: VolumeInfo
}
