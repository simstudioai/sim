import type { ConvexFunctionCallParams, ConvexFunctionCallResponse } from '@/tools/convex/types'
import {
  convexApiUrl,
  convexAuthHeaders,
  parseFunctionArgs,
  transformFunctionCallResponse,
} from '@/tools/convex/utils'
import type { ToolConfig } from '@/tools/types'

export const runFunctionTool: ToolConfig<ConvexFunctionCallParams, ConvexFunctionCallResponse> = {
  id: 'convex_run_function',
  name: 'Convex Run Function',
  description:
    'Run any Convex function (query, mutation, or action) by path without specifying its type',
  version: '1.0.0',

  params: {
    deploymentUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Convex deployment URL (e.g., https://your-deployment.convex.cloud)',
    },
    deployKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Convex deploy key from the dashboard Settings page',
    },
    functionPath: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Path to the function (e.g., messages:list or folder/file:myFunction)',
    },
    args: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Named arguments to pass to the function as a JSON object',
    },
  },

  request: {
    url: (params) => {
      const identifier = params.functionPath
        .trim()
        .replace(':', '/')
        .split('/')
        .map(encodeURIComponent)
        .join('/')
      return convexApiUrl(params.deploymentUrl, `/api/run/${identifier}`)
    },
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      ...convexAuthHeaders(params.deployKey),
    }),
    body: (params) => ({
      args: parseFunctionArgs(params.args),
      format: 'json',
    }),
  },

  transformResponse: async (response: Response) =>
    transformFunctionCallResponse(response, 'function'),

  outputs: {
    value: { type: 'json', description: 'Result returned by the function' },
    logLines: {
      type: 'array',
      description: 'Log lines printed during the function execution',
      items: { type: 'string' },
    },
  },
}
