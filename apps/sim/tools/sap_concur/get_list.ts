import type { GetListParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const getListTool: ToolConfig<GetListParams, SapConcurProxyResponse> = {
  id: 'sap_concur_get_list',
  name: 'SAP Concur Get List',
  description: 'Get a single custom list (GET /list/v4/lists/{listId}).',
  version: '1.0.0',
  params: {
    datacenter: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Concur datacenter base URL (defaults to us.api.concursolutions.com)',
    },
    grantType: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'OAuth grant type: client_credentials (default) or password',
    },
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Concur OAuth client ID',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Concur OAuth client secret',
    },
    username: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Username (only for password grant)',
    },
    password: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Password (only for password grant)',
    },
    companyUuid: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Company UUID for multi-company access tokens',
    },
    listId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'List ID',
    },
  },
  request: {
    url: SAP_CONCUR_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const listId = trimRequired(params.listId, 'listId')
      return {
        ...baseProxyBody(params),
        path: `/list/v4/lists/${encodeURIComponent(listId)}`,
        method: 'GET',
      }
    },
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'List detail payload',
      properties: {
        id: { type: 'string', description: 'Unique identifier (UUID) of the list', optional: true },
        value: { type: 'string', description: 'Name of the list', optional: true },
        levelCount: {
          type: 'number',
          description: 'Number of levels in the list',
          optional: true,
        },
        searchCriteria: {
          type: 'string',
          description: 'Search attribute (TEXT or CODE)',
          optional: true,
        },
        displayFormat: {
          type: 'string',
          description: 'Display order ((CODE) TEXT or TEXT (CODE))',
          optional: true,
        },
        category: {
          type: 'json',
          description: 'List category',
          optional: true,
          properties: {
            id: { type: 'string', description: 'Category UUID', optional: true },
            type: { type: 'string', description: 'Category type', optional: true },
          },
        },
        isReadOnly: {
          type: 'boolean',
          description: 'Whether the list is read-only',
          optional: true,
        },
        isDeleted: {
          type: 'boolean',
          description: 'Whether the list has been deleted',
          optional: true,
        },
        managedBy: {
          type: 'string',
          description: 'Identifier of the managing application or service',
          optional: true,
        },
        externalThreshold: {
          type: 'number',
          description: 'Threshold from where the level starts being external',
          optional: true,
        },
      },
    },
  },
}
