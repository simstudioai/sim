import type { ThinkingToolParams, ThinkingToolResponse } from '@/tools/thinking/types'
import type { InternalToolConfig } from '@/tools/types'

export const thinkingTool: InternalToolConfig<ThinkingToolParams, ThinkingToolResponse> = {
  id: 'thinking_tool',
  name: 'Thinking Tool',
  description:
    'Processes a provided thought/instruction, making it available for subsequent steps.',
  version: '1.0.0',

  params: {
    thought: {
      type: 'string',
      required: true,
      visibility: 'llm-only',
      description:
        'Your internal reasoning, analysis, or thought process. Use this to think through the problem step by step before responding.',
    },
  },

  operation: {
    input: (params: ThinkingToolParams) => ({
      thought: params.thought,
    }),
  },

  transformResponse: async (response: Response): Promise<ThinkingToolResponse> => {
    const data = await response.json()
    return data
  },

  outputs: {
    acknowledgedThought: {
      type: 'string',
      description: 'The thought that was processed and acknowledged',
    },
  },
}
