import {
  DOWNDETECTOR_API_BASE,
  type DowndetectorGetCompanyIndicatorsParams,
  type DowndetectorGetCompanyIndicatorsResponse,
} from '@/tools/downdetector/types'
import {
  downdetectorHeaders,
  encodePathParam,
  extractDowndetectorError,
} from '@/tools/downdetector/utils'
import type { ToolConfig } from '@/tools/types'

interface RawIndicator {
  slug?: string
  indicator?: string
  key?: string
  amount?: number
  percentage?: number
}

export const getCompanyIndicatorsTool: ToolConfig<
  DowndetectorGetCompanyIndicatorsParams,
  DowndetectorGetCompanyIndicatorsResponse
> = {
  id: 'downdetector_get_company_indicators',
  name: 'Downdetector Get Company Indicators',
  description:
    'Get the problem indicators (e.g. "App crashing", "Login", "Server connection") reported for a Downdetector company over a time period, with the report counts and percentages for each.',
  version: '1.0.0',

  params: {
    companyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Downdetector company id',
    },
    startdate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 8601 start of the time range (only works together with enddate)',
    },
    enddate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 8601 end of the time range (only works together with startdate)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Downdetector API Bearer token',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(
        `${DOWNDETECTOR_API_BASE}/companies/${encodePathParam(params.companyId, 'Company ID')}/indicators`
      )
      if (params.startdate) url.searchParams.set('startdate', params.startdate)
      if (params.enddate) url.searchParams.set('enddate', params.enddate)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => downdetectorHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(extractDowndetectorError(data, 'Failed to get company indicators'))
    }

    const rows: RawIndicator[] = Array.isArray(data) ? data : []
    const indicators = rows.map((item) => ({
      slug: item.slug ?? null,
      indicator: item.indicator ?? null,
      key: item.key ?? null,
      amount: item.amount ?? null,
      percentage: item.percentage ?? null,
    }))

    return { success: true, output: { indicators } }
  },

  outputs: {
    indicators: {
      type: 'array',
      description: 'Reported problem indicators with their counts',
      items: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'Indicator slug' },
          indicator: { type: 'string', description: 'Human-readable indicator label' },
          key: { type: 'string', description: 'Indicator key' },
          amount: { type: 'number', description: 'Number of reports for this indicator' },
          percentage: { type: 'number', description: 'Share of total reports (percentage)' },
        },
      },
    },
  },
}
