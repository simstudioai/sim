import type { ToolConfig } from '@/tools/types'
import {
  mapPsp,
  PSP_OUTPUT_PROPERTIES,
  UPTIMEROBOT_API_BASE,
  type UptimeRobotListPspsParams,
  type UptimeRobotListPspsResponse,
  uptimeRobotError,
  uptimeRobotHeaders,
} from '@/tools/uptimerobot/types'

export const uptimeRobotListPspsTool: ToolConfig<
  UptimeRobotListPspsParams,
  UptimeRobotListPspsResponse
> = {
  id: 'uptimerobot_list_psps',
  name: 'UptimeRobot List Status Pages',
  description: 'List the public status pages in your UptimeRobot account',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'UptimeRobot API key',
    },
    cursor: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor returned by a previous request',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.cursor != null) query.set('cursor', String(params.cursor))
      const qs = query.toString()
      return `${UPTIMEROBOT_API_BASE}/psps${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => uptimeRobotHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await uptimeRobotError(response))
    }
    const data = await response.json()
    const psps = Array.isArray(data?.data) ? data.data : []
    return {
      success: true,
      output: {
        psps: psps.map(mapPsp),
        nextLink: data?.nextLink ?? null,
      },
    }
  },

  outputs: {
    psps: {
      type: 'array',
      description: 'List of public status pages',
      items: { type: 'object', properties: PSP_OUTPUT_PROPERTIES },
    },
    nextLink: {
      type: 'string',
      description: 'URL for the next page of results, or null on the last page',
      optional: true,
    },
  },
}
