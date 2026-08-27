import type { ListListItemsParams, SapConcurResponse } from '@/tools/sap_concur/types'
import {
  baseSapConcurInput,
  buildListQuery,
  transformSapConcurResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { InternalToolConfig } from '@/tools/types'

export const listListItemsTool: InternalToolConfig<ListListItemsParams, SapConcurResponse> = {
  id: 'sap_concur_list_list_items',
  name: 'SAP Concur List List Items',
  description:
    'List the top-level items (children) for a custom list (GET /list/v4/lists/{listId}/children).',
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
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number (1-based; page size is fixed at 100)',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort field: value or shortCode',
    },
    sortDirection: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort direction: asc or desc',
    },
    hasChildren: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include only items that have children',
    },
    isDeleted: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by deletion status. Pass "true" or "false" as a string because the filter also accepts the eq operator prefix (eq:true) — eq is the only operator this filter supports.',
    },
    shortCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by short code',
    },
    value: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by display value',
    },
    shortCodeOrValue: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by short code OR value',
    },
  },
  operation: {
    input: (params) => {
      const listId = trimRequired(params.listId, 'listId')
      return {
        ...baseSapConcurInput(params),
        path: `/list/v4/lists/${encodeURIComponent(listId)}/children`,
        method: 'GET',
        query: buildListQuery({
          page: params.page,
          sortBy: params.sortBy,
          sortDirection: params.sortDirection,
          hasChildren: params.hasChildren,
          isDeleted: params.isDeleted,
          shortCode: params.shortCode,
          value: params.value,
          shortCodeOrValue: params.shortCodeOrValue,
        }),
      }
    },
  },
  transformResponse: transformSapConcurResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'Paginated list items collection',
      properties: {
        content: {
          type: 'array',
          description: 'List items in the current page',
          optional: true,
          items: {
            type: 'json',
            properties: {
              id: { type: 'string', description: 'List item UUID', optional: true },
              listId: {
                type: 'string',
                description: 'UUID of the list that contains the list item',
                optional: true,
              },
              code: {
                type: 'string',
                description: 'Long code format for the item',
                optional: true,
              },
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
        page: {
          type: 'json',
          description: 'Pagination metadata',
          optional: true,
          properties: {
            number: { type: 'number', description: 'Current page number', optional: true },
            size: { type: 'number', description: 'Items per page', optional: true },
            totalElements: { type: 'number', description: 'Total item count', optional: true },
            totalPages: { type: 'number', description: 'Total page count', optional: true },
          },
        },
        links: {
          type: 'array',
          description: 'Navigation links (next, previous, first, last)',
          optional: true,
          items: {
            type: 'json',
            properties: {
              rel: { type: 'string', description: 'Link relation', optional: true },
              href: { type: 'string', description: 'Link URL', optional: true },
            },
          },
        },
      },
    },
  },
}
