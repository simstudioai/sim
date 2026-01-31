import type { DSPyChainOfThoughtParams, DSPyChainOfThoughtResponse } from '@/tools/dspy/types'
import type { ToolConfig } from '@/tools/types'

export const chainOfThoughtTool: ToolConfig<DSPyChainOfThoughtParams, DSPyChainOfThoughtResponse> =
  {
    id: 'dspy_chain_of_thought',
    name: 'DSPy Chain of Thought',
    description:
      'Run a Chain of Thought prediction using a self-hosted DSPy ChainOfThought program endpoint',
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
      question: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The question to answer using chain of thought reasoning',
      },
      context: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Additional context to provide for answering the question',
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
          text: params.question,
        }

        if (params.context) {
          body.context = params.context
        }

        return body
      },
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()

      const status = data.status ?? 'success'
      const outputData = data.data ?? data

      return {
        success: true,
        output: {
          answer: outputData.answer ?? outputData.output ?? outputData.response ?? '',
          reasoning: outputData.reasoning ?? outputData.rationale ?? outputData.thought ?? '',
          status,
          rawOutput: outputData,
        },
      }
    },

    outputs: {
      answer: {
        type: 'string',
        description: 'The answer generated through chain of thought reasoning',
      },
      reasoning: {
        type: 'string',
        description: 'The step-by-step reasoning that led to the answer',
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
