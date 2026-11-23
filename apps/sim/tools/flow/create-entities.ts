import type { FlowEntity } from '@/lib/flow'
import { flowHeaders } from '@/lib/flow'
import type { FlowCreateEntitiesParams, FlowCreateEntitiesResponse } from '@/tools/flow/types'
import {
  assertFlowResponse,
  FLOW_AUTH_PARAMS,
  FLOW_ENTITY_PROPERTIES,
  FLOW_OAUTH,
  FLOW_REDIRECT_POLICY,
  flowEntityBatch,
  flowUrl,
  mapFlowEntity,
} from '@/tools/flow/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const flowCreateEntitiesTool: ToolConfig<
  FlowCreateEntitiesParams,
  FlowCreateEntitiesResponse
> = {
  id: 'flow_create_entities',
  name: 'Flow Create Entities',
  description:
    'Create 1\u2013100 entities atomically on a single branch. A timed-out request may already have committed; inspect the branch before retrying.',
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
    entities: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of 1\u2013100 entities: [{entityType, name, id?}]. IDs may be omitted for server generation',
    },
  },
  request: {
    url: (params) =>
      flowUrl(
        params,
        `/project/${safeUrlPathSegment(params.projectId, 'projectId')}/entities/batch`
      ),
    method: 'POST',
    headers: flowHeaders,
    redirectPolicy: () => FLOW_REDIRECT_POLICY,
    body: (params) => ({
      entities: flowEntityBatch(params.entities),
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
      description: 'Create Entities result',
    },
  },
}
