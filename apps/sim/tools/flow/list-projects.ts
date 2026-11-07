import type { FlowProject } from '@/lib/flow'
import { flowHeaders } from '@/lib/flow'
import type { FlowListProjectsParams, FlowListProjectsResponse } from '@/tools/flow/types'
import {
  assertFlowResponse,
  FLOW_AUTH_PARAMS,
  FLOW_OAUTH,
  FLOW_PROJECT_PROPERTIES,
  FLOW_REDIRECT_POLICY,
  flowLimit,
  flowUrl,
  mapFlowProject,
} from '@/tools/flow/utils'
import type { ToolConfig } from '@/tools/types'

export const flowListProjectsTool: ToolConfig<FlowListProjectsParams, FlowListProjectsResponse> = {
  id: 'flow_list_projects',
  name: 'Flow List Projects',
  description:
    'List projects accessible to the connected Flow user. The API returns up to the requested limit without a continuation cursor.',
  version: '1.0.0',
  oauth: FLOW_OAUTH,
  params: {
    ...FLOW_AUTH_PARAMS,
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum results in this page',
    },
  },
  request: {
    url: (params) => flowUrl(params, `/project`, { limit: flowLimit(params.limit, 1000, 100) }),
    method: 'GET',
    headers: flowHeaders,
    redirectPolicy: () => FLOW_REDIRECT_POLICY,
    retry: {
      enabled: true,
      maxRetries: 2,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
      retryIdempotentOnly: true,
    },
  },
  transformResponse: async (response) => {
    assertFlowResponse(response)
    const data = (await response.json()) as FlowProject[]
    return { success: true, output: { projects: data.map(mapFlowProject) } }
  },
  outputs: {
    projects: {
      type: 'array',
      items: { type: 'object', properties: FLOW_PROJECT_PROPERTIES },
      description: 'List Projects result',
    },
  },
}
