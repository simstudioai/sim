import type { ToolConfig } from '../types'
import type { ThinkingToolParams, ThinkingToolResponse } from './types'

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

  // Use directExecution as no external HTTP call is needed
  directExecution: async (params: ThinkingToolParams): Promise<ThinkingToolResponse> => {
    // Simply acknowledge the thought by returning it in the output
    return {
      success: true,
      output: {
        acknowledgedThought: params.thought,
      },
    }
  },

  // Request configuration is not needed due to directExecution, but the type requires it.
  // Provide minimal valid configuration.
  request: {
    url: '', // Not used
    method: 'POST', // Not used
    headers: () => ({}), // Not used
  },
}
