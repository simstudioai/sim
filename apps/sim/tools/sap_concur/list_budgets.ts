import type { ListBudgetsParams, SapConcurResponse } from '@/tools/sap_concur/types'
import {
  baseSapConcurInput,
  buildListQuery,
  transformSapConcurResponse,
} from '@/tools/sap_concur/utils'
import type { InternalToolConfig } from '@/tools/types'

export const listBudgetsTool: InternalToolConfig<ListBudgetsParams, SapConcurResponse> = {
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
      description:
        'Response schema variant: "COMPACT" returns a smaller payload. Defaults to the non-compact schema',
    },
  },
  operation: {
    input: (params) => ({
      ...baseSapConcurInput(params),
      path: `/budget/v4/budgetItemHeader`,
      method: 'GET',
      query: buildListQuery({
        adminView: params.adminView,
        offset: params.offset,
        responseSchema: params.responseSchema,
      }),
    }),
  },
  transformResponse: transformSapConcurResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'Budget headers collection payload',
      properties: {
        budgetItemHeaders: {
          type: 'array',
          optional: true,
          description:
            'Array of budget item header summaries (id, name, description, budgetItemStatusType, budgetType, currencyCode, fiscalYear, budgetAmounts, owner, ...)',
          items: { type: 'json' },
        },
        totalRows: {
          type: 'number',
          optional: true,
          description: 'Total number of budget headers',
        },
        offset: { type: 'number', optional: true, description: 'Offset of the current page' },
        limit: {
          type: 'number',
          optional: true,
          description: 'Page size (Concur returns up to 50)',
        },
        href: { type: 'string', optional: true, description: 'URL of the current page' },
        previous: {
          type: 'json',
          optional: true,
          description: 'Previous page link ({ href }); null on the first page',
          properties: {
            href: { type: 'string', optional: true, description: 'Previous page URL' },
          },
        },
        next: {
          type: 'json',
          optional: true,
          description:
            'Next page link ({ href }); null when no results remain. This is the only forward cursor for paging',
          properties: {
            href: { type: 'string', optional: true, description: 'Next page URL' },
          },
        },
      },
    },
  },
}
