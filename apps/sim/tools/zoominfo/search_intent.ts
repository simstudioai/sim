import type { ToolConfig } from '@/tools/types'
import type {
  ZoomInfoSearchIntentParams,
  ZoomInfoSearchIntentResponse,
} from '@/tools/zoominfo/types'
import {
  buildProxyBody,
  extractDataArray,
  extractPagination,
  paginationOutputProperties,
  parseCsvOrJson,
  toCsvStringOrUndefined,
  toNumberOrUndefined,
  transformZoomInfoEnvelope,
  ZOOMINFO_PROXY_URL,
} from '@/tools/zoominfo/utils'

export const zoominfoSearchIntentTool: ToolConfig<
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

  request: {
    url: ZOOMINFO_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const topics = parseCsvOrJson(params.topics, 'topics')
      if (!topics || topics.length === 0) {
        throw new Error('topics is required')
      }
      const attributes: Record<string, unknown> = { topics }
      if (params.signalStartDate) attributes.signalStartDate = params.signalStartDate
      if (params.signalEndDate) attributes.signalEndDate = params.signalEndDate
      const scoreMin = toNumberOrUndefined(params.signalScoreMin)
      if (scoreMin !== undefined) attributes.signalScoreMin = scoreMin
      const scoreMax = toNumberOrUndefined(params.signalScoreMax)
      if (scoreMax !== undefined) attributes.signalScoreMax = scoreMax
      if (params.audienceStrengthMin) attributes.audienceStrengthMin = params.audienceStrengthMin
      if (params.audienceStrengthMax) attributes.audienceStrengthMax = params.audienceStrengthMax
      if (params.findRecommendedContacts !== undefined) {
        attributes.findRecommendedContacts = params.findRecommendedContacts
      }
      if (params.country) attributes.country = params.country
      if (params.state) attributes.state = params.state
      const industryCodes = toCsvStringOrUndefined(params.industryCodes, 'industryCodes')
      if (industryCodes) attributes.industryCodes = industryCodes

      const query: Record<string, string | number> = {}
      const page = toNumberOrUndefined(params.page)
      const rpp = toNumberOrUndefined(params.rpp)
      if (page !== undefined) query['page[number]'] = page
      if (rpp !== undefined) query['page[size]'] = rpp

      return {
        ...buildProxyBody(params),
        path: '/data/v1/intent/search',
        method: 'POST',
        query: Object.keys(query).length > 0 ? query : undefined,
        body: {
          data: {
            type: 'IntentSearch',
            attributes,
          },
        },
      }
    },
  },

  transformResponse: async (response: Response) => {
    const { data } = await transformZoomInfoEnvelope(response)
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
