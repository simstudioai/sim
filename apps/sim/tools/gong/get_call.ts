import type { GongGetCallParams, GongGetCallResponse } from '@/tools/gong/types'
import type { ToolConfig } from '@/tools/types'

export const getCallTool: ToolConfig<GongGetCallParams, GongGetCallResponse> = {
  id: 'gong_get_call',
  name: 'Gong Get Call',
  description: 'Retrieve detailed data for a specific call from Gong.',
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
    callId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Gong call ID to retrieve',
    },
  },

  request: {
    url: (params) => `https://api.gong.io/v2/calls/${params.callId}`,
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`${params.accessKey}:${params.accessKeySecret}`)}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.errors?.[0]?.message || data.message || 'Failed to get call')
    }
    const call = data.call ?? data
    return {
      success: true,
      output: {
        id: call.id ?? '',
        title: call.title ?? null,
        url: call.url ?? null,
        scheduled: call.scheduled ?? null,
        started: call.started ?? '',
        duration: call.duration ?? 0,
        direction: call.direction ?? null,
        system: call.system ?? null,
        scope: call.scope ?? null,
        media: call.media ?? null,
        language: call.language ?? null,
        primaryUserId: call.primaryUserId ?? null,
        workspaceId: call.workspaceId ?? null,
        sdrDisposition: call.sdrDisposition ?? null,
        clientUniqueId: call.clientUniqueId ?? null,
        customData: call.customData ?? null,
        purpose: call.purpose ?? null,
        meetingUrl: call.meetingUrl ?? null,
        isPrivate: call.isPrivate ?? false,
        calendarEventId: call.calendarEventId ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: "Gong's unique numeric identifier for the call" },
    title: { type: 'string', description: 'Call title', optional: true },
    url: { type: 'string', description: 'URL to the call in the Gong web app', optional: true },
    scheduled: {
      type: 'string',
      description: 'Scheduled call time in ISO-8601 format',
      optional: true,
    },
    started: { type: 'string', description: 'Recording start time in ISO-8601 format' },
    duration: { type: 'number', description: 'Call duration in seconds' },
    direction: {
      type: 'string',
      description: 'Call direction (Inbound/Outbound)',
      optional: true,
    },
    system: {
      type: 'string',
      description: 'Communication platform used (e.g., Outreach)',
      optional: true,
    },
    scope: {
      type: 'string',
      description: "Call scope: 'Internal', 'External', or 'Unknown'",
      optional: true,
    },
    media: { type: 'string', description: 'Media type (e.g., Video)', optional: true },
    language: {
      type: 'string',
      description: 'Language code in ISO-639-2B format',
      optional: true,
    },
    primaryUserId: {
      type: 'string',
      description: 'Host team member identifier',
      optional: true,
    },
    workspaceId: { type: 'string', description: 'Workspace identifier', optional: true },
    sdrDisposition: {
      type: 'string',
      description: 'SDR disposition classification',
      optional: true,
    },
    clientUniqueId: {
      type: 'string',
      description: 'Call identifier from the origin recording system',
      optional: true,
    },
    customData: {
      type: 'string',
      description: 'Metadata provided during call creation',
      optional: true,
    },
    purpose: { type: 'string', description: 'Call purpose', optional: true },
    meetingUrl: {
      type: 'string',
      description: 'Web conference provider URL',
      optional: true,
    },
    isPrivate: { type: 'boolean', description: 'Whether the call is private' },
    calendarEventId: {
      type: 'string',
      description: 'Calendar event identifier',
      optional: true,
    },
  },
}
