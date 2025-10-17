import { env } from '@/lib/env'
import type { TAFinderParams, TAFinderResponse } from '@/tools/target_audience_finder/types'
import type { ToolConfig } from '@/tools/types'

export const taFinderTool: ToolConfig<TAFinderParams, TAFinderResponse> = {
  id: 'ta_finder_execute',
  name: 'Target Audience Finder',
  description:
    'Execute target audience finding with specified objective, region, and optional supporting objective.',
  version: '1.0.0',

  params: {
    objective: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The main objective',
    },
    region: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The target region',
    },
    supportingObjective: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Supporting objective (optional)',
    },
  },

  request: {
    url: () => {
      return 'https://sim.ltdan.ai/api/workflows/a441ed21-dae4-433c-a853-622d0aadbc10/execute'
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
    body: (params: TAFinderParams) => {
      return {
        Objective: params.objective,
        region: params.region,
        supportingObjective: params.supportingObjective || '',
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
      description: 'The target audience finder analysis results',
    },
  },
}