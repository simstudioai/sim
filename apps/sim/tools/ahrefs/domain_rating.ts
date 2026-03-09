import type { AhrefsDomainRatingParams, AhrefsDomainRatingResponse } from '@/tools/ahrefs/types'
import type { ToolConfig } from '@/tools/types'

export const domainRatingTool: ToolConfig<AhrefsDomainRatingParams, AhrefsDomainRatingResponse> = {
  id: 'ahrefs_domain_rating',
  name: 'Ahrefs Domain Rating',
  description:
    "Get the Domain Rating (DR) and Ahrefs Rank for a target domain. Domain Rating shows the strength of a website's backlink profile on a scale from 0 to 100.",
  version: '1.0.0',

  params: {
    target: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The target domain to analyze (e.g., example.com)',
    },
    date: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Date for historical data in YYYY-MM-DD format (defaults to today)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Ahrefs API Key',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.ahrefs.com/v3/site-explorer/domain-rating')
      url.searchParams.set('target', params.target)
      // Date is required - default to today if not provided
      const date = params.date || new Date().toISOString().split('T')[0]
      url.searchParams.set('date', date)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || data.error || 'Failed to get domain rating')
    }

    return {
      success: true,
      output: {
        domainRating: data.domain_rating ?? 0,
        ahrefsRank: data.ahrefs_rank ?? 0,
      },
    }
  },

  outputs: {
    domainRating: {
      type: 'number',
      description: 'Domain Rating score (0-100)',
    },
    ahrefsRank: {
      type: 'number',
      description: 'Ahrefs Rank - global ranking based on backlink profile strength',
    },
  },
}
