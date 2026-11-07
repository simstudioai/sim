import type { JamaGetProjectParams, JamaGetProjectResponse } from '@/tools/jama/types'
import {
  JAMA_PROJECT_PROPERTIES,
  JAMA_RETRY,
  jamaAuthParams,
  jamaData,
  jamaHeaders,
  jamaId,
  jamaOAuth,
  jamaUrl,
  mapJamaProject,
  readJamaEnvelope,
} from '@/tools/jama/utils'
import type { ToolConfig } from '@/tools/types'

export const jamaGetProjectTool: ToolConfig<JamaGetProjectParams, JamaGetProjectResponse> = {
  id: 'jama_get_project',
  name: 'Jama Get Project',
  description: "Get Project in Jama Connect using the connected user's access permissions.",
  version: '1.0.0',
  oauth: jamaOAuth,
  params: {
    ...jamaAuthParams,
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'project ID',
    },
  },
  request: {
    url: (params) =>
      jamaUrl(params.instanceUrl, `/projects/${jamaId(params.projectId, 'projectId')}`, {}),
    method: 'GET',
    headers: jamaHeaders,
    retry: JAMA_RETRY,
    redirectPolicy: () => ({ mode: 'standard', sendCredentialsOnCrossOriginRedirect: false }),
  },
  transformResponse: async (response) => {
    const body = await readJamaEnvelope(response)
    return { success: true, output: { project: mapJamaProject(jamaData(body)) } }
  },
  outputs: {
    project: {
      type: 'object',
      description: 'Get Project result',
      properties: JAMA_PROJECT_PROPERTIES,
    },
  },
}
