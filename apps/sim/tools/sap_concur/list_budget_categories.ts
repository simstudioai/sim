import type { ListBudgetCategoriesParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const listBudgetCategoriesTool: ToolConfig<
  ListBudgetCategoriesParams,
  SapConcurProxyResponse
> = {
  id: 'sap_concur_list_budget_categories',
  name: 'SAP Concur List Budget Categories',
  description: 'List budget categories (GET /budget/v4/budgetCategory).',
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
  },
  request: {
    url: SAP_CONCUR_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      ...baseProxyBody(params),
      path: `/budget/v4/budgetCategory`,
      method: 'GET',
    }),
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'Budget categories collection payload',
      properties: {
        items: {
          type: 'array',
          optional: true,
          description: 'Array of budget category objects',
          items: {
            type: 'json',
            properties: {
              id: { type: 'string', optional: true, description: 'Category ID' },
              name: { type: 'string', optional: true, description: 'Admin-facing category name' },
              description: { type: 'string', optional: true, description: 'Friendly name' },
              statusType: {
                type: 'string',
                optional: true,
                description: 'Status: OPEN or REMOVED',
              },
              expenseTypes: {
                type: 'array',
                optional: true,
                description:
                  'Expense types in this category (id, featureTypeCode, expenseTypeCode, name)',
                items: { type: 'json' },
              },
            },
          },
        },
      },
    },
  },
}
