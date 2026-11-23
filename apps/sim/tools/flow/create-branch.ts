import { flowHeaders } from '@/lib/flow'
import type { FlowCreateBranchParams, FlowCreateBranchResponse } from '@/tools/flow/types'
import {
  assertFlowResponse,
  FLOW_AUTH_PARAMS,
  FLOW_OAUTH,
  FLOW_REDIRECT_POLICY,
  flowUrl,
} from '@/tools/flow/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const flowCreateBranchTool: ToolConfig<FlowCreateBranchParams, FlowCreateBranchResponse> = {
  id: 'flow_create_branch',
  name: 'Flow Create Branch',
  description:
    'Create a working branch before modifying requirements, tests, or other project entities.',
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
    branchName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name of the new branch',
    },
    parentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Parent branch ID; omit for Base',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of the new branch',
    },
    isVariant: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Create a variant branch',
    },
  },
  request: {
    url: (params) =>
      flowUrl(params, `/project/${safeUrlPathSegment(params.projectId, 'projectId')}/branch`),
    method: 'POST',
    headers: flowHeaders,
    redirectPolicy: () => FLOW_REDIRECT_POLICY,
    body: (params) => ({
      name: params.branchName,
      parent_id: params.parentId?.trim() || undefined,
      description: params.description,
      is_variant: params.isVariant,
    }),
  },
  transformResponse: async (response) => {
    assertFlowResponse(response)
    const data = (await response.json()) as { id: string; number: number }
    return { success: true, output: { id: data.id, number: data.number } }
  },
  outputs: {
    id: { type: 'string', description: 'Created branch ID' },
    number: { type: 'number', description: 'Assigned branch number' },
  },
}
