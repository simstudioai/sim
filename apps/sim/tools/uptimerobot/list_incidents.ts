import type { ToolConfig } from '@/tools/types'
import {
  INCIDENT_SUMMARY_OUTPUT_PROPERTIES,
  mapIncidentSummary,
  UPTIMEROBOT_API_BASE,
  type UptimeRobotListIncidentsParams,
  type UptimeRobotListIncidentsResponse,
  uptimeRobotError,
  uptimeRobotHeaders,
} from '@/tools/uptimerobot/types'

export const uptimeRobotListIncidentsTool: ToolConfig<
  UptimeRobotListIncidentsParams,
  UptimeRobotListIncidentsResponse
> = {
  id: 'uptimerobot_list_incidents',
  name: 'UptimeRobot List Incidents',
  description:
    'List incidents across your UptimeRobot account (last 24 hours by default), with optional filters',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'UptimeRobot API key',
    },
    monitorId: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter incidents by monitor ID',
    },
    monitorName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter incidents by monitor name',
    },
    startedAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include incidents started after this ISO 8601 timestamp',
    },
    startedBefore: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only include incidents started before this ISO 8601 timestamp',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor (incident ID) returned by a previous request',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.monitorId != null) query.set('monitor_id', String(params.monitorId))
      if (params.monitorName) query.set('monitor_name', params.monitorName)
      if (params.startedAfter) query.set('started_after', params.startedAfter)
      if (params.startedBefore) query.set('started_before', params.startedBefore)
      if (params.cursor) query.set('cursor', params.cursor)
      const qs = query.toString()
      return `${UPTIMEROBOT_API_BASE}/incidents${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => uptimeRobotHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await uptimeRobotError(response))
    }
    const data = await response.json()
    const incidents = Array.isArray(data?.data) ? data.data : []
    return {
      success: true,
      output: {
        incidents: incidents.map(mapIncidentSummary),
        nextLink: data?.nextLink ?? null,
      },
    }
  },

  outputs: {
    incidents: {
      type: 'array',
      description: 'List of incidents',
      items: { type: 'object', properties: INCIDENT_SUMMARY_OUTPUT_PROPERTIES },
    },
    nextLink: {
      type: 'string',
      description: 'URL for the next page of results, or null on the last page',
      optional: true,
    },
  },
}
