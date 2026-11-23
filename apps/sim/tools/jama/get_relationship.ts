import type { JamaGetRelationshipParams, JamaGetRelationshipResponse } from '@/tools/jama/types'
import {
  JAMA_RELATIONSHIP_PROPERTIES,
  JAMA_RETRY,
  jamaAuthParams,
  jamaData,
  jamaHeaders,
  jamaId,
  jamaOAuth,
  jamaUrl,
  mapJamaRelationship,
  readJamaEnvelope,
} from '@/tools/jama/utils'
import type { ToolConfig } from '@/tools/types'

export const jamaGetRelationshipTool: ToolConfig<
  JamaGetRelationshipParams,
  JamaGetRelationshipResponse
> = {
  id: 'jama_get_relationship',
  name: 'Jama Get Relationship',
  description: "Get Relationship in Jama Connect using the connected user's access permissions.",
  version: '1.0.0',
  oauth: jamaOAuth,
  params: {
    ...jamaAuthParams,
    relationshipId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'relationship ID',
    },
  },
  request: {
    url: (params) =>
      jamaUrl(
        params.instanceUrl,
        `/relationships/${jamaId(params.relationshipId, 'relationshipId')}`,
        {}
      ),
    method: 'GET',
    headers: jamaHeaders,
    retry: JAMA_RETRY,
    redirectPolicy: () => ({ mode: 'standard', sendCredentialsOnCrossOriginRedirect: false }),
  },
  transformResponse: async (response) => {
    const body = await readJamaEnvelope(response)
    return { success: true, output: { relationship: mapJamaRelationship(jamaData(body)) } }
  },
  outputs: {
    relationship: {
      type: 'object',
      description: 'Get Relationship result',
      properties: JAMA_RELATIONSHIP_PROPERTIES,
    },
  },
}
