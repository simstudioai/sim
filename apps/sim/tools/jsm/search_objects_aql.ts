import type { JsmSearchObjectsAqlParams, JsmSearchObjectsAqlResponse } from '@/tools/jsm/types'
import type { ToolConfig } from '@/tools/types'

export const jsmSearchObjectsAqlTool: ToolConfig<
  JsmSearchObjectsAqlParams,
  JsmSearchObjectsAqlResponse
> = {
  id: 'jsm_search_objects_aql',
  name: 'JSM Search Assets (AQL)',
  description:
    'Search Assets (Insight/CMDB) objects using AQL (Assets Query Language), e.g. objectType = "Host" AND Status = "Running". Supports pagination.',
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
    qlQuery: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'AQL query string (e.g., objectType = "Host" AND "Operating System" = "Ubuntu")',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number (1-based, defaults to 1)',
    },
    resultsPerPage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Results per page (e.g., 25, 50)',
    },
    includeAttributes: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include resolved attribute values on each object (defaults to true)',
    },
    objectTypeId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optionally scope the search to a single object type ID',
    },
    objectSchemaId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optionally scope the search to a single object schema ID',
    },
  },

  request: {
    url: '/api/tools/jsm/assets/search',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      domain: params.domain,
      accessToken: params.accessToken,
      cloudId: params.cloudId,
      workspaceId: params.workspaceId,
      qlQuery: params.qlQuery,
      page: params.page,
      resultsPerPage: params.resultsPerPage,
      includeAttributes: params.includeAttributes,
      objectTypeId: params.objectTypeId,
      objectSchemaId: params.objectSchemaId,
    }),
  },

  transformResponse: async (response: Response) => {
    const responseText = await response.text()
    if (!responseText) {
      return {
        success: false,
        output: {
          ts: new Date().toISOString(),
          objects: [],
          total: 0,
          pageNumber: 0,
          pageSize: 0,
        },
        error: 'Empty response from API',
      }
    }
    const data = JSON.parse(responseText)
    if (data.success && data.output) return data
    return {
      success: data.success || false,
      output: data.output || {
        ts: new Date().toISOString(),
        objects: [],
        total: 0,
        pageNumber: 0,
        pageSize: 0,
      },
      error: data.error,
    }
  },

  outputs: {
    ts: { type: 'string', description: 'Timestamp of the operation' },
    objects: {
      type: 'array',
      description: 'Matching Assets objects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Object ID' },
          label: { type: 'string', description: 'Object label', optional: true },
          objectKey: { type: 'string', description: 'Object key (e.g., HOST-123)', optional: true },
          objectType: { type: 'json', description: 'Object type metadata', optional: true },
          attributes: { type: 'json', description: 'Resolved attribute values', optional: true },
        },
      },
    },
    total: { type: 'number', description: 'Total number of matching objects (totalFilterCount)' },
    pageNumber: { type: 'number', description: 'Current page number' },
    pageSize: { type: 'number', description: 'Number of objects on this page' },
  },
}
