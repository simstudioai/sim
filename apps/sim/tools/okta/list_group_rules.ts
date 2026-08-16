import { createLogger } from '@sim/logger'
import { validateOktaDomain } from '@/lib/core/security/input-validation'
import type {
  OktaGroupRule,
  OktaListGroupRulesParams,
  OktaListGroupRulesResponse,
} from '@/tools/okta/types'
import {
  mapOktaGroupRule,
  oktaHeaders,
  parseOktaPagination,
  throwOktaError,
} from '@/tools/okta/utils'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('OktaListGroupRules')

export const oktaListGroupRulesTool: ToolConfig<
  OktaListGroupRulesParams,
  OktaListGroupRulesResponse
> = {
  id: 'okta_list_group_rules',
  name: 'List Group Rules from Okta',
  description:
    'List the group rules in your Okta organization. Each rule assigns users to groups automatically based on an expression over their profile, so this shows how group membership is being driven.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Okta API token for authentication',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Okta domain (e.g., dev-123456.okta.com)',
    },
    search: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Keyword to search group rules for',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque pagination cursor returned as nextCursor by a previous call',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of rules to return (default: 50, max: 200)',
    },
  },

  request: {
    url: (params) => {
      const domain = validateOktaDomain(params.domain)
      const queryParams = new URLSearchParams()

      if (params.search) queryParams.append('search', params.search)
      if (params.after) queryParams.append('after', params.after)
      if (params.limit) queryParams.append('limit', params.limit.toString())

      const queryString = queryParams.toString()
      return queryString
        ? `https://${domain}/api/v1/groups/rules?${queryString}`
        : `https://${domain}/api/v1/groups/rules`
    },
    method: 'GET',
    headers: (params) => oktaHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      await throwOktaError(response, logger, 'Failed to list group rules from Okta')
    }

    const { nextCursor, hasMore } = parseOktaPagination(response)
    const data: OktaGroupRule[] = await response.json()
    const rules = data.map(mapOktaGroupRule)

    return {
      success: true,
      output: {
        rules,
        count: rules.length,
        nextCursor,
        hasMore,
        success: true,
      },
    }
  },

  outputs: {
    rules: {
      type: 'array',
      description: 'Array of group rules',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Group rule ID' },
          name: { type: 'string', description: 'Group rule name' },
          type: { type: 'string', description: 'Rule type, always group_rule' },
          status: { type: 'string', description: 'Rule status (ACTIVE, INACTIVE, INVALID)' },
          created: { type: 'string', description: 'Creation timestamp', optional: true },
          lastUpdated: { type: 'string', description: 'Last update timestamp', optional: true },
          expression: {
            type: 'string',
            description: 'Okta expression that decides which users the rule matches',
            optional: true,
          },
          expressionType: {
            type: 'string',
            description: 'Expression language, typically urn:okta:expression:1.0',
            optional: true,
          },
          assignUserToGroupIds: {
            type: 'array',
            description: 'Groups that matching users are assigned to',
            items: { type: 'string', description: 'Group ID' },
          },
          excludedUserIds: {
            type: 'array',
            description: 'Users excluded from the rule',
            items: { type: 'string', description: 'User ID' },
          },
          excludedGroupIds: {
            type: 'array',
            description:
              'Groups excluded from the rule. Always empty — Okta does not currently support group exclusions.',
            items: { type: 'string', description: 'Group ID' },
          },
        },
      },
    },
    count: { type: 'number', description: 'Number of rules returned' },
    nextCursor: {
      type: 'string',
      description: 'Cursor for the next page, or null on the last page',
      optional: true,
    },
    hasMore: { type: 'boolean', description: 'Whether more rules are available' },
    success: { type: 'boolean', description: 'Operation success status' },
  },
}
