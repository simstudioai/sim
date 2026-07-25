import { generateId } from '@sim/utils/id'
import type { BrexCreateBudgetParams, BrexCreateBudgetResponse } from '@/tools/brex/types'
import { BREX_MONEY_PROPERTIES } from '@/tools/brex/types'
import { BREX_API_BASE, buildBrexHeaders, parseBrexJson, splitBrexIdList } from '@/tools/brex/utils'
import type { ToolConfig } from '@/tools/types'

export const brexCreateBudgetTool: ToolConfig<BrexCreateBudgetParams, BrexCreateBudgetResponse> = {
  id: 'brex_create_budget',
  name: 'Brex Create Budget',
  description: 'Create a new budget in the Brex account',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Brex user token (generated from Developer Settings in the Brex dashboard)',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name for the budget',
    },
    description: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Description of what the budget is used for',
    },
    parentBudgetId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the parent budget',
    },
    periodRecurrenceType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Period type of the budget (WEEKLY, MONTHLY, QUARTERLY, YEARLY, ONE_TIME)',
    },
    amount: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Budget amount, in the smallest unit of the currency (e.g., cents for USD)',
    },
    currency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 4217 currency code (defaults to USD)',
    },
    ownerUserIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated user IDs of the budget owners',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Date the budget should start counting (YYYY-MM-DD)',
    },
    endDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Date the budget should stop counting (YYYY-MM-DD)',
    },
  },

  request: {
    url: () => `${BREX_API_BASE}/v2/budgets`,
    method: 'POST',
    headers: (params) => ({
      ...buildBrexHeaders(params.apiKey),
      'Idempotency-Key': generateId(),
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        name: params.name,
        description: params.description,
        parent_budget_id: params.parentBudgetId,
        period_recurrence_type: params.periodRecurrenceType,
        amount: {
          amount: params.amount,
          currency: params.currency || 'USD',
        },
      }
      const ownerUserIds = splitBrexIdList(params.ownerUserIds)
      if (ownerUserIds) body.owner_user_ids = ownerUserIds
      if (params.startDate) body.start_date = params.startDate
      if (params.endDate) body.end_date = params.endDate
      return body
    },
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
    spendBudgetStatus: { type: 'string', description: 'Status of the created budget' },
    limitType: { type: 'string', description: 'Budget limit type', optional: true },
  },
}
