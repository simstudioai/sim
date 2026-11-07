import type { JamaListReleasesParams, JamaListReleasesResponse } from '@/tools/jama/types'
import {
  JAMA_PAGE_INFO_OUTPUT,
  JAMA_RELEASE_PROPERTIES,
  JAMA_RETRY,
  jamaAuthParams,
  jamaHeaders,
  jamaId,
  jamaList,
  jamaOAuth,
  jamaPageInfo,
  jamaPagination,
  jamaPaginationParams,
  jamaUrl,
  mapJamaRelease,
  readJamaEnvelope,
} from '@/tools/jama/utils'
import type { ToolConfig } from '@/tools/types'

export const jamaListReleasesTool: ToolConfig<JamaListReleasesParams, JamaListReleasesResponse> = {
  id: 'jama_list_releases',
  name: 'Jama List Releases',
  description: "List Releases in Jama Connect using the connected user's access permissions.",
  version: '1.0.0',
  oauth: jamaOAuth,
  params: {
    ...jamaAuthParams,
    ...jamaPaginationParams,
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'project ID',
    },
  },
  request: {
    url: (params) =>
      jamaUrl(params.instanceUrl, '/releases', {
        ...jamaPagination(params),
        project: jamaId(params.projectId, 'projectId'),
      }),
    method: 'GET',
    headers: jamaHeaders,
    retry: JAMA_RETRY,
    redirectPolicy: () => ({ mode: 'standard', sendCredentialsOnCrossOriginRedirect: false }),
  },
  transformResponse: async (response) => {
    const body = await readJamaEnvelope(response)
    return {
      success: true,
      output: { releases: jamaList(body).map(mapJamaRelease), pageInfo: jamaPageInfo(body) },
    }
  },
  outputs: {
    releases: {
      type: 'array',
      description: 'List Releases result',
      items: { type: 'object', properties: JAMA_RELEASE_PROPERTIES },
    },
    pageInfo: JAMA_PAGE_INFO_OUTPUT,
  },
}
