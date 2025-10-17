import { env } from '@/lib/env'
import type { MessageTesterParams, MessageTesterResponse } from '@/tools/message_tester/types'
import type { ToolConfig } from '@/tools/types'

export const messageTesterTool: ToolConfig<MessageTesterParams, MessageTesterResponse> = {
  id: 'message_tester_execute',
  name: 'Message Tester',
  description:
    'Execute message testing with specified objective, region, target audience, and message content.',
  version: '1.0.0',

  params: {
    objective: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The objective of the message test',
    },
    region: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The target region for the message test',
    },
    targetAudience: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The target audience for the message test',
    },
    message: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The message content to test',
    },
  },

  request: {
    url: () => {
      return 'https://sim.ltdan.ai/api/workflows/5099987b-7e5c-42c9-b5e7-f5bf970c2867/execute'
    },
    method: 'POST',
    headers: () => {
      const apiKey = env.FOCUS_GROUP_API_KEY
      if (!apiKey) {
        throw new Error('FOCUS_GROUP_API_KEY environment variable is required')
      }
      return {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json',
      }
    },
    body: (params: MessageTesterParams) => {
      return {
        message: params.message,
        targetaudience: params.targetAudience,
        region: params.region,
        objective: params.objective,
      }
    },
  },

  transformResponse: async (response: Response) => {
    const content = await response.text()
    return {
      success: response.ok,
      output: {
        content,
      },
    }
  },

  outputs: {
    content: {
      type: 'string',
      description: 'The message testing analysis results',
    },
  },
}