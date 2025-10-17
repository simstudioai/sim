import { env } from '@/lib/env'
import type { SymbolEvaluatorParams, SymbolEvaluatorResponse } from '@/tools/symbol_evaluator/types'
import type { ToolConfig } from '@/tools/types'

export const symbolEvaluatorTool: ToolConfig<SymbolEvaluatorParams, SymbolEvaluatorResponse> = {
  id: 'symbol_evaluator_execute',
  name: 'Symbol Evaluator',
  description:
    'Execute symbol evaluation with specified objective, supporting objective, target audience, region, and symbols.',
  version: '1.0.0',

  params: {
    objective: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The main objective',
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
    symbols: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Symbols to evaluate',
    },
  },

  request: {
    url: () => {
      return 'https://sim.ltdan.ai/api/workflows/9376516b-345d-4c35-b174-f4f3e9d3b2a5/execute'
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
    body: (params: SymbolEvaluatorParams) => {
      return {
        objective: params.objective,
        supportingObjective: params.supportingObjective || '',
        targetaudience: params.targetAudience,
        region: params.region,
        symbols: params.symbols,
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
      description: 'The symbol evaluation analysis results',
    },
  },
}