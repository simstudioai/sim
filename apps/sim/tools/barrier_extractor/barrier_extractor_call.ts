import { env } from '@/lib/env'
import type { BarrierExtractorParams, BarrierExtractorResponse } from '@/tools/barrier_extractor/types'
import type { ToolConfig } from '@/tools/types'

export const barrierExtractorTool: ToolConfig<BarrierExtractorParams, BarrierExtractorResponse> = {
  id: 'barrier_extractor_execute',
  name: 'Barrier Extractor',
  description:
    'Execute barrier extraction with specified objective, region, and target audience.',
  version: '1.0.0',

  params: {
    objective: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The objective to analyze barriers for',
    },
    region: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The target region',
    },
    targetAudience: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The target audience',
    },
  },

  request: {
    url: () => {
      return 'https://sim.ltdan.ai/api/workflows/8ec91a79-fe1d-45ec-a2cf-114593ec02b9/execute'
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
    body: (params: BarrierExtractorParams) => {
      return {
        objective: params.objective,
        targetaudience: params.targetAudience,
        region: params.region,
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
      description: 'The barrier extraction analysis results',
    },
  },
}