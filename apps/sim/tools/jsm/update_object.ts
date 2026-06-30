import type { JsmUpdateObjectParams, JsmUpdateObjectResponse } from '@/tools/jsm/types'
import { ASSET_OBJECT_PROPERTIES } from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmUpdateObjectTool: ToolConfig<JsmUpdateObjectParams, JsmUpdateObjectResponse> = {
  id: 'jsm_update_object',
  name: 'JSM Update Asset Object',
  description:
    'Update an existing Assets (Insight/CMDB) object. Provide the attributes to change using their objectTypeAttributeId values.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'jira',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Jira Service Management',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Your Jira domain (e.g., yourcompany.atlassian.net)',
    },
    cloudId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Jira Cloud ID for the instance',
    },
    workspaceId: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'Assets workspace ID (resolved automatically when omitted)',
    },
    objectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Assets object ID to update',
    },
    attributes: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of attributes to set: [{ objectTypeAttributeId, objectAttributeValues: [{ value }] }]',
    },
    objectTypeId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional object type ID (only if changing the type)',
    },
  },

  request: {
    url: '/api/tools/jsm/assets/object/update',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      workspaceId: params.workspaceId,
      objectId: params.objectId?.trim(),
      objectTypeId: params.objectTypeId?.trim(),
      attributes: params.attributes,
    }),
  },

  transformResponse: async (response: Response) => {
    const responseText = await response.text()
    if (!responseText) {
      return {
        success: false,
        output: { ts: new Date().toISOString(), object: null },
        error: 'Empty response from API',
      }
    }
    const data = JSON.parse(responseText)
    if (data.success && data.output) return data
    return {
      success: data.success || false,
      output: data.output || { ts: new Date().toISOString(), object: null },
      error: data.error,
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of the operation' },
    object: {
      type: 'json',
      description: 'The updated Assets object',
      properties: ASSET_OBJECT_PROPERTIES,
    },
  },
}
