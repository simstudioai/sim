import type { FlowCategory } from '@/lib/flow'
import { flowHeaders } from '@/lib/flow'
import type { FlowGetDataModelParams, FlowGetDataModelResponse } from '@/tools/flow/types'
import {
  assertFlowResponse,
  FLOW_AUTH_PARAMS,
  FLOW_CATEGORY_PROPERTIES,
  FLOW_OAUTH,
  FLOW_REDIRECT_POLICY,
  flowUrl,
  mapFlowCategory,
} from '@/tools/flow/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const flowGetDataModelTool: ToolConfig<FlowGetDataModelParams, FlowGetDataModelResponse> = {
  id: 'flow_get_data_model',
  name: 'Flow Get Data Model',
  description:
    'Read the project categories and field definitions before interpreting values or writing custom fields.',
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
      flowUrl(params, `/project/${safeUrlPathSegment(params.projectId, 'projectId')}/data-model`),
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
    const data = (await response.json()) as FlowCategory[]
    return { success: true, output: { categories: data.map(mapFlowCategory) } }
  },
  outputs: {
    categories: {
      type: 'array',
      items: { type: 'object', properties: FLOW_CATEGORY_PROPERTIES },
      description: 'Get Data Model result',
    },
  },
}
