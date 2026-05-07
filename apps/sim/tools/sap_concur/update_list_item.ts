import type { SapConcurProxyResponse, UpdateListItemParams } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const updateListItemTool: ToolConfig<UpdateListItemParams, SapConcurProxyResponse> = {
  id: 'sap_concur_update_list_item',
  name: 'SAP Concur Update List Item',
  description: 'Update a list item (PUT /list/v4/items/{itemId}).',
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
    itemId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'List item UUID',
    },
    body: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'List item payload. Required: shortCode, value. Other fields in the body are ignored.',
    },
  },
  request: {
    url: SAP_CONCUR_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const itemId = trimRequired(params.itemId, 'itemId')
      return {
        ...baseProxyBody(params),
        path: `/list/v4/items/${encodeURIComponent(itemId)}`,
        method: 'PUT',
        body: params.body,
      }
    },
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'Updated list item',
      properties: {
        id: { type: 'string', description: 'List item UUID', optional: true },
        code: { type: 'string', description: 'Long code format for the item', optional: true },
        shortCode: { type: 'string', description: 'Short code identifier', optional: true },
        value: { type: 'string', description: 'Display value of the item', optional: true },
        parentId: {
          type: 'string',
          description: 'Parent item UUID (omitted for first-level items)',
          optional: true,
        },
        level: {
          type: 'number',
          description: 'Hierarchy level (1 for root items)',
          optional: true,
        },
        isDeleted: {
          type: 'boolean',
          description: 'Deletion status across all containing lists',
          optional: true,
        },
        lists: {
          type: 'array',
          description: 'Lists containing this item',
          optional: true,
          items: {
            type: 'json',
            properties: {
              id: { type: 'string', description: 'List UUID', optional: true },
              hasChildren: {
                type: 'boolean',
                description: 'Whether this item has children in the list',
                optional: true,
              },
            },
          },
        },
      },
    },
  },
}
