import type { BrexGetBudgetParams, BrexGetBudgetResponse } from '@/tools/brex/types'
import { BREX_MONEY_PROPERTIES } from '@/tools/brex/types'
import { BREX_API_BASE, buildBrexHeaders, parseBrexJson } from '@/tools/brex/utils'
import type { ToolConfig } from '@/tools/types'

export const brexGetBudgetTool: ToolConfig<BrexGetBudgetParams, BrexGetBudgetResponse> = {
  id: 'brex_get_budget',
  name: 'Brex Get Budget',
  description: 'Get a Brex budget by its ID',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Brex user token (generated from Developer Settings in the Brex dashboard)',
    },
    budgetId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the budget to fetch',
    },
  },

  request: {
    url: (params) => `${BREX_API_BASE}/v2/budgets/${encodeURIComponent(params.budgetId.trim())}`,
    method: 'GET',
    headers: (params) => buildBrexHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await parseBrexJson(response)
    return {
      success: true,
      output: {
        budgetId: data.budget_id ?? '',
        accountId: data.account_id ?? '',
        name: data.name ?? '',
        description: data.description ?? null,
        parentBudgetId: data.parent_budget_id ?? null,
        ownerUserIds: data.owner_user_ids ?? [],
        periodRecurrenceType: data.period_recurrence_type ?? '',
        startDate: data.start_date ?? null,
        endDate: data.end_date ?? null,
        amount: data.amount ?? null,
        spendBudgetStatus: data.spend_budget_status ?? '',
        limitType: data.limit_type ?? null,
      },
    }
  },

  outputs: {
    budgetId: { type: 'string', description: 'Unique budget ID' },
    accountId: { type: 'string', description: 'Account ID the budget belongs to' },
    name: { type: 'string', description: 'Budget name' },
    description: { type: 'string', description: 'Budget description', optional: true },
    parentBudgetId: { type: 'string', description: 'Parent budget ID', optional: true },
    ownerUserIds: { type: 'array', description: 'User IDs of the budget owners' },
    periodRecurrenceType: {
      type: 'string',
      description: 'Budget period recurrence (WEEKLY, MONTHLY, QUARTERLY, YEARLY, ONE_TIME)',
    },
    startDate: { type: 'string', description: 'Budget start date', optional: true },
    endDate: { type: 'string', description: 'Budget end date', optional: true },
    amount: {
      type: 'json',
      description: 'Budget amount',
      optional: true,
      properties: BREX_MONEY_PROPERTIES,
    },
    spendBudgetStatus: {
      type: 'string',
      description: 'Budget status (ACTIVE, ARCHIVED, DELETED)',
    },
    limitType: { type: 'string', description: 'Budget limit type (HARD or SOFT)', optional: true },
  },
}
