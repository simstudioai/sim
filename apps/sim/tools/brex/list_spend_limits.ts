import type { BrexListSpendLimitsParams, BrexListSpendLimitsResponse } from '@/tools/brex/types'
import { BREX_SPEND_LIMIT_PERIOD_BALANCE_PROPERTIES } from '@/tools/brex/types'
import {
  appendBrexArrayParam,
  appendBrexPagination,
  BREX_API_BASE,
  buildBrexHeaders,
  parseBrexJson,
} from '@/tools/brex/utils'
import type { ToolConfig } from '@/tools/types'

export const brexListSpendLimitsTool: ToolConfig<
  BrexListSpendLimitsParams,
  BrexListSpendLimitsResponse
> = {
  id: 'brex_list_spend_limits',
  name: 'Brex List Spend Limits',
  description: 'List spend limits in the Brex account, optionally filtered by member user',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Brex user token (generated from Developer Settings in the Brex dashboard)',
    },
    memberUserIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated user IDs to filter spend limits by member',
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
      description: 'Number of spend limits to return (default 100, max 1000)',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      appendBrexArrayParam(query, 'member_user_id[]', params.memberUserIds)
      appendBrexPagination(query, params)
      const queryString = query.toString()
      return queryString
        ? `${BREX_API_BASE}/v2/spend_limits?${queryString}`
        : `${BREX_API_BASE}/v2/spend_limits`
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
      description: 'Spend limits in the Brex account',
      items: {
        type: 'json',
        properties: {
          id: { type: 'string', description: 'Unique spend limit ID' },
          account_id: { type: 'string', description: 'Account ID the spend limit belongs to' },
          name: { type: 'string', description: 'Spend limit name' },
          description: { type: 'string', description: 'Spend limit description', optional: true },
          parent_budget_id: { type: 'string', description: 'Parent budget ID', optional: true },
          status: { type: 'string', description: 'Spend limit status' },
          period_recurrence_type: {
            type: 'string',
            description: 'Period recurrence (PER_WEEK, PER_MONTH, PER_QUARTER, PER_YEAR, ONE_TIME)',
          },
          spend_type: { type: 'string', description: 'Spend type of the limit' },
          start_date: { type: 'string', description: 'Spend limit start date', optional: true },
          end_date: { type: 'string', description: 'Spend limit end date', optional: true },
          owner_user_ids: { type: 'array', description: 'User IDs of the spend limit owners' },
          member_user_ids: { type: 'array', description: 'User IDs of the spend limit members' },
          current_period_balance: {
            type: 'json',
            description: 'Spend and rollover amounts for the current period',
            optional: true,
            properties: BREX_SPEND_LIMIT_PERIOD_BALANCE_PROPERTIES,
          },
          authorization_settings: {
            type: 'json',
            description:
              'Authorization settings (base limit, authorization type, rollover refresh)',
            optional: true,
          },
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
