import type { JamaListRelationshipsParams, JamaListRelationshipsResponse } from '@/tools/jama/types'
import {
  JAMA_PAGE_INFO_OUTPUT,
  JAMA_RELATIONSHIP_PROPERTIES,
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
  mapJamaRelationship,
  readJamaEnvelope,
} from '@/tools/jama/utils'
import type { ToolConfig } from '@/tools/types'

export const jamaListRelationshipsTool: ToolConfig<
  JamaListRelationshipsParams,
  JamaListRelationshipsResponse
> = {
  id: 'jama_list_relationships',
  name: 'Jama List Relationships',
  description: "List Relationships in Jama Connect using the connected user's access permissions.",
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
      jamaUrl(params.instanceUrl, '/relationships', {
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
      output: {
        relationships: jamaList(body).map(mapJamaRelationship),
        pageInfo: jamaPageInfo(body),
      },
    }
  },
  outputs: {
    relationships: {
      type: 'array',
      description: 'List Relationships result',
      items: { type: 'object', properties: JAMA_RELATIONSHIP_PROPERTIES },
    },
    pageInfo: JAMA_PAGE_INFO_OUTPUT,
  },
}
