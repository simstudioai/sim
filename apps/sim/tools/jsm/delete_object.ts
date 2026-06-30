import type { JsmDeleteObjectParams, JsmDeleteObjectResponse } from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmDeleteObjectTool: ToolConfig<JsmDeleteObjectParams, JsmDeleteObjectResponse> = {
  id: 'jsm_delete_object',
  name: 'JSM Delete Asset Object',
  description: 'Delete an Assets (Insight/CMDB) object by ID',
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
      description: 'The Assets object ID to delete',
    },
  },

  request: {
    url: '/api/tools/jsm/assets/object/delete',
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
        output: { ts: new Date().toISOString(), objectId: '', deleted: false },
        error: 'Empty response from API',
      }
    }
    const data = JSON.parse(responseText)
    if (data.success && data.output) return data
    return {
      success: data.success || false,
      output: data.output || { ts: new Date().toISOString(), objectId: '', deleted: false },
      error: data.error,
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of the operation' },
    objectId: { type: 'string', description: 'The deleted object ID' },
    deleted: { type: 'boolean', description: 'Whether the object was deleted' },
  },
}
