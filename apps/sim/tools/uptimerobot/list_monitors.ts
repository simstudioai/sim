import type { ToolConfig } from '@/tools/types'
import {
  MONITOR_OUTPUT_PROPERTIES,
  mapMonitor,
  UPTIMEROBOT_API_BASE,
  type UptimeRobotListMonitorsParams,
  type UptimeRobotListMonitorsResponse,
  uptimeRobotError,
  uptimeRobotHeaders,
} from '@/tools/uptimerobot/types'

export const uptimeRobotListMonitorsTool: ToolConfig<
  UptimeRobotListMonitorsParams,
  UptimeRobotListMonitorsResponse
> = {
  id: 'uptimerobot_list_monitors',
  name: 'UptimeRobot List Monitors',
  description: 'List monitors in your UptimeRobot account, with optional filters and pagination',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'UptimeRobot API key',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of monitors per page (1-200, default 50)',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated statuses to filter by (PAUSED, STARTED, UP, LOOKS_DOWN, DOWN)',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Partial friendly-name filter',
    },
    url: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Partial URL filter',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated tags to filter by (case-sensitive, OR logic)',
    },
    groupId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Monitor group ID to filter by',
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
      if (params.limit != null) query.set('limit', String(params.limit))
      if (params.status) query.set('status', params.status)
      if (params.name) query.set('name', params.name)
      if (params.url) query.set('url', params.url)
      if (params.tags) query.set('tags', params.tags)
      if (params.groupId != null) query.set('groupId', String(params.groupId))
      if (params.cursor != null) query.set('cursor', String(params.cursor))
      const qs = query.toString()
      return `${UPTIMEROBOT_API_BASE}/monitors${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => uptimeRobotHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await uptimeRobotError(response))
    }
    const data = await response.json()
    const monitors = Array.isArray(data?.data) ? data.data : []
    return {
      success: true,
      output: {
        monitors: monitors.map(mapMonitor),
        nextLink: data?.nextLink ?? null,
      },
    }
  },

  outputs: {
    monitors: {
      type: 'array',
      description: 'List of monitors',
      items: { type: 'object', properties: MONITOR_OUTPUT_PROPERTIES },
    },
    nextLink: {
      type: 'string',
      description: 'URL for the next page of results, or null on the last page',
      optional: true,
    },
  },
}
