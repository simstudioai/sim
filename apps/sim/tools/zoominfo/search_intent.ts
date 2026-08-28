import type { InternalToolConfig } from '@/tools/types'
import type {
  ZoomInfoSearchIntentParams,
  ZoomInfoSearchIntentResponse,
} from '@/tools/zoominfo/types'
import {
  extractDataArray,
  extractPagination,
  paginationOutputProperties,
  transformZoomInfoResponse,
} from '@/tools/zoominfo/utils'

export const zoominfoSearchIntentTool: InternalToolConfig<
  ZoomInfoSearchIntentParams,
  ZoomInfoSearchIntentResponse
> = {
  id: 'zoominfo_search_intent',
  name: 'ZoomInfo Search Intent',
  description: 'Search for companies showing intent signals on specific topics.',
  version: '1.0.0',

  params: {
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ZoomInfo OAuth client ID',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'ZoomInfo OAuth client secret',
    },
    topics: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Up to 50 intent topics as JSON array or comma-separated list (e.g. ["CRM Software","Marketing Automation"])',
    },
    signalStartDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Earliest signal date (YYYY-MM-DD)',
    },
    signalEndDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Latest signal date (YYYY-MM-DD)',
    },
    signalScoreMin: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Minimum signal score (60-100)',
    },
    signalScoreMax: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum signal score (60-100)',
    },
    audienceStrengthMin: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Minimum audience strength (A-E, A is largest)',
    },
    audienceStrengthMax: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum audience strength (A-E, A is largest)',
    },
    findRecommendedContacts: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include recommended contacts (default true)',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Country filter',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'State filter',
    },
    industryCodes: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Industry codes — JSON array or comma-separated list. Sent to the API as a comma-separated string.',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number (1-based)',
    },
    rpp: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page (1-100, default 25)',
    },
  },

  operation: {
    input: (params) => params,
  },

  transformResponse: async (response: Response) => {
    const { data } = await transformZoomInfoResponse(response)
    const signals = extractDataArray(data)
    const pagination = extractPagination(data)
    return {
      success: true,
      output: {
        signals,
        ...pagination,
      },
    }
  },

  outputs: {
    signals: {
      type: 'array',
      description: 'Intent signals with topic, score, audience strength, and company',
      items: { type: 'json' },
    },
    ...paginationOutputProperties,
  },
}
