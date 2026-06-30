import {
  DOWNDETECTOR_API_BASE,
  type DowndetectorIncidentsResponse,
  type DowndetectorListIncidentsParams,
} from '@/tools/downdetector/types'
import {
  downdetectorHeaders,
  downdetectorIncidentItemSchema,
  downdetectorNextPageOutput,
  extractDowndetectorError,
  mapDowndetectorIncident,
  nextPageFromResponse,
} from '@/tools/downdetector/utils'
import type { ToolConfig } from '@/tools/types'

export const listIncidentsTool: ToolConfig<
  DowndetectorListIncidentsParams,
  DowndetectorIncidentsResponse
> = {
  id: 'downdetector_list_incidents',
  name: 'Downdetector List Incidents',
  description:
    'List all incidents (outages) across every company that were active in the chosen time period, or in the last 24 hours if no date range is provided.',
  version: '1.0.0',

  params: {
    onlyActive: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'When true, only currently active incidents are returned',
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
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Requested page number (1-indexed)',
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
      const url = new URL(`${DOWNDETECTOR_API_BASE}/incidents`)
      if (params.onlyActive !== undefined)
        url.searchParams.set('only_active', String(params.onlyActive))
      if (params.startdate) url.searchParams.set('startdate', params.startdate)
      if (params.enddate) url.searchParams.set('enddate', params.enddate)
      if (params.page !== undefined) url.searchParams.set('page', String(params.page))
      if (params.pageSize !== undefined) url.searchParams.set('page_size', String(params.pageSize))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => downdetectorHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(extractDowndetectorError(data, 'Failed to list incidents'))
    }

    const rows = Array.isArray(data) ? data : []
    const incidents = rows.map(mapDowndetectorIncident)

    return { success: true, output: { incidents, nextPage: nextPageFromResponse(response) } }
  },

  outputs: {
    incidents: {
      type: 'array',
      description: 'List of incidents across all companies',
      items: downdetectorIncidentItemSchema,
    },
    nextPage: downdetectorNextPageOutput,
  },
}
