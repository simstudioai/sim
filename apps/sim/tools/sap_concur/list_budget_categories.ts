import type { ListBudgetCategoriesParams, SapConcurResponse } from '@/tools/sap_concur/types'
import { baseSapConcurInput, transformSapConcurResponse } from '@/tools/sap_concur/utils'
import type { InternalToolConfig } from '@/tools/types'

export const listBudgetCategoriesTool: InternalToolConfig<
  ListBudgetCategoriesParams,
  SapConcurResponse
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
  operation: {
    input: (params) => ({
      ...baseSapConcurInput(params),
      path: `/budget/v4/budgetCategory`,
      method: 'GET',
    }),
  },
  transformResponse: transformSapConcurResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'array',
      description: 'Top-level array of budget category objects',
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
}
