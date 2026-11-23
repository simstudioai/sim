import type { FlowEntity } from '@/lib/flow'
import { flowHeaders } from '@/lib/flow'
import type { FlowSetValueParams, FlowSetValueResponse } from '@/tools/flow/types'
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

export const flowSetValueTool: ToolConfig<FlowSetValueParams, FlowSetValueResponse> = {
  id: 'flow_set_value',
  name: 'Flow Set Value',
  description:
    'Set one field on a Flow entity using a key from the data model and a JSON value of the documented field type.',
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
    fieldKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Stored field key returned by Get Data Model',
    },
    value: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON-encoded field value matching the data model. Use "text" for a string, 123 for a number, true or false for a boolean, an array or object, or null to clear the field. Use "" for an empty string.',
    },
  },
  request: {
    url: (params) =>
      flowUrl(
        params,
        `/project/${safeUrlPathSegment(params.projectId, 'projectId')}/entities/${safeUrlPathSegment(params.entityId, 'entityId')}/values`
      ),
    method: 'PUT',
    headers: flowHeaders,
    redirectPolicy: () => FLOW_REDIRECT_POLICY,
    body: (params) => {
      const key = params.fieldKey.trim()
      if (!key) throw new Error('Field key is required')
      if (typeof params.value !== 'string') throw new Error('Value must be JSON text')
      let value: unknown
      try {
        value = JSON.parse(params.value)
      } catch {
        throw new Error('Value must be valid JSON; wrap text values in double quotes')
      }
      return {
        key,
        value,
        branchId: params.branchId?.trim() || undefined,
      }
    },
  },
  transformResponse: async (response) => {
    assertFlowResponse(response)
    const data = (await response.json()) as FlowEntity
    return { success: true, output: { entity: mapFlowEntity(data) } }
  },
  outputs: {
    entity: { type: 'json', properties: FLOW_ENTITY_PROPERTIES, description: 'Set Value result' },
  },
}
