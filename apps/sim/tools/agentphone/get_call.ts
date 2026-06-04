import type {
  AgentPhoneGetCallParams,
  AgentPhoneGetCallResult,
  AgentPhoneTranscriptTurn,
} from '@/tools/agentphone/types'
import type { ToolConfig } from '@/tools/types'

export const agentphoneGetCallTool: ToolConfig<AgentPhoneGetCallParams, AgentPhoneGetCallResult> = {
  id: 'agentphone_get_call',
  name: 'Get Call',
  description: 'Fetch a call and its full transcript',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AgentPhone API key',
    },
    callId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the call to retrieve',
    },
  },

  request: {
    url: (params) => `https://api.agentphone.to/v1/calls/${params.callId.trim()}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response): Promise<AgentPhoneGetCallResult> => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        error: data?.detail?.[0]?.msg ?? data?.message ?? 'Failed to fetch call',
        output: {
          id: '',
          agentId: null,
          phoneNumberId: null,
          phoneNumber: null,
          fromNumber: '',
          toNumber: '',
          direction: '',
          status: '',
          startedAt: null,
          endedAt: null,
          durationSeconds: null,
          lastTranscriptSnippet: null,
          recordingUrl: null,
          recordingAvailable: null,
          transcripts: [],
        },
      }
    }

    const transcripts: AgentPhoneTranscriptTurn[] = (data.transcripts ?? []).map(
      (turn: Record<string, unknown>) => ({
        id: (turn.id as string) ?? '',
        transcript: (turn.transcript as string) ?? '',
        confidence: (turn.confidence as number | null) ?? null,
        response: (turn.response as string | null) ?? null,
        createdAt: (turn.createdAt as string) ?? '',
      })
    )

    return {
      success: true,
      output: {
        id: data.id ?? '',
        agentId: data.agentId ?? null,
        phoneNumberId: data.phoneNumberId ?? null,
        phoneNumber: data.phoneNumber ?? null,
        fromNumber: data.fromNumber ?? '',
        toNumber: data.toNumber ?? '',
        direction: data.direction ?? '',
        status: data.status ?? '',
        startedAt: data.startedAt ?? null,
        endedAt: data.endedAt ?? null,
        durationSeconds: data.durationSeconds ?? null,
        lastTranscriptSnippet: data.lastTranscriptSnippet ?? null,
        recordingUrl: data.recordingUrl ?? null,
        recordingAvailable: data.recordingAvailable ?? null,
        transcripts,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Call ID' },
    agentId: { type: 'string', description: 'Agent that handled the call', optional: true },
    phoneNumberId: { type: 'string', description: 'Phone number ID', optional: true },
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
    durationSeconds: { type: 'number', description: 'Call duration in seconds', optional: true },
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
    transcripts: {
      type: 'array',
      description: 'Ordered transcript turns for the call',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Transcript turn ID' },
          transcript: { type: 'string', description: 'User utterance' },
          confidence: {
            type: 'number',
            description: 'Speech recognition confidence',
            optional: true,
          },
          response: {
            type: 'string',
            description: 'Agent response (when available)',
            optional: true,
          },
          createdAt: { type: 'string', description: 'ISO 8601 timestamp' },
        },
      },
    },
  },
}
