import type { BrexListBudgetsResponse, BrexPaginationParams } from '@/tools/brex/types'
import { BREX_MONEY_PROPERTIES } from '@/tools/brex/types'
import {
  appendBrexPagination,
  BREX_API_BASE,
  buildBrexHeaders,
  parseBrexJson,
} from '@/tools/brex/utils'
import type { ToolConfig } from '@/tools/types'

export const brexListBudgetsTool: ToolConfig<BrexPaginationParams, BrexListBudgetsResponse> = {
  id: 'brex_list_budgets',
  name: 'Brex List Budgets',
  description: 'List budgets in the Brex account',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Brex user token (generated from Developer Settings in the Brex dashboard)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response',
    },
    limit: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of budgets to return (default 100, max 1000)',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      appendBrexPagination(query, params)
      const queryString = query.toString()
      return queryString
        ? `${BREX_API_BASE}/v2/budgets?${queryString}`
        : `${BREX_API_BASE}/v2/budgets`
    },
    method: 'GET',
    headers: (params) => buildBrexHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await parseBrexJson(response)
    return {
      success: true,
      output: {
        items: data.items ?? [],
        nextCursor: data.next_cursor ?? null,
      },
    }
  },

  outputs: {
    items: {
      type: 'array',
      description: 'Budgets in the Brex account',
      items: {
        type: 'json',
        properties: {
          budget_id: { type: 'string', description: 'Unique budget ID' },
          account_id: { type: 'string', description: 'Account ID the budget belongs to' },
          name: { type: 'string', description: 'Budget name' },
          description: { type: 'string', description: 'Budget description', optional: true },
          parent_budget_id: { type: 'string', description: 'Parent budget ID', optional: true },
          owner_user_ids: { type: 'array', description: 'User IDs of the budget owners' },
          period_recurrence_type: {
            type: 'string',
            description: 'Budget period recurrence (WEEKLY, MONTHLY, QUARTERLY, YEARLY, ONE_TIME)',
          },
          start_date: { type: 'string', description: 'Budget start date', optional: true },
          end_date: { type: 'string', description: 'Budget end date', optional: true },
          amount: {
            type: 'json',
            description: 'Budget amount',
            optional: true,
            properties: BREX_MONEY_PROPERTIES,
          },
          spend_budget_status: { type: 'string', description: 'Budget status' },
          limit_type: { type: 'string', description: 'Budget limit type', optional: true },
        },
      },
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for fetching the next page of results',
      optional: true,
    },
  },
}
