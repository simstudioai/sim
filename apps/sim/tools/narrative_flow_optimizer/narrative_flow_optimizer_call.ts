import { env } from '@/lib/env'
import type { NarrativeFlowOptimizerParams, NarrativeFlowOptimizerResponse } from '@/tools/narrative_flow_optimizer/types'
import type { ToolConfig } from '@/tools/types'

export const narrativeFlowOptimizerTool: ToolConfig<NarrativeFlowOptimizerParams, NarrativeFlowOptimizerResponse> = {
  id: 'narrative_flow_optimizer_execute',
  name: 'Narrative Flow Optimizer',
  description:
    'Execute narrative flow optimization with specified objective, supporting objective, target audience, region, and narrative content.',
  version: '1.0.0',

  params: {
    objective: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The optimization objective',
    },
    supportingObjective: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Supporting objective (optional)',
    },
    targetAudience: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The target audience',
    },
    region: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The target region',
    },
    narrative: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Narrative content to optimize',
    },
  },

  request: {
    url: () => {
      return 'https://sim.ltdan.ai/api/workflows/6a446141-ce3b-4913-9a37-5921153ab690/execute'
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
    body: (params: NarrativeFlowOptimizerParams) => {
      return {
        targetaudience: params.targetAudience,
        narrative: params.narrative,
        supportingObjective: params.supportingObjective || '',
        objective: params.objective,
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
      description: 'The narrative flow optimization analysis results',
    },
  },
}