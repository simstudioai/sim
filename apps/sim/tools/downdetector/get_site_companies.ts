import {
  DOWNDETECTOR_API_BASE,
  type DowndetectorGetSiteCompaniesParams,
  type DowndetectorGetSiteCompaniesResponse,
} from '@/tools/downdetector/types'
import {
  downdetectorHeaders,
  downdetectorNextPageOutput,
  encodePathParam,
  extractDowndetectorError,
  nextPageFromResponse,
} from '@/tools/downdetector/utils'
import type { ToolConfig } from '@/tools/types'

const DEFAULT_FIELDS = 'id,name,slug,url,status,country_iso,category_id'

interface RawSiteCompany {
  id?: number
  name?: string
  slug?: string
  url?: string
  status?: string
  country_iso?: string
  category_id?: number
}

export const getSiteCompaniesTool: ToolConfig<
  DowndetectorGetSiteCompaniesParams,
  DowndetectorGetSiteCompaniesResponse
> = {
  id: 'downdetector_get_site_companies',
  name: 'Downdetector Get Site Companies',
  description:
    'List the companies monitored on a Downdetector site, including each company’s current status. Useful for discovering the companies available on a regional status page.',
  version: '1.0.0',

  params: {
    siteId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Downdetector site id',
    },
    fields: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Comma-separated company fields to return (defaults to id, name, slug, status)',
    },
    page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque page token from a previous response (X-Page-Next) for the next page',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page, between 10 and 100',
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
        `${DOWNDETECTOR_API_BASE}/sites/${encodePathParam(params.siteId, 'Site ID')}/companies`
      )
      url.searchParams.set('fields', params.fields || DEFAULT_FIELDS)
      if (params.page) url.searchParams.set('page', params.page)
      if (params.pageSize !== undefined) url.searchParams.set('page_size', String(params.pageSize))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => downdetectorHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(extractDowndetectorError(data, 'Failed to get site companies'))
    }

    const rows: RawSiteCompany[] = Array.isArray(data) ? data : []
    const companies = rows.map((company) => ({
      id: company.id ?? null,
      name: company.name ?? null,
      slug: company.slug ?? null,
      url: company.url ?? null,
      status: company.status ?? null,
      countryIso: company.country_iso ?? null,
      categoryId: company.category_id ?? null,
    }))

    return { success: true, output: { companies, nextPage: nextPageFromResponse(response) } }
  },

  outputs: {
    companies: {
      type: 'array',
      description: 'List of companies on the site',
      items: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Company id' },
          name: { type: 'string', description: 'Company name' },
          slug: { type: 'string', description: 'Company slug' },
          url: { type: 'string', description: 'Company status page URL' },
          status: {
            type: 'string',
            description: 'Cached current status (success, warning, or danger)',
          },
          countryIso: { type: 'string', description: 'ISO-2 country code' },
          categoryId: { type: 'number', description: 'Category id' },
        },
      },
    },
    nextPage: downdetectorNextPageOutput,
  },
}
