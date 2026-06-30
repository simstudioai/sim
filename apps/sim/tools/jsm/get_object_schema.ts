import type { JsmGetObjectSchemaParams, JsmGetObjectSchemaResponse } from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmGetObjectSchemaTool: ToolConfig<
  JsmGetObjectSchemaParams,
  JsmGetObjectSchemaResponse
> = {
  id: 'jsm_get_object_schema',
  name: 'JSM Get Asset Schema',
  description: 'Get a single Assets (Insight/CMDB) object schema by ID',
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
    schemaId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Assets object schema ID',
    },
  },

  request: {
    url: '/api/tools/jsm/assets/schema',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      workspaceId: params.workspaceId,
      schemaId: params.schemaId?.trim(),
    }),
  },

  transformResponse: async (response: Response) => {
    const responseText = await response.text()
    if (!responseText) {
      return {
        success: false,
        output: { ts: new Date().toISOString(), schema: null },
        error: 'Empty response from API',
      }
    }
    const data = JSON.parse(responseText)
    if (data.success && data.output) return data
    return {
      success: data.success || false,
      output: data.output || { ts: new Date().toISOString(), schema: null },
      error: data.error,
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of the operation' },
    schema: {
      type: 'json',
      description: 'The Assets object schema',
      properties: {
        id: { type: 'string', description: 'Schema ID' },
        name: { type: 'string', description: 'Schema name' },
        objectSchemaKey: { type: 'string', description: 'Schema key' },
        status: { type: 'string', description: 'Schema status' },
        description: { type: 'string', description: 'Schema description', optional: true },
        objectCount: { type: 'number', description: 'Number of objects', optional: true },
        objectTypeCount: {
          type: 'number',
          description: 'Number of object types',
          optional: true,
        },
      },
    },
  },
}
