import type { DSPyPredictParams, DSPyPredictResponse } from '@/tools/dspy/types'
import type { ToolConfig } from '@/tools/types'

export const predictTool: ToolConfig<DSPyPredictParams, DSPyPredictResponse> = {
  id: 'dspy_predict',
  name: 'DSPy Predict',
  description: 'Run a prediction using a self-hosted DSPy program endpoint',
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
    input: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The input text to send to the DSPy program',
    },
    inputField: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Name of the input field expected by the DSPy program (defaults to "text")',
    },
    context: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Additional context to provide to the DSPy program',
    },
    additionalInputs: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Additional key-value pairs to include in the request body',
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
      const inputField = params.inputField || 'text'
      const body: Record<string, unknown> = {
        [inputField]: params.input,
      }

      if (params.context) {
        body.context = params.context
      }

      if (params.additionalInputs) {
        Object.assign(body, params.additionalInputs)
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
        reasoning: outputData.reasoning ?? outputData.rationale ?? null,
        status,
        rawOutput: outputData,
      },
    }
  },

  outputs: {
    answer: {
      type: 'string',
      description: 'The main output/answer from the DSPy program',
    },
    reasoning: {
      type: 'string',
      description: 'The reasoning or rationale behind the answer (if available)',
      optional: true,
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
