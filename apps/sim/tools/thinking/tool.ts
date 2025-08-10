import type { ThinkingToolParams, ThinkingToolResponse } from '@/tools/thinking/types'
import type { ToolConfig } from '@/tools/types'

export const thinkingTool: ToolConfig<ThinkingToolParams, ThinkingToolResponse> = {
  id: 'thinking_tool',
  name: 'Thinking Tool',
  description:
    'Processes a provided thought/instruction, making it available for subsequent steps.',
  version: '1.0.0',

  params: {
    thought: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description:
        'The thought process or instruction provided by the user in the Thinking Step block.',
    },
  },

  outputs: {
    acknowledgedThought: {
      type: 'string',
      description: 'The thought that was processed and acknowledged',
    },
  },

  // Request configuration for the thinking tool API endpoint
  request: {
    url: '/api/tools/thinking',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: ThinkingToolParams) => ({
      thought: params.thought,
    }),
  },

  // Transform the API response to match our expected format
  transformResponse: async (response: Response): Promise<ThinkingToolResponse> => {
    const data = await response.json()
    return data
  },
}
