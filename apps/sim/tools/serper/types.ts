import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property definitions for Serper API responses.
 *
 * Serper publishes no schema and no reachable docs site; the authoritative source is the set of
 * example responses embedded in the vertical tab-switcher on https://serper.dev/. Every field
 * below is taken from those examples — nothing here is inferred.
 */

/**
 * Unified per-item shape returned by {@link SearchResponse}. One flat projection is used across
 * every vertical, so a field only present in some verticals is `optional`.
 *
 * `link` is optional because the `places` vertical genuinely has no result URL: its items carry a
 * business `website` instead, which is surfaced under its own key rather than impersonating a
 * search result link.
 */
export const SERPER_SEARCH_RESULT_OUTPUT_PROPERTIES = {
  title: { type: 'string', description: 'Result title' },
  link: {
    type: 'string',
    description: 'Result URL. Absent for places results, which have no result URL',
    optional: true,
  },
  snippet: {
    type: 'string',
    description: 'Result description/snippet (the business description for places)',
    optional: true,
  },
  position: { type: 'number', description: 'Position in search results' },
  date: { type: 'string', description: 'Publication date (news/videos)', optional: true },
  imageUrl: { type: 'string', description: 'Image URL (images/news/shopping)', optional: true },
  source: { type: 'string', description: 'Source name (news/videos/shopping)', optional: true },
  rating: { type: 'number', description: 'Average rating, 1-5 (places)', optional: true },
  ratingCount: {
    type: 'number',
    description: 'Number of ratings/reviews (places)',
    optional: true,
  },
  address: { type: 'string', description: 'Address (places)', optional: true },
  category: {
    type: 'string',
    description: 'Primary category, e.g. "Coffee shop" (places)',
    optional: true,
  },
  phoneNumber: { type: 'string', description: 'Contact phone number (places)', optional: true },
  website: { type: 'string', description: 'Business website URL (places)', optional: true },
  price: { type: 'string', description: 'Price (shopping)', optional: true },
  duration: { type: 'string', description: 'Duration (videos)', optional: true },
} as const satisfies Record<string, OutputProperty>

export interface SearchParams {
  query: string
  apiKey: string
  num?: number
  gl?: string
  hl?: string
  type?: 'search' | 'news' | 'places' | 'images' | 'videos' | 'shopping' | 'scholar' | 'patents'
  tbs?: string
}

export interface SearchResult {
  title: string
  /** Absent on `places` results, which Serper returns without any result URL. */
  link?: string
  snippet?: string
  position: number
  imageUrl?: string
  date?: string
  source?: string
  rating?: number
  ratingCount?: number
  address?: string
  category?: string
  phoneNumber?: string
  website?: string
  price?: string
  duration?: string
}

export interface SearchResponse extends ToolResponse {
  output: {
    searchResults: SearchResult[]
  }
}
