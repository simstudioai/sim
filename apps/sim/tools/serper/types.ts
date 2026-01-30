import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property definitions for Serper API responses.
 * Based on Serper.dev API documentation: https://serper.dev/
 * Reference: https://github.com/yigitkonur/serper-deno-sdk
 */

/**
 * Output definition for search parameters echoed in response
 */
export const SEARCH_PARAMETERS_OUTPUT_PROPERTIES = {
  q: { type: 'string', description: 'The search query that was executed' },
  type: { type: 'string', description: 'Type of search performed (search, images, news, etc.)' },
  engine: { type: 'string', description: 'Search engine used (always "google")' },
  gl: { type: 'string', description: 'Country code applied to the search', optional: true },
  hl: { type: 'string', description: 'Language code applied to the search', optional: true },
  location: { type: 'string', description: 'Location applied to the search', optional: true },
  num: { type: 'number', description: 'Number of results requested', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete search parameters output definition
 */
export const SEARCH_PARAMETERS_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Parameters used for this search request',
  properties: SEARCH_PARAMETERS_OUTPUT_PROPERTIES,
}

/**
 * Output definition for Knowledge Graph attributes
 */
export const KNOWLEDGE_GRAPH_ATTRIBUTES_OUTPUT_PROPERTIES = {
  key: { type: 'string', description: 'Attribute name (e.g., "Headquarters", "CEO", "Founded")' },
  value: { type: 'string', description: 'Attribute value' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for Knowledge Graph panel
 * Appears for entities like companies, people, places
 */
export const KNOWLEDGE_GRAPH_OUTPUT_PROPERTIES = {
  title: { type: 'string', description: 'Entity name/title (e.g., "OpenAI")' },
  type: {
    type: 'string',
    description: 'Entity type (e.g., "Company", "Person", "Place")',
    optional: true,
  },
  description: {
    type: 'string',
    description: 'Description text, usually from Wikipedia',
    optional: true,
  },
  descriptionSource: {
    type: 'string',
    description: 'Source of the description (e.g., "Wikipedia")',
    optional: true,
  },
  descriptionLink: { type: 'string', description: 'URL to the description source', optional: true },
  imageUrl: {
    type: 'string',
    description: 'URL of an image associated with the entity',
    optional: true,
  },
  website: { type: 'string', description: 'Official website of the entity', optional: true },
  attributes: {
    type: 'object',
    description:
      'Additional key-value attributes about the entity (e.g., Headquarters, CEO, Founded)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete Knowledge Graph output definition
 */
export const KNOWLEDGE_GRAPH_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Knowledge Graph panel information for entities like companies, people, places',
  optional: true,
  properties: KNOWLEDGE_GRAPH_OUTPUT_PROPERTIES,
}

/**
 * Output definition for Answer Box / Featured Snippet
 * Appears for direct answer queries
 */
export const ANSWER_BOX_OUTPUT_PROPERTIES = {
  snippet: { type: 'string', description: 'Answer snippet text', optional: true },
  answer: {
    type: 'string',
    description: 'Direct answer (for calculations, definitions)',
    optional: true,
  },
  title: { type: 'string', description: 'Title of the source', optional: true },
  link: { type: 'string', description: 'URL of the source', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete Answer Box output definition
 */
export const ANSWER_BOX_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Featured snippet / answer box with direct answers to queries',
  optional: true,
  properties: ANSWER_BOX_OUTPUT_PROPERTIES,
}

/**
 * Output definition for sitelinks under an organic result
 */
export const SITELINK_OUTPUT_PROPERTIES = {
  title: { type: 'string', description: 'Sitelink title' },
  link: { type: 'string', description: 'Sitelink URL' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete sitelinks array output definition
 */
export const SITELINKS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Sitelinks under this result',
  optional: true,
  items: {
    type: 'object',
    properties: SITELINK_OUTPUT_PROPERTIES,
  },
}

/**
 * Output definition for organic search result items
 */
export const ORGANIC_RESULT_OUTPUT_PROPERTIES = {
  title: { type: 'string', description: 'Result title' },
  link: { type: 'string', description: 'Result URL' },
  snippet: { type: 'string', description: 'Text snippet with query context', optional: true },
  position: { type: 'number', description: 'Position in results (1-based)' },
  date: { type: 'string', description: 'Publication date if available', optional: true },
  sitelinks: SITELINKS_OUTPUT,
  attributes: {
    type: 'object',
    description: 'Additional attributes (e.g., for Wikipedia: "Available in", "URL")',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete organic results array output definition
 */
export const ORGANIC_RESULTS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Organic search results',
  items: {
    type: 'object',
    properties: ORGANIC_RESULT_OUTPUT_PROPERTIES,
  },
}

/**
 * Output definition for People Also Ask questions
 */
export const PEOPLE_ALSO_ASK_OUTPUT_PROPERTIES = {
  question: { type: 'string', description: 'The question that was asked' },
  snippet: { type: 'string', description: 'A snippet of the answer', optional: true },
  title: { type: 'string', description: 'Title of the source page', optional: true },
  link: { type: 'string', description: 'URL of the source page', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete People Also Ask array output definition
 */
export const PEOPLE_ALSO_ASK_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'People Also Ask questions and answers',
  optional: true,
  items: {
    type: 'object',
    properties: PEOPLE_ALSO_ASK_OUTPUT_PROPERTIES,
  },
}

/**
 * Output definition for related search suggestions
 */
export const RELATED_SEARCH_OUTPUT_PROPERTIES = {
  query: { type: 'string', description: 'Suggested search query' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete related searches array output definition
 */
export const RELATED_SEARCHES_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Related search suggestions',
  optional: true,
  items: {
    type: 'object',
    properties: RELATED_SEARCH_OUTPUT_PROPERTIES,
  },
}

/**
 * Output definition for top stories in news carousel
 */
export const TOP_STORY_OUTPUT_PROPERTIES = {
  title: { type: 'string', description: 'Story headline' },
  link: { type: 'string', description: 'Story URL' },
  source: { type: 'string', description: 'News source name' },
  date: { type: 'string', description: 'Publication date/time', optional: true },
  imageUrl: { type: 'string', description: 'Thumbnail image URL', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete top stories array output definition
 */
export const TOP_STORIES_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Top stories carousel',
  optional: true,
  items: {
    type: 'object',
    properties: TOP_STORY_OUTPUT_PROPERTIES,
  },
}

/**
 * Output definition for news search result items
 */
export const NEWS_RESULT_OUTPUT_PROPERTIES = {
  title: { type: 'string', description: 'News article title' },
  link: { type: 'string', description: 'News article URL' },
  snippet: { type: 'string', description: 'Article summary/excerpt' },
  date: { type: 'string', description: 'Publication date (e.g., "2 hours ago", "Jan 5, 2025")' },
  source: { type: 'string', description: 'Publisher/source name' },
  imageUrl: { type: 'string', description: 'Article thumbnail image URL', optional: true },
  position: { type: 'number', description: 'Position in results (1-based)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete news results array output definition
 */
export const NEWS_RESULTS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'News search results',
  items: {
    type: 'object',
    properties: NEWS_RESULT_OUTPUT_PROPERTIES,
  },
}

/**
 * Output definition for image search result items
 */
export const IMAGE_RESULT_OUTPUT_PROPERTIES = {
  title: { type: 'string', description: 'Image title/alt text' },
  imageUrl: { type: 'string', description: 'Direct URL to full-size image' },
  thumbnailUrl: { type: 'string', description: 'URL to thumbnail image' },
  imageWidth: { type: 'number', description: 'Full image width in pixels' },
  imageHeight: { type: 'number', description: 'Full image height in pixels' },
  thumbnailWidth: { type: 'number', description: 'Thumbnail width in pixels' },
  thumbnailHeight: { type: 'number', description: 'Thumbnail height in pixels' },
  source: { type: 'string', description: 'Source website name' },
  domain: { type: 'string', description: 'Source domain' },
  link: { type: 'string', description: 'Page URL where image appears' },
  googleUrl: { type: 'string', description: "Google's redirect URL for the image" },
  position: { type: 'number', description: 'Position in results (1-based)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete image results array output definition
 */
export const IMAGE_RESULTS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Image search results',
  items: {
    type: 'object',
    properties: IMAGE_RESULT_OUTPUT_PROPERTIES,
  },
}

/**
 * Output definition for video search result items
 */
export const VIDEO_RESULT_OUTPUT_PROPERTIES = {
  title: { type: 'string', description: 'Video title' },
  link: { type: 'string', description: 'Video URL (often YouTube or source site)' },
  snippet: { type: 'string', description: 'Video description/snippet', optional: true },
  source: { type: 'string', description: 'Platform name (e.g., "YouTube")' },
  duration: {
    type: 'string',
    description: 'Video duration (e.g., "10:30", "1:30:00")',
    optional: true,
  },
  date: { type: 'string', description: 'Upload date or relative time', optional: true },
  position: { type: 'number', description: 'Position in results (1-based)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete video results array output definition
 */
export const VIDEO_RESULTS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Video search results',
  items: {
    type: 'object',
    properties: VIDEO_RESULT_OUTPUT_PROPERTIES,
  },
}

/**
 * Output definition for places/maps search result items
 */
export const PLACE_RESULT_OUTPUT_PROPERTIES = {
  title: { type: 'string', description: 'Business/place name' },
  address: { type: 'string', description: 'Full street address' },
  latitude: { type: 'number', description: 'Latitude coordinate' },
  longitude: { type: 'number', description: 'Longitude coordinate' },
  rating: { type: 'number', description: 'Average rating (1-5 stars)', optional: true },
  ratingCount: { type: 'number', description: 'Total number of reviews', optional: true },
  type: {
    type: 'string',
    description: 'Primary category/type (e.g., "Coffee shop", "Restaurant")',
  },
  types: {
    type: 'array',
    description: 'All applicable categories',
    items: { type: 'string', description: 'Category type' },
  },
  website: { type: 'string', description: 'Business website URL', optional: true },
  phoneNumber: { type: 'string', description: 'Contact phone number', optional: true },
  description: {
    type: 'string',
    description: 'Business description from Google Maps',
    optional: true,
  },
  cid: { type: 'string', description: 'Google CID (internal identifier)' },
  placeId: { type: 'string', description: 'Google Place ID (for use with other APIs)' },
  position: { type: 'number', description: 'Position in results (1-based)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete places results array output definition
 */
export const PLACES_RESULTS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Places/maps search results',
  items: {
    type: 'object',
    properties: PLACE_RESULT_OUTPUT_PROPERTIES,
  },
}

/**
 * Output definition for shopping/product search result items
 */
export const SHOPPING_RESULT_OUTPUT_PROPERTIES = {
  title: { type: 'string', description: 'Product name/title' },
  link: { type: 'string', description: 'Product page URL (Google Shopping or merchant)' },
  snippet: { type: 'string', description: 'Product description/details', optional: true },
  source: { type: 'string', description: 'Seller/store name' },
  price: { type: 'string', description: 'Price as displayed (e.g., "$19.99", "€24.99")' },
  imageUrl: { type: 'string', description: 'Product image URL' },
  position: { type: 'number', description: 'Position in results (1-based)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete shopping results array output definition
 */
export const SHOPPING_RESULTS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Shopping/product search results',
  items: {
    type: 'object',
    properties: SHOPPING_RESULT_OUTPUT_PROPERTIES,
  },
}

/**
 * Combined search result output definition (supports all search types for legacy compatibility)
 * This is used when returning a unified result format across different search types
 */
export const SERPER_SEARCH_RESULT_OUTPUT_PROPERTIES = {
  title: { type: 'string', description: 'Result title' },
  link: { type: 'string', description: 'Result URL' },
  snippet: { type: 'string', description: 'Result description/snippet', optional: true },
  position: { type: 'number', description: 'Position in search results' },
  date: { type: 'string', description: 'Publication date (news/videos)', optional: true },
  imageUrl: { type: 'string', description: 'Image URL (images/news/shopping)', optional: true },
  source: { type: 'string', description: 'Source name (news/videos/shopping)', optional: true },
  rating: { type: 'number', description: 'Rating (places)', optional: true },
  ratingCount: { type: 'number', description: 'Number of reviews (places)', optional: true },
  address: { type: 'string', description: 'Address (places)', optional: true },
  price: { type: 'string', description: 'Price (shopping)', optional: true },
  duration: { type: 'string', description: 'Duration (videos)', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete search result output definition
 */
export const SERPER_SEARCH_RESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Search result item with type-specific metadata',
  properties: SERPER_SEARCH_RESULT_OUTPUT_PROPERTIES,
}

export interface SearchParams {
  query: string
  apiKey: string
  num?: number
  gl?: string
  hl?: string
  type?: 'search' | 'news' | 'places' | 'images' | 'videos' | 'shopping'
  tbs?: string
}

export interface SearchResult {
  title: string
  link: string
  snippet?: string
  position: number
  imageUrl?: string
  date?: string
  source?: string
  rating?: number
  ratingCount?: number
  address?: string
  price?: string
  duration?: string
}

export interface KnowledgeGraph {
  title: string
  type?: string
  description?: string
  descriptionSource?: string
  descriptionLink?: string
  imageUrl?: string
  website?: string
  attributes?: Record<string, string>
}

export interface AnswerBox {
  snippet?: string
  answer?: string
  title?: string
  link?: string
}

export interface PeopleAlsoAsk {
  question: string
  snippet?: string
  title?: string
  link?: string
}

export interface RelatedSearch {
  query: string
}

export interface TopStory {
  title: string
  link: string
  source: string
  date?: string
  imageUrl?: string
}

export interface SearchResponse extends ToolResponse {
  output: {
    searchResults: SearchResult[]
    knowledgeGraph?: KnowledgeGraph
    answerBox?: AnswerBox
    peopleAlsoAsk?: PeopleAlsoAsk[]
    relatedSearches?: RelatedSearch[]
    topStories?: TopStory[]
  }
}
