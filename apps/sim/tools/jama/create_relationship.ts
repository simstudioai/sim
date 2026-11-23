import { toStringOrNull } from '@sim/utils/coerce'
import { toRecord } from '@sim/utils/object'
import type {
  JamaCreateRelationshipParams,
  JamaCreateRelationshipResponse,
} from '@/tools/jama/types'
import {
  JAMA_RETRY,
  jamaAuthParams,
  jamaHeaders,
  jamaId,
  jamaNumber,
  jamaOAuth,
  jamaUrl,
  readJamaEnvelope,
} from '@/tools/jama/utils'
import type { ToolConfig } from '@/tools/types'

export const jamaCreateRelationshipTool: ToolConfig<
  JamaCreateRelationshipParams,
  JamaCreateRelationshipResponse
> = {
  id: 'jama_create_relationship',
  name: 'Jama Create Relationship',
  description: "Create Relationship in Jama Connect using the connected user's access permissions.",
  version: '1.0.0',
  oauth: jamaOAuth,
  params: {
    ...jamaAuthParams,
    fromItemId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'fromItem ID',
    },
    toItemId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'toItem ID',
    },
    relationshipTypeId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Relationship type ID; defaults to the instance default',
    },
  },
  request: {
    url: (params) => jamaUrl(params.instanceUrl, '/relationships', {}),
    method: 'POST',
    headers: jamaHeaders,
    retry: JAMA_RETRY,
    redirectPolicy: () => ({ mode: 'standard', sendCredentialsOnCrossOriginRedirect: false }),
    body: (params) => ({
      fromItem: Number(jamaId(params.fromItemId, 'fromItemId')),
      toItem: Number(jamaId(params.toItemId, 'toItemId')),
      ...(params.relationshipTypeId
        ? { relationshipType: Number(jamaId(params.relationshipTypeId, 'relationshipTypeId')) }
        : {}),
    }),
  },
  transformResponse: async (response) => {
    const body = await readJamaEnvelope(response)
    const meta = toRecord(body.meta)
    return {
      success: true,
      output: { id: jamaNumber(meta.id), location: toStringOrNull(meta.location) },
    }
  },
  outputs: {
    id: { type: 'number', description: 'Created resource ID' },
    location: { type: 'string', nullable: true, description: 'API URL of the created resource' },
  },
}
