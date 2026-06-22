import type {
  JsmGetObjectTypeAttributesParams,
  JsmGetObjectTypeAttributesResponse,
} from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmGetObjectTypeAttributesTool: ToolConfig<
  JsmGetObjectTypeAttributesParams,
  JsmGetObjectTypeAttributesResponse
> = {
  id: 'jsm_get_object_type_attributes',
  name: 'JSM Get Asset Object Type Attributes',
  description:
    'Get the attribute definitions for an Assets (Insight/CMDB) object type. Use the returned attribute IDs to build create/update payloads or map columns.',
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
    objectTypeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Assets object type ID',
    },
    onlyValueEditable: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only attributes whose values can be edited',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter attributes by a search query',
    },
  },

  request: {
    url: '/api/tools/jsm/assets/attributes',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      workspaceId: params.workspaceId,
      objectTypeId: params.objectTypeId?.trim(),
      onlyValueEditable: params.onlyValueEditable,
      query: params.query,
    }),
  },

  transformResponse: async (response: Response) => {
    const responseText = await response.text()
    if (!responseText) {
      return {
        success: false,
        output: { ts: new Date().toISOString(), attributes: [], total: 0 },
        error: 'Empty response from API',
      }
    }
    const data = JSON.parse(responseText)
    if (data.success && data.output) return data
    return {
      success: data.success || false,
      output: data.output || { ts: new Date().toISOString(), attributes: [], total: 0 },
      error: data.error,
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of the operation' },
    attributes: {
      type: 'array',
      description: 'Attribute definitions for the object type',
      items: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Attribute definition ID — use as objectTypeAttributeId in create/update',
          },
          name: { type: 'string', description: 'Attribute name' },
          label: { type: 'boolean', description: 'Whether this attribute is the object label' },
          type: { type: 'number', description: 'Data type discriminator (integer enum)' },
          defaultType: {
            type: 'json',
            description: 'Default data type { id, name }',
            optional: true,
          },
          editable: { type: 'boolean', description: 'Whether the value is editable' },
          minimumCardinality: {
            type: 'number',
            description: 'Minimum number of values (>= 1 means required)',
          },
          maximumCardinality: { type: 'number', description: 'Maximum number of values' },
          uniqueAttribute: {
            type: 'boolean',
            description: 'Whether values must be unique',
            optional: true,
          },
        },
      },
    },
    total: { type: 'number', description: 'Total number of attributes' },
  },
}
