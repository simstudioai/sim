import type { OutputProperty, ToolResponse } from '@/tools/types'

/** SearchResult read from a Autom API response. */
export interface AutomSearchResult {
  position: number | null
  title: string | null
  link: string | null
  domain: string | null
  displayedLink: string | null
  source: string | null
  snippet: string | null
  date: string | null
}

/** KnowledgeGraph read from a Autom API response. */
export interface AutomKnowledgeGraph {
  title: string | null
  type: string | null
  website: string | null
}

/** Place read from a Autom API response. */
export interface AutomPlace {
  title: string | null
  address: string | null
  website: string | null
  phoneNumber: string | null
  latitude: number | null
  longitude: number | null
  placeId: string | null
}

/** Suggestion read from a Autom API response. */
export interface AutomSuggestion {
  value: string | null
}

/** Location read from a Autom API response. */
export interface AutomLocation {
  canonicalName: string | null
  name: string | null
  targetType: string | null
  countryCode: string | null
  reach: number | null
  googleId: number | null
}

export const AUTOM_SEARCH_RESULT_OUTPUT_PROPERTIES = {
  position: {
    type: 'number',
    description: 'Position of the result on the page',
    optional: true,
  },
  title: {
    type: 'string',
    description: 'Title of the result',
    optional: true,
  },
  link: {
    type: 'string',
    description: 'URL of the result',
    optional: true,
  },
  domain: {
    type: 'string',
    description: 'Domain of the result',
    optional: true,
  },
  displayedLink: {
    type: 'string',
    description: 'Link as the search engine displays it',
    optional: true,
  },
  source: {
    type: 'string',
    description: 'Source or site name',
    optional: true,
  },
  snippet: {
    type: 'string',
    description: 'Snippet shown under the title',
    optional: true,
  },
  date: {
    type: 'string',
    description: 'Date shown with the result, when there is one',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const AUTOM_KNOWLEDGE_GRAPH_OUTPUT_PROPERTIES = {
  title: {
    type: 'string',
    description: 'Title of the entity',
    optional: true,
  },
  type: {
    type: 'string',
    description: 'Type of the entity',
    optional: true,
  },
  website: {
    type: 'string',
    description: 'Website of the entity',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const AUTOM_PLACE_OUTPUT_PROPERTIES = {
  title: {
    type: 'string',
    description: 'Name of the place',
    optional: true,
  },
  address: {
    type: 'string',
    description: 'Address of the place',
    optional: true,
  },
  website: {
    type: 'string',
    description: 'Website of the place',
    optional: true,
  },
  phoneNumber: {
    type: 'string',
    description: 'Phone number of the place',
    optional: true,
  },
  latitude: {
    type: 'number',
    description: 'Latitude',
    optional: true,
  },
  longitude: {
    type: 'number',
    description: 'Longitude',
    optional: true,
  },
  placeId: {
    type: 'string',
    description: 'Google Maps feature ID of the place',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const AUTOM_SUGGESTION_OUTPUT_PROPERTIES = {
  value: {
    type: 'string',
    description: 'Suggested query',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const AUTOM_LOCATION_OUTPUT_PROPERTIES = {
  canonicalName: {
    type: 'string',
    description: 'Full location name, as the Location field accepts it',
    optional: true,
  },
  name: {
    type: 'string',
    description: 'Short name of the location',
    optional: true,
  },
  targetType: {
    type: 'string',
    description: 'Type of location, such as City or Country',
    optional: true,
  },
  countryCode: {
    type: 'string',
    description: 'ISO 3166-1 alpha-2 country code',
    optional: true,
  },
  reach: {
    type: 'number',
    description: 'Estimated reach of the location',
    optional: true,
  },
  googleId: {
    type: 'number',
    description: "Google's ID of the location",
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export interface AutomGoogleSearchParams {
  apiKey: string
  query: string
  country?: string
  language?: string
  location?: string
  page?: number
  numResults?: number
}

export interface AutomGoogleSearchResponse extends ToolResponse {
  output: {
    results: AutomSearchResult[]
    knowledgeGraph: AutomKnowledgeGraph | null
    totalResults: number | null
    hasNextPage: boolean | null
  }
}

export interface AutomGoogleSearchLightParams {
  apiKey: string
  query: string
  country?: string
  language?: string
}

export interface AutomGoogleSearchLightResponse extends ToolResponse {
  output: {
    results: AutomSearchResult[]
  }
}

export interface AutomGoogleNewsParams {
  apiKey: string
  query: string
  country?: string
  language?: string
  page?: number
  numResults?: number
}

export interface AutomGoogleNewsResponse extends ToolResponse {
  output: {
    results: AutomSearchResult[]
    hasNextPage: boolean | null
  }
}

export interface AutomGoogleMapsParams {
  apiKey: string
  query: string
  country?: string
  language?: string
  page?: number
}

export interface AutomGoogleMapsResponse extends ToolResponse {
  output: {
    places: AutomPlace[]
  }
}

export interface AutomGoogleAutocompleteParams {
  apiKey: string
  query: string
  country?: string
  language?: string
}

export interface AutomGoogleAutocompleteResponse extends ToolResponse {
  output: {
    suggestions: AutomSuggestion[]
  }
}

export interface AutomBingSearchParams {
  apiKey: string
  query: string
  market?: string
  page?: number
  numResults?: number
}

export interface AutomBingSearchResponse extends ToolResponse {
  output: {
    results: AutomSearchResult[]
    totalResults: number | null
    hasNextPage: boolean | null
  }
}

export interface AutomDuckduckgoSearchParams {
  apiKey: string
  query: string
  country?: string
  language?: string
  page?: number
}

export interface AutomDuckduckgoSearchResponse extends ToolResponse {
  output: {
    results: AutomSearchResult[]
  }
}

export interface AutomYahooSearchParams {
  apiKey: string
  query: string
  country?: string
  language?: string
  page?: number
}

export interface AutomYahooSearchResponse extends ToolResponse {
  output: {
    results: AutomSearchResult[]
  }
}

export interface AutomBraveSearchParams {
  apiKey: string
  query: string
  country?: string
  language?: string
  page?: number
}

export interface AutomBraveSearchResponse extends ToolResponse {
  output: {
    results: AutomSearchResult[]
  }
}

export interface AutomFindGoogleLocationsParams {
  apiKey: string
  query: string
}

export interface AutomFindGoogleLocationsResponse extends ToolResponse {
  output: {
    locations: AutomLocation[]
  }
}
