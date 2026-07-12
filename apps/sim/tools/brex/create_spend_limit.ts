import { generateId } from '@sim/utils/id'
import type { BrexCreateSpendLimitParams, BrexCreateSpendLimitResponse } from '@/tools/brex/types'
import { BREX_SPEND_LIMIT_PERIOD_BALANCE_PROPERTIES } from '@/tools/brex/types'
import { BREX_API_BASE, buildBrexHeaders, parseBrexJson, splitBrexIdList } from '@/tools/brex/utils'
import type { ToolConfig } from '@/tools/types'

export const brexCreateSpendLimitTool: ToolConfig<
  BrexCreateSpendLimitParams,
  BrexCreateSpendLimitResponse
> = {
  id: 'brex_create_spend_limit',
  name: 'Brex Create Spend Limit',
  description: 'Create a new spend limit (hard-authorization card program) in the Brex account',
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
      description: 'Name for the spend limit',
    },
    periodRecurrenceType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Period type of the spend limit (PER_WEEK, PER_MONTH, PER_QUARTER, PER_YEAR, ONE_TIME)',
    },
    spendType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Whether the spend limit can only be spent from cards it provisions (BUDGET_PROVISIONED_CARDS_ONLY, NON_BUDGET_PROVISIONED_CARDS_ALLOWED)',
    },
    expenseVisibility: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Whether expenses on this spend limit are viewable by all members (SHARED, PRIVATE)',
    },
    authorizationVisibility: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Whether the limit amount is visible to all members, or just controllers/bookkeepers/owners (PUBLIC, PRIVATE)',
    },
    limitIncreaseSetting: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether members can request limit increases (ENABLED, DISABLED)',
    },
    autoTransferCardsSetting: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'How auto transfer works for virtual cards on this spend limit (DISABLED, ENABLED)',
    },
    autoCreateLimitCardsSetting: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'How auto limit card creation works for members (DISABLED, ALL_MEMBERS)',
    },
    expensePolicyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the expense policy corresponding to this spend limit',
    },
    baseLimitAmount: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Base spend limit amount, without increases/rollovers, in the smallest unit of the currency (e.g., cents for USD)',
    },
    currency: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ISO 4217 currency code for the base limit (defaults to USD)',
    },
    authorizationType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Whether authorizations decline based on available balance (HARD, SOFT)',
    },
    rolloverRefreshRate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Recurrence at which rolled-over unused funds stop rolling over (OFF, NEVER, PER_MONTH, PER_QUARTER, PER_YEAR)',
    },
    limitBufferPercentage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Flexible buffer on the limit as a 0-100 percentage',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description of what the spend limit is used for',
    },
    parentBudgetId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'ID of the parent budget',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Date the spend limit should start counting (YYYY-MM-DD)',
    },
    endDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Date the spend limit should expire (YYYY-MM-DD)',
    },
    transactionLimitAmount: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Per-transaction limit this spend limit enforces, in the smallest unit of the currency',
    },
    ownerUserIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated user IDs of the spend limit owners',
    },
    memberUserIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated user IDs of the spend limit members',
    },
  },

  request: {
    url: () => `${BREX_API_BASE}/v2/spend_limits`,
    method: 'POST',
    headers: (params) => ({
      ...buildBrexHeaders(params.apiKey),
      'Idempotency-Key': generateId(),
    }),
    body: (params) => {
      const currency = params.currency || 'USD'
      const body: Record<string, unknown> = {
        name: params.name,
        period_recurrence_type: params.periodRecurrenceType,
        spend_type: params.spendType,
        expense_visibility: params.expenseVisibility,
        authorization_visibility: params.authorizationVisibility,
        limit_increase_setting: params.limitIncreaseSetting,
        auto_transfer_cards_setting: params.autoTransferCardsSetting,
        auto_create_limit_cards_setting: params.autoCreateLimitCardsSetting,
        expense_policy_id: params.expensePolicyId,
        authorization_settings: {
          base_limit: {
            amount: params.baseLimitAmount,
            currency,
          },
          authorization_type: params.authorizationType,
          rollover_refresh_rate: params.rolloverRefreshRate,
          ...(params.limitBufferPercentage !== undefined
            ? { limit_buffer_percentage: params.limitBufferPercentage }
            : {}),
        },
      }
      if (params.description) body.description = params.description
      if (params.parentBudgetId) body.parent_budget_id = params.parentBudgetId
      if (params.startDate) body.start_date = params.startDate
      if (params.endDate) body.end_date = params.endDate
      if (params.transactionLimitAmount !== undefined) {
        body.transaction_limit = { amount: params.transactionLimitAmount, currency }
      }
      const ownerUserIds = splitBrexIdList(params.ownerUserIds)
      if (ownerUserIds) body.owner_user_ids = ownerUserIds
      const memberUserIds = splitBrexIdList(params.memberUserIds)
      if (memberUserIds) body.member_user_ids = memberUserIds
      return body
    },
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
    status: { type: 'string', description: 'Spend limit status' },
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
