import type { FlowProject } from '@/lib/flow'
import { flowHeaders } from '@/lib/flow'
import type { FlowGetProjectParams, FlowGetProjectResponse } from '@/tools/flow/types'
import {
  assertFlowResponse,
  FLOW_AUTH_PARAMS,
  FLOW_OAUTH,
  FLOW_PROJECT_PROPERTIES,
  FLOW_REDIRECT_POLICY,
  flowUrl,
  mapFlowProject,
} from '@/tools/flow/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const flowGetProjectTool: ToolConfig<FlowGetProjectParams, FlowGetProjectResponse> = {
  id: 'flow_get_project',
  name: 'Flow Get Project',
  description: 'Read a Flow project by its UUID.',
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
      flowUrl(params, `/project/${safeUrlPathSegment(params.projectId, 'projectId')}`),
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
    const data = (await response.json()) as FlowProject
    return { success: true, output: { project: mapFlowProject(data) } }
  },
  outputs: {
    project: {
      type: 'json',
      properties: FLOW_PROJECT_PROPERTIES,
      description: 'Get Project result',
    },
  },
}
