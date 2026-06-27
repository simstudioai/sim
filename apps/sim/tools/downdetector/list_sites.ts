import {
  DOWNDETECTOR_API_BASE,
  type DowndetectorListSitesParams,
  type DowndetectorListSitesResponse,
} from '@/tools/downdetector/types'
import { downdetectorHeaders, extractDowndetectorError } from '@/tools/downdetector/utils'
import type { ToolConfig } from '@/tools/types'

interface RawSite {
  id?: number
  name?: string
  domain?: string
  country_id?: number
}

export const listSitesTool: ToolConfig<DowndetectorListSitesParams, DowndetectorListSitesResponse> =
  {
    id: 'downdetector_list_sites',
    name: 'Downdetector List Sites',
    description:
      'List all available Downdetector sites (regional status-page domains). Each site groups the companies monitored for a given country/region.',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Downdetector API Bearer token',
      },
    },

    request: {
      url: () => `${DOWNDETECTOR_API_BASE}/sites`,
      method: 'GET',
      headers: (params) => downdetectorHeaders(params.apiKey),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()
      if (!response.ok) {
        throw new Error(extractDowndetectorError(data, 'Failed to list sites'))
      }

      const rows: RawSite[] = Array.isArray(data) ? data : []
      const sites = rows.map((site) => ({
        id: site.id ?? null,
        name: site.name ?? null,
        domain: site.domain ?? null,
        countryId: site.country_id ?? null,
      }))

      return { success: true, output: { sites } }
    },

    outputs: {
      sites: {
        type: 'array',
        description: 'List of Downdetector sites',
        items: {
          type: 'object',
          properties: {
            id: { type: 'number', description: 'Site id' },
            name: { type: 'string', description: 'Site name' },
            domain: { type: 'string', description: 'Site domain' },
            countryId: { type: 'number', description: 'Country id for the site' },
          },
        },
      },
    },
  }
