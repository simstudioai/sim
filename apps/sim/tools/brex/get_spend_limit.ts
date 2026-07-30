import type { BrexGetSpendLimitParams, BrexGetSpendLimitResponse } from '@/tools/brex/types'
import { BREX_SPEND_LIMIT_PERIOD_BALANCE_PROPERTIES } from '@/tools/brex/types'
import { BREX_API_BASE, buildBrexHeaders, parseBrexJson } from '@/tools/brex/utils'
import type { ToolConfig } from '@/tools/types'

export const brexGetSpendLimitTool: ToolConfig<BrexGetSpendLimitParams, BrexGetSpendLimitResponse> =
  {
    id: 'brex_get_spend_limit',
    name: 'Brex Get Spend Limit',
    description: 'Get a Brex spend limit by its ID',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Brex user token (generated from Developer Settings in the Brex dashboard)',
      },
      spendLimitId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'ID of the spend limit to fetch',
      },
    },

    request: {
      url: (params) =>
        `${BREX_API_BASE}/v2/spend_limits/${encodeURIComponent(params.spendLimitId.trim())}`,
      method: 'GET',
      headers: (params) => buildBrexHeaders(params.apiKey),
    },

    transformResponse: async (response) => {
      const data = await parseBrexJson(response)
      return {
        success: true,
        output: {
          id: data.id ?? '',
          accountId: data.account_id ?? '',
          name: data.name ?? '',
          description: data.description ?? null,
          parentBudgetId: data.parent_budget_id ?? null,
          status: data.status ?? '',
          periodRecurrenceType: data.period_recurrence_type ?? '',
          spendType: data.spend_type ?? '',
          startDate: data.start_date ?? null,
          endDate: data.end_date ?? null,
          ownerUserIds: data.owner_user_ids ?? [],
          memberUserIds: data.member_user_ids ?? [],
          currentPeriodBalance: data.current_period_balance ?? null,
          authorizationSettings: data.authorization_settings ?? null,
        },
      }
    },

    outputs: {
      id: { type: 'string', description: 'Unique spend limit ID' },
      accountId: { type: 'string', description: 'Account ID the spend limit belongs to' },
      name: { type: 'string', description: 'Spend limit name' },
      description: { type: 'string', description: 'Spend limit description', optional: true },
      parentBudgetId: { type: 'string', description: 'Parent budget ID', optional: true },
      status: {
        type: 'string',
        description: 'Spend limit status (ACTIVE, EXPIRED, ARCHIVED)',
      },
      periodRecurrenceType: {
        type: 'string',
        description: 'Period recurrence (PER_WEEK, PER_MONTH, PER_QUARTER, PER_YEAR, ONE_TIME)',
      },
      spendType: { type: 'string', description: 'Spend type of the limit' },
      startDate: { type: 'string', description: 'Spend limit start date', optional: true },
      endDate: { type: 'string', description: 'Spend limit end date', optional: true },
      ownerUserIds: { type: 'array', description: 'User IDs of the spend limit owners' },
      memberUserIds: { type: 'array', description: 'User IDs of the spend limit members' },
      currentPeriodBalance: {
        type: 'json',
        description: 'Spend and rollover amounts for the current period',
        optional: true,
        properties: BREX_SPEND_LIMIT_PERIOD_BALANCE_PROPERTIES,
      },
      authorizationSettings: {
        type: 'json',
        description: 'Authorization settings (base limit, authorization type, rollover refresh)',
        optional: true,
      },
    },
  }
