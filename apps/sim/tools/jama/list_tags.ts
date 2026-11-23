import type { JamaListTagsParams, JamaListTagsResponse } from '@/tools/jama/types'
import {
  JAMA_PAGE_INFO_OUTPUT,
  JAMA_RETRY,
  JAMA_TAG_PROPERTIES,
  jamaAuthParams,
  jamaHeaders,
  jamaId,
  jamaList,
  jamaOAuth,
  jamaPageInfo,
  jamaPagination,
  jamaPaginationParams,
  jamaUrl,
  mapJamaTag,
  readJamaEnvelope,
} from '@/tools/jama/utils'
import type { ToolConfig } from '@/tools/types'

export const jamaListTagsTool: ToolConfig<JamaListTagsParams, JamaListTagsResponse> = {
  id: 'jama_list_tags',
  name: 'Jama List Tags',
  description: "List Tags in Jama Connect using the connected user's access permissions.",
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
      jamaUrl(params.instanceUrl, '/tags', {
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
      output: { tags: jamaList(body).map(mapJamaTag), pageInfo: jamaPageInfo(body) },
    }
  },
  outputs: {
    tags: {
      type: 'array',
      description: 'List Tags result',
      items: { type: 'object', properties: JAMA_TAG_PROPERTIES },
    },
    pageInfo: JAMA_PAGE_INFO_OUTPUT,
  },
}
