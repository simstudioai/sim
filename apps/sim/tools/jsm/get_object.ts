import type { JsmGetObjectParams, JsmGetObjectResponse } from '@/tools/jsm/types'
import { ASSET_OBJECT_PROPERTIES } from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmGetObjectTool: ToolConfig<JsmGetObjectParams, JsmGetObjectResponse> = {
  id: 'jsm_get_object',
  name: 'JSM Get Asset Object',
  description: 'Get a single Assets (Insight/CMDB) object by ID, including its attribute values',
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
      description: 'The Assets object ID',
    },
  },

  request: {
    url: '/api/tools/jsm/assets/object/get',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      workspaceId: params.workspaceId,
      objectId: params.objectId?.trim(),
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
      description: 'The Assets object',
      properties: ASSET_OBJECT_PROPERTIES,
    },
  },
}
