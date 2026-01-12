import type { InsForgeInvokeParams, InsForgeInvokeResponse } from '@/tools/insforge/types'
import type { ToolConfig } from '@/tools/types'

export const invokeTool: ToolConfig<InsForgeInvokeParams, InsForgeInvokeResponse> = {
  id: 'insforge_invoke',
  name: 'InsForge Invoke Function',
  description: 'Invoke a serverless function in InsForge',
  version: '1.0',

  params: {
    baseUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your InsForge backend URL (e.g., https://your-app.insforge.app)',
    },
    functionName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the function to invoke',
    },
    method: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'HTTP method (GET, POST, PUT, DELETE). Default: POST',
    },
    body: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'The request body to send to the function (JSON object)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Your InsForge anon key or service role key',
    },
  },

  request: {
    url: (params) => {
      const base = params.baseUrl.replace(/\/$/, '')
      return `${base}/functions/${params.functionName}`
    },
    method: (params) => (params.method as 'GET' | 'POST' | 'PUT' | 'DELETE') || 'POST',
    headers: (params) => ({
      apikey: params.apiKey,
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => params.body || {},
  },

  transformResponse: async (response: Response) => {
    let data
    try {
      const text = await response.text()
      if (text?.trim()) {
        try {
          data = JSON.parse(text)
        } catch {
          data = { result: text }
        }
      } else {
        data = {}
      }
    } catch (parseError) {
      throw new Error(`Failed to parse InsForge function response: ${parseError}`)
    }

    return {
      success: true,
      output: {
        message: 'Successfully invoked function',
        results: data,
      },
      error: undefined,
    }
  },

  outputs: {
    message: { type: 'string', description: 'Operation status message' },
    results: { type: 'json', description: 'Result returned from the function' },
  },
}
