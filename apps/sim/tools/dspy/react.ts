import type { DSPyReActParams, DSPyReActResponse } from '@/tools/dspy/types'
import { parseTrajectory } from '@/tools/dspy/utils'
import type { ToolConfig } from '@/tools/types'

export const reactTool: ToolConfig<DSPyReActParams, DSPyReActResponse> = {
  id: 'dspy_react',
  name: 'DSPy ReAct',
  description:
    'Run a ReAct agent using a self-hosted DSPy ReAct program endpoint for multi-step reasoning and action',
  version: '1.0.0',

  params: {
    baseUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Base URL of the DSPy server (e.g., https://your-dspy-server.com)',
    },
    apiKey: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'API key for authentication (if required by your server)',
    },
    endpoint: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'API endpoint path (defaults to /predict)',
    },
    task: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The task or question for the ReAct agent to work on',
    },
    context: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Additional context to provide for the task',
    },
    maxIterations: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Maximum number of reasoning iterations (defaults to server setting)',
    },
  },

  request: {
    method: 'POST',
    url: (params) => {
      const baseUrl = params.baseUrl.replace(/\/$/, '')
      const endpoint = params.endpoint || '/predict'
      return `${baseUrl}${endpoint}`
    },
    headers: (params) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (params.apiKey) {
        headers.Authorization = `Bearer ${params.apiKey}`
      }
      return headers
    },
    body: (params) => {
      const body: Record<string, unknown> = {
        text: params.task,
      }

      if (params.context) {
        body.context = params.context
      }

      if (params.maxIterations !== undefined) {
        body.max_iters = params.maxIterations
      }

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    const status = data.status ?? 'success'
    const outputData = data.data ?? data

    const rawTrajectory = outputData.trajectory ?? {}
    const trajectory = Array.isArray(rawTrajectory)
      ? rawTrajectory.map((step: Record<string, unknown>) => ({
          thought: (step.thought as string) ?? (step.reasoning as string) ?? '',
          toolName: (step.tool_name as string) ?? (step.selected_fn as string) ?? '',
          toolArgs:
            (step.tool_args as Record<string, unknown>) ??
            (step.args as Record<string, unknown>) ??
            {},
          observation: step.observation !== undefined ? String(step.observation) : null,
        }))
      : parseTrajectory(rawTrajectory)

    return {
      success: true,
      output: {
        answer:
          outputData.answer ??
          outputData.process_result ??
          outputData.output ??
          outputData.response ??
          '',
        reasoning: outputData.reasoning ?? null,
        trajectory,
        status,
        rawOutput: outputData,
      },
    }
  },

  outputs: {
    answer: {
      type: 'string',
      description: 'The final answer or result from the ReAct agent',
    },
    reasoning: {
      type: 'string',
      description: 'The overall reasoning summary from the agent',
      optional: true,
    },
    trajectory: {
      type: 'array',
      description: 'The step-by-step trajectory of thoughts, actions, and observations',
      items: {
        type: 'object',
        properties: {
          thought: { type: 'string', description: 'The reasoning thought at this step' },
          toolName: { type: 'string', description: 'The name of the tool/action called' },
          toolArgs: { type: 'json', description: 'Arguments passed to the tool' },
          observation: {
            type: 'string',
            description: 'The observation/result from the tool execution',
            optional: true,
          },
        },
      },
    },
    status: {
      type: 'string',
      description: 'Response status from the DSPy server (success or error)',
    },
    rawOutput: {
      type: 'json',
      description: 'The complete raw output from the DSPy program (result.toDict())',
    },
  },
}
