import { env } from '@/lib/env'
import type { PersuasionSupportEngineParams, PersuasionSupportEngineResponse } from '@/tools/persuasion_support_engine/types'
import type { ToolConfig } from '@/tools/types'

export const persuasionSupportEngineTool: ToolConfig<PersuasionSupportEngineParams, PersuasionSupportEngineResponse> = {
  id: 'persuasion_support_engine_execute',
  name: 'Persuasion Support Engine',
  description:
    'Execute persuasion support analysis with specified objective, supporting objective, target audience, region, and messages.',
  version: '1.0.0',

  params: {
    objective: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The persuasion objective',
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
    messages: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Messages to enhance persuasiveness',
    },
  },

  request: {
    url: () => {
      return 'https://sim.ltdan.ai/api/workflows/49ebf455-defe-422d-b671-585587875639/execute'
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
    body: (params: PersuasionSupportEngineParams) => {
      return {
        region: params.region,
        messages: params.messages,
        targetaudience: params.targetAudience,
        objective: params.objective,
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
      description: 'The persuasion support engine analysis results',
    },
  },
}