import type { FlowEntity } from '@/lib/flow'
import { flowHeaders } from '@/lib/flow'
import type { FlowGetEntitiesParams, FlowGetEntitiesResponse } from '@/tools/flow/types'
import {
  assertFlowResponse,
  FLOW_AUTH_PARAMS,
  FLOW_ENTITY_PROPERTIES,
  FLOW_OAUTH,
  FLOW_REDIRECT_POLICY,
  flowIds,
  flowUrl,
  mapFlowEntity,
} from '@/tools/flow/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const flowGetEntitiesTool: ToolConfig<FlowGetEntitiesParams, FlowGetEntitiesResponse> = {
  id: 'flow_get_entities',
  name: 'Flow Get Entities',
  description:
    'Read the full values, relationships, and timestamps of up to 100 Flow entities in one project and branch.',
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
    entityIds: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated entity IDs; up to 100 per read',
    },
  },
  request: {
    url: (params) =>
      flowUrl(
        params,
        `/project/${safeUrlPathSegment(params.projectId, 'projectId')}/entities/${flowIds(
          params.entityIds
        )
          .map((id) => safeUrlPathSegment(id, 'entityIds'))
          .join(',')}`,
        { branch_id: params.branchId?.trim() || undefined, include_metadata: true }
      ),
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
    const data = (await response.json()) as FlowEntity[]
    return { success: true, output: { entities: data.map(mapFlowEntity) } }
  },
  outputs: {
    entities: {
      type: 'array',
      items: { type: 'object', properties: FLOW_ENTITY_PROPERTIES },
      description: 'Get Entities result',
    },
  },
}
