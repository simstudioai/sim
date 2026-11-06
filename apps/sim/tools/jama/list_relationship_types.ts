import type {
  JamaListRelationshipTypesParams,
  JamaListRelationshipTypesResponse,
} from '@/tools/jama/types'
import {
  JAMA_PAGE_INFO_OUTPUT,
  JAMA_RELATIONSHIP_TYPE_PROPERTIES,
  JAMA_RETRY,
  jamaAuthParams,
  jamaHeaders,
  jamaList,
  jamaOAuth,
  jamaPageInfo,
  jamaPagination,
  jamaPaginationParams,
  jamaUrl,
  mapJamaRelationshipType,
  readJamaEnvelope,
} from '@/tools/jama/utils'
import type { ToolConfig } from '@/tools/types'

export const jamaListRelationshipTypesTool: ToolConfig<
  JamaListRelationshipTypesParams,
  JamaListRelationshipTypesResponse
> = {
  id: 'jama_list_relationship_types',
  name: 'Jama List Relationship Types',
  description:
    "List Relationship Types in Jama Connect using the connected user's access permissions.",
  version: '1.0.0',
  oauth: jamaOAuth,
  params: {
    ...jamaAuthParams,
    ...jamaPaginationParams,
  },
  request: {
    url: (params) =>
      jamaUrl(params.instanceUrl, '/relationshiptypes', { ...jamaPagination(params) }),
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
        relationshipTypes: jamaList(body).map(mapJamaRelationshipType),
        pageInfo: jamaPageInfo(body),
      },
    }
  },
  outputs: {
    relationshipTypes: {
      type: 'array',
      description: 'List Relationship Types result',
      items: { type: 'object', properties: JAMA_RELATIONSHIP_TYPE_PROPERTIES },
    },
    pageInfo: JAMA_PAGE_INFO_OUTPUT,
  },
}
