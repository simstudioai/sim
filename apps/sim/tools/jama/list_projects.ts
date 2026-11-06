import type { JamaListProjectsParams, JamaListProjectsResponse } from '@/tools/jama/types'
import {
  JAMA_PAGE_INFO_OUTPUT,
  JAMA_PROJECT_PROPERTIES,
  JAMA_RETRY,
  jamaAuthParams,
  jamaHeaders,
  jamaList,
  jamaOAuth,
  jamaPageInfo,
  jamaPagination,
  jamaPaginationParams,
  jamaUrl,
  mapJamaProject,
  readJamaEnvelope,
} from '@/tools/jama/utils'
import type { ToolConfig } from '@/tools/types'

export const jamaListProjectsTool: ToolConfig<JamaListProjectsParams, JamaListProjectsResponse> = {
  id: 'jama_list_projects',
  name: 'Jama List Projects',
  description: "List Projects in Jama Connect using the connected user's access permissions.",
  version: '1.0.0',
  oauth: jamaOAuth,
  params: {
    ...jamaAuthParams,
    ...jamaPaginationParams,
  },
  request: {
    url: (params) => jamaUrl(params.instanceUrl, '/projects', { ...jamaPagination(params) }),
    method: 'GET',
    headers: jamaHeaders,
    retry: JAMA_RETRY,
    redirectPolicy: () => ({ mode: 'standard', sendCredentialsOnCrossOriginRedirect: false }),
  },
  transformResponse: async (response) => {
    const body = await readJamaEnvelope(response)
    return {
      success: true,
      output: { projects: jamaList(body).map(mapJamaProject), pageInfo: jamaPageInfo(body) },
    }
  },
  outputs: {
    projects: {
      type: 'array',
      description: 'List Projects result',
      items: { type: 'object', properties: JAMA_PROJECT_PROPERTIES },
    },
    pageInfo: JAMA_PAGE_INFO_OUTPUT,
  },
}
