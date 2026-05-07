import type { ListListsParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  buildListQuery,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const listListsTool: ToolConfig<ListListsParams, SapConcurProxyResponse> = {
  id: 'sap_concur_list_lists',
  name: 'SAP Concur List Lists',
  description: 'List custom lists (GET /list/v4/lists).',
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
      description: 'Sort field: name, levelcount, or listcategory',
    },
    sortDirection: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort direction: asc or desc',
    },
    value: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by list name',
    },
    categoryType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by category type (mapped to category.type query param)',
    },
    isDeleted: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include deleted lists',
    },
    levelCount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by number of levels',
    },
  },
  request: {
    url: SAP_CONCUR_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      ...baseProxyBody(params),
      path: `/list/v4/lists`,
      method: 'GET',
      query: buildListQuery({
        page: params.page,
        sortBy: params.sortBy,
        sortDirection: params.sortDirection,
        value: params.value,
        'category.type': params.categoryType,
        isDeleted: params.isDeleted,
        levelCount: params.levelCount,
      }),
    }),
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'Paginated lists collection',
      properties: {
        content: {
          type: 'array',
          description: 'Lists in the current page',
          optional: true,
          items: {
            type: 'json',
            properties: {
              id: { type: 'string', description: 'List UUID', optional: true },
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
                description: 'Managing application or service identifier',
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
