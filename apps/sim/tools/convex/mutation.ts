import type { ConvexFunctionCallParams, ConvexFunctionCallResponse } from '@/tools/convex/types'
import {
  convexApiUrl,
  convexAuthHeaders,
  parseFunctionArgs,
  transformFunctionCallResponse,
} from '@/tools/convex/utils'
import type { ToolConfig } from '@/tools/types'

export const mutationTool: ToolConfig<ConvexFunctionCallParams, ConvexFunctionCallResponse> = {
  id: 'convex_mutation',
  name: 'Convex Run Mutation',
  description: 'Run a Convex mutation function to write data and return its result',
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
      description: 'Path to the mutation function (e.g., messages:send or folder/file:myMutation)',
    },
    args: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Named arguments to pass to the function as a JSON object',
    },
  },

  request: {
    url: (params) => convexApiUrl(params.deploymentUrl, '/api/mutation'),
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      ...convexAuthHeaders(params.deployKey),
    }),
    body: (params) => ({
      path: params.functionPath.trim(),
      args: parseFunctionArgs(params.args),
      format: 'json',
    }),
  },

  transformResponse: async (response: Response) =>
    transformFunctionCallResponse(response, 'mutation'),

  outputs: {
    value: { type: 'json', description: 'Result returned by the mutation function' },
    logLines: {
      type: 'array',
      description: 'Log lines printed during the function execution',
      items: { type: 'string' },
    },
  },
}
