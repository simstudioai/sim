import type { FlowEntity } from '@/lib/flow'
import { flowHeaders } from '@/lib/flow'
import type { FlowAddLinkParams, FlowAddLinkResponse } from '@/tools/flow/types'
import {
  assertFlowResponse,
  FLOW_AUTH_PARAMS,
  FLOW_ENTITY_PROPERTIES,
  FLOW_OAUTH,
  FLOW_REDIRECT_POLICY,
  flowUrl,
  mapFlowEntity,
} from '@/tools/flow/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const flowAddLinkTool: ToolConfig<FlowAddLinkParams, FlowAddLinkResponse> = {
  id: 'flow_add_link',
  name: 'Flow Add Link',
  description: 'Add a downstream relationship between Flow entities on the selected branch.',
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
    entityId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Entity ID returned by Search Entities or List Entities',
    },
    branchId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Branch ID; omit or use master for Base',
    },
    destinationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the downstream entity to link or unlink',
    },
  },
  request: {
    url: (params) =>
      flowUrl(
        params,
        `/project/${safeUrlPathSegment(params.projectId, 'projectId')}/entities/${safeUrlPathSegment(params.entityId, 'entityId')}/links`
      ),
    method: 'POST',
    headers: flowHeaders,
    redirectPolicy: () => FLOW_REDIRECT_POLICY,
    body: (params) => ({
      destinationId: params.destinationId.trim(),
      branchId: params.branchId?.trim() || undefined,
    }),
  },
  transformResponse: async (response) => {
    assertFlowResponse(response)
    const data = (await response.json()) as FlowEntity
    return { success: true, output: { entity: mapFlowEntity(data) } }
  },
  outputs: {
    entity: { type: 'json', properties: FLOW_ENTITY_PROPERTIES, description: 'Add Link result' },
  },
}
