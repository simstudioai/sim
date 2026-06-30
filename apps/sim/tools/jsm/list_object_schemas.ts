import type { JsmListObjectSchemasParams, JsmListObjectSchemasResponse } from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmListObjectSchemasTool: ToolConfig<
  JsmListObjectSchemasParams,
  JsmListObjectSchemasResponse
> = {
  id: 'jsm_list_object_schemas',
  name: 'JSM List Asset Schemas',
  description: 'List Assets (Insight/CMDB) object schemas in Jira Service Management',
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
    startAt: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination start index (e.g., 0, 50)',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum schemas to return (e.g., 25, 50)',
    },
    includeCounts: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include object and object-type counts per schema',
    },
  },

  request: {
    url: '/api/tools/jsm/assets/schemas',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      workspaceId: params.workspaceId,
      startAt: params.startAt,
      maxResults: params.maxResults,
      includeCounts: params.includeCounts,
    }),
  },

  transformResponse: async (response: Response) => {
    const responseText = await response.text()
    if (!responseText) {
      return {
        success: false,
        output: { ts: new Date().toISOString(), schemas: [], total: 0, isLast: true },
        error: 'Empty response from API',
      }
    }
    const data = JSON.parse(responseText)
    if (data.success && data.output) return data
    return {
      success: data.success || false,
      output: data.output || {
        ts: new Date().toISOString(),
        schemas: [],
        total: 0,
        isLast: true,
      },
      error: data.error,
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of the operation' },
    schemas: {
      type: 'array',
      description: 'List of Assets object schemas',
      items: {
        type: 'object',
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
    total: { type: 'number', description: 'Total number of schemas' },
    isLast: { type: 'boolean', description: 'Whether this is the last page' },
  },
}
