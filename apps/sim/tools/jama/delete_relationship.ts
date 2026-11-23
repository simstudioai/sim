import type {
  JamaDeleteRelationshipParams,
  JamaDeleteRelationshipResponse,
} from '@/tools/jama/types'
import {
  assertJamaResponse,
  jamaAuthParams,
  jamaHeaders,
  jamaId,
  jamaOAuth,
  jamaUrl,
} from '@/tools/jama/utils'
import type { ToolConfig } from '@/tools/types'

export const jamaDeleteRelationshipTool: ToolConfig<
  JamaDeleteRelationshipParams,
  JamaDeleteRelationshipResponse
> = {
  id: 'jama_delete_relationship',
  name: 'Jama Delete Relationship',
  description: "Delete Relationship in Jama Connect using the connected user's access permissions.",
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
    method: 'DELETE',
    headers: jamaHeaders,
    redirectPolicy: () => ({ mode: 'standard', sendCredentialsOnCrossOriginRedirect: false }),
  },
  transformResponse: async (response) => {
    assertJamaResponse(response)
    return { success: true, output: { status: response.status } }
  },
  outputs: {
    status: { type: 'number', description: 'Successful HTTP status code' },
  },
}
