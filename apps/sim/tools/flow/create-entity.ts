import type { FlowEntity } from '@/lib/flow'
import { flowHeaders } from '@/lib/flow'
import type { FlowCreateEntityParams, FlowCreateEntityResponse } from '@/tools/flow/types'
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

export const flowCreateEntityTool: ToolConfig<FlowCreateEntityParams, FlowCreateEntityResponse> = {
  id: 'flow_create_entity',
  name: 'Flow Create Entity',
  description:
    'Create an entity in a category on the selected branch. Branch protection and the connected user permissions remain enforced.',
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
    entityType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Category ID returned by Get Data Model',
    },
    name: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Entity name' },
  },
  request: {
    url: (params) =>
      flowUrl(params, `/project/${safeUrlPathSegment(params.projectId, 'projectId')}/entities`),
    method: 'POST',
    headers: flowHeaders,
    redirectPolicy: () => FLOW_REDIRECT_POLICY,
    body: (params) => ({
      entityType: params.entityType.trim(),
      name: params.name,
      branchId: params.branchId?.trim() || undefined,
    }),
  },
  transformResponse: async (response) => {
    assertFlowResponse(response)
    const data = (await response.json()) as FlowEntity
    return { success: true, output: { entity: mapFlowEntity(data) } }
  },
  outputs: {
    entity: {
      type: 'json',
      properties: FLOW_ENTITY_PROPERTIES,
      description: 'Create Entity result',
    },
  },
}
