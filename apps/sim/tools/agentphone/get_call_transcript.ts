import type {
  AgentPhoneGetCallTranscriptParams,
  AgentPhoneGetCallTranscriptResult,
  AgentPhoneTranscriptEntry,
} from '@/tools/agentphone/types'
import type { ToolConfig } from '@/tools/types'

export const agentphoneGetCallTranscriptTool: ToolConfig<
  AgentPhoneGetCallTranscriptParams,
  AgentPhoneGetCallTranscriptResult
> = {
  id: 'agentphone_get_call_transcript',
  name: 'Get Call Transcript',
  description: 'Get the full ordered transcript for a call',
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
      description: 'ID of the call to retrieve the transcript for',
    },
  },

  request: {
    url: (params) => `https://api.agentphone.to/v1/calls/${params.callId.trim()}/transcript`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response, params): Promise<AgentPhoneGetCallTranscriptResult> => {
    const data = await response.json()
    const callId = params?.callId?.trim() ?? ''

    if (!response.ok) {
      return {
        success: false,
        error: data?.detail?.[0]?.msg ?? data?.message ?? 'Failed to fetch transcript',
        output: { callId, transcript: [] },
      }
    }

    const rawTurns = Array.isArray(data?.transcript)
      ? data.transcript
      : Array.isArray(data)
        ? data
        : []

    const transcript: AgentPhoneTranscriptEntry[] = rawTurns.map(
      (turn: Record<string, unknown>) => ({
        role: (turn.role as string) ?? '',
        content: (turn.content as string) ?? '',
        createdAt: (turn.createdAt as string) ?? (turn.created_at as string) ?? null,
      })
    )

    return {
      success: true,
      output: { callId: data?.callId ?? callId, transcript },
    }
  },

  outputs: {
    callId: { type: 'string', description: 'Call ID' },
    transcript: {
      type: 'array',
      description: 'Ordered transcript turns for the call',
      items: {
        type: 'object',
        properties: {
          role: {
            type: 'string',
            description: 'Speaker role (user or agent)',
          },
          content: { type: 'string', description: 'Turn content' },
          createdAt: {
            type: 'string',
            description: 'ISO 8601 timestamp',
            optional: true,
          },
        },
      },
    },
  },
}
