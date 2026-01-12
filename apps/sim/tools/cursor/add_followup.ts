import type { AddFollowupParams, AddFollowupResponse } from '@/tools/cursor/types'
import type { ToolConfig } from '@/tools/types'

const addFollowupBase = {
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cursor API key',
    },
    agentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique identifier for the cloud agent (e.g., bc_abc123)',
    },
    followupPromptText: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The follow-up instruction text for the agent',
    },
    promptImages: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON array of image objects with base64 data and dimensions (max 5)',
    },
  },
  request: {
    url: (params: AddFollowupParams) =>
      `https://api.cursor.com/v0/agents/${params.agentId}/followup`,
    method: 'POST',
    headers: (params: AddFollowupParams) => ({
      'Content-Type': 'application/json',
      Authorization: `Basic ${Buffer.from(`${params.apiKey}:`).toString('base64')}`,
    }),
    body: (params: AddFollowupParams) => {
      const body: Record<string, any> = {
        prompt: {
          text: params.followupPromptText,
        },
      }

      if (params.promptImages) {
        try {
          body.prompt.images = JSON.parse(params.promptImages)
        } catch {
          body.prompt.images = []
        }
      }

      return body
    },
  },
} satisfies Pick<ToolConfig<AddFollowupParams, any>, 'params' | 'request'>

export const addFollowupTool: ToolConfig<AddFollowupParams, AddFollowupResponse> = {
  id: 'cursor_add_followup',
  name: 'Cursor Add Follow-up',
  description: 'Add a follow-up instruction to an existing cloud agent.',
  version: '1.0.0',

  ...addFollowupBase,

  transformResponse: async (response) => {
    const data = await response.json()

    const content = `Follow-up added to agent ${data.id}`

    return {
      success: true,
      output: {
        content,
        metadata: {
          id: data.id,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Success message' },
    metadata: {
      type: 'object',
      description: 'Result metadata',
      properties: {
        id: { type: 'string', description: 'Agent ID' },
      },
    },
  },
}

interface AddFollowupV2Response {
  success: boolean
  output: {
    id: string
  }
}

export const addFollowupV2Tool: ToolConfig<AddFollowupParams, AddFollowupV2Response> = {
  ...addFollowupBase,
  id: 'cursor_add_followup_v2',
  name: 'Cursor Add Follow-up',
  description:
    'Add a follow-up instruction to an existing cloud agent. Returns API-aligned fields only.',
  version: '2.0.0',
  transformResponse: async (response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        id: data.id,
      },
    }
  },
  outputs: {
    id: { type: 'string', description: 'Agent ID' },
  },
}
