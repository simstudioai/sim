import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookEntityNewsWindowParams, PitchbookResponse } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookEntityNewsTool: ToolConfig<
  PitchbookEntityNewsWindowParams,
  PitchbookResponse
> = {
  id: 'pitchbook_entity_news',
  name: 'PitchBook Entity News',
  description: 'Retrieve recent news articles PitchBook has associated with an entity',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PITCHBOOK_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PitchBook API key',
    },
    pbId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'PitchBook entity ID of a company, investor, or service provider, e.g. 51261-67.',
    },
    sinceDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Publication window, carrying its operator in the value: >YYYY-MM-DD for after a date, <YYYY-MM-DD for before one, or YYYY-MM-DD^YYYY-MM-DD for a range. Use this or trailingRange.',
    },
    trailingRange: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'How many days back to pull news for (e.g. 20)',
    },
    currency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ISO currency code to convert monetary values into, sent as the X-Currency header (e.g. USD, EUR, JPY). Defaults to the currency on the account preferences.',
    },
  },

  request: {
    url: (params) => {
      const qs = new URLSearchParams()
      if (params.sinceDate) qs.set('sinceDate', params.sinceDate.trim())
      if (params.trailingRange !== undefined && params.trailingRange !== null) {
        qs.set('trailingRange', String(params.trailingRange))
      }
      const query = qs.toString()
      return `${PITCHBOOK_API_BASE}/entities/${params.pbId.trim()}/news${query ? `?${query}` : ''}`
    },
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch entity news')
    const data = await response.json()

    return {
      success: true,
      output: {
        news: Array.isArray(data) ? data : [],
      },
    }
  },

  outputs: {
    news: {
      type: 'array',
      description: 'News articles associated with the entity, most recent first',
      items: {
        type: 'object',
        properties: {
          entityId: { type: 'string', description: 'PitchBook entity ID the article is about' },
          title: { type: 'string', description: 'Article headline' },
          byline: { type: 'string', description: 'Article summary or byline', nullable: true },
          source: {
            type: 'string',
            description: 'Publication the article came from',
            nullable: true,
          },
          publishDate: {
            type: 'string',
            description: 'Publication timestamp (ISO 8601)',
            nullable: true,
          },
          url: { type: 'string', description: 'Link to the article', nullable: true },
        },
      },
    },
  },
}
