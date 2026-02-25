import type { GongListCallsParams, GongListCallsResponse } from '@/tools/gong/types'
import type { ToolConfig } from '@/tools/types'

export const listCallsTool: ToolConfig<GongListCallsParams, GongListCallsResponse> = {
  id: 'gong_list_calls',
  name: 'Gong List Calls',
  description: 'Retrieve call data by date range from Gong.',
  version: '1.0.0',

  params: {
    accessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Gong API Access Key',
    },
    accessKeySecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Gong API Access Key Secret',
    },
    fromDateTime: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start date/time in ISO-8601 format (e.g., 2024-01-01T00:00:00Z)',
    },
    toDateTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'End date/time in ISO-8601 format (e.g., 2024-01-31T23:59:59Z). If omitted, lists calls up to the most recent.',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response',
    },
    workspaceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Gong workspace ID to filter calls',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.gong.io/v2/calls')
      url.searchParams.set('fromDateTime', params.fromDateTime)
      if (params.toDateTime) url.searchParams.set('toDateTime', params.toDateTime)
      if (params.cursor) url.searchParams.set('cursor', params.cursor)
      if (params.workspaceId) url.searchParams.set('workspaceId', params.workspaceId)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.accessKey}:${params.accessKeySecret}`)}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.errors?.[0]?.message || data.message || 'Failed to list calls')
    }
    const calls = (data.calls ?? []).map((call: Record<string, unknown>) => ({
      id: call.id ?? '',
      title: call.title ?? null,
      scheduled: call.scheduled ?? null,
      started: call.started ?? '',
      duration: call.duration ?? 0,
      direction: call.direction ?? null,
      system: call.system ?? null,
      scope: call.scope ?? null,
      media: call.media ?? null,
      language: call.language ?? null,
      url: call.url ?? null,
      primaryUserId: call.primaryUserId ?? null,
      workspaceId: call.workspaceId ?? null,
      sdrDisposition: call.sdrDisposition ?? null,
      clientUniqueId: call.clientUniqueId ?? null,
      customData: call.customData ?? null,
      purpose: call.purpose ?? null,
      meetingUrl: call.meetingUrl ?? null,
      isPrivate: call.isPrivate ?? false,
      calendarEventId: call.calendarEventId ?? null,
    }))
    return {
      success: true,
      output: {
        calls,
        cursor: data.records?.cursor ?? null,
        totalRecords: data.records?.totalRecords ?? calls.length,
      },
    }
  },

  outputs: {
    calls: {
      type: 'array',
      description: 'List of calls matching the date range',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: "Gong's unique numeric identifier for the call" },
          title: { type: 'string', description: 'Call title' },
          scheduled: { type: 'string', description: 'Scheduled call time in ISO-8601 format' },
          started: { type: 'string', description: 'Recording start time in ISO-8601 format' },
          duration: { type: 'number', description: 'Call duration in seconds' },
          direction: { type: 'string', description: 'Call direction (Inbound/Outbound)' },
          system: { type: 'string', description: 'Communication platform used (e.g., Outreach)' },
          scope: {
            type: 'string',
            description: "Call scope: 'Internal', 'External', or 'Unknown'",
          },
          media: { type: 'string', description: 'Media type (e.g., Video)' },
          language: { type: 'string', description: 'Language code in ISO-639-2B format' },
          url: { type: 'string', description: 'URL to the call in the Gong web app' },
          primaryUserId: { type: 'string', description: 'Host team member identifier' },
          workspaceId: { type: 'string', description: 'Workspace identifier' },
          sdrDisposition: { type: 'string', description: 'SDR disposition classification' },
          clientUniqueId: {
            type: 'string',
            description: 'Call identifier from the origin recording system',
          },
          customData: { type: 'string', description: 'Metadata provided during call creation' },
          purpose: { type: 'string', description: 'Call purpose' },
          meetingUrl: { type: 'string', description: 'Web conference provider URL' },
          isPrivate: { type: 'boolean', description: 'Whether the call is private' },
          calendarEventId: { type: 'string', description: 'Calendar event identifier' },
        },
      },
    },
    cursor: {
      type: 'string',
      description: 'Pagination cursor for the next page',
      optional: true,
    },
    totalRecords: {
      type: 'number',
      description: 'Total number of records matching the filter',
    },
  },
}
