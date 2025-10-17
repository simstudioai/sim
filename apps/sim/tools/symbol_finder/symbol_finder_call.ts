import { env } from '@/lib/env'
import type { SymbolFinderParams, SymbolFinderResponse } from '@/tools/symbol_finder/types'
import type { ToolConfig } from '@/tools/types'

export const symbolFinderTool: ToolConfig<SymbolFinderParams, SymbolFinderResponse> = {
  id: 'symbol_finder_execute',
  name: 'Symbol Finder',
  description:
    'Execute symbol finding with specified objective, region, and target audience.',
  version: '1.0.0',

  params: {
    objective: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The objective of the symbol finding',
    },
    region: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The target region for symbol finding',
    },
    targetAudience: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The target audience for symbol finding',
    },
  },

  request: {
    url: () => {
      return 'https://sim.ltdan.ai/api/workflows/d1eabe94-218a-49d6-9db5-cf42d87307c0/execute'
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
    body: (params: SymbolFinderParams) => {
      return {
        objective: params.objective,
        region: params.region,
        targetaudience: params.targetAudience,
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
      description: 'The symbol finder analysis results',
    },
  },
}