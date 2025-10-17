import { env } from '@/lib/env'
import type { FocusGroupParams, FocusGroupResponse } from '@/tools/focus_group/types'
import type { ToolConfig } from '@/tools/types'

export const focusGroupTool: ToolConfig<FocusGroupParams, FocusGroupResponse> = {
  id: 'focus_group_execute',
  name: 'Focus Group Executor',
  description:
    'Execute a focus group analysis with specified objective, region, and target audience parameters.',
  version: '1.0.0',

  params: {
    objective: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The objective of the focus group',
    },
    region: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The target region for the focus group',
    },
    targetAudience: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The target audience for the focus group',
    },
  },

  request: {
    url: () => {
      return 'https://sim.ltdan.ai/api/workflows/5d227314-54ae-409b-aff1-35b62fb30e92/execute'
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
    body: (params: FocusGroupParams) => {
      return {
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
      description: 'The focus group analysis results',
    },
  },
}
