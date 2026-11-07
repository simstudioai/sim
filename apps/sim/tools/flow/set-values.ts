import type { FlowEntity } from '@/lib/flow'
import { flowHeaders } from '@/lib/flow'
import type { FlowSetValuesParams, FlowSetValuesResponse } from '@/tools/flow/types'
import {
  assertFlowResponse,
  FLOW_AUTH_PARAMS,
  FLOW_ENTITY_PROPERTIES,
  FLOW_OAUTH,
  FLOW_REDIRECT_POLICY,
  flowUrl,
  flowValueBatch,
  mapFlowEntity,
} from '@/tools/flow/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const flowSetValuesTool: ToolConfig<FlowSetValuesParams, FlowSetValuesResponse> = {
  id: 'flow_set_values',
  name: 'Flow Set Values',
  description:
    'Set 1\u2013100 field values atomically on one branch. Returns each affected entity once in first-touched order.',
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
    branchId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Branch ID; omit or use master for Base',
    },
    updates: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of 1\u2013100 field updates: [{entityId, key, value}]',
    },
  },
  request: {
    url: (params) =>
      flowUrl(
        params,
        `/project/${safeUrlPathSegment(params.projectId, 'projectId')}/entities/values/batch`
      ),
    method: 'PUT',
    headers: flowHeaders,
    redirectPolicy: () => FLOW_REDIRECT_POLICY,
    body: (params) => ({
      updates: flowValueBatch(params.updates),
      branchId: params.branchId?.trim() || undefined,
    }),
  },
  transformResponse: async (response) => {
    assertFlowResponse(response)
    const data = (await response.json()) as FlowEntity[]
    return { success: true, output: { entities: data.map(mapFlowEntity) } }
  },
  outputs: {
    entities: {
      type: 'array',
      items: { type: 'object', properties: FLOW_ENTITY_PROPERTIES },
      description: 'Set Values result',
    },
  },
}
