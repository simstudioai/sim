import {
  DOWNDETECTOR_API_BASE,
  type DowndetectorGetCompanyParams,
  type DowndetectorGetCompanyResponse,
} from '@/tools/downdetector/types'
import {
  downdetectorHeaders,
  encodePathParam,
  extractDowndetectorError,
} from '@/tools/downdetector/utils'
import type { ToolConfig } from '@/tools/types'

const DEFAULT_FIELDS =
  'id,name,slug,url,stats_24,baseline,baseline_current,category_id,status,country_iso,site_id,indicators,description'

interface RawCompany {
  id?: number
  name?: string
  slug?: string
  url?: string
  status?: string
  category_id?: number
  country_iso?: string
  site_id?: number
  baseline_current?: number
  stats_24?: number[]
  baseline?: number[]
  indicators?: string[]
  description?: string
}

export const getCompanyTool: ToolConfig<
  DowndetectorGetCompanyParams,
  DowndetectorGetCompanyResponse
> = {
  id: 'downdetector_get_company',
  name: 'Downdetector Get Company',
  description:
    'Get details for a Downdetector company by id, including its current status, 24h report statistics, baseline, and available problem indicators.',
  version: '1.0.0',

  params: {
    companyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Downdetector company id',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Comma-separated list of fields to return (defaults to a rich set including status, stats_24, and baseline)',
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
        `${DOWNDETECTOR_API_BASE}/companies/${encodePathParam(params.companyId, 'Company ID')}`
      )
      url.searchParams.set('fields', params.fields || DEFAULT_FIELDS)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => downdetectorHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data: RawCompany = await response.json()
    if (!response.ok) {
      throw new Error(extractDowndetectorError(data, 'Failed to get company'))
    }

    return {
      success: true,
      output: {
        company: {
          id: data.id ?? null,
          name: data.name ?? null,
          slug: data.slug ?? null,
          url: data.url ?? null,
          status: data.status ?? null,
          categoryId: data.category_id ?? null,
          countryIso: data.country_iso ?? null,
          siteId: data.site_id ?? null,
          baselineCurrent: data.baseline_current ?? null,
          stats24: data.stats_24 ?? [],
          baseline: data.baseline ?? [],
          indicators: data.indicators ?? [],
          description: data.description ?? null,
        },
      },
    }
  },

  outputs: {
    company: {
      type: 'object',
      description: 'Company details',
      properties: {
        id: { type: 'number', description: 'Company id' },
        name: { type: 'string', description: 'Company name' },
        slug: { type: 'string', description: 'Company slug' },
        url: { type: 'string', description: 'Company status page URL' },
        status: {
          type: 'string',
          description: 'Cached current status (success, warning, or danger)',
        },
        categoryId: { type: 'number', description: 'Category id' },
        countryIso: { type: 'string', description: 'ISO-2 country code' },
        siteId: { type: 'number', description: 'Site id' },
        baselineCurrent: {
          type: 'number',
          description: 'The current considered average reports at this point in time',
        },
        stats24: {
          type: 'array',
          description: 'Reports over the last 24h in 15-minute buckets',
          items: { type: 'number' },
        },
        baseline: {
          type: 'array',
          description: 'Averaged baseline values per 15m over 24h',
          items: { type: 'number' },
        },
        indicators: {
          type: 'array',
          description: 'List of available problem indicators',
          items: { type: 'string' },
        },
        description: { type: 'string', description: 'Company description' },
      },
    },
  },
}
