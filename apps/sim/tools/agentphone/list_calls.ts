import type {
  AgentPhoneCallSummary,
  AgentPhoneListCallsParams,
  AgentPhoneListCallsResult,
} from '@/tools/agentphone/types'
import type { ToolConfig } from '@/tools/types'

export const agentphoneListCallsTool: ToolConfig<
  AgentPhoneListCallsParams,
  AgentPhoneListCallsResult
> = {
  id: 'agentphone_list_calls',
  name: 'List Calls',
  description: 'List voice calls for this AgentPhone account',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AgentPhone API key',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to return (default 20, max 100)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to skip (min 0)',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by status (completed, in-progress, failed)',
    },
    direction: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by direction (inbound, outbound)',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by call type (pstn, web)',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search by phone number (matches fromNumber or toNumber)',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (typeof params.limit === 'number') query.set('limit', String(params.limit))
      if (typeof params.offset === 'number') query.set('offset', String(params.offset))
      if (params.status) query.set('status', params.status)
      if (params.direction) query.set('direction', params.direction)
      if (params.type) query.set('type', params.type)
      if (params.search) query.set('search', params.search)
      const qs = query.toString()
      return `https://api.agentphone.to/v1/calls${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response): Promise<AgentPhoneListCallsResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data?.detail?.[0]?.msg ?? data?.message ?? 'Failed to list calls',
        output: { data: [], hasMore: false, total: 0 },
      }
    }

    return {
      success: true,
      output: {
        data: (data.data ?? []).map(
          (call: Record<string, unknown>): AgentPhoneCallSummary => ({
            id: (call.id as string) ?? '',
            agentId: (call.agentId as string | null) ?? null,
            phoneNumberId: (call.phoneNumberId as string | null) ?? null,
            phoneNumber: (call.phoneNumber as string | null) ?? null,
            fromNumber: (call.fromNumber as string) ?? '',
            toNumber: (call.toNumber as string) ?? '',
            direction: (call.direction as string) ?? '',
            status: (call.status as string) ?? '',
            startedAt: (call.startedAt as string | null) ?? null,
            endedAt: (call.endedAt as string | null) ?? null,
            durationSeconds: (call.durationSeconds as number | null) ?? null,
            lastTranscriptSnippet: (call.lastTranscriptSnippet as string | null) ?? null,
            recordingUrl: (call.recordingUrl as string | null) ?? null,
            recordingAvailable: (call.recordingAvailable as boolean | null) ?? null,
          })
        ),
        hasMore: data.hasMore ?? false,
        total: data.total ?? 0,
      },
    }
  },

  outputs: {
    data: {
      type: 'array',
      description: 'Calls',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Call ID' },
          agentId: {
            type: 'string',
            description: 'Agent that handled the call',
            optional: true,
          },
          phoneNumberId: {
            type: 'string',
            description: 'Phone number ID used for the call',
            optional: true,
          },
          phoneNumber: {
            type: 'string',
            description: 'Phone number used for the call',
            optional: true,
          },
          fromNumber: { type: 'string', description: 'Caller phone number' },
          toNumber: { type: 'string', description: 'Recipient phone number' },
          direction: { type: 'string', description: 'inbound or outbound', optional: true },
          status: { type: 'string', description: 'Call status' },
          startedAt: { type: 'string', description: 'ISO 8601 timestamp', optional: true },
          endedAt: { type: 'string', description: 'ISO 8601 timestamp', optional: true },
          durationSeconds: {
            type: 'number',
            description: 'Call duration in seconds',
            optional: true,
          },
          lastTranscriptSnippet: {
            type: 'string',
            description: 'Last transcript snippet',
            optional: true,
          },
          recordingUrl: { type: 'string', description: 'Recording audio URL', optional: true },
          recordingAvailable: {
            type: 'boolean',
            description: 'Whether a recording is available',
            optional: true,
          },
        },
      },
    },
    hasMore: { type: 'boolean', description: 'Whether more results are available' },
    total: { type: 'number', description: 'Total number of matching calls' },
  },
}
