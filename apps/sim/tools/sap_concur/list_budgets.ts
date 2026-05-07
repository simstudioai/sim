import type { ListBudgetsParams, SapConcurProxyResponse } from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  buildListQuery,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

export const listBudgetsTool: ToolConfig<ListBudgetsParams, SapConcurProxyResponse> = {
  id: 'sap_concur_list_budgets',
  name: 'SAP Concur List Budgets',
  description: 'List budget item headers (GET /budget/v4/budgetItemHeader).',
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
    adminView: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'When true, returns all budgets the caller can administer (default false)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page offset (Concur returns up to 50 budget headers per page)',
    },
    responseSchema: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Response schema variant: "COMPACT" returns a smaller payload',
    },
  },
  request: {
    url: SAP_CONCUR_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      ...baseProxyBody(params),
      path: `/budget/v4/budgetItemHeader`,
      method: 'GET',
      query: buildListQuery({
        adminView: params.adminView,
        offset: params.offset,
        responseSchema: params.responseSchema,
      }),
    }),
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'Budget headers collection payload',
      properties: {
        items: {
          type: 'array',
          optional: true,
          description:
            'Array of budget item header summaries (id, name, description, budgetItemStatusType, budgetType, currencyCode, fiscalYear, budgetAmounts, owner, ...)',
          items: { type: 'json' },
        },
        offset: { type: 'number', optional: true, description: 'Page offset' },
        limit: { type: 'number', optional: true, description: 'Page size' },
        totalCount: { type: 'number', optional: true, description: 'Total result count' },
      },
    },
  },
}
