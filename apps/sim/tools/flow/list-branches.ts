import type { FlowBranch } from '@/lib/flow'
import { flowHeaders } from '@/lib/flow'
import type { FlowListBranchesParams, FlowListBranchesResponse } from '@/tools/flow/types'
import {
  assertFlowResponse,
  FLOW_AUTH_PARAMS,
  FLOW_BRANCH_PROPERTIES,
  FLOW_OAUTH,
  FLOW_REDIRECT_POLICY,
  flowUrl,
  mapFlowBranch,
} from '@/tools/flow/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const flowListBranchesTool: ToolConfig<FlowListBranchesParams, FlowListBranchesResponse> = {
  id: 'flow_list_branches',
  name: 'Flow List Branches',
  description: 'List the Flow project branches and their review and protection state.',
  version: '1.0.0',
  oauth: FLOW_OAUTH,
  params: {
    ...FLOW_AUTH_PARAMS,
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project UUID returned by List Projects',
    },
  },
  request: {
    url: (params) =>
      flowUrl(params, `/project/${safeUrlPathSegment(params.projectId, 'projectId')}/branch`),
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
    const data = (await response.json()) as FlowBranch[]
    return { success: true, output: { branches: data.map(mapFlowBranch) } }
  },
  outputs: {
    branches: {
      type: 'array',
      items: { type: 'object', properties: FLOW_BRANCH_PROPERTIES },
      description: 'List Branches result',
    },
  },
}
