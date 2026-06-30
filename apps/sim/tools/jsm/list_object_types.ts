import type { JsmListObjectTypesParams, JsmListObjectTypesResponse } from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmListObjectTypesTool: ToolConfig<
  JsmListObjectTypesParams,
  JsmListObjectTypesResponse
> = {
  id: 'jsm_list_object_types',
  name: 'JSM List Asset Object Types',
  description: 'List object types within an Assets (Insight/CMDB) object schema',
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
      description: 'The Assets object schema ID to list object types for',
    },
    excludeAbstract: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Exclude abstract object types from the result',
    },
  },

  request: {
    url: '/api/tools/jsm/assets/object-types',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      workspaceId: params.workspaceId,
      schemaId: params.schemaId?.trim(),
      excludeAbstract: params.excludeAbstract,
    }),
  },

  transformResponse: async (response: Response) => {
    const responseText = await response.text()
    if (!responseText) {
      return {
        success: false,
        output: { ts: new Date().toISOString(), objectTypes: [], total: 0 },
        error: 'Empty response from API',
      }
    }
    const data = JSON.parse(responseText)
    if (data.success && data.output) return data
    return {
      success: data.success || false,
      output: data.output || { ts: new Date().toISOString(), objectTypes: [], total: 0 },
      error: data.error,
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of the operation' },
    objectTypes: {
      type: 'array',
      description: 'List of object types in the schema',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Object type ID' },
          name: { type: 'string', description: 'Object type name' },
          description: { type: 'string', description: 'Object type description', optional: true },
          objectSchemaId: { type: 'string', description: 'Parent schema ID' },
          objectCount: { type: 'number', description: 'Number of objects', optional: true },
          abstractObjectType: {
            type: 'boolean',
            description: 'Whether the type is abstract',
            optional: true,
          },
          inherited: {
            type: 'boolean',
            description: 'Whether the type inherits attributes',
            optional: true,
          },
        },
      },
    },
    total: { type: 'number', description: 'Total number of object types' },
  },
}
