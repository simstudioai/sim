import { toStringOrNull } from '@sim/utils/coerce'
import { toRecord } from '@sim/utils/object'
import type { JamaCreateItemParams, JamaCreateItemResponse } from '@/tools/jama/types'
import {
  JAMA_RETRY,
  jamaAuthParams,
  jamaFields,
  jamaHeaders,
  jamaId,
  jamaNumber,
  jamaOAuth,
  jamaUrl,
  readJamaEnvelope,
} from '@/tools/jama/utils'
import type { ToolConfig } from '@/tools/types'

export const jamaCreateItemTool: ToolConfig<JamaCreateItemParams, JamaCreateItemResponse> = {
  id: 'jama_create_item',
  name: 'Jama Create Item',
  description: "Create Item in Jama Connect using the connected user's access permissions.",
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
    itemTypeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'itemType ID',
    },
    fields: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Jama field names and values, including name and required custom fields',
    },
    parentItemId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Parent item ID; otherwise create at the project root',
    },
    childItemTypeId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Child item type ID, required for sets and folders',
    },
  },
  request: {
    url: (params) => jamaUrl(params.instanceUrl, '/items', {}),
    method: 'POST',
    headers: jamaHeaders,
    retry: JAMA_RETRY,
    redirectPolicy: () => ({ mode: 'standard', sendCredentialsOnCrossOriginRedirect: false }),
    body: (params) => ({
      itemType: Number(jamaId(params.itemTypeId, 'itemTypeId')),
      project: Number(jamaId(params.projectId, 'projectId')),
      fields: jamaFields(params.fields),
      location: {
        parent: params.parentItemId
          ? { item: Number(jamaId(params.parentItemId, 'parentItemId')) }
          : { project: Number(jamaId(params.projectId, 'projectId')) },
      },
      ...(params.childItemTypeId
        ? { childItemType: Number(jamaId(params.childItemTypeId, 'childItemTypeId')) }
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
