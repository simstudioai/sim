import { ErrorExtractorId } from '@/tools/error-extractors'
import type { PitchbookResponse, PitchbookUsageWindowParams } from '@/tools/pitchbook/types'
import { PITCHBOOK_API_BASE, pitchbookAuthHeaders, throwIfNotOk } from '@/tools/pitchbook/utils'
import type { ToolConfig } from '@/tools/types'

export const pitchbookUsageReportTool: ToolConfig<PitchbookUsageWindowParams, PitchbookResponse> = {
  id: 'pitchbook_usage_report',
  name: 'PitchBook Usage Report',
  description:
    'Retrieve how many API calls were made and how many credits they charged, for up to the last 90 days',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.PITCHBOOK_ERRORS,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'PitchBook API key',
    },
    sinceDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Window to report changes over, carrying its operator in the value: >YYYY-MM-DD for after a date, <YYYY-MM-DD for before one, or YYYY-MM-DD^YYYY-MM-DD for a range. Use this or trailingRange.',
    },
    trailingRange: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Report changes over the last N days. Use this or sinceDate.',
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
      if (params.sinceDate) qs.set('sinceDate', params.sinceDate)
      if (params.trailingRange !== undefined && params.trailingRange !== null) {
        qs.set('trailingRange', String(params.trailingRange))
      }
      const query = qs.toString()
      return `${PITCHBOOK_API_BASE}/calls/history${query ? `?${query}` : ''}`
    },
    method: 'GET',
    headers: (params) => pitchbookAuthHeaders(params.apiKey, params.currency),
  },

  transformResponse: async (response: Response) => {
    await throwIfNotOk(response, 'Failed to fetch usage report')
    const data = await response.json()

    return {
      success: true,
      output: {
        stats: data.stats ?? null,
        rawData: data.rawData ?? [],
      },
    }
  },

  outputs: {
    stats: {
      type: 'object',
      description: 'Summary statistics for the response',
      properties: {
        endpoints: {
          type: 'array',
          description: 'Per-endpoint call breakdown',
          items: { type: 'json' },
        },
        totalCountOfCalls: { type: 'number', description: 'Total number of calls made' },
        totalChargedCredits: { type: 'number', description: 'Total credits charged' },
      },
    },
    rawData: {
      type: 'array',
      description: 'Individual call records',
      items: { type: 'json' },
    },
  },
}
